import assert from "node:assert/strict"
import { test } from "node:test"
import { browseKey, createOnDemandSource, createTmdbCache, type MovieSource } from "../lib/discovery/on-demand"
import { createRound, resetDiscovery, resetRequestSchema, roundRequestSchema } from "../lib/discovery/service"
import { rankFreshMix, rankPersonalized, tasteAffinity } from "../lib/discovery/personalization"
import { STREAMING_SERVICES, type CatalogMovie, type DiscoveryMovie, type DiscoveryRound, type WatchPreferences } from "../lib/discovery/types"
import { parseTmdbMovie, parseTmdbPage } from "../lib/discovery/tmdb-source"
import type { DiscoveryStore } from "../lib/discovery/store"

const preferences: WatchPreferences = { mode: "home", services: ["prime"], region: "US", includeRentals: false }
const providers = STREAMING_SERVICES.map((service, index) => ({ provider_id: index + 10, provider_name: service.names[0] }))
const rawMovie = (id: number) => ({ id, title: `Film ${id}`, release_date: "2026-01-01", poster_path: "/poster.jpg", overview: "A test film.", genre_ids: [18], popularity: 100, vote_average: 8, vote_count: 200, original_language: "en" })
function fixture() {
  const calls: { path: string; params: Record<string, string> }[] = []
  const source = createOnDemandSource(async (path, params) => {
    calls.push({ path, params: { ...params } })
    if (path === "/watch/providers/movie") return { results: [...providers, { provider_id: 99, provider_name: "Amazon Prime Video with Ads" }, { provider_id: 999, provider_name: "Extra Amazon Channel" }, { provider_id: 777, provider_name: "Other Regional Service" }] }
    if (path.endsWith("/keywords")) return { keywords: [] }
    if (path.endsWith("/watch/providers")) return { results: { US: { flatrate: [{ provider_id: 11 }] } } }
    const base = Number(params.with_watch_providers?.split("|")[0] ?? 60) * 10000 + Number(params.page) * 100
    return { page: Number(params.page), total_pages: 5, total_results: 100, results: Array.from({ length: 20 }, (_, i) => rawMovie(i === 0 ? 999999 : base + i)) }
  })
  return { source, calls }
}

test("all featured streaming services use regional on-demand queries, without scanning catalogs", async () => {
  const { source, calls } = fixture()
  const result = await source({ ...preferences, services: STREAMING_SERVICES.map(service => service.key) }, null, 1, new Set())
  assert.equal(calls.length, 11)
  assert.equal(result.catalogs.length, 10)
  assert.deepEqual(result.missingCatalogs, [])
  assert.ok(result.movies.every(movie => !movie.sample && movie.posterPath === "/poster.jpg"))
  assert.ok(calls.slice(1).every(call => call.params.watch_region === "US" && call.params.page === "1" && call.params.sort_by === "popularity.desc"))
  assert.ok(calls.slice(1).every(call => !call.params.with_watch_monetization_types.includes("rent") && !call.params.with_watch_monetization_types.includes("buy")))
  assert.equal(calls.find(call => call.params.with_watch_providers?.startsWith("11"))?.params.with_watch_providers, "11|99")
  assert.ok(calls.every(call => !call.params.with_watch_providers?.includes("999")))
  const ranked = rankPersonalized(result.movies, null, [], new Set())
  assert.equal(ranked.length, 6)
  const common = result.movies.filter(movie => movie.tmdbId === 999999)
  assert.equal(rankPersonalized(common, null, [], new Set())[0].availableOn.length, 10)
})

test("additional regional providers work through the same path", async () => {
  const { source, calls } = fixture()
  const result = await source({ ...preferences, services: ["tmdb:777"], region: "CA" }, null, 1, new Set())
  assert.equal(calls.length, 2)
  assert.equal(calls[1].params.with_watch_providers, "777")
  assert.equal(calls[1].params.watch_region, "CA")
  assert.ok(result.movies.every(movie => movie.availableOn.join() === "Other Regional Service"))
})

