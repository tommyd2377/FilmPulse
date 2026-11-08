import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import { DiscoveryError } from "./errors"

const execute = promisify(execFile)
export function localCliEnvironment() {
  return { ...process.env, SUPABASE_HOME: join(process.cwd(), ".filmpulse-data", "supabase"), SUPABASE_TELEMETRY_DISABLED: "1" }
}

export type SupabaseConnection = { url: string; publishableKey: string; secretKey: string; databaseUrl?: string; local: boolean }
let localConnection: Promise<SupabaseConnection> | null = null

/** Only the task-owned local stack is inspected. Generated test credentials stay in memory. */
export async function getLocalSupabaseConnection(): Promise<SupabaseConnection> {
  localConnection ??= (async () => {
    let stdout: string
    try {
      const result = await execute(join(process.cwd(), "node_modules", ".bin", "supabase"), ["status", "--env", "--output-format", "json"], {
        cwd: process.cwd(), env: localCliEnvironment(), timeout: 15000, maxBuffer: 2_000_000,
      })
      stdout = result.stdout
    } catch { throw new DiscoveryError("Local Supabase is not running. Start it with npm run db:local.", 503) }
    const status = JSON.parse(stdout) as Record<string, string>
    const url = status.API_URL
    const databaseUrl = status.DB_URL
    if (!url || !databaseUrl || ![url, databaseUrl].every(value => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname))) throw new Error("The local Supabase connection must use loopback addresses.")
    const publishableKey = status.PUBLISHABLE_KEY || status.ANON_KEY
    const secretKey = status.SECRET_KEY || status.SERVICE_ROLE_KEY
    if (!publishableKey || !secretKey) throw new Error("The local Supabase stack did not return its test configuration.")
    return { url, databaseUrl, publishableKey, secretKey, local: true }
  })().catch(error => { localConnection = null; throw error })
  return localConnection
}

export async function getSupabaseConnection(local: boolean): Promise<SupabaseConnection> {
  if (local) return getLocalSupabaseConnection()
  const url = process.env.FILMPULSE_SUPABASE_URL
  const publishableKey = process.env.FILMPULSE_SUPABASE_PUBLISHABLE_KEY
  const secretKey = process.env.FILMPULSE_SUPABASE_SECRET_KEY
  if (!url || !publishableKey || !secretKey) throw new DiscoveryError("The Supabase backend is not configured yet.", 503)
  if (new URL(url).protocol !== "https:") throw new Error("Hosted Supabase must use HTTPS.")
  return { url, publishableKey, secretKey, local: false }
}
