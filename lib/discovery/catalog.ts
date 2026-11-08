import type { CatalogManifest, CatalogMovie, CatalogSnapshot, CatalogSummary, DiscoveryMovie } from "./types"
import { serviceLabel } from "./types"

export const CATALOG_CHUNK_SIZE = 100
export const CATALOG_REFRESH_MS = 6 * 60 * 60 * 1000
export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function hashNumber(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return hash >>> 0
}

export function buildSnapshot(
  input: Omit<CatalogManifest, "movieCount" | "chunkCount" | "refreshAfter">,
  movies: CatalogMovie[],
): CatalogSnapshot {
  const unique = [...new Map(movies.map(movie => [movie.tmdbId, movie])).values()].sort((a, b) => a.tmdbId - b.tmdbId)
  const chunks: CatalogMovie[][] = []
  for (let start = 0; start < unique.length; start += CATALOG_CHUNK_SIZE) chunks.push(unique.slice(start, start + CATALOG_CHUNK_SIZE))
  const quality = (movie: CatalogMovie) => movie.voteAverage * movie.voteCount / (movie.voteCount + 100)
  const medianPopularity = [...unique].sort((a, b) => a.popularity - b.popularity)[Math.floor(unique.length / 2)]?.popularity ?? 0
  const summary: CatalogSummary = {
    popular: [...unique].sort((a, b) => b.popularity - a.popularity).slice(0, 36),
    gems: unique.filter(movie => movie.voteCount >= 25 && movie.popularity <= medianPopularity).sort((a, b) => quality(b) - quality(a)).slice(0, 36),
    recent: [...unique].sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0) || b.popularity - a.popularity).slice(0, 36),
    genres: {},
  }
  for (const movie of [...unique].sort((a, b) => quality(b) - quality(a))) {
    for (const genre of movie.genreIds) {
      const group = summary.genres[genre] ??= []
      if (group.length < 8) group.push(movie)
    }
  }
  const compact = (movie: CatalogMovie) => ({ ...movie, overview: movie.overview.slice(0, 180) })
  summary.popular = summary.popular.map(compact)
  summary.gems = summary.gems.map(compact)
  summary.recent = summary.recent.map(compact)
  summary.genres = Object.fromEntries(Object.entries(summary.genres).map(([genre, group]) => [genre, group.map(compact)]))
  return {
    manifest: { ...input, refreshAfter: new Date(Date.parse(input.checkedAt) + CATALOG_REFRESH_MS).toISOString(), movieCount: unique.length, chunkCount: chunks.length },
    summary,
    chunks,
  }
}

export function candidatesFromCatalog(
  manifest: CatalogManifest,
  summary: CatalogSummary,
  chunk: CatalogMovie[],
  seed: CatalogMovie | null,
): DiscoveryMovie[] {
  return [
    ...(seed?.genreIds.flatMap(genre => summary.genres[genre] ?? []) ?? []),
    ...summary.popular, ...summary.gems, ...summary.recent, ...chunk,
  ].map(movie => ({ ...movie, availableOn: [serviceLabel(manifest.service)], sample: manifest.source === "sample", reason: "" }))
}

export function rankRound(candidates: DiscoveryMovie[], seed: CatalogMovie | null, exclude: Set<number>, salt: string, count = 6): DiscoveryMovie[] {
  const merged = new Map<number, DiscoveryMovie>()
  for (const movie of candidates) {
    const existing = merged.get(movie.tmdbId)
    if (existing) existing.availableOn = [...new Set([...existing.availableOn, ...movie.availableOn])]
    else merged.set(movie.tmdbId, { ...movie, availableOn: [...movie.availableOn] })
  }
  const eligible = [...merged.values()].filter(movie => !exclude.has(movie.tmdbId) && movie.tmdbId !== seed?.tmdbId)
  const ordered = eligible.map(movie => {
    const overlap = seed ? movie.genreIds.filter(genre => seed.genreIds.includes(genre)).length / Math.max(1, seed.genreIds.length) : 0
    const quality = movie.voteAverage * movie.voteCount / (movie.voteCount + 100) / 10
    const variety = hashNumber(`${salt}:${movie.tmdbId}`) / 0xffffffff
    const popularity = Math.log1p(Math.max(0, movie.popularity)) / 10
    return { movie, overlap, variety, score: overlap * 3 + quality * .6 + Math.min(1, popularity) * .4 + variety * .7 }
  }).sort((a, b) => b.score - a.score)
  // One slot explores the whole catalog rather than repeatedly locking onto the same genre.
  const picks = ordered.slice(0, Math.max(0, count - 1))
  const exploratory = ordered.filter(item => !picks.includes(item)).sort((a, b) => b.variety - a.variety)[0]
  if (exploratory) picks.push(exploratory)
  return picks.map(({ movie, overlap }) => ({
    ...movie,
    reason: seed && overlap > 0 ? `A new direction from ${seed.title}.` : "Something different to explore.",
  }))
}