test("progressive browsing pages forward and a selected film switches to its own related list", async () => {
  const { source, calls } = fixture()
  const first = await source(preferences, null, 1, new Set())
  const second = await source(preferences, null, 2, new Set())
  assert.equal(calls.length, 3, "Provider list and first page should be cached")
  assert.equal(calls[2].params.page, "2")
  assert.ok(second.movies.some(movie => !first.movies.some(previous => previous.tmdbId === movie.tmdbId)))
  await source(preferences, first.movies[0], 1, new Set())
  assert.ok(calls.some(call => call.path === `/movie/${first.movies[0].tmdbId}/recommendations`))
  assert.ok(calls.every(call => !call.params.with_genres))
  assert.ok(calls.filter(call => call.path === "/discover/movie").every(call => call.params.with_watch_providers === "11|99"))
  await source(preferences, null, 3, new Set())
  assert.ok(calls.some(call => call.params.sort_by === "vote_average.desc" && call.params["vote_count.gte"] === "50"))
})

test("rent/buy are opt-in and theaters use regional now-playing", async () => {
  const { source, calls } = fixture()
  await source({ ...preferences, services: [], includeRentals: true }, null, 1, new Set())
  assert.deepEqual(calls.map(call => call.params.with_watch_monetization_types), ["rent", "buy"])
  assert.ok(calls.every(call => !call.params.with_watch_providers))
  calls.length = 0
  await source({ ...preferences, mode: "theaters", region: "GB", services: [] }, null, 1, new Set())
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, "/movie/now_playing")
  assert.equal(calls[0].params.region, "GB")
})

test("missing services and failed sources never fall back to sample films or other providers", async () => {
  let calls = 0
  const source = createOnDemandSource(async () => { calls++; return { results: [] } })
  const missing = await source(preferences, null, 1, new Set())
  assert.equal(calls, 1)
  assert.deepEqual(missing.movies, [])
  assert.deepEqual(missing.missingCatalogs, ["US_prime"])
  const failing = createOnDemandSource(async () => { throw new Error("offline") })
  await assert.rejects(failing(preferences, null, 1, new Set()), /offline/)
})

test("page caches deduplicate concurrent requests, expire, and never retry failures or serve stale data", async () => {
  let calls = 0, now = 1000, fail = false
  const cached = createTmdbCache(async () => { calls++; if (fail) throw new Error("offline"); return { results: [] } }, () => now)
  await Promise.all(Array.from({ length: 8 }, () => cached("/discover/movie", { page: "1", watch_region: "US" })))
  assert.equal(calls, 1)
  await cached("/discover/movie", { watch_region: "US", page: "1" })
  assert.equal(calls, 1)
  now += 16 * 60 * 1000; fail = true
  await assert.rejects(cached("/discover/movie", { page: "1", watch_region: "US" }), /offline/)
  assert.equal(calls, 2)
  fail = false
  await cached("/discover/movie", { page: "1", watch_region: "US" })
  assert.equal(calls, 3)
})

