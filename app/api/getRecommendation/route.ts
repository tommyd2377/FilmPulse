import { NextResponse } from "next/server"
import OpenAI from "openai"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.5"
const OPENAI_RANK_MODEL = process.env.OPENAI_RANK_MODEL ?? "gpt-5.4-mini"
const OPENAI_EXTRACT_MODEL = process.env.OPENAI_EXTRACT_MODEL ?? "gpt-5-mini"
const TMDB_API_KEY = process.env.TMDB_API_KEY ?? process.env.NEXT_PUBLIC_TMDB_API_KEY
const TMDB_REGION = (process.env.TMDB_REGION ?? "US").trim().toUpperCase() || "US"
const TMDB_BASE_URL = "https://api.themoviedb.org/3"
const TMDB_POSTER_BASE_URL = "https://image.tmdb.org/t/p/w500"
const TARGET_RECOMMENDATION_COUNT = 5
const MAX_CANDIDATE_POOL_SIZE = 60
const MAX_AVAILABILITY_CHECK_CANDIDATES = 24
const AVAILABILITY_BATCH_SIZE = 6
const DISCOVERY_PAGE_COUNT = 2
const DEFAULT_WATCH_PREFERENCES: WatchPreferences = {
  mode: "any",
  streamingProviders: [],
  includeRentals: false,
}

const openai = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY,
    })
  : null

interface RecommendationRequestBody {
  userMessage?: unknown
  preference?: unknown
  previousResponseId?: unknown
  conversationHistory?: unknown
  feedbackEvents?: unknown
  watchPreferences?: unknown
}

type ConversationRole = "user" | "assistant"
type WatchMode = "any" | "theaters" | "home"

interface ConversationHistoryItem {
  role: ConversationRole
  content: string
}

type FeedbackType = "liked" | "loved_this" | "more_like_this" | "not_interested"

interface FeedbackEvent {
  type: FeedbackType
  title: string
  tmdbId: number | null
}

interface WatchPreferences {
  mode: WatchMode
  streamingProviders: string[]
  includeRentals: boolean
}

interface TasteAnalysis {
  seedMovieTitles: string[]
  referencePeople: string[]
  likedSignals: string[]
  dislikedSignals: string[]
  constraints: string[]
  desiredMood: string[]
  excludeDirectReferenceWorks: boolean
  needsClarification: boolean
  clarificationQuestion: string
}

interface TmdbGenre {
  id: number
  name: string
}

interface TmdbMovieListItem {
  id: number
  title?: string
  name?: string
  overview?: string
  poster_path?: string | null
  release_date?: string
  genre_ids?: number[]
  popularity?: number
  vote_average?: number
}

interface TmdbMovieDetails {
  id: number
  title?: string
  overview?: string
  poster_path?: string | null
  release_date?: string
  genres?: TmdbGenre[]
  popularity?: number
  vote_average?: number
}

interface TmdbListResponse {
  results?: TmdbMovieListItem[]
}

interface TmdbWatchProvider {
  provider_id: number
  provider_name: string
  logo_path?: string | null
}

interface TmdbWatchProviderRegion {
  link?: string
  flatrate?: TmdbWatchProvider[]
  rent?: TmdbWatchProvider[]
  buy?: TmdbWatchProvider[]
}

interface TmdbWatchProviderResponse {
  results?: Record<string, TmdbWatchProviderRegion | undefined>
}

interface TmdbWatchProviderListResponse {
  results?: TmdbWatchProvider[]
}

interface TmdbPersonListItem {
  id: number
  name?: string
  known_for_department?: string
  popularity?: number
}

interface TmdbPersonSearchResponse {
  results?: TmdbPersonListItem[]
}

interface TmdbMovieCreditItem extends TmdbMovieListItem {
  job?: string
  department?: string
  character?: string
}

interface TmdbPersonMovieCreditsResponse {
  cast?: TmdbMovieCreditItem[]
  crew?: TmdbMovieCreditItem[]
}

interface MovieAvailability {
  region: string
  watchUrl: string | null
  inTheaters: boolean
  streaming: string[]
  rent: string[]
  buy: string[]
  badges: string[]
}

interface RecommendedMovie {
  tmdbId: number
  title: string
  poster: string | null
  tmdbUrl: string
  releaseYear: number | string
  genre: string
  overview: string
  popularity: number
  voteAverage: number
  reason?: string
  availability?: MovieAvailability
}

interface CandidateMovie extends RecommendedMovie {
  sourceSeedTitles: string[]
  sourceTypes: string[]
  score: number
}

interface RecommendationContext {
  movies: RecommendedMovie[]
  analysis: TasteAnalysis | null
  excludedMovieKeys: string[]
}

function preferenceMode(preference: number): "indie" | "mixed" | "blockbusters" {
  if (preference <= 0.33) {
    return "indie"
  }
  if (preference >= 0.67) {
    return "blockbusters"
  }
  return "mixed"
}

function buildInstructions(
  preference: number,
  selectedMovies: RecommendedMovie[] = [],
  watchPreferences: WatchPreferences = DEFAULT_WATCH_PREFERENCES
): string {
  const mode = preferenceMode(preference)

  const preferenceDirective =
    mode === "indie"
      ? "Prioritize indie, international, or lesser-known films. Avoid obvious blockbusters unless the user asks."
      : mode === "blockbusters"
      ? "Prioritize popular, mainstream, or blockbuster films with broad appeal."
      : "Blend hidden gems and crowd-pleasers in a balanced way."

  const lockedRecommendationDirective =
    selectedMovies.length > 0
      ? [
          "Use only the selected recommendation list provided in the user input as the recommended movies.",
          "Do not add, replace, or recommend any movie title outside that selected list.",
          "You may mention the user's seed films as context, but not as recommendations.",
          "Do not claim that other users liked a film. Say based on what the user liked here when you need that framing.",
        ].join("\n")
      : watchPreferencesAreActive(watchPreferences)
      ? [
          "No verified recommendation list is available for the user's current viewing filters.",
          "Do not recommend, bold, or imply specific movie titles as verified available.",
          "Briefly explain that you could not verify matching movies for the selected viewing filters and ask one concise follow-up to broaden the search.",
        ].join("\n")
      : ""

  const shortageDirective =
    selectedMovies.length > 0 &&
    selectedMovies.length < TARGET_RECOMMENDATION_COUNT &&
    watchPreferencesAreActive(watchPreferences)
      ? `Only ${selectedMovies.length} verified option${
          selectedMovies.length === 1 ? " is" : "s are"
        } available for the current viewing filters. Recommend all of them and briefly mention that the filter was narrow.`
      : ""

  const viewingDirective =
    watchPreferences.mode === "theaters"
      ? "The user wants movies they can watch in theaters now. Prefer theatrical availability when discussing recommendations."
      : watchPreferences.mode === "home"
      ? `The user wants at-home options. Prefer movies available on ${watchPreferences.streamingProviders.length > 0 ? watchPreferences.streamingProviders.join(", ") : "streaming services"}${
          watchPreferences.includeRentals ? ", and rental or purchase options are acceptable." : "."
        }`
      : ""

  return [
    "You are FilmPulse, a warm and conversational movie concierge.",
    "Keep replies natural and friendly, with contractions and clear personality, never robotic.",
    `Recommend up to ${TARGET_RECOMMENDATION_COUNT} movies unless the user explicitly asks for a different number.`,
    "For each movie, include a short reason (1 sentence) why it matches the user's taste.",
    "Format every movie title in **bold** markdown.",
    "End with one concise follow-up question to continue the conversation.",
    preferenceDirective,
    viewingDirective,
    shortageDirective,
    lockedRecommendationDirective,
  ]
    .filter(Boolean)
    .join("\n")
}

