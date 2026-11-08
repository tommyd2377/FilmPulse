import { randomUUID } from "node:crypto"
import { z } from "zod"
import { rankPersonalized } from "./personalization"
import { isServiceKey, type DiscoveryRound, type ServiceKey } from "./types"
import { browseKey, onDemandMovies, type MovieSource } from "./on-demand"
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
  excludeIds: z.array(z.number().int().positive()).max(300).default([]),
  previousRoundId: z.string().uuid().nullable().optional(),
}).strict()
export const pickRequestSchema = z.object({ roundId: z.string().uuid(), movieId: z.number().int().positive() }).strict()
export const undoRequestSchema = z.object({ roundId: z.string().uuid() }).strict()

export async function createRound(store: DiscoveryStore, uid: string, input: z.infer<typeof roundRequestSchema>, source: MovieSource = onDemandMovies): Promise<DiscoveryRound> {
  const id = randomUUID(), now = new Date()
  await store.takeQuota(uid, Math.floor(now.getTime() / 60000))
  const taste = await store.getTaste(uid)
  const favorite = input.seedId ? await store.getFavorite(uid, input.seedId) : null
  if (input.seedId && !favorite) throw new DiscoveryError("Choose a favorite from your movies first.")
  const history = taste.history?.map(pick => pick.movie) ?? []
  const seed = favorite?.movie ?? null
  const previous = input.previousRoundId ? await store.getRound(uid, input.previousRoundId) : null
  if (input.previousRoundId && !previous) throw new DiscoveryError("This set of movies is no longer available.", 404)
  const key = browseKey(input.preferences, seed)
  const page = previous?.browse?.key === key ? previous.browse.page + 1 : 1
  const result = await source(input.preferences, seed, page, new Set([...taste.favorites, ...input.excludeIds]), history)
  const { movies: candidates, catalogs, missingCatalogs } = result
  let movies = rankPersonalized(candidates, seed, history, new Set([...taste.favorites, ...input.excludeIds]))
  // Previously displayed, neutral films may return; positive picks stay excluded.
  if (movies.length < 6) movies = rankPersonalized(candidates, seed, history, new Set(taste.favorites))
  const round: DiscoveryRound = {
    id, preferences: input.preferences, movies, seed, catalogs, missingCatalogs, browse: { key, page: result.page },
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), selectedId: null, voteCreated: false,
  }
  await store.saveRound(uid, round)
  return round
}

export async function pickFavorite(store: DiscoveryStore, uid: string, roundId: string, movieId: number): Promise<void> {
  await store.pick(uid, roundId, movieId)
}
export async function undoFavorite(store: DiscoveryStore, uid: string, roundId: string): Promise<void> {
  await store.undo(uid, roundId)
}