test("rounds page forward through owned context, save only offered movies, and ignore legacy catalogs", async () => {
  const rounds = new Map<string, DiscoveryRound>(), pages: number[] = []
  const store = {
    takeQuota: async () => {}, getBrowseContext: async () => ({ page: 0, seenIds: [] }), getTaste: async () => ({ favorites: [1] }), getFavorite: async () => null,
    getRound: async (uid: string, id: string) => uid === "owner" ? rounds.get(id) ?? null : null,
    saveRound: async (_uid: string, round: DiscoveryRound) => { rounds.set(round.id, round) },
    getCatalog: async () => { throw new Error("Legacy catalogs must not be read") },
  } as unknown as DiscoveryStore
  const fixture = await createOnDemandSource(async (path, params) => path === "/watch/providers/movie" ? { results: providers } : { page: Number(params.page), total_pages: 2, total_results: 40, results: Array.from({ length: 20 }, (_, index) => rawMovie(index + 1)) })(preferences, null, 1, new Set())
  const source: MovieSource = async (_preferences, _seed, page) => { pages.push(page); return { ...fixture, page } }
  const first = await createRound(store, "owner", { preferences, seedId: null, excludeIds: [] }, source)
  assert.equal(first.movies.length, 6)
  assert.ok(first.movies.every(movie => movie.tmdbId !== 1))
  await createRound(store, "owner", { preferences, seedId: null, excludeIds: [], previousRoundId: first.id }, source)
  assert.deepEqual(pages, [1, 2])
  await assert.rejects(createRound(store, "stranger", { preferences, seedId: null, excludeIds: [], previousRoundId: first.id }, source), /no longer available/)
  const changed = await createRound(store, "owner", { preferences: { ...preferences, region: "CA" }, seedId: null, excludeIds: [], previousRoundId: first.id }, source)
  assert.equal(changed.browse?.page, 1)
  assert.equal(rounds.size, 3)
})

test("viewing choices, dynamic provider IDs and ownership inputs are validated", () => {
  assert.equal(roundRequestSchema.safeParse({ preferences, tasteVersion: 99 }).success, false)
  assert.equal(resetRequestSchema.safeParse({ uid: "somebody-else" }).success, false)
  assert.equal(resetRequestSchema.safeParse({}).success, true)
  assert.equal(roundRequestSchema.safeParse({ preferences: { ...preferences, services: [] } }).success, false)
  assert.equal(roundRequestSchema.safeParse({ preferences, uid: "somebody-else" }).success, false)
  assert.equal(roundRequestSchema.safeParse({ preferences: { ...preferences, region: "../../" } }).success, false)
  assert.equal(roundRequestSchema.safeParse({ preferences, excludeIds: Array(301).fill(1) }).success, false)
  assert.equal(roundRequestSchema.safeParse({ preferences: { ...preferences, services: ["tmdb:777"] } }).success, true)
  assert.equal(roundRequestSchema.safeParse({ preferences: { ...preferences, services: ["tmdb:0"] } }).success, false)
  assert.equal(roundRequestSchema.safeParse({ preferences: { ...preferences, services: ["invented"] } }).success, false)
  assert.equal(roundRequestSchema.safeParse({ preferences, history: [rawMovie(1)] }).success, false)
  assert.equal(roundRequestSchema.safeParse({ preferences, startingMovieId: 10 }).success, true)
  assert.equal(roundRequestSchema.safeParse({ preferences, startingMovieId: 0 }).success, false)
  assert.equal(roundRequestSchema.safeParse({ preferences, startingMovieId: 10, seedId: 20 }).success, false)
  assert.equal(roundRequestSchema.safeParse({ preferences, startingMovieId: 10, movie: rawMovie(10) }).success, false)
})

test("refreshes advance the saved catalog cursor and exclude recent exposures without a client round", async () => {
  const saved: DiscoveryRound[] = [], pages: number[] = []
  const store = {
    takeQuota: async () => {}, getTaste: async () => ({ favorites: [], tasteVersion: 3 }),
    getBrowseContext: async (uid: string, key: string) => {
      assert.equal(uid, "owner")
      return { page: saved.filter(round => round.browse?.key === key).at(-1)?.browse?.page ?? 0, seenIds: saved.flatMap(round => round.movies.map(movie => movie.tmdbId)) }
    },
    getRound: async () => saved[0],
    saveRound: async (_uid: string, round: DiscoveryRound) => { saved.push(round) },
  } as unknown as DiscoveryStore
  const source: MovieSource = async (_preferences, _seed, page, excluded) => {
    pages.push(page)
    assert.ok(saved.flatMap(round => round.movies).every(movie => excluded.has(movie.tmdbId)))
    return { movies: Array.from({ length: 30 }, (_, i) => relation(movie(100 + i), movie(1))), catalogs: [], missingCatalogs: [], page }
  }
  const input = { preferences, seedId: null, excludeIds: [] }
  const first = await createRound(store, "owner", input, source)
  const second = await createRound(store, "owner", input, source)
  const third = await createRound(store, "owner", { ...input, previousRoundId: first.id }, source)
  assert.deepEqual(pages, [1, 2, 3])
  assert.equal(new Set([...first.movies, ...second.movies, ...third.movies].map(movie => movie.tmdbId)).size, 18)
  assert.equal(third.tasteVersion, 3)
})

