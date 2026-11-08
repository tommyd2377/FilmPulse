import type { CatalogManifest, CatalogMovie, CatalogSnapshot, DataMode, DiscoveryMovie, DiscoveryRound, Favorite, GuestTaste } from "./types"
import { getSupabaseConnection } from "./local-supabase"
import { createSupabaseStore } from "./supabase-store"

export interface DiscoveryStore {
  getCatalog(key: string): Promise<CatalogManifest | null>
  getTaste(uid: string): Promise<GuestTaste>
  getFavorite(uid: string, movieId: number): Promise<Favorite | null>
  getCandidates(keys: string[], seed: CatalogMovie | null, salt: string): Promise<DiscoveryMovie[]>
  takeQuota(uid: string, minute: number): Promise<void>
  saveRound(uid: string, round: DiscoveryRound): Promise<void>
  getRound(uid: string, roundId: string): Promise<DiscoveryRound | null>
  pick(uid: string, roundId: string, movieId: number): Promise<void>
  undo(uid: string, roundId: string): Promise<void>
  publish(snapshot: CatalogSnapshot): Promise<void>
  getStats(movieId: number): Promise<{ picks: number }>
  claimLegacyGuest(oldUid: string, uid: string): Promise<void>
}

export function dataMode(): DataMode {
  const mode = process.env.FILMPULSE_DATA_MODE
  if (mode === "supabase" || mode === "local") return mode
  if (mode) return "unconfigured"
  return process.env.NODE_ENV === "production" ? "unconfigured" : "local"
}

const stores = new Map<string, Promise<DiscoveryStore>>()
export async function getStore(): Promise<DiscoveryStore> {
  const mode = dataMode()
  if (mode === "unconfigured") throw new Error("Discovery storage is not configured.")
  let store = stores.get(mode)
  if (!store) {
    store = getSupabaseConnection(mode === "local").then(createSupabaseStore).catch(error => { stores.delete(mode); throw error })
    stores.set(mode, store)
  }
  return store
}

export function catalogWriteCount(snapshot: CatalogSnapshot): number {
  return snapshot.manifest.movieCount * 2 + 2 // Movies, availability, run, active pointer.
}

export async function publishSnapshot(store: DiscoveryStore, snapshot: CatalogSnapshot): Promise<void> {
  const movies = snapshot.chunks.flat()
  if (movies.length !== snapshot.manifest.movieCount || new Set(movies.map(movie => movie.tmdbId)).size !== movies.length) throw new Error("Only a complete, deduplicated catalog can be published.")
  await store.publish(snapshot)
}
