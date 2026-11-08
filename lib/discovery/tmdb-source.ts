import { z } from "zod"
import type { CatalogMovie } from "./types"

export type CatalogPage = { page: number; totalPages: number; totalResults: number; movies: CatalogMovie[] }

const movieSchema = z.object({
  id: z.number().int().positive(), title: z.string().min(1).max(400), release_date: z.string().optional().default(""),
  poster_path: z.string().regex(/^\/[a-zA-Z0-9._-]+$/).nullable().optional(), overview: z.string().optional().default(""),
  genre_ids: z.array(z.number().int().positive()).max(25), popularity: z.number().finite().nonnegative(),
  vote_average: z.number().finite().min(0).max(10), vote_count: z.number().int().nonnegative(), original_language: z.string().max(10),
})
const pageSchema = z.object({ page: z.number().int().positive(), total_pages: z.number().int().nonnegative(), total_results: z.number().int().nonnegative(), results: z.array(movieSchema).max(20) })

export function parseTmdbPage(payload: unknown): CatalogPage {
  const page = pageSchema.parse(payload)
  return { page: page.page, totalPages: page.total_pages, totalResults: page.total_results, movies: page.results.map(movie => ({
    tmdbId: movie.id, title: movie.title, releaseYear: /^\d{4}-/.test(movie.release_date) ? Number(movie.release_date.slice(0, 4)) : null,
    posterPath: movie.poster_path ?? null, overview: movie.overview.slice(0, 1600), genreIds: movie.genre_ids,
    popularity: movie.popularity, voteAverage: movie.vote_average, voteCount: movie.vote_count, originalLanguage: movie.original_language,
  })) }
}
