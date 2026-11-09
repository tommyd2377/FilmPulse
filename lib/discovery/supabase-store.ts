import { createClient } from "@supabase/supabase-js"
import { DiscoveryError } from "./errors"
import { getSupabaseConnection, type SupabaseConnection } from "./local-supabase"
import { serviceLabel, type BrowseContext, type CatalogManifest, type CatalogMovie, type CatalogSnapshot, type DiscoveryMovie, type DiscoveryRound, type Favorite, type GuestTaste } from "./types"
import type { DiscoveryStore } from "./store"

export function supabaseClient(connection: SupabaseConnection, privileged = false) {
  const origin = new URL(connection.url).origin
  return createClient(connection.url, privileged ? connection.secretKey : connection.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, options) => {
      if (new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).origin !== origin) throw new Error("Unexpected Supabase request destination.")
      return fetch(input, { ...options, redirect: "error", signal: options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) })
    } },
  })
}

export function createSupabaseStore(connection: SupabaseConnection): DiscoveryStore {
  const client = supabaseClient(connection, true)
  async function call<T>(action: string, args: object): Promise<T> {
    const { data, error } = await client.rpc("filmpulse_discovery", { p_action: action, p_args: args })
    if (error) {
      if (/^P04\d\d$/.test(error.code)) throw new DiscoveryError(error.message, Number(error.code.slice(2)))
      if (error.code === "23514" && error.message.includes("round_limits")) throw new DiscoveryError("Take a moment, then try another mix.", 429)
      throw new Error(`Discovery database operation failed: ${error.message}`)
    }
    return data as T
  }
  return {
    getCatalog: key => call<CatalogManifest | null>("catalog_get", { key }),
    getTaste: uid => call<GuestTaste>("taste_get", { uid }),
    getBrowseContext: (uid, key) => call<BrowseContext>("browse_context", { uid, key }),
    async resetTaste(uid) { await call("reset_taste", { uid }) },
    getFavorite: (uid, movieId) => call<Favorite | null>("favorite_get", { uid, movieId }),
    async getCandidates(keys, seed, salt) {
      const rows = await call<{ movie: CatalogMovie; services: string[]; sample: boolean }[]>("catalog_candidates", { keys, genres: seed?.genreIds ?? [], salt })
      return rows.map(row => ({ ...row.movie, availableOn: row.services.map(serviceLabel), sample: row.sample, reason: "" })) satisfies DiscoveryMovie[]
    },
    async takeQuota(uid, minute) { await call("quota_take", { uid, minute }) },
    async saveRound(uid, round) { await call("round_save", { uid, round }) },
    getRound: (uid, roundId) => call<DiscoveryRound | null>("round_get", { uid, roundId }),
    async pick(uid, roundId, movieId) { await call("pick", { uid, roundId, movieId }) },
    async undo(uid, roundId) { await call("undo", { uid, roundId }) },
    async publish(snapshot: CatalogSnapshot) { await call("catalog_publish", { manifest: snapshot.manifest, movies: snapshot.chunks.flat() }) },
    getStats: movieId => call<{ picks: number }>("stats_get", { movieId }),
    async claimLegacyGuest(oldUid, uid) { await call("claim_legacy_guest", { oldUid, uid }) },
  }
}

export async function getAnonymousSession(local: boolean, accessToken?: string, refreshToken?: string) {
  const connection = await getSupabaseConnection(local)
  const auth = supabaseClient(connection).auth
  if (accessToken) {
    const { data, error } = await auth.getUser(accessToken)
    if (!error && data.user?.is_anonymous) return { uid: data.user.id, session: null }
    if (!refreshToken) throw new DiscoveryError("Your anonymous session could not be verified. Please reload.", 401)
  }
  if (refreshToken) {
    const { data, error } = await auth.refreshSession({ refresh_token: refreshToken })
    if (error || !data.user?.is_anonymous || !data.session) throw new DiscoveryError("Your anonymous session could not be renewed. Please try again.", 401)
    return { uid: data.user.id, session: data.session }
  }
  const { data, error } = await auth.signInAnonymously()
  if (error || !data.user?.is_anonymous || !data.session) throw new DiscoveryError("Your anonymous movie session could not be started. Please try again.", 503)
  return { uid: data.user.id, session: data.session }
}