function sanitizeMovieTitles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const deduped = new Set<string>()
  for (const item of value) {
    if (typeof item !== "string") {
      continue
    }
    const normalized = normalizeMovieTitle(item)
    if (!normalized || !isLikelyMovieTitle(normalized)) {
      continue
    }
    deduped.add(normalized)
  }

  return [...deduped]
}

function normalizeMovieTitle(rawTitle: string): string {
  return rawTitle
    .trim()
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, "")
    .replace(/^[\-–—:;,.!?()\[\]]+|[\-–—:;,.!?()\[\]]+$/g, "")
    .replace(/\s*\((\d{4}|[A-Za-z]{3,}\s\d{4})\)$/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isLikelyMovieTitle(title: string): boolean {
  if (title.length < 2 || title.length > 80) {
    return false
  }

  if (/[.?!]\s+\w+/.test(title)) {
    return false
  }

  if (title.split(/\s+/).length > 14) {
    return false
  }

  const words = title.split(/\s+/)
  const lowercaseStarts = words.filter((word) => /^[a-z]/.test(word)).length
  if (words.length >= 5 && lowercaseStarts >= words.length - 1) {
    return false
  }

  return true
}

function sanitizeConversationHistory(value: unknown): ConversationHistoryItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  const history: ConversationHistoryItem[] = []

  for (const item of value.slice(-12)) {
    if (!item || typeof item !== "object") {
      continue
    }

    const roleValue = "role" in item ? item.role : undefined
    const contentValue = "content" in item ? item.content : undefined

    if ((roleValue !== "user" && roleValue !== "assistant") || typeof contentValue !== "string") {
      continue
    }

    const content = contentValue.trim().slice(0, 800)
    if (!content) {
      continue
    }

    history.push({
      role: roleValue,
      content,
    })
  }

  return history
}

function sanitizeFeedbackEvents(value: unknown): FeedbackEvent[] {
  if (!Array.isArray(value)) {
    return []
  }

  const events: FeedbackEvent[] = []

  for (const item of value.slice(-40)) {
    if (!item || typeof item !== "object") {
      continue
    }

    const typeValue = "type" in item ? item.type : undefined
    const titleValue = "title" in item ? item.title : undefined
    const tmdbIdValue = "tmdbId" in item ? item.tmdbId : undefined

    if (
      typeValue !== "liked" &&
      typeValue !== "loved_this" &&
      typeValue !== "more_like_this" &&
      typeValue !== "not_interested"
    ) {
      continue
    }

    if (typeof titleValue !== "string") {
      continue
    }

    const title = normalizeMovieTitle(titleValue).slice(0, 120)
    if (!title) {
      continue
    }

    events.push({
      type: typeValue,
      title,
      tmdbId: typeof tmdbIdValue === "number" && Number.isInteger(tmdbIdValue) ? tmdbIdValue : null,
    })
  }

  return events
}

function sanitizeWatchPreferences(value: unknown): WatchPreferences {
  if (!value || typeof value !== "object") {
    return DEFAULT_WATCH_PREFERENCES
  }

  const preferences = value as Record<string, unknown>
  const mode = preferences.mode === "theaters" || preferences.mode === "home" ? preferences.mode : "any"
  const streamingProviders = Array.isArray(preferences.streamingProviders)
    ? [
        ...new Set(
          preferences.streamingProviders
            .filter((provider): provider is string => typeof provider === "string")
            .map((provider) => provider.trim())
            .filter(Boolean)
        ),
      ].slice(0, 12)
    : []

  return {
    mode,
    streamingProviders,
    includeRentals: preferences.includeRentals === true,
  }
}

