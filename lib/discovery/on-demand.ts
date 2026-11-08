import { z } from "zod"
import { DiscoveryError } from "./errors"
import { parseTmdbPage, type CatalogPage } from "./tmdb-source"
import { anchorGenre, rankPersonalized, representativePicks } from "./personalization"
import { catalogKey, STREAMING_SERVICES, type CatalogMovie, type DiscoveryMovie, type DiscoveryRound, type MovieRelation, type ServiceOption, type WatchPreferences } from "./types"

type JsonRequest = (path: string, params: Record<string, string>) => Promise<unknown>
type CachedValue = { data: unknown; checkedAt: number; expiresAt: number }
const PAGE_TTL = 15 * 60 * 1000
const PROVIDER_TTL = 12 * 60 * 60 * 1000

export function createTmdbCache(request: JsonRequest, now = Date.now) {
  const entries = new Map<string, CachedValue>(), pending = new Map<string, Promise<CachedValue>>()
  return async (path: string, params: Record<string, string>): Promise<CachedValue> => {
    const key = JSON.stringify([path, Object.entries(params).sort(([a], [b]) => a.localeCompare(b))])
    const cached = entries.get(key)
    if (cached && cached.expiresAt > now()) return cached
    if (pending.has(key)) return pending.get(key)!
    const operation = (async () => {
      const data = await request(path, params)
      const checkedAt = now(), value = { data, checkedAt, expiresAt: checkedAt + (path === "/watch/providers/movie" ? PROVIDER_TTL : PAGE_TTL) }
      entries.delete(key); entries.set(key, value)
      while (entries.size > 240) entries.delete(entries.keys().next().value!)
      return value
    })().finally(() => pending.delete(key))
    pending.set(key, operation)
    return operation
  }
}

const providersSchema = z.object({ results: z.array(z.object({ provider_id: z.number().int().positive(), provider_name: z.string() })) })
const keywordsSchema = z.object({ keywords: z.array(z.object({ id: z.number().int().positive(), name: z.string() })) })
const GENERIC_KEYWORDS = new Set(["based on novel or book", "based on short story", "based on play or musical", "based on a true story", "based on true story", "sequel", "remake", "friendship", "love", "death", "murder", "family", "female protagonist", "male protagonist", "new york city", "los angeles", "london", "usa", "nudity", "sex", "husband wife relationship", "marriage", "military", "wartime", "period drama", "european", "eastern europe", "author", "duringcreditsstinger", "time", "loss", "heartbreak", "flashback", "nonlinear timeline", "1960s", "1930s", "science fiction", "hilarious", "hopeful", "complex", "wistful", "incredulous"])
const offerProviders = z.array(z.object({ provider_id: z.number().int().positive() }))
const availabilitySchema = z.object({ results: z.record(z.object({
  flatrate: offerProviders.optional(), free: offerProviders.optional(), ads: offerProviders.optional(),
  rent: offerProviders.optional(), buy: offerProviders.optional(),
})) })
export type BrowseResult = { movies: DiscoveryMovie[]; catalogs: DiscoveryRound["catalogs"]; missingCatalogs: string[]; page: number }
export type MovieSource = (preferences: WatchPreferences, seed: CatalogMovie | null, page: number, excluded: Set<number>, history?: CatalogMovie[]) => Promise<BrowseResult>

export function browseKey(preferences: WatchPreferences, seed: CatalogMovie | null) {
  return JSON.stringify([preferences.mode, preferences.region, [...preferences.services].sort(), preferences.includeRentals, seed?.tmdbId ?? null])
}