test("fresh mixes spread across services and genres despite a single-genre history", () => {
  const genres = [27, 35, 878, 99, 10749, 16, 80, 37, 10402, 36]
  const pool = genres.flatMap((genre, i) => Array.from({ length: 8 }, (_, j) => ({ ...relation(movie(i * 100 + j + 1), movie(9999)), genreIds: [genre], availableOn: [`Service ${i}`] })))
  const history = Array.from({ length: 20 }, (_, i) => ({ ...movie(10000 + i), genreIds: [27] }))
  const first = rankFreshMix(pool, history, new Set(), "first")
  assert.equal(first.length, 6)
  assert.equal(new Set(first.map(movie => movie.genreIds[0])).size, 6)
  assert.equal(new Set(first.flatMap(movie => movie.availableOn)).size, 6)
  assert.ok(first.filter(movie => movie.genreIds.includes(27)).length <= 1)
  assert.deepEqual(rankFreshMix(pool, history, new Set(), "first"), first)
  assert.notDeepEqual(rankFreshMix(pool, history, new Set(), "second").map(movie => movie.tmdbId), first.map(movie => movie.tmdbId))
})

test("when a small catalog repeats, unseen films keep their places before neutral repeats", async () => {
  const candidates = Array.from({ length: 8 }, (_, i) => relation(movie(100 + i), movie(1)))
  const store = {
    takeQuota: async () => {}, getTaste: async () => ({ favorites: [100] }),
    getBrowseContext: async () => ({ page: 1, seenIds: [101, 102, 103, 104, 105] }), saveRound: async () => {},
  } as unknown as DiscoveryStore
  const source: MovieSource = async (_p, _s, page) => ({ movies: candidates, catalogs: [], missingCatalogs: [], page })
  const result = await createRound(store, "owner", { preferences, seedId: null, excludeIds: [] }, source)
  assert.equal(result.movies.length, 6)
  assert.deepEqual(new Set(result.movies.slice(0, 2).map(movie => movie.tmdbId)), new Set([106, 107]))
  assert.ok(result.movies.every(movie => movie.tmdbId !== 100))
})

test("taste reset uses the verified guest and preserves throttling", async () => {
  const calls: string[] = []
  const store = { takeQuota: async (uid: string) => { calls.push(`quota:${uid}`) }, resetTaste: async (uid: string) => { calls.push(`reset:${uid}`) } } as unknown as DiscoveryStore
  await resetDiscovery(store, "verified-guest")
  assert.deepEqual(calls, ["quota:verified-guest", "reset:verified-guest"])
  store.takeQuota = async () => { throw new Error("Take a moment") }
  await assert.rejects(resetDiscovery(store, "verified-guest"), /Take a moment/)
  assert.equal(calls.length, 2)
})

function movie(id: number, extra: Partial<CatalogMovie> = {}): CatalogMovie {
  return { ...parseTmdbPage({ page: 1, total_pages: 1, total_results: 1, results: [rawMovie(id)] }).movies[0], ...extra }
}
function relation(candidate: CatalogMovie, seed: CatalogMovie, rank = 0): DiscoveryMovie {
  return { ...candidate, sample: false, availableOn: ["Prime Video"], reason: "", relations: [{ seedId: seed.tmdbId, seedTitle: seed.title, kind: "recommendation", rank }] }
}
function pageOf(ids: number[], page = 1) { return { page, total_pages: 1, total_results: ids.length, results: ids.map(rawMovie) } }