function buildConversationAwareInput(userMessage: string, history: ConversationHistoryItem[]): string {
  if (history.length === 0) {
    return userMessage
  }

  const formattedHistory = history
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "User"}: ${turn.content}`)
    .join("\n")

  return [
    "Conversation so far (oldest to newest):",
    formattedHistory,
    "",
    `Latest user message: ${userMessage}`,
  ].join("\n")
}

function watchPreferencesAreActive(preferences: WatchPreferences): boolean {
  return preferences.mode !== "any"
}

function watchPreferencesSummary(preferences: WatchPreferences): string {
  if (preferences.mode === "theaters") {
    return "in theaters now"
  }

  if (preferences.mode === "home") {
    const services =
      preferences.streamingProviders.length > 0 ? preferences.streamingProviders.join(", ") : "any streaming service"
    return preferences.includeRentals ? `${services}; rentals or purchases ok` : services
  }

  return ""
}

function buildRecommendationInput(options: {
  userMessage: string
  conversationHistory: ConversationHistoryItem[]
  selectedMovies: RecommendedMovie[]
  analysis: TasteAnalysis | null
  watchPreferences: WatchPreferences
}): string {
  const conversationInput = buildConversationAwareInput(options.userMessage, options.conversationHistory)
  const viewingPreference = watchPreferencesSummary(options.watchPreferences)

  if (options.selectedMovies.length === 0) {
    return [viewingPreference ? `Viewing preference: ${viewingPreference}` : "", conversationInput]
      .filter(Boolean)
      .join("\n")
  }

  const selectedRecommendations = options.selectedMovies.map((movie) => ({
    tmdbId: movie.tmdbId,
    title: movie.title,
    year: movie.releaseYear,
    genre: movie.genre,
    reason: movie.reason,
    availability: movie.availability
      ? {
          inTheaters: movie.availability.inTheaters,
          streaming: movie.availability.streaming,
          rent: movie.availability.rent,
          buy: movie.availability.buy,
        }
      : undefined,
  }))

  return [
    viewingPreference ? `Viewing preference: ${viewingPreference}` : "",
    "Selected recommendations (only allowed recommendation titles):",
    JSON.stringify(selectedRecommendations, null, 2),
    "",
    options.analysis
      ? [
          "Taste profile:",
          JSON.stringify(
            {
              referencePeople: options.analysis.referencePeople,
              likedSignals: options.analysis.likedSignals,
              dislikedSignals: options.analysis.dislikedSignals,
              constraints: options.analysis.constraints,
              desiredMood: options.analysis.desiredMood,
              excludeDirectReferenceWorks: options.analysis.excludeDirectReferenceWorks,
            },
            null,
            2
          ),
          "",
        ].join("\n")
      : "",
    conversationInput,
  ]
    .filter(Boolean)
    .join("\n")
}

function buildSelectedMoviesResponseText(selectedMovies: RecommendedMovie[], watchPreferences: WatchPreferences): string {
  const viewingPreference = watchPreferencesSummary(watchPreferences)
  const countLabel = selectedMovies.length === TARGET_RECOMMENDATION_COUNT ? "five" : String(selectedMovies.length)
  const filterText = viewingPreference ? ` and match ${viewingPreference}` : ""

  if (selectedMovies.length < TARGET_RECOMMENDATION_COUNT && watchPreferencesAreActive(watchPreferences)) {
    return `I found ${countLabel} verified pick${
      selectedMovies.length === 1 ? "" : "s"
    } that fit the vibe${filterText}. The current watch filter is pretty narrow, so I’m only showing titles I could verify.`
  }

  return `I found ${countLabel} verified picks that fit the vibe${filterText}.`
}

function extractMovieTitlesFromMarkdown(text: string): string[] {
  const matches: string[] = []
  const patterns = [/\*\*(.*?)\*\*/g, /\*([^*\n]+)\*/g]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const candidate = match[1]?.trim()
      if (!candidate) {
        continue
      }
      matches.push(candidate.replace(/['’]s$/i, "").trim())
    }
  }

  return sanitizeMovieTitles(matches)
}

function extractSeedTitleHints(text: string): string[] {
  const hints: string[] = []
  const quotedPatterns = [/"([^"\n]{2,80})"/g, /“([^”\n]{2,80})”/g, /'([^'\n]{2,80})'/g]

  for (const pattern of quotedPatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      hints.push(match[1])
    }
  }

  const likePattern =
    /(?:more\s+(?:films?|movies?)\s+like|something\s+like|similar\s+to|movies?\s+like|films?\s+like|like)\s+(.+?)(?:[.?!]|$)/gi
  let likeMatch: RegExpExecArray | null
  while ((likeMatch = likePattern.exec(text)) !== null) {
    const rawCandidate = likeMatch[1].trim()
    if (/\s+(?:films?|movies?|ones?|recommendations?)$/i.test(rawCandidate)) {
      continue
    }

    const candidate = rawCandidate
      .replace(/^(?:the\s+movie|the\s+film)\s+/i, "")
      .trim()

    if (candidate && !/\b(?:directors?|filmmakers?|actors?|writers?)$/i.test(candidate)) {
      hints.push(candidate)
    }
  }

  return sanitizeMovieTitles(hints)
}

function createSSEEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return "Failed to get recommendation"
}

function shouldRetryWithoutPreviousResponseId(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const message = error.message.toLowerCase()
  return message.includes("previous_response_id") || message.includes("previous response")
}

function releaseYearFromDate(releaseDate?: string): number | string {
  if (!releaseDate) {
    return "N/A"
  }

  const year = Number.parseInt(releaseDate.slice(0, 4), 10)
  return Number.isFinite(year) ? year : "N/A"
}

function moviePosterUrl(path?: string | null): string | null {
  return path ? `${TMDB_POSTER_BASE_URL}${path}` : null
}

function normalizeTitleKey(title: string): string {
  return normalizeMovieTitle(title).toLowerCase()
}

function movieKeysFromTitles(titles: string[]): Set<string> {
  return new Set(sanitizeMovieTitles(titles).map(normalizeTitleKey))
}

function movieIsExcluded(movie: RecommendedMovie, excludedKeys: Set<string>): boolean {
  return excludedKeys.has(String(movie.tmdbId)) || excludedKeys.has(normalizeTitleKey(movie.title))
}

function tmdbUrl(path: string, params: Record<string, string | number | boolean> = {}): string | null {
  if (!TMDB_API_KEY) {
    return null
  }

  const url = new URL(`${TMDB_BASE_URL}${path}`)
  url.searchParams.set("api_key", TMDB_API_KEY)

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value))
  }

  return url.toString()
}

async function fetchTmdbJson<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T | null> {
  const url = tmdbUrl(path, params)
  if (!url) {
    return null
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      return null
    }

    return (await response.json()) as T
  } catch (error) {
    console.error("TMDB request failed:", error)
    return null
  }
}

let genreMapCache: Map<number, string> | null = null
let watchProviderCache: { expiresAt: number; providers: TmdbWatchProvider[] } | null = null

async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize)
    results.push(...(await Promise.all(batch.map(mapper))))
  }

  return results
}

async function getGenreMap(): Promise<Map<number, string>> {
  if (genreMapCache) {
    return genreMapCache
  }

  const payload = await fetchTmdbJson<{ genres?: TmdbGenre[] }>("/genre/movie/list")
  genreMapCache = new Map((payload?.genres ?? []).map((genre) => [genre.id, genre.name]))
  return genreMapCache
}

async function getMovieWatchProviders(): Promise<TmdbWatchProvider[]> {
  const now = Date.now()
  if (watchProviderCache && watchProviderCache.expiresAt > now) {
    return watchProviderCache.providers
  }

  const payload = await fetchTmdbJson<TmdbWatchProviderListResponse>("/watch/providers/movie", {
    watch_region: TMDB_REGION,
  })
  const providers = (payload?.results ?? []).filter(
    (provider) => Number.isInteger(provider.provider_id) && Boolean(provider.provider_name)
  )

  watchProviderCache = {
    expiresAt: now + 1000 * 60 * 60 * 24,
    providers,
  }

  return providers
}

async function getSelectedWatchProviderIds(selectedProviders: string[]): Promise<number[]> {
  if (selectedProviders.length === 0) {
    return []
  }

  const providers = await getMovieWatchProviders()
  const providerIds = new Set<number>()

  for (const selectedProvider of selectedProviders) {
    for (const provider of providers) {
      if (providerNameMatches(provider.provider_name, selectedProvider)) {
        providerIds.add(provider.provider_id)
      }
    }
  }

  return [...providerIds]
}

function watchMonetizationTypes(preferences: WatchPreferences): string {
  return preferences.includeRentals ? "flatrate|rent|buy" : "flatrate"
}

function movieFromDetails(details: TmdbMovieDetails, reason?: string): RecommendedMovie | null {
  const title = details.title?.trim()
  if (!title) {
    return null
  }

  return {
    tmdbId: details.id,
    title,
    poster: moviePosterUrl(details.poster_path),
    tmdbUrl: `https://www.themoviedb.org/movie/${details.id}`,
    releaseYear: releaseYearFromDate(details.release_date),
    genre: details.genres?.[0]?.name ?? "Unknown Genre",
    overview: details.overview ?? "",
    popularity: details.popularity ?? 0,
    voteAverage: details.vote_average ?? 0,
    reason,
    availability: undefined,
  }
}

function candidateFromListItem(
  movie: TmdbMovieListItem,
  genreMap: Map<number, string>,
  sourceSeedTitle: string,
  sourceType: string,
  preference: number
): CandidateMovie | null {
  const title = movie.title?.trim() ?? movie.name?.trim()
  if (!title) {
    return null
  }

  const popularity = movie.popularity ?? 0
  const voteAverage = movie.vote_average ?? 0
  const popularityScore = Math.min(popularity / 80, 1)
  const hiddenGemScore = 1 - popularityScore
  const blockbusterScore = popularityScore
  const noveltyFit =
    preference <= 0.33 ? hiddenGemScore : preference >= 0.67 ? blockbusterScore : 1 - Math.abs(0.5 - popularityScore)
  const sourceScore = sourceType.startsWith("provider_discover")
    ? 0.36
    : sourceType === "now_playing"
    ? 0.3
    : sourceType === "recommendations"
    ? 0.2
    : 0.12
  const score = sourceScore + noveltyFit * 0.5 + Math.min(voteAverage / 10, 1) * 0.3

  return {
    tmdbId: movie.id,
    title,
    poster: moviePosterUrl(movie.poster_path),
    tmdbUrl: `https://www.themoviedb.org/movie/${movie.id}`,
    releaseYear: releaseYearFromDate(movie.release_date),
    genre: genreMap.get(movie.genre_ids?.[0] ?? -1) ?? "Unknown Genre",
    overview: movie.overview ?? "",
    popularity,
    voteAverage,
    sourceSeedTitles: [sourceSeedTitle],
    sourceTypes: [sourceType],
    score,
  }
}

