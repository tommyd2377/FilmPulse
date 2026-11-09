import { randomUUID } from "node:crypto"
import { z } from "zod"
import { rankFreshMix, rankPersonalized } from "./personalization"
import { isServiceKey, type CatalogMovie, type DiscoveryRound, type ServiceKey } from "./types"
import { browseKey, onDemandMovies, startingMovie, type MovieSource } from "./on-demand"
import { DiscoveryError } from "./errors"
import type { DiscoveryStore } from "./store"
export { DiscoveryError } from "./errors"

export const preferencesSchema = z.object({
  mode: z.enum(["home", "theaters"]),
  services: z.array(z.custom<ServiceKey>(isServiceKey, "Unknown streaming service.")).max(20).transform(values => [...new Set(values)]),
  includeRentals: z.boolean(),
  region: z.string().regex(/^[A-Z]{2}$/),
}).strict().refine(value => value.mode === "theaters" || value.services.length > 0 || value.includeRentals, "Choose at least one service, or include rent or buy.")

export const roundRequestSchema = z.object({
  preferences: preferencesSchema,
  seedId: z.number().int().positive().nullable().default(null),
  startingMovieId: z.number().int().positive().max(2147483647).optional(),
  excludeIds: z.array(z.number().int().positive()).max(300).default([]),
  previousRoundId: z.string().uuid().nullable().optional(),
}).strict().refine(input => !input.startingMovieId || !input.seedId, "Choose one starting movie.")
export const pickRequestSchema = z.object({ roundId: z.string().uuid(), movieId: z.number().int().positive() }).strict()
export const undoRequestSchema = z.object({ roundId: z.string().uuid() }).strict()
export const resetRequestSchema = z.object({}).strict()

export async function createRound(store: DiscoveryStore, uid: string, input: z.infer<typeof roundRequestSchema>, source: MovieSource = onDemandMovies, resolveStartingMovie = startingMovie): Promise<DiscoveryRound> {
  const id = randomUUID(), now = new Date()
  await store.takeQuota(uid, Math.floor(now.getTime() / 60000))
  const taste = await store.getTaste(uid)
  const previous = input.previousRoundId ? await store.getRound(uid, input.previousRoundId) : null
  if (input.previousRoundId && !previous) throw new DiscoveryError("This set of movies is no longer available.", 404)
  const favorite = input.seedId ? await store.getFavorite(uid, input.seedId) : null
  const previousSeed = input.seedId && previous?.seed?.tmdbId === input.seedId ? previous.seed : null
  if (input.seedId && !favorite && !previousSeed) throw new DiscoveryError("Choose a favorite from your movies first.")
  const history = taste.history?.map(pick => pick.movie) ?? []
  // A searched title is a direction, not an implicit favorite. Resolve its
  // metadata on the server; later pages may reuse only this guest's saved seed.
  const seed: CatalogMovie | null = input.startingMovieId ? await resolveStartingMovie(input.startingMovieId) : favorite?.movie ?? previousSeed ?? null
  const key = browseKey(input.preferences, seed)
  const context = seed ? { page: 0, seenIds: [] } : await store.getBrowseContext(uid, key)
  const page = Math.max(previous?.browse?.key === key ? previous.browse.page : 0, context.page) + 1
  const excluded = new Set([...taste.favorites, ...input.excludeIds, ...context.seenIds])
  const result = await source(input.preferences, seed, page, excluded, history)
  const { movies: candidates, catalogs, missingCatalogs } = result
  const rank = (excluded: Set<number>) => seed ? rankPersonalized(candidates, seed, history, excluded) : rankFreshMix(candidates, history, excluded, id)
  let movies = rank(excluded)
  // Previously displayed, neutral films may return; positive picks stay excluded.
  if (movies.length < 6) {
    const fill = rank(new Set([...taste.favorites, ...movies.map(movie => movie.tmdbId)]))
    movies = [...movies, ...fill].slice(0, 6)
  }
  const round: DiscoveryRound = {
    id, preferences: input.preferences, movies, seed, catalogs, missingCatalogs, ...(result.sourceNotice ? { sourceNotice: result.sourceNotice } : {}), browse: { key, page: result.page }, tasteVersion: taste.tasteVersion ?? 0,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), selectedId: null, voteCreated: false,
  }
  await store.saveRound(uid, round)
  return round
}

export async function resetDiscovery(store: DiscoveryStore, uid: string): Promise<void> {
  await store.takeQuota(uid, Math.floor(Date.now() / 60000))
  await store.resetTaste(uid)
}

export async function pickFavorite(store: DiscoveryStore, uid: string, roundId: string, movieId: number): Promise<void> {
  await store.pick(uid, roundId, movieId)
}
export async function undoFavorite(store: DiscoveryStore, uid: string, roundId: string): Promise<void> {
  await store.undo(uid, roundId)
}