test("starting-movie details use canonical genres and reject adult or malformed records", () => {
  const details = { ...rawMovie(10), adult: false, genres: [{ id: 878, name: "Science Fiction" }], overview: "An astronaut explores distant planets." }
  const parsed = parseTmdbMovie(details)
  assert.equal(parsed.tmdbId, 10)
  assert.deepEqual(parsed.genreIds, [878])
  assert.equal(parsed.releaseYear, 2026)
  assert.equal(parsed.posterPath, "/poster.jpg")
  assert.throws(() => parseTmdbMovie({ ...details, adult: true }))
  assert.throws(() => parseTmdbMovie({ ...details, genres: [{ id: "invalid" }] }))
})

test("searched titles start related rounds without an implicit favorite and keep the guest's earlier taste", async () => {
  const searched = movie(10, { genreIds: [878] }), earlier = movie(20, { genreIds: [878] })
  const rounds = new Map<string, DiscoveryRound>(), observedPages: number[] = []
  let lookups = 0, writes = 0, quota = 0
  const store = {
    takeQuota: async () => { quota++ },
    getTaste: async (uid: string) => uid === "owner" ? { favorites: [20], history: [{ movie: earlier, createdAt: "2026-11-09" }] } : { favorites: [], history: [] },
    getFavorite: async () => null,
    getRound: async (uid: string, id: string) => uid === "owner" ? rounds.get(id) ?? null : null,
    saveRound: async (_uid: string, round: DiscoveryRound) => { rounds.set(round.id, round) },
    pick: async () => { writes++ },
  } as unknown as DiscoveryStore
  const resolve = async (id: number) => { assert.ok(quota > 0, "Rate limiting happens before the movie lookup"); assert.equal(id, searched.tmdbId); lookups++; return searched }
  const source: MovieSource = async (watch, seed, page, _excluded, history) => {
    assert.deepEqual(watch, preferences)
    assert.equal(seed?.tmdbId, searched.tmdbId)
    assert.deepEqual(history?.map(movie => movie.tmdbId), [20])
    observedPages.push(page)
    return { movies: [relation(movie(101, { genreIds: [878] }), searched)], catalogs: [], missingCatalogs: [], page }
  }
  const first = await createRound(store, "owner", { preferences, seedId: null, startingMovieId: 10, excludeIds: [] }, source, resolve)
  assert.equal(first.seed?.tmdbId, 10)
  assert.equal(first.movies[0].tmdbId, 101)
  assert.equal(first.selectedId, null)
  assert.equal(writes, 0, "Choosing a search result must not create a favorite")
  await createRound(store, "owner", { preferences, seedId: 10, previousRoundId: first.id, excludeIds: [] }, source, resolve)
  assert.deepEqual(observedPages, [1, 2])
  assert.equal(lookups, 1, "Later mixes reuse the seed from an owned round")
  await assert.rejects(createRound(store, "owner", { preferences, seedId: 999, previousRoundId: first.id, excludeIds: [] }, source, resolve), /Choose a favorite/)
  await assert.rejects(createRound(store, "stranger", { preferences, seedId: 10, previousRoundId: first.id, excludeIds: [] }, source, resolve), /no longer available/)
  await assert.rejects(createRound(store, "stranger", { preferences, seedId: null, startingMovieId: 10, previousRoundId: first.id, excludeIds: [] }, source, resolve), /no longer available/)
  assert.equal(lookups, 1)
  assert.equal(writes, 0)
})