function recommendationFromCandidate(candidate: CandidateMovie, reason?: string): RecommendedMovie {
  return {
    tmdbId: candidate.tmdbId,
    title: candidate.title,
    poster: candidate.poster,
    tmdbUrl: candidate.tmdbUrl,
    releaseYear: candidate.releaseYear,
    genre: candidate.genre,
    overview: candidate.overview,
    popularity: candidate.popularity,
    voteAverage: candidate.voteAverage,
    reason,
    availability: candidate.availability,
  }
}

let nowPlayingCache: { expiresAt: number; ids: Set<number> } | null = null
let nowPlayingRequest: Promise<Set<number>> | null = null

function providerNames(providers?: TmdbWatchProvider[]): string[] {
  return [...new Set((providers ?? []).map((provider) => provider.provider_name).filter(Boolean))]
}

function availabilityBadges(options: {
  inTheaters: boolean
  streaming: string[]
  rent: string[]
  buy: string[]
}): string[] {
  const badges: string[] = []

  if (options.inTheaters) {
    badges.push("In theaters")
  }
  if (options.streaming.length > 0) {
    badges.push(`Stream: ${options.streaming[0]}`)
  }
  if (options.rent.length > 0) {
    badges.push(`Rent: ${options.rent[0]}`)
  }
  if (options.buy.length > 0) {
    badges.push(`Buy: ${options.buy[0]}`)
  }

  return badges.length > 0 ? badges : ["Availability unknown"]
}

function justWatchRegion(region: string): string {
  return region.toLowerCase() === "gb" ? "uk" : region.toLowerCase()
}

function buildWatchSearchUrl(title: string, releaseYear: number | string): string {
  const year = typeof releaseYear === "number" ? String(releaseYear) : /^\d{4}$/.test(releaseYear) ? releaseYear : ""
  const query = year ? `${title} ${year}` : title
  return `https://www.justwatch.com/${justWatchRegion(TMDB_REGION)}/search?q=${encodeURIComponent(query)}`
}

async function getNowPlayingMovieIds(): Promise<Set<number>> {
  const now = Date.now()
  if (nowPlayingCache && nowPlayingCache.expiresAt > now) {
    return nowPlayingCache.ids
  }

  if (nowPlayingRequest) {
    return nowPlayingRequest
  }

  nowPlayingRequest = (async () => {
    const pages = await Promise.all(
      Array.from({ length: DISCOVERY_PAGE_COUNT }, (_, index) =>
        fetchTmdbJson<TmdbListResponse>("/movie/now_playing", { region: TMDB_REGION, page: index + 1 })
      )
    )
    const ids = new Set<number>()

    for (const page of pages) {
      for (const movie of page?.results ?? []) {
        if (Number.isInteger(movie.id)) {
          ids.add(movie.id)
        }
      }
    }

    nowPlayingCache = {
      expiresAt: now + 1000 * 60 * 15,
      ids,
    }

    return ids
  })()

  try {
    return await nowPlayingRequest
  } finally {
    nowPlayingRequest = null
  }
}

async function fetchMovieAvailability(
  movie: RecommendedMovie,
  options: { includeTheaters?: boolean; includeWatchProviders?: boolean } = {}
): Promise<MovieAvailability> {
  const includeTheaters = options.includeTheaters ?? true
  const includeWatchProviders = options.includeWatchProviders ?? true
  const [watchProviders, nowPlayingIds] = await Promise.all([
    includeWatchProviders
      ? fetchTmdbJson<TmdbWatchProviderResponse>(`/movie/${movie.tmdbId}/watch/providers`)
      : Promise.resolve(null),
    includeTheaters ? getNowPlayingMovieIds() : Promise.resolve(new Set<number>()),
  ])
  const regionProviders = watchProviders?.results?.[TMDB_REGION]
  const streaming = providerNames(regionProviders?.flatrate)
  const rent = providerNames(regionProviders?.rent)
  const buy = providerNames(regionProviders?.buy)
  const inTheaters = nowPlayingIds.has(movie.tmdbId)

  return {
    region: TMDB_REGION,
    watchUrl: buildWatchSearchUrl(movie.title, movie.releaseYear),
    inTheaters,
    streaming,
    rent,
    buy,
    badges: availabilityBadges({ inTheaters, streaming, rent, buy }),
  }
}

async function enrichAvailability(movies: RecommendedMovie[]): Promise<RecommendedMovie[]> {
  if (!TMDB_API_KEY || movies.length === 0) {
    return movies
  }

  return mapInBatches(movies, AVAILABILITY_BATCH_SIZE, async (movie) => ({
    ...movie,
    availability: movie.availability ?? (await fetchMovieAvailability(movie)),
  }))
}

async function enrichCandidateAvailability(
  candidates: CandidateMovie[],
  preferences: WatchPreferences
): Promise<CandidateMovie[]> {
  if (!TMDB_API_KEY || candidates.length === 0) {
    return candidates
  }

  const includeTheaters = preferences.mode === "theaters"
  const includeWatchProviders = preferences.mode === "home"

  return mapInBatches(
    candidates.slice(0, MAX_AVAILABILITY_CHECK_CANDIDATES),
    AVAILABILITY_BATCH_SIZE,
    async (candidate) => ({
      ...candidate,
      availability:
        candidate.availability ??
        (await fetchMovieAvailability(candidate, {
          includeTheaters,
          includeWatchProviders,
        })),
    })
  )
}