/** Fetches only requested pages. It never walks a catalog or publishes a snapshot. */
export function createOnDemandSource(request: JsonRequest, cachedRequest = createTmdbCache(request)): MovieSource {
  return async (preferences, seed, firstPage, excluded, history = []) => {
    let requests = 0
    async function cached(path: string, params: Record<string, string>) {
      // Counts attempted page lookups too, so each browse remains strictly bounded.
      if (++requests > 90) throw new DiscoveryError("Try fewer services for this mix.", 503)
      return cachedRequest(path, params)
    }
    const targets: { key: string; service: string; label: string; ids: number[]; access: string }[] = [], missingCatalogs: string[] = []
    if (preferences.mode === "theaters") targets.push({ key: catalogKey(preferences.region, "theaters"), service: "theaters", label: "In theaters", ids: [], access: "theaters" })
    else {
      if (preferences.services.length) {
        const response = await cached("/watch/providers/movie", { watch_region: preferences.region })
        const providers = providersSchema.parse(response.data).results
        for (const key of preferences.services) {
          const service = STREAMING_SERVICES.find(service => service.key === key)
          const matching = providers.filter(provider => service ? service.names.some(name => name.toLowerCase() === provider.provider_name.toLowerCase()) : key === `tmdb:${provider.provider_id}`)
          const ids = [...new Set(matching.map(provider => provider.provider_id))]
          if (ids.length) targets.push({ key: catalogKey(preferences.region, key), service: key, label: service?.label ?? matching[0].provider_name, ids, access: "flatrate|free|ads" })
          else missingCatalogs.push(catalogKey(preferences.region, key))
        }
      }
      if (preferences.includeRentals) targets.push({ key: catalogKey(preferences.region, "rentals"), service: "rentals", label: "Rent", ids: [], access: "rent" }, { key: catalogKey(preferences.region, "purchases"), service: "purchases", label: "Buy", ids: [], access: "buy" })
    }
    const movies: DiscoveryMovie[] = [], health = new Map<string, DiscoveryRound["catalogs"][number]>()
    let page = firstPage

    if (seed && targets.length) {
      const related = new Map<number, DiscoveryMovie>(), historicalLinks = new Map<number, MovieRelation[]>()
      const available = new Map<number, DiscoveryMovie>(), checked = new Set<number>()
      let checkedAt = Date.now(), availabilityChecks = 0
      const saved = new Set(history.map(movie => movie.tmdbId))
      saved.add(seed.tmdbId)
      let theaterIds: Set<number> | null = null
      if (preferences.mode === "theaters") {
        theaterIds = new Set<number>()
        const first = parseTmdbPage((await cached("/movie/now_playing", { language: "en-US", region: preferences.region, page: "1" })).data)
        first.movies.forEach(movie => theaterIds!.add(movie.tmdbId))
        if (first.totalPages > 1) parseTmdbPage((await cached("/movie/now_playing", { language: "en-US", region: preferences.region, page: "2" })).data).movies.forEach(movie => theaterIds!.add(movie.tmdbId))
      }
      async function linkedPage(movie: CatalogMovie, kind: "recommendation" | "similar", requested: number) {
        const path = `/movie/${movie.tmdbId}/${kind === "recommendation" ? "recommendations" : "similar"}`
        const params = { language: "en-US", page: "1" }
        const first = parseTmdbPage((await cached(path, params)).data)
        if (requested > Math.min(500, first.totalPages)) return []
        const result = requested === 1 ? first : parseTmdbPage((await cached(path, { ...params, page: String(requested) })).data)
        if (result.page !== requested) throw new DiscoveryError("Related movies returned an invalid page. Please try again.", 503)
        return result.movies.map((candidate, index) => ({ candidate, relation: { seedId: movie.tmdbId, seedTitle: movie.title, kind, rank: (requested - 1) * 20 + index } satisfies MovieRelation }))
      }
      // Earlier movies support ranking; they never introduce candidates unrelated to the current pick.
      for (const picked of representativePicks(history, seed)) {
        for (const { candidate, relation } of await linkedPage(picked, "recommendation", 1)) {
          historicalLinks.set(candidate.tmdbId, [...(historicalLinks.get(candidate.tmdbId) ?? []), relation])
        }
      }
      for (const kind of ["recommendation", "similar"] as const) {
        for (const { candidate, relation } of await linkedPage(seed, kind, firstPage)) {
          const existing = related.get(candidate.tmdbId)
          if (existing) existing.relations!.push(relation)
          else related.set(candidate.tmdbId, { ...candidate, sample: false, reason: "", availableOn: [], relations: [relation, ...(historicalLinks.get(candidate.tmdbId) ?? [])] })
        }
      }
      function ordered(candidates: DiscoveryMovie[]) {
        return rankPersonalized(candidates, seed, history, saved, 80).filter(movie => !checked.has(movie.tmdbId))
          .sort((a, b) => Number(excluded.has(a.tmdbId)) - Number(excluded.has(b.tmdbId)))
      }
      async function verify(candidates: DiscoveryMovie[], limit: number) {
        for (let offset = 0; offset < candidates.length && availabilityChecks < limit; offset += 4) {
          const batch = candidates.slice(offset, offset + Math.min(4, limit - availabilityChecks))
          availabilityChecks += batch.length
          const verified = await Promise.all(batch.map(async movie => {
            checked.add(movie.tmdbId)
            if (theaterIds) return theaterIds.has(movie.tmdbId) ? { ...movie, availableOn: ["In theaters"] } : null
            const response = await cached(`/movie/${movie.tmdbId}/watch/providers`, {})
            checkedAt = Math.min(checkedAt, response.checkedAt)
            const offers = availabilitySchema.parse(response.data).results[preferences.region]
            if (!offers) return null
            const included = new Set([...(offers.flatrate ?? []), ...(offers.free ?? []), ...(offers.ads ?? [])].map(provider => provider.provider_id))
            const labels = targets.filter(target => target.access === "rent" ? offers.rent?.length : target.access === "buy" ? offers.buy?.length : target.ids.some(id => included.has(id))).map(target => target.label)
            return labels.length ? { ...movie, availableOn: [...new Set(labels)] } : null
          }))
          verified.forEach(movie => { if (movie) available.set(movie.tmdbId, movie) })
          if ([...available.values()].filter(movie => !excluded.has(movie.tmdbId)).length >= 6) break
        }
      }
      await verify(ordered([...related.values()]), 8)
      if ([...available.values()].filter(movie => !excluded.has(movie.tmdbId)).length < 6 && preferences.mode === "home") {
        const response = await cached(`/movie/${seed.tmdbId}/keywords`, {})
        const keywords = keywordsSchema.parse(response.data).keywords.filter(keyword => keyword.name.length >= 4 && !GENERIC_KEYWORDS.has(keyword.name.toLowerCase()))
          .sort((a, b) => Number(seed.overview.toLowerCase().includes(b.name.toLowerCase())) - Number(seed.overview.toLowerCase().includes(a.name.toLowerCase())) || b.name.split(" ").length - a.name.split(" ").length).slice(0, 8)
        if (keywords.length) {
          const ids = [...new Set(targets.flatMap(target => target.ids))]
          const params: Record<string, string> = { language: "en-US", page: "1", watch_region: preferences.region, include_adult: "false", include_video: "false", sort_by: "popularity.desc", with_keywords: keywords.map(keyword => keyword.id).join("|"), with_watch_monetization_types: preferences.includeRentals ? "flatrate|free|ads|rent|buy" : "flatrate|free|ads" }
          if (!preferences.includeRentals) params.with_watch_providers = ids.join("|")
          const anchor = anchorGenre(seed)
          if (anchor !== undefined) params.with_genres = String(anchor)
          const first = parseTmdbPage((await cached("/discover/movie", params)).data)
          const actualPage = ((firstPage - 1) % Math.max(1, Math.min(500, first.totalPages))) + 1
          const result = actualPage === 1 ? first : parseTmdbPage((await cached("/discover/movie", { ...params, page: String(actualPage) })).data)
          if (result.page !== actualPage) throw new DiscoveryError("Related movies returned an invalid page. Please try again.", 503)
          const keywordMatches = result.movies.map((candidate, rank): DiscoveryMovie => {
            const existing = related.get(candidate.tmdbId)
            return { ...candidate, sample: false, reason: "", availableOn: [], relations: [...(existing?.relations ?? historicalLinks.get(candidate.tmdbId) ?? []), { seedId: seed.tmdbId, seedTitle: seed.title, kind: "keywords", rank }] }
          })
          await verify(ordered(keywordMatches), 16)
        }
      }
      if ([...available.values()].filter(movie => !excluded.has(movie.tmdbId)).length < 6) await verify(ordered([...related.values()]), 16)
      for (const target of targets) health.set(target.key, {
        key: target.key, label: target.label, source: "tmdb", checkedAt: new Date(checkedAt).toISOString(),
        refreshAfter: new Date(checkedAt + PAGE_TTL).toISOString(), stale: false,
        movieCount: [...available.values()].filter(movie => movie.availableOn.includes(target.label)).length,
      })
      return { movies: [...available.values()], catalogs: [...health.values()], missingCatalogs, page: firstPage }
    }

    async function collect(target: typeof targets[number], requestedPage: number) {
      const path = target.access === "theaters" ? "/movie/now_playing" : "/discover/movie"
      const params: Record<string, string> = { language: "en-US", page: "1" }
      if (target.access === "theaters") params.region = preferences.region
      else {
        Object.assign(params, { watch_region: preferences.region, with_watch_monetization_types: target.access, include_adult: "false", include_video: "false", sort_by: requestedPage % 3 === 0 ? "vote_average.desc" : "popularity.desc" })
        if (requestedPage % 3 === 0) params["vote_count.gte"] = "50"
        if (target.ids.length) params.with_watch_providers = target.ids.join("|")
      }
      let response = await cached(path, params), result: CatalogPage = parseTmdbPage(response.data)
      const actualPage = ((requestedPage - 1) % Math.max(1, Math.min(500, result.totalPages))) + 1
      if (actualPage !== 1) {
        response = await cached(path, { ...params, page: String(actualPage) })
        result = parseTmdbPage(response.data)
      }
      if (result.page !== actualPage) throw new DiscoveryError("Movie availability returned an invalid page. Please try again.", 503)
      movies.push(...result.movies.map(movie => ({ ...movie, availableOn: [target.label], sample: false, reason: "" })))
      const previous = health.get(target.key)
      const checkedAt = new Date(Math.min(response.checkedAt, previous ? Date.parse(previous.checkedAt) : Infinity)).toISOString()
      health.set(target.key, { key: target.key, label: target.label, source: "tmdb", checkedAt, refreshAfter: new Date(Date.parse(checkedAt) + PAGE_TTL).toISOString(), movieCount: result.totalResults, stale: false })
    }
    // A second requested page is useful when saved/seen choices exhaust the first.
    for (let pass = 0; pass < 2; pass++, page++) {
      for (const target of targets) await collect(target, page)
      if (new Set(movies.filter(movie => !excluded.has(movie.tmdbId) && movie.tmdbId !== seed?.tmdbId).map(movie => movie.tmdbId)).size >= 6) break
    }
    return { movies, catalogs: [...health.values()], missingCatalogs, page: Math.min(page, firstPage + 1) }
  }
}