test("a failed starting-movie lookup does not fall back to popular films or save a round", async () => {
  let saved = 0, requested = 0
  const store = { takeQuota: async () => {}, getBrowseContext: async () => ({ page: 0, seenIds: [] }), getTaste: async () => ({ favorites: [] }), saveRound: async () => { saved++ } } as unknown as DiscoveryStore
  const source: MovieSource = async () => { requested++; throw new Error("Unexpected fallback") }
  await assert.rejects(createRound(store, "owner", { preferences, seedId: null, startingMovieId: 10, excludeIds: [] }, source, async () => { throw new Error("Movie unavailable") }), /Movie unavailable/)
  assert.equal(requested, 0)
  assert.equal(saved, 0)
})

test("different picked movies with identical genres produce different related batches, never generic popular substitutes", async () => {
  const calls: string[] = []
  const source = createOnDemandSource(async path => {
    calls.push(path)
    if (path === "/watch/providers/movie") return { results: providers }
    if (path.endsWith("/keywords")) return { keywords: [] }
    if (path.endsWith("/watch/providers")) return { results: { US: { flatrate: [{ provider_id: 11 }] } } }
    if (path.endsWith("/similar")) return pageOf([])
    if (path === "/movie/10/recommendations") return pageOf(Array.from({ length: 10 }, (_, i) => 101 + i))
    if (path === "/movie/20/recommendations") return pageOf(Array.from({ length: 10 }, (_, i) => 201 + i))
    throw new Error("A seeded round must not query generic discovery")
  })
  const firstSeed = movie(10), secondSeed = movie(20)
  assert.notEqual(browseKey(preferences, firstSeed), browseKey(preferences, secondSeed), "A new movie ID must reset pagination even when genres match")
  const first = await source(preferences, firstSeed, 1, new Set())
  const second = await source(preferences, secondSeed, 1, new Set())
  const a = rankPersonalized(first.movies, firstSeed, [], new Set()), b = rankPersonalized(second.movies, secondSeed, [], new Set())
  assert.equal(a.length, 6); assert.equal(b.length, 6)
  assert.ok(a.every(movie => movie.tmdbId >= 101 && movie.tmdbId <= 110))
  assert.ok(b.every(movie => movie.tmdbId >= 201 && movie.tmdbId <= 210))
  assert.ok(calls.every(path => !path.includes("/discover/")))
})

test("earlier preferences materially reorder the same related pool; unrelated blockbusters cannot enter it", () => {
  const seed = movie(10, { genreIds: [18], overview: "" })
  const space = movie(101, { genreIds: [18, 878], overview: "Astronauts navigate spacecraft beyond distant planets." })
  const comedy = movie(102, { genreIds: [18, 35], overview: "Comedians perform standup routines inside comedy clubs." })
  const unrelated = { ...relation(movie(999, { popularity: 1000000, voteAverage: 10 }), movie(55)), relations: [] }
  const pool = [relation(space, seed), relation(comedy, seed), unrelated]
  const spaceHistory = [movie(51, { genreIds: [878], overview: space.overview })]
  const comedyHistory = [movie(52, { genreIds: [35], overview: comedy.overview })]
  assert.equal(rankPersonalized(pool, seed, spaceHistory, new Set())[0].tmdbId, 101)
  assert.equal(rankPersonalized(pool, seed, comedyHistory, new Set())[0].tmdbId, 102)
  assert.ok(rankPersonalized(pool, seed, comedyHistory, new Set()).every(movie => movie.tmdbId !== 999))
  const previous = Array.from({ length: 40 }, (_, i) => movie(1000 + i, { genreIds: [], overview: "" }))
  assert.ok(tasteAffinity(space, [...previous, ...spaceHistory]) > tasteAffinity(space, previous), "Older picks beyond the recent lookup window must still influence taste")
})