function normalizeProviderName(provider: string): string {
  return provider
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function providerNameMatches(availableProvider: string, selectedProvider: string): boolean {
  const availableProviderKey = normalizeProviderName(availableProvider)
  const selectedProviderKey = normalizeProviderName(selectedProvider)

  if (!availableProviderKey || !selectedProviderKey) {
    return false
  }

  if (selectedProviderKey === "amazon") {
    return availableProviderKey === "amazon prime video" || availableProviderKey === "prime video"
  }

  return (
    availableProviderKey === selectedProviderKey ||
    availableProviderKey.includes(selectedProviderKey) ||
    selectedProviderKey.includes(availableProviderKey)
  )
}

function hasSelectedStreamingProvider(availability: MovieAvailability, selectedProviders: string[]): boolean {
  if (selectedProviders.length === 0) {
    return availability.streaming.length > 0
  }

  return selectedProviders.some((selectedProvider) =>
    availability.streaming.some((availableProvider) => providerNameMatches(availableProvider, selectedProvider))
  )
}

function hasRentalOption(availability: MovieAvailability): boolean {
  return availability.rent.length > 0 || availability.buy.length > 0
}

function movieMatchesWatchPreferences(movie: RecommendedMovie, preferences: WatchPreferences): boolean {
  if (preferences.mode === "any") {
    return true
  }

  const availability = movie.availability
  if (!availability) {
    return false
  }

  if (preferences.mode === "theaters") {
    return availability.inTheaters
  }

  return (
    hasSelectedStreamingProvider(availability, preferences.streamingProviders) ||
    (preferences.includeRentals && hasRentalOption(availability))
  )
}

function watchPreferenceScore(movie: RecommendedMovie, preferences: WatchPreferences): number {
  const availability = movie.availability
  if (preferences.mode === "any" || !availability) {
    return 0
  }

  if (preferences.mode === "theaters") {
    return availability.inTheaters ? 0.45 : 0
  }

  let score = 0

  if (hasSelectedStreamingProvider(availability, preferences.streamingProviders)) {
    score += preferences.streamingProviders.length > 0 ? 0.45 : 0.3
  } else if (availability.streaming.length > 0) {
    score += 0.12
  }

  if (preferences.includeRentals && hasRentalOption(availability)) {
    score += 0.1
  }

  return score
}

function sourceVerifiedWatchPreferenceScore(candidate: CandidateMovie, preferences: WatchPreferences): number {
  if (preferences.mode === "home" && candidate.sourceTypes.some((sourceType) => sourceType.startsWith("provider_discover"))) {
    return preferences.streamingProviders.length > 0 ? 0.45 : 0.3
  }

  if (preferences.mode === "theaters" && candidate.sourceTypes.includes("now_playing")) {
    return 0.45
  }

  return 0
}

async function applyWatchPreferencesToCandidates(
  candidates: CandidateMovie[],
  preferences: WatchPreferences
): Promise<CandidateMovie[]> {
  if (preferences.mode === "any" || candidates.length === 0) {
    return candidates
  }

  const sourceVerifiedCandidates = candidates
    .filter((candidate) => sourceVerifiedWatchPreferenceScore(candidate, preferences) > 0)
    .map((candidate) => ({
      ...candidate,
      score: candidate.score + sourceVerifiedWatchPreferenceScore(candidate, preferences),
    }))
  const candidatesNeedingAvailability = candidates.filter(
    (candidate) => sourceVerifiedWatchPreferenceScore(candidate, preferences) === 0
  )
  const candidatesWithAvailability = await enrichCandidateAvailability(candidatesNeedingAvailability, preferences)

  return [
    ...sourceVerifiedCandidates,
    ...candidatesWithAvailability
    .filter((candidate) => movieMatchesWatchPreferences(candidate, preferences))
    .map((candidate) => ({
      ...candidate,
      score: candidate.score + watchPreferenceScore(candidate, preferences),
    })),
  ]
    .sort((first, second) => second.score - first.score)
}

function applyWatchPreferencesToMovies(
  movies: RecommendedMovie[],
  preferences: WatchPreferences
): RecommendedMovie[] {
  if (preferences.mode === "any") {
    return movies
  }

  return movies
    .filter((movie) => movieMatchesWatchPreferences(movie, preferences))
    .sort((first, second) => watchPreferenceScore(second, preferences) - watchPreferenceScore(first, preferences))
}

async function resolveMovieTitle(title: string): Promise<RecommendedMovie | null> {
  const payload = await fetchTmdbJson<TmdbListResponse>("/search/movie", {
    query: title,
    include_adult: false,
    page: 1,
  })

  const firstResult = payload?.results?.[0]
  if (!firstResult?.id) {
    return null
  }

  const details = await fetchTmdbJson<TmdbMovieDetails>(`/movie/${firstResult.id}`)
  return details ? movieFromDetails(details) : null
}

async function fetchCandidateMoviesForSeed(seed: RecommendedMovie, preference: number): Promise<CandidateMovie[]> {
  const genreMap = await getGenreMap()
  const endpoints = ["recommendations", "similar"]
  const candidates: CandidateMovie[] = []

  for (const endpoint of endpoints) {
    const payload = await fetchTmdbJson<TmdbListResponse>(`/movie/${seed.tmdbId}/${endpoint}`, {
      page: 1,
    })

    for (const movie of payload?.results ?? []) {
      const candidate = candidateFromListItem(movie, genreMap, seed.title, endpoint, preference)
      if (candidate) {
        candidates.push(candidate)
      }
    }
  }

  return candidates
}

async function fetchDiscoverCandidates(options: {
  preference: number
  params: Record<string, string | number | boolean>
  sourceSeedTitle: string
  sourceType: string
  pages?: number
}): Promise<CandidateMovie[]> {
  const genreMap = await getGenreMap()
  const pages = options.pages ?? DISCOVERY_PAGE_COUNT
  const payloads = await Promise.all(
    Array.from({ length: pages }, (_, index) =>
      fetchTmdbJson<TmdbListResponse>("/discover/movie", {
        include_adult: false,
        include_video: false,
        region: TMDB_REGION,
        page: index + 1,
        ...options.params,
      })
    )
  )
  const candidates: CandidateMovie[] = []

  for (const payload of payloads) {
    for (const movie of payload?.results ?? []) {
      const candidate = candidateFromListItem(
        movie,
        genreMap,
        options.sourceSeedTitle,
        options.sourceType,
        options.preference
      )
      if (candidate) {
        candidates.push(candidate)
      }
    }
  }

  return candidates
}

async function fetchWatchPreferenceDiscoveryCandidates(
  preferences: WatchPreferences,
  preference: number
): Promise<CandidateMovie[]> {
  if (preferences.mode === "any") {
    return []
  }

  if (preferences.mode === "theaters") {
    const genreMap = await getGenreMap()
    const payloads = await Promise.all(
      Array.from({ length: DISCOVERY_PAGE_COUNT }, (_, index) =>
        fetchTmdbJson<TmdbListResponse>("/movie/now_playing", {
          region: TMDB_REGION,
          page: index + 1,
        })
      )
    )
    const candidates: CandidateMovie[] = []

    for (const payload of payloads) {
      for (const movie of payload?.results ?? []) {
        const candidate = candidateFromListItem(movie, genreMap, "Now playing", "now_playing", preference)
        if (candidate) {
          candidates.push(candidate)
        }
      }
    }

    return candidates
  }

  const providerIds = await getSelectedWatchProviderIds(preferences.streamingProviders)
  if (preferences.streamingProviders.length > 0 && providerIds.length === 0) {
    return []
  }

  const baseParams: Record<string, string | number | boolean> = {
    watch_region: TMDB_REGION,
    with_watch_monetization_types: watchMonetizationTypes(preferences),
  }

  if (providerIds.length > 0) {
    baseParams.with_watch_providers = providerIds.join("|")
  }

  const discoveryGroups = await Promise.all([
    fetchDiscoverCandidates({
      preference,
      params: { ...baseParams, sort_by: "popularity.desc" },
      sourceSeedTitle: "Selected streaming providers",
      sourceType: "provider_discover",
    }),
    fetchDiscoverCandidates({
      preference,
      params: { ...baseParams, sort_by: "vote_average.desc", "vote_count.gte": 75 },
      sourceSeedTitle: "Selected streaming providers",
      sourceType: "provider_discover_quality",
      pages: 2,
    }),
  ])

  return discoveryGroups.flat()
}

async function searchPersonByName(name: string): Promise<TmdbPersonListItem | null> {
  const payload = await fetchTmdbJson<TmdbPersonSearchResponse>("/search/person", {
    query: name,
    include_adult: false,
    page: 1,
  })

  return payload?.results?.find((person) => Number.isInteger(person.id)) ?? null
}

function personCreditWeight(credit: TmdbMovieCreditItem): number {
  const job = normalizeProviderName(credit.job ?? "")
  const department = normalizeProviderName(credit.department ?? "")

  if (job === "director" || job === "writer" || job === "screenplay") {
    return 0.3
  }
  if (department === "directing" || department === "writing") {
    return 0.24
  }
  if (credit.character) {
    return 0.16
  }
  return 0.1
}

async function fetchReferenceMoviesForPeople(referencePeople: string[], preference: number): Promise<CandidateMovie[]> {
  const personNames = sanitizeMovieTitles(referencePeople).slice(0, 3)
  if (personNames.length === 0) {
    return []
  }

  const genreMap = await getGenreMap()
  const people = (await Promise.all(personNames.map((name) => searchPersonByName(name)))).filter(
    (person): person is TmdbPersonListItem => person !== null
  )
  const creditPayloads = await Promise.all(
    people.map(async (person) => ({
      person,
      credits: await fetchTmdbJson<TmdbPersonMovieCreditsResponse>(`/person/${person.id}/movie_credits`),
    }))
  )
  const byId = new Map<number, CandidateMovie>()

  for (const { person, credits } of creditPayloads) {
    const creditGroups = [credits?.crew ?? [], credits?.cast ?? []]

    for (const credit of creditGroups.flat()) {
      const candidate = candidateFromListItem(
        credit,
        genreMap,
        person.name?.trim() || "Reference person",
        "person_credit",
        preference
      )
      if (!candidate) {
        continue
      }

      candidate.score += personCreditWeight(credit)

      const existing = byId.get(candidate.tmdbId)
      if (!existing || candidate.score > existing.score) {
        byId.set(candidate.tmdbId, candidate)
      }
    }
  }

  return [...byId.values()]
    .sort((first, second) => second.score - first.score)
    .slice(0, 10)
}

function dedupeMoviesById<T extends RecommendedMovie>(movies: T[]): T[] {
  const byId = new Map<number, T>()

  for (const movie of movies) {
    if (!byId.has(movie.tmdbId)) {
      byId.set(movie.tmdbId, movie)
    }
  }

  return [...byId.values()]
}

function getExcludedMovieKeys(feedbackEvents: FeedbackEvent[], excludedMovies: RecommendedMovie[]): Set<string> {
  const excluded = new Set<string>()

  for (const movie of excludedMovies) {
    excluded.add(String(movie.tmdbId))
    excluded.add(normalizeTitleKey(movie.title))
  }

  for (const event of feedbackEvents) {
    if (event.type !== "not_interested") {
      continue
    }

    if (event.tmdbId) {
      excluded.add(String(event.tmdbId))
    }
    excluded.add(normalizeTitleKey(event.title))
  }

  return excluded
}

function dedupeAndRankCandidates(
  candidates: CandidateMovie[],
  feedbackEvents: FeedbackEvent[],
  excludedMovies: RecommendedMovie[]
): CandidateMovie[] {
  const excluded = getExcludedMovieKeys(feedbackEvents, excludedMovies)
  const byId = new Map<number, CandidateMovie>()

  for (const candidate of candidates) {
    if (excluded.has(String(candidate.tmdbId)) || excluded.has(normalizeTitleKey(candidate.title))) {
      continue
    }

    const existing = byId.get(candidate.tmdbId)
    if (!existing) {
      byId.set(candidate.tmdbId, candidate)
      continue
    }

    existing.score += candidate.score * 0.7
    existing.sourceSeedTitles = [...new Set([...existing.sourceSeedTitles, ...candidate.sourceSeedTitles])]
    existing.sourceTypes = [...new Set([...existing.sourceTypes, ...candidate.sourceTypes])]
  }

  return [...byId.values()]
    .sort((first, second) => second.score - first.score)
    .slice(0, MAX_CANDIDATE_POOL_SIZE)
}

function pickSeedTitles(analysis: TasteAnalysis, feedbackEvents: FeedbackEvent[]): string[] {
  const seedTitles = new Set<string>(sanitizeMovieTitles(analysis.seedMovieTitles))

  for (const event of feedbackEvents) {
    if (event.type === "more_like_this" || event.type === "liked" || event.type === "loved_this") {
      seedTitles.add(event.title)
    }
  }

  return [...seedTitles].slice(0, 5)
}

function fallbackTasteAnalysis(userMessage: string): TasteAnalysis {
  return {
    seedMovieTitles: sanitizeMovieTitles([
      ...extractMovieTitlesFromMarkdown(userMessage),
      ...extractSeedTitleHints(userMessage),
    ]),
    referencePeople: [],
    likedSignals: [],
    dislikedSignals: [],
    constraints: [],
    desiredMood: [],
    excludeDirectReferenceWorks: false,
    needsClarification: false,
    clarificationQuestion: "",
  }
}

async function analyzeUserTaste(options: {
  userMessage: string
  conversationHistory: ConversationHistoryItem[]
  feedbackEvents: FeedbackEvent[]
}): Promise<TasteAnalysis> {
  if (!openai) {
    return fallbackTasteAnalysis(options.userMessage)
  }

  try {
    const response = await openai.responses.create({
      model: OPENAI_RANK_MODEL,
      input: [
        buildConversationAwareInput(options.userMessage, options.conversationHistory),
        "",
        "Session feedback:",
        JSON.stringify(options.feedbackEvents, null, 2),
      ].join("\n"),
      instructions:
        "Extract the user's film taste and constraints for a recommendation system. Seed movie titles must be exact movie titles the user liked, asked about, or requested more movies like; never put people, genres, franchises, or vague descriptors in seedMovieTitles. Put referenced filmmakers, directors, actors, writers, or performers in referencePeople. Set excludeDirectReferenceWorks true when the user asks for movies like, in the style of, inspired by, or adjacent to a person rather than that person's own films, including phrases like not necessarily, not by, not starring, or similar to. Return only JSON matching the schema.",
      text: {
        format: {
          type: "json_schema",
          name: "film_taste_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              seedMovieTitles: {
                type: "array",
                items: { type: "string" },
              },
              referencePeople: {
                type: "array",
                items: { type: "string" },
              },
              likedSignals: {
                type: "array",
                items: { type: "string" },
              },
              dislikedSignals: {
                type: "array",
                items: { type: "string" },
              },
              constraints: {
                type: "array",
                items: { type: "string" },
              },
              desiredMood: {
                type: "array",
                items: { type: "string" },
              },
              excludeDirectReferenceWorks: { type: "boolean" },
              needsClarification: { type: "boolean" },
              clarificationQuestion: { type: "string" },
            },
            required: [
              "seedMovieTitles",
              "referencePeople",
              "likedSignals",
              "dislikedSignals",
              "constraints",
              "desiredMood",
              "excludeDirectReferenceWorks",
              "needsClarification",
              "clarificationQuestion",
            ],
          },
        },
      },
    })

    const parsed = JSON.parse(response.output_text) as Partial<TasteAnalysis>
    const seedTitleHints = extractSeedTitleHints(options.userMessage)
    return {
      seedMovieTitles: sanitizeMovieTitles([...sanitizeMovieTitles(parsed.seedMovieTitles), ...seedTitleHints]),
      referencePeople: Array.isArray(parsed.referencePeople)
        ? parsed.referencePeople
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .map((value) => value.trim())
            .slice(0, 5)
        : [],
      likedSignals: Array.isArray(parsed.likedSignals)
        ? parsed.likedSignals.filter((value): value is string => typeof value === "string").slice(0, 8)
        : [],
      dislikedSignals: Array.isArray(parsed.dislikedSignals)
        ? parsed.dislikedSignals.filter((value): value is string => typeof value === "string").slice(0, 8)
        : [],
      constraints: Array.isArray(parsed.constraints)
        ? parsed.constraints.filter((value): value is string => typeof value === "string").slice(0, 8)
        : [],
      desiredMood: Array.isArray(parsed.desiredMood)
        ? parsed.desiredMood.filter((value): value is string => typeof value === "string").slice(0, 8)
        : [],
      excludeDirectReferenceWorks: parsed.excludeDirectReferenceWorks === true,
      needsClarification: Boolean(parsed.needsClarification),
      clarificationQuestion: typeof parsed.clarificationQuestion === "string" ? parsed.clarificationQuestion : "",
    }
  } catch (error) {
    console.error("Failed to analyze film taste:", error)
    return fallbackTasteAnalysis(options.userMessage)
  }
}

