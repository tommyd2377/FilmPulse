import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { test } from "node:test"
import { Client } from "pg"
import type { MovieSource } from "../lib/discovery/on-demand"
import { requiredCatalogs } from "../lib/discovery/types"
import { CATALOG_MAX_AGE_MS } from "../lib/discovery/catalog"
import { buildSnapshot } from "../lib/discovery/catalog"
import { getLocalSupabaseConnection } from "../lib/discovery/local-supabase"
import { createSupabaseStore, getAnonymousSession, supabaseClient } from "../lib/discovery/supabase-store"
import { createRound, pickFavorite, undoFavorite } from "../lib/discovery/service"
import { publishSnapshot } from "../lib/discovery/store"
import { SAMPLE_MOVIES } from "../lib/discovery/sample"
import { importLegacyPreview, prepareLocalDatabase } from "../scripts/local-supabase"
import type { CatalogMovie, CatalogSnapshot, DiscoveryRound, WatchPreferences } from "../lib/discovery/types"

// Real local Postgres/Auth/REST; synthetic IDs and a test region never replace US catalogs.
test("local Supabase discovery integration", async t => {
  await prepareLocalDatabase()
  const connection = await getLocalSupabaseConnection()
  const db = new Client({ connectionString: connection.databaseUrl, connectionTimeoutMillis: 10000 })
  await db.connect()
  const store = createSupabaseStore(connection)
  const guests: string[] = [], runs: string[] = []
  const base = 8_000_000_000 + Math.floor(Math.random() * 1_000_000) * 1000
  const movies = Array.from({ length: 240 }, (_, index): CatalogMovie => ({
    ...SAMPLE_MOVIES[index % SAMPLE_MOVIES.length], tmdbId: base + index,
    title: `Local test film ${index}`, popularity: 240 - index, voteCount: index < 100 ? 1000 : 0,
  }))
  const preferences: WatchPreferences = { mode: "home", services: ["prime"], region: "ZZ", includeRentals: false }
  function guest() { const id = randomUUID(); guests.push(id); return id }
  function snapshot(service: "prime" | "apple" | "rentals" | "hulu" | "max" | "theaters", films = movies, checkedAt = new Date().toISOString()): CatalogSnapshot {
    const id = randomUUID(); runs.push(id)
    return buildSnapshot({ id, key: `ZZ_${service}`, service, region: "ZZ", access: service === "theaters" ? "theaters" : service === "rentals" ? "rent" : "subscription", source: "tmdb", checkedAt, completedAt: checkedAt }, films)
  }
  const fixtureSource: MovieSource = async (preferences, seed, page) => {
    const catalogs: DiscoveryRound["catalogs"] = [], missingCatalogs: string[] = []
    for (const key of requiredCatalogs(preferences)) {
      const manifest = await store.getCatalog(key)
      if (!manifest || Date.now() - Date.parse(manifest.checkedAt) > CATALOG_MAX_AGE_MS) missingCatalogs.push(key)
      else catalogs.push({ ...manifest, stale: Date.now() > Date.parse(manifest.refreshAfter) })
    }
    const movies = (await store.getCandidates(catalogs.map(catalog => catalog.key), seed, "test")).map((movie, rank) => ({ ...movie, relations: seed ? [{ seedId: seed.tmdbId, seedTitle: seed.title, kind: "recommendation" as const, rank }] : [] }))
    return { movies, catalogs, missingCatalogs, page }
  }
  async function round(uid: string, next = preferences, seedId: number | null = null) {
    return createRound(store, uid, { preferences: next, seedId, excludeIds: [] }, fixtureSource)
  }

  try {
    await t.test("complete catalog publication is atomic, immutable and replay-safe", async () => {
      const first = snapshot("prime", movies.slice(0, 12))
      await publishSnapshot(store, first)
      await publishSnapshot(store, first)
      assert.equal((await store.getCatalog("ZZ_prime"))?.id, first.manifest.id)
      const invalid = snapshot("prime", [{ ...movies[0], title: "" }])
      await assert.rejects(publishSnapshot(store, invalid), /check constraint/)
      assert.equal((await store.getCatalog("ZZ_prime"))?.id, first.manifest.id)
      const changed = structuredClone(first)
      changed.chunks[0][0] = movies[100]
      await assert.rejects(publishSnapshot(store, changed), /cannot be changed/)
      const incomplete = structuredClone(first); incomplete.chunks = []
      await assert.rejects(publishSnapshot(store, incomplete), /complete/)
      await assert.rejects(publishSnapshot(store, snapshot("prime", movies, "2000-01-01T00:00:00.000Z")), /newer catalog/)
      const empty = snapshot("prime", [])
      await publishSnapshot(store, empty)
      assert.equal((await store.getCatalog("ZZ_prime"))?.movieCount, 0)
      assert.deepEqual(await store.getCandidates(["ZZ_prime"], null, "empty"), [])
    })

    await t.test("the full catalog feeds rotating candidates, selected services union and rentals opt in", async () => {
      await publishSnapshot(store, snapshot("prime"))
      await publishSnapshot(store, snapshot("apple", movies.slice(230)))
      await publishSnapshot(store, snapshot("rentals", [{ ...movies[0], tmdbId: base + 300 }]))
      const candidates = await store.getCandidates(["ZZ_prime"], null, "whole-catalog")
      assert.ok(candidates.some(movie => movie.tmdbId >= base + 200 && movie.voteCount === 0))
      assert.ok(candidates.every(movie => movie.availableOn.join() === "Prime Video"))
      const combined = await store.getCandidates(["ZZ_prime", "ZZ_apple"], null, "union")
      assert.ok(combined.some(movie => movie.availableOn.includes("Prime Video") && movie.availableOn.includes("Apple TV+")))
      const uid = guest(), prime = await round(uid)
      assert.equal(prime.movies.length, 6)
      assert.ok(prime.movies.every(movie => movie.availableOn.join() === "Prime Video"))
      const rental = await round(uid, { ...preferences, services: [], includeRentals: true })
      assert.deepEqual(rental.movies.map(movie => movie.tmdbId), [base + 300])
      assert.deepEqual(rental.movies[0].availableOn, ["Rent"])
    })

    await t.test("expired, missing and other-country catalogs never leak into the mix", async () => {
      await publishSnapshot(store, snapshot("hulu", movies, new Date(Date.now() - 25 * 3600000).toISOString()))
      const uid = guest()
      const expired = await round(uid, { ...preferences, services: ["hulu"] })
      assert.equal(expired.movies.length, 0)
      assert.deepEqual(expired.missingCatalogs, ["ZZ_hulu"])
      assert.deepEqual(await store.getCandidates(["ZZ_hulu"], null, "stale"), [])
      const otherCountry = await round(uid, { ...preferences, region: "ZY" })
      assert.equal(otherCountry.movies.length, 0)
      assert.deepEqual(otherCountry.missingCatalogs, ["ZY_prime"])
      await publishSnapshot(store, snapshot("max", movies, new Date(Date.now() - 7 * 3600000).toISOString()))
      assert.equal((await round(uid, { ...preferences, services: ["max"] })).catalogs[0].stale, true)
      await publishSnapshot(store, snapshot("theaters", movies.slice(50, 60)))
      const theater = await round(uid, { ...preferences, mode: "theaters", services: [] })
      assert.ok(theater.movies.every(movie => movie.availableOn.join() === "In theaters"))
    })

    await t.test("concurrent picks count once, survive a new connection, undo once and leave other films neutral", async () => {
      const uid = guest(), offered = await round(uid), id = offered.movies[0].tmdbId
      const before = (await store.getStats(id)).picks
      await Promise.all(Array.from({ length: 8 }, () => pickFavorite(store, uid, offered.id, id)))
      assert.equal((await store.getStats(id)).picks, before + 1)
      assert.deepEqual((await createSupabaseStore(connection).getTaste(uid)).favorites, [id])
      assert.equal((await store.getTaste(uid)).history?.[0].movie.tmdbId, id)
      assert.equal((await store.getRound(uid, offered.id))?.selectedId, id)
      for (const movie of offered.movies.slice(1)) assert.equal(await store.getFavorite(uid, movie.tmdbId), null)
      const next = await round(uid, preferences, id)
      assert.equal(next.seed?.tmdbId, id)
      assert.ok(next.movies.every(movie => movie.tmdbId !== id))
      await Promise.all([undoFavorite(store, uid, offered.id), undoFavorite(store, uid, offered.id)])
      assert.equal((await store.getStats(id)).picks, before)
      assert.deepEqual((await store.getTaste(uid)).favorites, [])
      assert.deepEqual((await store.getTaste(uid)).history, [])
    })

    await t.test("earlier pick metadata persists, follows the guest, and undo removes it from the next profile", async () => {
      const uid = guest(), stranger = guest()
      const first = await round(uid), firstId = first.movies[0].tmdbId
      await pickFavorite(store, uid, first.id, firstId)
      const second = await round(uid, preferences, firstId), secondId = second.movies[0].tmdbId
      assert.equal(second.seed?.tmdbId, firstId)
      await pickFavorite(store, uid, second.id, secondId)
      const taste = await createSupabaseStore(connection).getTaste(uid)
      assert.equal(taste.history?.length, 2)
      assert.equal(taste.history?.[0].movie.tmdbId, secondId)
      assert.ok(taste.history?.every(pick => pick.movie.genreIds.length && pick.movie.overview))
      assert.ok(taste.history?.every(pick => !("relations" in pick.movie) && !("reason" in pick.movie) && !("availableOn" in pick.movie)))
      assert.ok((await store.getRound(uid, second.id))?.movies[0].relations?.length, "Private round explanations must remain available to their owner")
      assert.deepEqual((await store.getTaste(stranger)).history, [])
      await undoFavorite(store, uid, second.id)
      assert.deepEqual((await store.getTaste(uid)).history?.map(pick => pick.movie.tmdbId), [firstId])
      assert.equal((await round(uid, preferences, firstId)).seed?.tmdbId, firstId)
    })

    await t.test("ownership, offered-film validation, expiry and cross-tab undo are enforced in SQL", async () => {
      const uid = guest(), stranger = guest(), first = await round(uid), second = await round(uid)
      const id = first.movies[0].tmdbId
      await assert.rejects(pickFavorite(store, stranger, first.id, id), /no longer available/)
      assert.equal(await store.getRound(stranger, first.id), null)
      await assert.rejects(pickFavorite(store, uid, first.id, base + 999), /from this set/)
      await pickFavorite(store, uid, first.id, id)
      await assert.rejects(round(stranger, preferences, id), /Choose a favorite/)
      await assert.rejects(pickFavorite(store, uid, first.id, first.movies[1].tmdbId), /Undo/)
      // A previously opened tab may contain the same film, regardless of its random mix.
      const sameFilm: DiscoveryRound = { ...second, id: randomUUID(), movies: first.movies }
      await store.saveRound(uid, sameFilm)
      await pickFavorite(store, uid, sameFilm.id, id)
      await undoFavorite(store, uid, sameFilm.id)
      assert.ok(await store.getFavorite(uid, id))
      await db.query("update film_discovery.rounds set expires_at = now() - interval '1 hour' where round_id = $1", [second.id])
      await assert.rejects(pickFavorite(store, uid, second.id, second.movies[0].tmdbId), /expired/)
    })

    await t.test("guest throttles are transactional and reset in a new minute", async () => {
      const uid = guest()
      await Promise.all(Array.from({ length: 20 }, () => store.takeQuota(uid, 100)))
      await assert.rejects(store.takeQuota(uid, 100), error => error instanceof Error && "status" in error && error.status === 429)
      await store.takeQuota(uid, 101)
    })

    await t.test("legacy local favorites copy into SQL and can be claimed only through the local server path", async () => {
      const oldUid = guest(), uid = guest(), offered = await round(oldUid), chosen = offered.movies[0]
      // Use a new round UUID so this fixture accurately models the former JSON backup.
      const legacy = { ...offered, id: randomUUID(), selectedId: chosen.tmdbId, voteCreated: true }
      await db.query("begin")
      try {
        assert.equal((await importLegacyPreview(db, {
          [`discoveryGuests/${oldUid}/rounds/${legacy.id}`]: legacy,
          [`discoveryGuests/${oldUid}/favorites/${chosen.tmdbId}`]: { movie: chosen, roundId: legacy.id, createdAt: legacy.createdAt },
        })).favorites, 1)
        await db.query("commit")
      } catch (error) { await db.query("rollback"); throw error }
      await store.claimLegacyGuest(oldUid, uid)
      assert.equal((await store.getRound(uid, legacy.id))?.selectedId, chosen.tmdbId)
      assert.deepEqual((await store.getTaste(uid)).favorites, [chosen.tmdbId])
      assert.deepEqual((await store.getTaste(oldUid)).favorites, [])
      await undoFavorite(store, uid, legacy.id)
      assert.deepEqual((await store.getTaste(uid)).favorites, [])
    })

    await t.test("real local anonymous sessions verify and renew; browser roles cannot invoke the repository", async () => {
      const identity = await getAnonymousSession(true)
      assert.ok(identity.session)
      const verified = await getAnonymousSession(true, identity.session.access_token)
      assert.equal(verified.uid, identity.uid)
      const renewed = await getAnonymousSession(true, "invalid-test-token", identity.session.refresh_token)
      assert.equal(renewed.uid, identity.uid)
      await assert.rejects(getAnonymousSession(true, "invalid-test-token"), /could not be verified/)
      const browser = supabaseClient(connection)
      const { error } = await browser.rpc("filmpulse_discovery", { p_action: "taste_get", p_args: { uid: identity.uid } })
      assert.ok(error, "Anonymous clients must not call the privileged repository")
      const privileges = await db.query("select has_schema_privilege('authenticated', 'film_discovery', 'USAGE') as schema_access, has_function_privilege('authenticated', 'public.filmpulse_discovery(text,jsonb)', 'EXECUTE') as rpc_access, (select bool_and(relrowsecurity) from pg_class where relnamespace = 'film_discovery'::regnamespace and relkind = 'r') as rls")
      assert.deepEqual(privileges.rows[0], { schema_access: false, rpc_access: false, rls: true })
    })
  } finally {
    // Delete only this run's synthetic fixtures; keep the owner's preview data intact.
    await db.query("delete from film_discovery.favorites where guest_id = any($1::uuid[])", [guests])
    await db.query("delete from film_discovery.rounds where guest_id = any($1::uuid[])", [guests])
    await db.query("delete from film_discovery.round_limits where guest_id = any($1::uuid[])", [guests])
    await db.query("delete from film_discovery.guests where guest_id = any($1::uuid[])", [guests])
    await db.query("delete from film_discovery.catalogs where active_run = any($1::uuid[])", [runs])
    await db.query("delete from film_discovery.catalog_runs where run_id = any($1::uuid[])", [runs])
    await db.query("delete from film_discovery.movies where movie_id between $1 and $2", [base, base + 999])
    await db.end()
  }
})