test("seeded streaming checks enforce country, exact providers and rent/buy opt-in; short batches stay related", async () => {
  const source = createOnDemandSource(async path => {
    if (path === "/watch/providers/movie") return { results: providers }
    if (path.endsWith("/recommendations")) return pageOf([101, 102, 103, 104, 105, 106, 107])
    if (path.endsWith("/similar")) return pageOf([])
    if (path.endsWith("/keywords")) return { keywords: [] }
    const id = Number(path.split("/")[2])
    const offers = {
      101: { US: { rent: [{ provider_id: 11 }] } },
      102: { US: { flatrate: [{ provider_id: 15 }] } },
      103: { CA: { flatrate: [{ provider_id: 11 }] } },
      104: { US: { flatrate: [{ provider_id: 999 }] } },
      105: { US: { flatrate: [{ provider_id: 11 }] } },
      106: { US: { ads: [{ provider_id: 11 }] } },
      107: { US: { buy: [{ provider_id: 11 }] } },
    }[id]
    if (!offers) throw new Error("Unexpected movie query")
    return { results: offers }
  })
  const seed = movie(10)
  const included = await source(preferences, seed, 1, new Set())
  assert.deepEqual(included.movies.map(movie => movie.tmdbId).sort(), [105, 106])
  const paid = await source({ ...preferences, includeRentals: true }, seed, 1, new Set())
  assert.deepEqual(paid.movies.map(movie => movie.tmdbId).sort(), [101, 105, 106, 107])
  assert.deepEqual(paid.movies.find(movie => movie.tmdbId === 101)?.availableOn, ["Rent"])
  assert.deepEqual(paid.movies.find(movie => movie.tmdbId === 107)?.availableOn, ["Buy"])
})

test("older film-to-film support helps rank current matches without introducing history-only candidates", async () => {
  const source = createOnDemandSource(async path => {
    if (path === "/watch/providers/movie") return { results: providers }
    if (path === "/movie/10/recommendations") return pageOf([101, 102])
    if (path === "/movie/50/recommendations") return pageOf([102, 999])
    if (path.endsWith("/similar")) return pageOf([])
    if (path.endsWith("/keywords")) return { keywords: [] }
    if (path.endsWith("/watch/providers")) return { results: { US: { flatrate: [{ provider_id: 11 }] } } }
    throw new Error("No general discovery fallback")
  })
  const seed = movie(10), earlier = movie(50)
  const result = await source(preferences, seed, 1, new Set(), [seed, earlier])
  const ranked = rankPersonalized(result.movies, seed, [seed, earlier], new Set())
  assert.equal(ranked[0].tmdbId, 102)
  assert.ok(ranked[0].reason.includes(earlier.title))
  assert.ok(ranked.every(movie => movie.tmdbId !== 999))
})

test("a related film must also be in the regional current-theater list", async () => {
  const source = createOnDemandSource(async path => {
    if (path === "/movie/now_playing") return pageOf([101])
    if (path.endsWith("/recommendations")) return pageOf([101, 102])
    if (path.endsWith("/similar")) return pageOf([])
    throw new Error("Theaters must not use streaming availability")
  })
  const result = await source({ ...preferences, mode: "theaters", services: [] }, movie(10), 1, new Set())
  assert.deepEqual(result.movies.map(movie => movie.tmdbId), [101])
  assert.deepEqual(result.movies[0].availableOn, ["In theaters"])
})

test("a fresh mix uses the verified guest's saved history without trapping them on the previous seed", async () => {
  const recent = movie(10), earlier = movie(20), offered = relation(movie(101), recent)
  let supplied: CatalogMovie[] = []
  const store = {
    takeQuota: async () => {}, getBrowseContext: async () => ({ page: 0, seenIds: [] }),
    getTaste: async (uid: string) => { assert.equal(uid, "owner"); return { favorites: [10, 20], history: [{ movie: recent, createdAt: "2026-11-08" }, { movie: earlier, createdAt: "2026-11-07" }] } },
    saveRound: async () => {},
  } as unknown as DiscoveryStore
  const source: MovieSource = async (_preferences, seed, page, _excluded, history) => {
    assert.equal(seed, null); supplied = history ?? []
    return { movies: [offered], catalogs: [], missingCatalogs: [], page }
  }
  const result = await createRound(store, "owner", { preferences, seedId: null, excludeIds: [] }, source)
  assert.deepEqual(supplied.map(movie => movie.tmdbId), [10, 20])
  assert.equal(result.seed, null)
  assert.equal(result.movies[0].tmdbId, 101)
})