async function rerankCandidates(options: {
  userMessage: string
  preference: number
  analysis: TasteAnalysis
  feedbackEvents: FeedbackEvent[]
  candidates: CandidateMovie[]
  watchPreferences: WatchPreferences
}): Promise<RecommendedMovie[]> {
  if (!openai || options.candidates.length === 0) {
    return options.candidates
      .slice(0, TARGET_RECOMMENDATION_COUNT)
      .map((candidate) => recommendationFromCandidate(candidate))
  }

  const candidateMap = new Map(options.candidates.map((candidate) => [candidate.tmdbId, candidate]))

  try {
    const response = await openai.responses.create({
      model: OPENAI_RANK_MODEL,
      input: JSON.stringify(
        {
          latestUserMessage: options.userMessage,
          preferenceMode: preferenceMode(options.preference),
          viewingPreference: watchPreferencesSummary(options.watchPreferences),
          tasteProfile: options.analysis,
          feedbackEvents: options.feedbackEvents,
          candidates: options.candidates.map((candidate) => ({
            tmdbId: candidate.tmdbId,
            title: candidate.title,
            year: candidate.releaseYear,
            genre: candidate.genre,
            overview: candidate.overview,
            popularity: candidate.popularity,
            voteAverage: candidate.voteAverage,
            sourceSeedTitles: candidate.sourceSeedTitles,
            sourceTypes: candidate.sourceTypes,
            availability: candidate.availability
              ? {
                  inTheaters: candidate.availability.inTheaters,
                  streaming: candidate.availability.streaming,
                  rent: candidate.availability.rent,
                  buy: candidate.availability.buy,
                }
              : undefined,
            preScore: Number(candidate.score.toFixed(3)),
          })),
        },
        null,
        2
      ),
      instructions:
        `Select up to ${TARGET_RECOMMENDATION_COUNT} film recommendations only from the provided candidate list. Prefer precise taste matches over globally famous defaults, especially for hidden-gem mode. Respect the viewing preference when one is provided. If fewer than ${TARGET_RECOMMENDATION_COUNT} strong verified candidates are available, return fewer rather than inventing. Treat loved_this as the strongest positive signal, liked and more_like_this as positive signals, and not_interested as a negative exclusion. Do not invent TMDB IDs. Do not claim other users liked a film. Return only JSON matching the schema.`,
      text: {
        format: {
          type: "json_schema",
          name: "film_candidate_rerank",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              selections: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    tmdbId: { type: "number" },
                    reason: { type: "string" },
                  },
                  required: ["tmdbId", "reason"],
                },
              },
            },
            required: ["selections"],
          },
        },
      },
    })

    const parsed = JSON.parse(response.output_text) as {
      selections?: Array<{ tmdbId?: unknown; reason?: unknown }>
    }
    const selected: RecommendedMovie[] = []
    const selectedIds = new Set<number>()

    for (const selection of parsed.selections ?? []) {
      if (typeof selection.tmdbId !== "number" || !Number.isInteger(selection.tmdbId)) {
        continue
      }

      const candidate = candidateMap.get(selection.tmdbId)
      if (!candidate || selectedIds.has(selection.tmdbId)) {
        continue
      }

      selectedIds.add(selection.tmdbId)
      selected.push(
        recommendationFromCandidate(
          candidate,
          typeof selection.reason === "string" ? selection.reason.slice(0, 240) : undefined
        )
      )

      if (selected.length === TARGET_RECOMMENDATION_COUNT) {
        break
      }
    }

    for (const candidate of options.candidates) {
      if (selected.length === TARGET_RECOMMENDATION_COUNT) {
        break
      }

      if (selectedIds.has(candidate.tmdbId)) {
        continue
      }

      selectedIds.add(candidate.tmdbId)
      selected.push(recommendationFromCandidate(candidate))
    }

    return selected
  } catch (error) {
    console.error("Failed to rerank film candidates:", error)
    return options.candidates
      .slice(0, TARGET_RECOMMENDATION_COUNT)
      .map((candidate) => recommendationFromCandidate(candidate))
  }
}

