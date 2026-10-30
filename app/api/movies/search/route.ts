import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim().replace(/\s+/g, " ") ?? ""
  if (query.length < 2 || query.length > 100) {
    return NextResponse.json({ movies: [] })
  }

  const apiKey = process.env.TMDB_API_KEY ?? process.env.NEXT_PUBLIC_TMDB_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "Movie search is unavailable." }, { status: 503 })
  }

  const url = new URL("https://api.themoviedb.org/3/search/movie")
  url.searchParams.set("api_key", apiKey)
  url.searchParams.set("query", query)
  url.searchParams.set("include_adult", "false")
  url.searchParams.set("language", "en-US")
  url.searchParams.set("page", "1")

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(4000)]),
    })
    if (!response.ok) {
      return NextResponse.json({ error: "Movie search is unavailable." }, { status: 503 })
    }

    const data = await response.json()
    const seen = new Set<number>()
    const movies = (Array.isArray(data.results) ? data.results : [])
      .filter((movie: Record<string, unknown>) => {
        if (!movie || movie.adult === true || typeof movie.id !== "number" || !Number.isInteger(movie.id) ||
          movie.id <= 0 || seen.has(movie.id) || typeof movie.title !== "string" || !movie.title.trim()) {
          return false
        }
        seen.add(movie.id)
        return true
      })
      .slice(0, 6)
      .map((movie: Record<string, unknown>) => ({
        id: movie.id,
        title: (movie.title as string).trim().slice(0, 200),
        year: typeof movie.release_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(movie.release_date)
          ? movie.release_date.slice(0, 4)
          : null,
        poster: typeof movie.poster_path === "string" && /^\/[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(movie.poster_path)
          ? `https://image.tmdb.org/t/p/w92${movie.poster_path}`
          : null,
      }))

    return NextResponse.json({ movies }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "Movie search is unavailable." }, { status: 503 })
  }
}
