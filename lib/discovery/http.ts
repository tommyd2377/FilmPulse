import { NextRequest, NextResponse } from "next/server"
import { ZodError, type ZodTypeAny, type output } from "zod"
import type { Session } from "@supabase/supabase-js"
import { dataMode, getStore, type DiscoveryStore } from "./store"
import { DiscoveryError } from "./service"
import { getAnonymousSession } from "./supabase-store"

export async function readBody<Schema extends ZodTypeAny>(request: NextRequest, schema: Schema): Promise<output<Schema>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DiscoveryError("Send a JSON request.", 415)
  const reader = request.body?.getReader()
  if (!reader) throw new DiscoveryError("Invalid request.")
  const decoder = new TextDecoder()
  let text = "", bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 8192) { await reader.cancel(); throw new DiscoveryError("The request is too large.", 413) }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally { reader.releaseLock() }
  try { return schema.parse(JSON.parse(text)) }
  catch (error) {
    if (error instanceof ZodError) throw new DiscoveryError(error.issues[0]?.message ?? "Invalid request.")
    throw new DiscoveryError("Invalid request.")
  }
}

export async function discoveryRequest(request: NextRequest, action: (store: DiscoveryStore, uid: string) => Promise<unknown>): Promise<NextResponse> {
  let renewedSession: Session | null = null
  let clearLegacyCookie = false
  function sessionCookies(response: NextResponse) {
    const options = { httpOnly: true, sameSite: "strict" as const, path: "/", secure: new URL(request.url).protocol === "https:" }
    if (renewedSession) {
      response.cookies.set("fp_sb_access", renewedSession.access_token, { ...options, maxAge: renewedSession.expires_in ?? 3600 })
      response.cookies.set("fp_sb_refresh", renewedSession.refresh_token, { ...options, maxAge: 365 * 24 * 60 * 60 })
    }
    if (clearLegacyCookie) response.cookies.set("fp_local_guest", "", { ...options, maxAge: 0 })
    return response
  }
  try {
    const requestUrl = new URL(request.url)
    // Next's development server can normalize request.url to localhost even
    // when the browser connected to 127.0.0.1. Validate the actual Host header.
    if (request.headers.get("host")) requestUrl.host = request.headers.get("host")!
    const origin = request.headers.get("origin")
    if (origin && origin !== requestUrl.origin) throw new DiscoveryError("This request must come from FilmPulse.", 403)
    const mode = dataMode()
    if (mode === "local") {
      if (!["localhost", "127.0.0.1", "[::1]"].includes(requestUrl.hostname)) throw new DiscoveryError("The sample backend is available on localhost only.", 403)
    } else if (mode !== "supabase") throw new DiscoveryError("FilmPulse discovery is not connected yet.", 503)
    const access = request.cookies.get("fp_sb_access")?.value
    const refresh = request.cookies.get("fp_sb_refresh")?.value
    if ((access?.length ?? 0) > 8192 || (refresh?.length ?? 0) > 8192) throw new DiscoveryError("Invalid anonymous session.", 401)
    const identity = await getAnonymousSession(mode === "local", access, refresh)
    renewedSession = identity.session
    const store = await getStore()
    const legacyUid = request.cookies.get("fp_local_guest")?.value
    if (mode === "local" && legacyUid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(legacyUid)) {
      await store.claimLegacyGuest(legacyUid, identity.uid)
      clearLegacyCookie = true
    }
    const result = await action(store, identity.uid)
    const response = NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } })
    return sessionCookies(response)
  } catch (error) {
    const known = error instanceof DiscoveryError
    if (!known) console.error("FilmPulse discovery request failed.")
    return sessionCookies(NextResponse.json({ error: known ? error.message : "Movies could not be loaded. Please try again." }, { status: known ? error.status : 500, headers: { "Cache-Control": "private, no-store" } }))
  }
}