async function prepareRecommendationContext(options: {
  userMessage: string
  preference: number
  conversationHistory: ConversationHistoryItem[]
  feedbackEvents: FeedbackEvent[]
  watchPreferences: WatchPreferences
}): Promise<RecommendationContext> {
  const analysis = await analyzeUserTaste({
    userMessage: options.userMessage,
    conversationHistory: options.conversationHistory,
    feedbackEvents: options.feedbackEvents,
  })
  const seedTitles = pickSeedTitles(analysis, options.feedbackEvents)
  const excludedMovieKeys = movieKeysFromTitles(seedTitles)

  for (const event of options.feedbackEvents) {
    if (event.tmdbId) {
      excludedMovieKeys.add(String(event.tmdbId))
    }
    excludedMovieKeys.add(normalizeTitleKey(event.title))
  }

  if (!TMDB_API_KEY) {
    return { movies: [], analysis, excludedMovieKeys: [...excludedMovieKeys] }
  }

  const [seedMovieResults, referenceMovies, watchPreferenceCandidates] = await Promise.all([
    Promise.all(seedTitles.map((title) => resolveMovieTitle(title))),
    fetchReferenceMoviesForPeople(analysis.referencePeople, options.preference),
    fetchWatchPreferenceDiscoveryCandidates(options.watchPreferences, options.preference),
  ])
  const seedMovies = seedMovieResults.filter((movie): movie is RecommendedMovie => movie !== null)
  for (const seedMovie of seedMovies) {
    excludedMovieKeys.add(String(seedMovie.tmdbId))
    excludedMovieKeys.add(normalizeTitleKey(seedMovie.title))
  }

  const retrievalSeedMovies = dedupeMoviesById([...seedMovies, ...referenceMovies])
  const directReferenceCandidates = analysis.excludeDirectReferenceWorks ? [] : referenceMovies

  const candidateGroups = await Promise.all(
    retrievalSeedMovies.map((seedMovie) => fetchCandidateMoviesForSeed(seedMovie, options.preference))
  )
  const excludedMovies = dedupeMoviesById([
    ...seedMovies,
    ...(analysis.excludeDirectReferenceWorks ? referenceMovies : []),
  ])
  const rankedCandidates = dedupeAndRankCandidates(
    [...candidateGroups.flat(), ...watchPreferenceCandidates, ...directReferenceCandidates],
    options.feedbackEvents,
    excludedMovies
  )
  const candidates = await applyWatchPreferencesToCandidates(rankedCandidates, options.watchPreferences)

  if (candidates.length === 0) {
    return { movies: [], analysis, excludedMovieKeys: [...excludedMovieKeys] }
  }

  const movies = await rerankCandidates({
    userMessage: options.userMessage,
    preference: options.preference,
    analysis,
    feedbackEvents: options.feedbackEvents,
    candidates,
    watchPreferences: options.watchPreferences,
  })

  return {
    movies: (await enrichAvailability(movies)).filter((movie) => !movieIsExcluded(movie, excludedMovieKeys)),
    analysis,
    excludedMovieKeys: [...excludedMovieKeys],
  }
}

