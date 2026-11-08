import { GENRE_NAMES, type CatalogMovie, type DiscoveryMovie } from "./types"

// These common plot words otherwise make unrelated synopses look similar.
const STOP_WORDS = new Set("about after again against along also another back been before being between both could discovers during each finds first from gets goes have into just life lives love makes more most must named only other over people that their them then there these they this through time together under very wants were what when where which while will with woman young film movie story world years takes becomes group family friends himself herself".split(" "))
function words(movie: CatalogMovie): Set<string> {
  return new Set((movie.overview.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(word => !STOP_WORDS.has(word)))
}
function overlap(left: Set<string>, right: Set<string>) {
  let shared = 0
  for (const word of left) if (right.has(word)) shared++
  return shared / Math.max(1, Math.sqrt(left.size * right.size))
}

export function uniqueHistory(movies: CatalogMovie[]): CatalogMovie[] {
  return [...new Map(movies.map(movie => [movie.tmdbId, movie])).values()]
}

export function anchorGenre(movie: CatalogMovie): number | undefined {
  return movie.genreIds.find(genre => ![18, 12, 28].includes(genre)) ?? movie.genreIds[0]
}

/** All saved picks contribute; newer picks have a modest extra weight. */
export function tasteAffinity(movie: CatalogMovie, history: CatalogMovie[]): number {
  const candidateWords = words(movie)
  let total = 0, score = 0
  history.forEach((picked, index) => {
    const weight = .5 + .5 * Math.exp(-index / 12)
    const genres = movie.genreIds.filter(genre => picked.genreIds.includes(genre)).length / Math.max(1, new Set([...movie.genreIds, ...picked.genreIds]).size)
    const text = overlap(candidateWords, words(picked))
    score += weight * (genres * .65 + text * .35)
    total += weight
  })
  return total ? score / total : 0
}

/** A few film-to-film lookups supplement the profile without fetching every liked film. */
export function representativePicks(history: CatalogMovie[], seed: CatalogMovie): CatalogMovie[] {
  const remaining = uniqueHistory(history).filter(movie => movie.tmdbId !== seed.tmdbId)
  if (!remaining.length) return []
  const chosen = [remaining[0]]
  const genres = new Set(chosen[0].genreIds)
  for (const movie of remaining.slice(1)) {
    if (chosen.length === 3) break
    if (movie.genreIds.some(genre => !genres.has(genre))) {
      chosen.push(movie)
      movie.genreIds.forEach(genre => genres.add(genre))
    }
  }
  for (const movie of remaining) {
    if (chosen.length === 3) break
    if (!chosen.some(pick => pick.tmdbId === movie.tmdbId)) chosen.push(movie)
  }
  return chosen
}

export function rankPersonalized(candidates: DiscoveryMovie[], seed: CatalogMovie | null, history: CatalogMovie[], excluded: Set<number>, count = 6): DiscoveryMovie[] {
  const merged = new Map<number, DiscoveryMovie>()
  for (const movie of candidates) {
    const existing = merged.get(movie.tmdbId)
    if (existing) {
      existing.availableOn = [...new Set([...existing.availableOn, ...movie.availableOn])]
      existing.relations = [...(existing.relations ?? []), ...(movie.relations ?? [])]
    } else merged.set(movie.tmdbId, { ...movie, availableOn: [...movie.availableOn], relations: [...(movie.relations ?? [])] })
  }
  const earlier = uniqueHistory(history).filter(movie => movie.tmdbId !== seed?.tmdbId)
  const seedWords = seed ? words(seed) : new Set<string>()
  return [...merged.values()].filter(movie => !excluded.has(movie.tmdbId) && movie.tmdbId !== seed?.tmdbId)
    .map(movie => {
      const direct = seed ? movie.relations?.filter(relation => relation.seedId === seed.tmdbId) ?? [] : []
      // Genre overlap alone can never qualify a film for a seeded round.
      if (seed && !direct.length) return null
      const anchor = seed ? anchorGenre(seed) : undefined
      if (anchor !== undefined && !movie.genreIds.includes(anchor)) return null
      const relationScore = Math.max(0, ...direct.map(relation => (relation.kind === "recommendation" ? 1 : relation.kind === "similar" ? .65 : .4) / (1 + relation.rank / 30)))
      const olderLinks = movie.relations?.filter(relation => relation.seedId !== seed?.tmdbId && earlier.some(pick => pick.tmdbId === relation.seedId)) ?? []
      const support = new Set(olderLinks.map(relation => relation.seedId)).size / Math.max(1, Math.min(3, earlier.length))
      const affinity = tasteAffinity(movie, earlier)
      const quality = movie.voteAverage * movie.voteCount / (movie.voteCount + 100) / 10
      const text = overlap(seedWords, words(movie))
      const popularity = seed ? 0 : Math.min(1, Math.log1p(Math.max(0, movie.popularity)) / 10) * .8
      const score = relationScore * 5 + support * 1.5 + affinity * 3 + text + quality * .15 + popularity
      const genres = seed ? movie.genreIds.filter(genre => seed.genreIds.includes(genre)).map(genre => GENRE_NAMES[genre]).filter(Boolean).slice(0, 2) : []
      const older = olderLinks[0]
      const keywordOnly = direct.length > 0 && direct.every(relation => relation.kind === "keywords")
      const reason = seed
        ? `${keywordOnly ? "Shared plot keywords with " : genres.length ? genres.join(" / ") + "; linked to " : "Linked to "}${seed.title}.${older ? ` Also linked to ${older.seedTitle}.` : earlier.length && affinity >= .25 ? " Fits your earlier picks." : ""}`
        : earlier.length ? "Matches your saved movie preferences." : "Popular on your selected services."
      return { movie: { ...movie, reason }, score, relationScore }
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.score - a.score || b.relationScore - a.relationScore || a.movie.tmdbId - b.movie.tmdbId)
    .slice(0, count).map(entry => entry.movie)
}
