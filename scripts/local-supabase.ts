import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { Client } from "pg"
import { getLocalSupabaseConnection, localCliEnvironment } from "../lib/discovery/local-supabase"
import { buildSnapshot } from "../lib/discovery/catalog"
import type { CatalogManifest, CatalogMovie, DiscoveryRound, Favorite } from "../lib/discovery/types"

const execute = promisify(execFile)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type LegacyDocuments = Record<string, unknown>

export async function importLegacyPreview(client: Client, documents: LegacyDocuments): Promise<{ catalogs: number; favorites: number }> {
  let catalogs = 0, favorites = 0
  for (const [path, value] of Object.entries(documents)) {
    if (!path.startsWith("discoveryCatalogs/")) continue
    const manifest = value as CatalogManifest
    const prefix = `discoverySnapshots/${manifest.id}/chunks/`
    const movies = Object.entries(documents).filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
      .flatMap(([, chunk]) => (chunk as { movies: CatalogMovie[] }).movies)
    if (movies.length !== manifest.movieCount) throw new Error("A legacy catalog is incomplete. Its backup has not been changed.")
    const snapshot = buildSnapshot({ ...manifest, id: randomUUID(), checkedAt: manifest.checkedAt ?? manifest.completedAt }, movies)
    await client.query("select public.filmpulse_discovery('catalog_publish', $1::jsonb)", [JSON.stringify({ manifest: snapshot.manifest, movies })])
    catalogs++
  }
  for (const [path, value] of Object.entries(documents)) {
    const match = path.match(/^discoveryGuests\/([^/]+)\/rounds\/([^/]+)$/)
    if (!match) continue
    if (!uuid.test(match[1]) || !uuid.test(match[2])) throw new Error("A legacy guest or round identifier is invalid. Its backup has not been changed.")
    const round = value as DiscoveryRound
    await client.query("select public.filmpulse_discovery('round_save', $1::jsonb)", [JSON.stringify({ uid: match[1], round })])
    await client.query("update film_discovery.rounds set selected_id = $2, vote_created = $3 where round_id = $1", [round.id, round.selectedId, round.voteCreated])
  }
  for (const [path, value] of Object.entries(documents)) {
    const match = path.match(/^discoveryGuests\/([^/]+)\/favorites\/(\d+)$/)
    if (!match) continue
    if (!uuid.test(match[1])) throw new Error("A legacy guest identifier is invalid. Its backup has not been changed.")
    const favorite = value as Favorite
    await client.query("insert into film_discovery.favorites(guest_id,movie_id,origin_round,created_at) values ($1,$2,$3,$4) on conflict do nothing", [match[1], Number(match[2]), favorite.roundId, favorite.createdAt])
    favorites++
  }
  return { catalogs, favorites }
}

export async function prepareLocalDatabase() {
  const connection = await getLocalSupabaseConnection()
  if (!connection.databaseUrl || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection.databaseUrl).hostname)) throw new Error("Local setup requires a loopback Postgres connection.")
  const client = new Client({ connectionString: connection.databaseUrl, connectionTimeoutMillis: 10000 })
  await client.connect()
  try {
    await client.query("begin")
    const directory = join(process.cwd(), "supabase", "migrations")
    for (const filename of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) {
      const sql = await readFile(join(directory, filename), "utf8")
      const version = `schema-${createHash("sha256").update(sql).digest("hex").slice(0, 16)}`
      const exists = await client.query("select to_regclass('film_discovery.migrations') as name")
      const applied = exists.rows[0]?.name ? await client.query("select 1 from film_discovery.migrations where name = $1", [version]) : { rowCount: 0 }
      if (!applied.rowCount) {
        await client.query(sql)
        await client.query("insert into film_discovery.migrations(name) values ($1) on conflict do nothing", [version])
      }
    }
    let migrated: { catalogs: number; favorites: number } | null = null
    const legacyApplied = await client.query("select 1 from film_discovery.migrations where name = 'legacy-json-v1'")
    if (!legacyApplied.rowCount) {
      let legacy: LegacyDocuments | null = null
      try { legacy = JSON.parse(await readFile(join(process.cwd(), ".filmpulse-data", "discovery.json"), "utf8")) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
      if (legacy) {
        migrated = await importLegacyPreview(client, legacy)
        await client.query("insert into film_discovery.migrations(name) values ('legacy-json-v1')")
      }
    }
    await client.query("commit")
    return migrated
  } catch (error) { await client.query("rollback"); throw error }
  finally { await client.end() }
}

async function main() {
  if (!process.argv.includes("--migrate-only")) {
    console.log("Starting the project-scoped local Supabase stack. Hosted Supabase is not used by this command.")
    try {
      // CLI output includes generated local test credentials; keep it out of logs.
      await execute(join(process.cwd(), "node_modules", ".bin", "supabase"), ["start", "--runtime", "native", "--eager", "--output-format", "json"], {
        cwd: process.cwd(), env: localCliEnvironment(), timeout: 240000, maxBuffer: 20_000_000,
      })
    } catch { throw new Error("Local Supabase could not start. Check the local CLI service status; no cloud changes were attempted.") }
  }
  const migrated = await prepareLocalDatabase()
  console.log("Local Supabase SQL schema is ready. Movie pages are fetched only as you browse.")
  if (migrated) console.log(`Preserved ${migrated.catalogs} catalog snapshots and ${migrated.favorites} positive picks from the unchanged legacy preview file.`)
}

if (process.argv[1]?.endsWith("local-supabase.ts")) main().catch(error => {
  console.error(error instanceof Error ? error.message : "Local database setup failed.")
  process.exitCode = 1
})