async function enrichMovieTitles(
  titles: string[],
  watchPreferences: WatchPreferences,
  excludedMovieKeys: Set<string> = new Set()
): Promise<RecommendedMovie[]> {
  if (!TMDB_API_KEY || titles.length === 0) {
    return []
  }

  const filteredTitles = sanitizeMovieTitles(titles).filter((title) => !excludedMovieKeys.has(normalizeTitleKey(title)))
  const resolvedMovies = await Promise.all(filteredTitles.slice(0, 12).map((title) => resolveMovieTitle(title)))
  const resolvedIds = new Set<number>()
  const movies: RecommendedMovie[] = []

  for (const movie of resolvedMovies) {
    if (!movie || resolvedIds.has(movie.tmdbId) || movieIsExcluded(movie, excludedMovieKeys)) {
      continue
    }

    resolvedIds.add(movie.tmdbId)
    movies.push(movie)
  }

  return applyWatchPreferencesToMovies(await enrichAvailability(movies), watchPreferences).slice(
    0,
    TARGET_RECOMMENDATION_COUNT
  )
}

async function extractMovieTitlesFromText(responseText: string): Promise<string[]> {
  if (!openai || !responseText.trim()) {
    return []
  }

  const markdownTitles = extractMovieTitlesFromMarkdown(responseText)

  try {
    const extraction = await openai.responses.create({
      model: OPENAI_EXTRACT_MODEL,
      input: responseText,
      instructions:
        "Extract only exact movie titles mentioned in the assistant reply. Do not include commentary fragments, connective phrases, or anything that is not an actual movie title. Return only JSON matching the schema.",
      text: {
        format: {
          type: "json_schema",
          name: "movie_title_extraction",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              movieTitles: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["movieTitles"],
          },
        },
      },
    })

    const parsed = JSON.parse(extraction.output_text) as { movieTitles?: unknown }
    return sanitizeMovieTitles([...sanitizeMovieTitles(parsed.movieTitles), ...markdownTitles])
  } catch (error) {
    console.error("Failed to extract movie titles:", error)
    return markdownTitles
  }
}

async function streamAssistantResponse(options: {
  userMessage: string
  preference: number
  previousResponseId: string | null
  conversationHistory: ConversationHistoryItem[]
  selectedMovies: RecommendedMovie[]
  analysis: TasteAnalysis | null
  watchPreferences: WatchPreferences
  onToken: (delta: string) => void
}): Promise<{ responseText: string; responseId: string | null }> {
  if (!openai) {
    throw new Error("OpenAI API key is not configured. Please add OPENAI_API_KEY to your environment.")
  }

  const instructions = buildInstructions(options.preference, options.selectedMovies, options.watchPreferences)
  const input = buildRecommendationInput({
    userMessage: options.userMessage,
    conversationHistory: options.conversationHistory,
    selectedMovies: options.selectedMovies,
    analysis: options.analysis,
    watchPreferences: options.watchPreferences,
  })

  const runAttempt = async (previousResponseId: string | null) => {
    let responseText = ""
    let responseId: string | null = null
    let sawTokenDelta = false

    const stream = await openai.responses.create({
      model: OPENAI_MODEL,
      instructions,
      input,
      previous_response_id: previousResponseId ?? undefined,
      store: true,
      stream: true,
    })

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta) {
        sawTokenDelta = true
        responseText += event.delta
        options.onToken(event.delta)
      } else if (event.type === "response.completed") {
        responseId = event.response.id
        if (!sawTokenDelta && event.response.output_text) {
          responseText = event.response.output_text
          options.onToken(event.response.output_text)
        }
      } else if (event.type === "response.failed") {
        throw new Error(event.response.error?.message ?? "OpenAI response failed.")
      } else if (event.type === "error") {
        throw new Error(event.message || "OpenAI stream error.")
      }
    }

    return { responseText, responseId }
  }

  try {
    return await runAttempt(options.previousResponseId)
  } catch (error) {
    if (options.previousResponseId && shouldRetryWithoutPreviousResponseId(error)) {
      console.warn("Retrying without previous_response_id:", options.previousResponseId)
      return runAttempt(null)
    }
    throw error
  }
}

export async function POST(req: Request) {
  if (!openai) {
    return NextResponse.json(
      { error: "OpenAI API key is not configured. Please add OPENAI_API_KEY to your environment." },
      { status: 500 }
    )
  }

  let body: RecommendationRequestBody
  try {
    body = (await req.json()) as RecommendationRequestBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 })
  }

  const userMessage = typeof body.userMessage === "string" ? body.userMessage.trim() : ""
  const preference = typeof body.preference === "number" && Number.isFinite(body.preference) ? body.preference : 0.5
  const previousResponseId =
    typeof body.previousResponseId === "string" && body.previousResponseId.trim()
      ? body.previousResponseId.trim()
      : null
  const conversationHistory = sanitizeConversationHistory(body.conversationHistory)
  const feedbackEvents = sanitizeFeedbackEvents(body.feedbackEvents)
  const watchPreferences = sanitizeWatchPreferences(body.watchPreferences)

  if (!userMessage) {
    return NextResponse.json({ error: "userMessage is required." }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(createSSEEvent(event, data)))
      }

      sendEvent("status", { status: "finding" })

      try {
        let recommendationContext: RecommendationContext = { movies: [], analysis: null, excludedMovieKeys: [] }

        try {
          recommendationContext = await prepareRecommendationContext({
            userMessage,
            preference,
            conversationHistory,
            feedbackEvents,
            watchPreferences,
          })
        } catch (error) {
          console.error("Failed to prepare recommendation context:", error)
        }

        let responseText = ""
        let responseId: string | null = null
        const excludedMovieKeys = new Set(recommendationContext.excludedMovieKeys)

        if (recommendationContext.movies.length > 0) {
          responseText = buildSelectedMoviesResponseText(recommendationContext.movies, watchPreferences)
          sendEvent("token", { delta: responseText })
        } else {
          const assistantResponse = await streamAssistantResponse({
            userMessage,
            preference,
            previousResponseId,
            conversationHistory,
            selectedMovies: recommendationContext.movies,
            analysis: recommendationContext.analysis,
            watchPreferences,
            onToken: (delta) => {
              sendEvent("token", { delta })
            },
          })

          responseText = assistantResponse.responseText
          responseId = assistantResponse.responseId
        }

        const extractedMovieTitles =
          recommendationContext.movies.length > 0 ? [] : await extractMovieTitlesFromText(responseText)
        const enrichedFallbackMovies =
          recommendationContext.movies.length > 0
            ? []
            : await enrichMovieTitles(extractedMovieTitles, watchPreferences, excludedMovieKeys)
        const metadataMovies =
          recommendationContext.movies.length > 0 ? recommendationContext.movies : enrichedFallbackMovies
        const movieTitles = sanitizeMovieTitles([
          ...metadataMovies.map((movie) => movie.title),
          ...extractedMovieTitles.filter((title) => !excludedMovieKeys.has(normalizeTitleKey(title))),
        ]).slice(0, TARGET_RECOMMENDATION_COUNT)

        sendEvent("metadata", {
          responseId,
          movieTitles,
          movies: metadataMovies,
        })
      } catch (error) {
        console.error("Error in getRecommendation:", error)
        sendEvent("error", { message: getErrorMessage(error) })
      } finally {
        sendEvent("done", {})
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
