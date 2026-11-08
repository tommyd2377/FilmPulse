import type { DataMode } from "./types"

// Supabase sessions use HTTP-only cookies. No credential is exposed to client JS.
export async function discoveryHeaders(_mode: DataMode): Promise<Record<string, string>> {
  return { "Content-Type": "application/json" }
}