let upstreamRequests = 0
async function requestTmdb(path: string, params: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.TMDB_API_KEY ?? process.env.NEXT_PUBLIC_TMDB_API_KEY
  if (!apiKey) throw new DiscoveryError("Movie browsing needs the existing TMDB development configuration.", 503)
  const limit = process.env.FILMPULSE_TMDB_REQUEST_LIMIT
  if (limit && (!/^\d+$/.test(limit) || Number(limit) < 1)) throw new DiscoveryError("The local API request budget is invalid.", 503)
  if (limit && upstreamRequests >= Number(limit)) throw new DiscoveryError("The local API verification budget has been reached.", 503)
  upstreamRequests++
  const url = new URL(`https://api.themoviedb.org/3${path}`)
  url.searchParams.set("api_key", apiKey)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  let response: Response
  try { response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store" }) }
  catch { throw new DiscoveryError("Movie availability could not be reached. Please try again.", 503) }
  if (!response.ok) throw new DiscoveryError(`Movie availability returned HTTP ${response.status}. Please try again.`, 503)
  try {
    const payload: unknown = await response.json()
    if (path === "/watch/providers/movie") providersSchema.parse(payload)
    else if (path.endsWith("/watch/providers")) availabilitySchema.parse(payload)
    else if (path.endsWith("/keywords")) keywordsSchema.parse(payload)
    else parseTmdbPage(payload)
    return payload
  } catch { throw new DiscoveryError("Movie availability returned incomplete data. Please try again.", 503) }
}

const cachedTmdbRequest = createTmdbCache(requestTmdb)
export const onDemandMovies = createOnDemandSource(requestTmdb, cachedTmdbRequest)

export async function streamingServices(region: string): Promise<ServiceOption[]> {
  const response = await cachedTmdbRequest("/watch/providers/movie", { watch_region: region })
  const providers = providersSchema.parse(response.data).results
  const knownIds = new Set(providers.filter(provider => STREAMING_SERVICES.some(service => service.names.some(name => name.toLowerCase() === provider.provider_name.toLowerCase()))).map(provider => provider.provider_id))
  return providers.filter(provider => !knownIds.has(provider.provider_id)).map(provider => ({ key: `tmdb:${provider.provider_id}` as const, label: provider.provider_name })).sort((a, b) => a.label.localeCompare(b.label))
}