test("unavailable direct matches use seed-specific plot keywords on selected services, with exact offer checks", async () => {
  let offerChecks = 0, keywordQueries = 0
  const source = createOnDemandSource(async (path, params) => {
    if (path === "/watch/providers/movie") return { results: providers }
    if (path.endsWith("/recommendations")) return pageOf(Array.from({ length: 20 }, (_, i) => 1 + i))
    if (path.endsWith("/similar")) return pageOf([])
    if (path.endsWith("/keywords")) return { keywords: [{ id: 77, name: "first contact" }, { id: 88, name: "based on novel or book" }] }
    if (path === "/discover/movie") {
      keywordQueries++
      assert.equal(params.with_keywords, "77")
      assert.equal(params.with_watch_providers, "11")
      assert.equal(params.watch_region, "US")
      assert.ok(!params.with_watch_monetization_types.includes("rent"))
      return pageOf(Array.from({ length: 8 }, (_, i) => 101 + i))
    }
    if (path.endsWith("/watch/providers")) {
      offerChecks++
      const id = Number(path.split("/")[2])
      return { results: { US: { flatrate: [{ provider_id: id >= 101 ? 11 : 999 }] } } }
    }
    throw new Error("Unexpected query")
  })
  const seed = movie(1000)
  const result = await source(preferences, seed, 1, new Set())
  assert.equal(keywordQueries, 1)
  assert.ok(offerChecks <= 16)
  const ranked = rankPersonalized(result.movies, seed, [], new Set())
  assert.equal(ranked.length, 6)
  assert.ok(ranked.every(movie => movie.tmdbId >= 101 && movie.relations?.some(relation => relation.kind === "keywords")))
  assert.ok(ranked.every(movie => movie.reason.includes("Shared plot keywords")))
})

test("sparse availability has a strict 16-film verification cap, without generic-keyword padding", async () => {
  let checks = 0
  const source = createOnDemandSource(async path => {
    if (path === "/watch/providers/movie") return { results: providers }
    if (path.endsWith("/recommendations")) return pageOf(Array.from({ length: 20 }, (_, i) => 101 + i))
    if (path.endsWith("/similar")) return pageOf(Array.from({ length: 20 }, (_, i) => 201 + i))
    if (path.endsWith("/keywords")) return { keywords: [{ id: 88, name: "sequel" }] }
    if (path.endsWith("/watch/providers")) { checks++; return { results: {} } }
    throw new Error("No generic discovery or full-catalog scan")
  })
  const result = await source(preferences, movie(10), 1, new Set())
  assert.equal(checks, 16)
  assert.deepEqual(result.movies, [])
})

test("a shared broad drama category cannot override the selected film's distinctive genre", () => {
  const arrival = movie(10, { genreIds: [18, 878, 9648] })
  const grandHotel = movie(20, { genreIds: [35, 18] })
  const offTheme = movie(101, { genreIds: [18, 10749], popularity: 100000 })
  assert.deepEqual(rankPersonalized([relation(offTheme, arrival)], arrival, [], new Set()), [])
  assert.deepEqual(rankPersonalized([relation(offTheme, grandHotel)], grandHotel, [], new Set()), [])
  assert.equal(rankPersonalized([relation(movie(102, { genreIds: [878, 18] }), arrival)], arrival, [], new Set()).length, 1)
  assert.equal(rankPersonalized([relation(movie(103, { genreIds: [35, 80] }), grandHotel)], grandHotel, [], new Set()).length, 1)
})
