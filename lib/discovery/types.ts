export const STREAMING_SERVICES = [
  { key: "netflix", label: "Netflix", names: ["Netflix", "Netflix Standard with Ads"] },
  { key: "prime", label: "Prime Video", names: ["Amazon Prime Video", "Amazon Prime Video with Ads"] },
  { key: "max", label: "Max", names: ["Max", "HBO Max"] },
  { key: "hulu", label: "Hulu", names: ["Hulu"] },
  { key: "disney", label: "Disney+", names: ["Disney Plus"] },
  { key: "apple", label: "Apple TV+", names: ["Apple TV Plus", "Apple TV"] },
  { key: "peacock", label: "Peacock", names: ["Peacock", "Peacock Premium", "Peacock Premium Plus"] },
  { key: "paramount", label: "Paramount+", names: ["Paramount Plus", "Paramount Plus Essential", "Paramount+ with Showtime"] },
  { key: "criterion", label: "Criterion", names: ["Criterion Channel"] },
  { key: "mubi", label: "MUBI", names: ["MUBI"] },
] as const

export type ServiceKey = (typeof STREAMING_SERVICES)[number]["key"] | `tmdb:${number}`
export type ServiceOption = { key: ServiceKey; label: string }
export function isServiceKey(value: unknown): value is ServiceKey {
  return typeof value === "string" && (STREAMING_SERVICES.some(service => service.key === value) || /^tmdb:[1-9]\d{0,8}$/.test(value))
}
export type DataMode = "local" | "supabase" | "unconfigured"
export type CatalogAccess = "subscription" | "rent" | "buy" | "theaters"
export type WatchPreferences = {
  mode: "home" | "theaters"
  services: ServiceKey[]
  includeRentals: boolean
  region: string
}

export type CatalogMovie = {
  tmdbId: number
  title: string
  releaseYear: number | null
  posterPath: string | null
  overview: string
  genreIds: number[]
  popularity: number
  voteAverage: number
  voteCount: number
  originalLanguage: string
}

export type CatalogManifest = {
  id: string
  key: string
  service: ServiceKey | "rentals" | "purchases" | "theaters"
  region: string
  access: CatalogAccess
  source: "sample" | "tmdb"
  completedAt: string
  checkedAt: string
  refreshAfter: string
  movieCount: number
  chunkCount: number
}

export type CatalogSummary = {
  popular: CatalogMovie[]
  gems: CatalogMovie[]
  recent: CatalogMovie[]
  genres: Record<string, CatalogMovie[]>
}

export type CatalogSnapshot = {
  manifest: CatalogManifest
  summary: CatalogSummary
  chunks: CatalogMovie[][]
}

export type MovieRelation = { seedId: number; seedTitle: string; kind: "recommendation" | "similar" | "keywords"; rank: number }
export type DiscoveryMovie = CatalogMovie & { availableOn: string[]; reason: string; sample: boolean; relations?: MovieRelation[] }
export type CatalogHealth = Pick<CatalogManifest, "key" | "source" | "checkedAt" | "movieCount" | "refreshAfter"> & { stale: boolean; label?: string }
export type DiscoveryRound = {
  id: string
  preferences: WatchPreferences
  movies: DiscoveryMovie[]
  seed: CatalogMovie | null
  catalogs: CatalogHealth[]
  missingCatalogs: string[]
  createdAt: string
  expiresAt: string
  selectedId: number | null
  voteCreated: boolean
  browse?: { key: string; page: number }
}

export type Favorite = { movie: CatalogMovie; roundId: string; createdAt: string }
export type GuestTaste = { favorites: number[]; history?: { movie: CatalogMovie; createdAt: string }[] }

export const GENRE_NAMES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary",
  18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
  9648: "Mystery", 10749: "Romance", 878: "Sci-fi", 10770: "TV movie", 53: "Thriller", 10752: "War", 37: "Western",
}

export function catalogKey(region: string, service: string): string {
  return `${region}_${service}`
}

export function requiredCatalogs(preferences: WatchPreferences): string[] {
  if (preferences.mode === "theaters") return [catalogKey(preferences.region, "theaters")]
  return [
    ...preferences.services.map(service => catalogKey(preferences.region, service)),
    ...(preferences.includeRentals ? [catalogKey(preferences.region, "rentals"), catalogKey(preferences.region, "purchases")] : []),
  ]
}

export function serviceLabel(service: string): string {
  return STREAMING_SERVICES.find(option => option.key === service)?.label ?? ({ rentals: "Rent", purchases: "Buy", theaters: "In theaters" }[service] || (service.startsWith("tmdb:") ? "Streaming service" : service))
}
