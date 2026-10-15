"use client"

import { useEffect, useRef, useState, FormEvent, ChangeEvent } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTwitter, faTelegram, faLinkedin, faGithub } from '@fortawesome/free-brands-svg-icons'
import { Check, Globe, Heart, Loader2, Mic, MicOff, Play, RotateCcw, Send, Sparkles, ThumbsDown, ThumbsUp, Ticket } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { Streamdown } from "streamdown"

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
  tmdbId?: number
  title: string
  poster: string | null
  tmdbUrl: string | null
  releaseYear: number | string
  genre: string
  runtime?: number | null
  originalLanguage?: string | null
  overview?: string
  popularity?: number
  voteAverage?: number
  reason?: string
  availability?: MovieAvailability
}

interface Message {
  id: string
  content: string
  isBot: boolean
  movies?: RecommendedMovie[]
  followUpContent?: string
  notice?: string
  isLoadingMovies?: boolean
  status?: "finding" | "streaming" | "complete" | "error"
  intent?: ResponseIntent
  progress?: RequestProgress
  requestStartedAt?: number
  requestText?: string
  requestPreviousResponseId?: string | null
}

type RequestStage = "understanding" | "curating" | "verifying" | "complete"

interface RequestProgress {
  stage?: RequestStage
  brief?: string
  constraints: string[]
  completedStages: RequestStage[]
}

interface SSEEvent {
  event: string
  data: string
}

type FeedbackType = "liked" | "loved_this" | "more_like_this" | "not_interested"
type WatchMode = "any" | "theaters" | "home"
type ResponseIntent = "recommendation" | "conversation" | "clarification"

interface FeedbackEvent {
  type: FeedbackType
  title: string
  tmdbId: number | null
  year?: number | null
}

interface WatchPreferences {
  mode: WatchMode
  streamingProviders: string[]
  includeRentals: boolean
}

interface WatchProviderOption {
  label: string
  value: string
}

interface BrowserSpeechRecognitionAlternative {
  transcript: string
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean
  length: number
  [index: number]: BrowserSpeechRecognitionAlternative
}

interface BrowserSpeechRecognitionEvent extends Event {
  resultIndex: number
  results: {
    length: number
    [index: number]: BrowserSpeechRecognitionResult
  }
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  error?: string
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
}

type DictationMode = "idle" | "native" | "recording" | "transcribing"

interface TmdbMovieListItem {
  id: number
  poster_path?: string | null
  release_date?: string
  overview?: string
  popularity?: number
  vote_average?: number
}

interface TmdbMovieDetails {
  genres?: Array<{ name?: string }>
  runtime?: number | null
  original_language?: string | null
  overview?: string
  popularity?: number
  vote_average?: number
}

interface TmdbListResponse {
  results?: TmdbMovieListItem[]
}

interface TmdbWatchProvider {
  provider_name?: string
}

interface TmdbWatchProviderRegion {
  flatrate?: TmdbWatchProvider[]
  rent?: TmdbWatchProvider[]
  buy?: TmdbWatchProvider[]
}

interface TmdbWatchProviderResponse {
  results?: Record<string, TmdbWatchProviderRegion | undefined>
}

const REQUEST_STAGE_LABELS: Record<RequestStage, string> = {
  understanding: "Understanding your brief",
  curating: "Curating your answer",
  verifying: "Verifying film details",
  complete: "Ready",
}
const REQUEST_COMPLETED_LABELS: Record<RequestStage, string> = {
  understanding: "Brief understood",
  curating: "Curation complete",
  verifying: "Details verified",
  complete: "Ready",
}

function isRequestStage(value: unknown): value is RequestStage {
  return value === "understanding" || value === "curating" || value === "verifying" || value === "complete"
}

function RequestProgressPanel({ progress, elapsedSeconds }: { progress?: RequestProgress; elapsedSeconds: number }) {
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-purple-300/20 bg-gradient-to-br from-purple-400/10 to-gray-900/20 p-3.5 sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-purple-300/20 bg-purple-300/10">
            <Sparkles className="h-4 w-4 text-purple-200 motion-safe:animate-pulse" aria-hidden="true" />
          </span>
          <p role="status" aria-live="polite" className="text-sm font-medium text-purple-100">
            {progress?.stage ? REQUEST_STAGE_LABELS[progress.stage] : "Connecting to FilmPulse"}
          </p>
        </div>
        <span role="timer" aria-live="off" className="shrink-0 text-xs tabular-nums text-gray-400">
          {elapsedSeconds}s elapsed
        </span>
      </div>
      {progress?.brief ? <p className="mt-3 text-sm leading-relaxed text-gray-200">{progress.brief}</p> : null}
      {progress?.constraints.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Your preferences">
          {progress.constraints.map((constraint) => (
            <span key={constraint} className="rounded-full border border-gray-500/50 bg-gray-900/20 px-2.5 py-1 text-[11px] text-gray-300">
              {constraint}
            </span>
          ))}
        </div>
      ) : null}
      {progress?.completedStages.some((stage) => stage !== "complete") ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-purple-200/10 pt-2.5 text-[11px] text-gray-400" aria-label="Completed steps">
          {progress.completedStages.filter((stage) => stage !== "complete").map((stage) => (
            <li key={stage} className="inline-flex items-center gap-1.5">
              <Check className="h-3 w-3 text-emerald-300" aria-hidden="true" />
              {REQUEST_COMPLETED_LABELS[stage]}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function ChatMarkdown({ content, isAnimating }: { content: string; isAnimating: boolean }) {
  return (
    <Streamdown
      animated
      caret={isAnimating ? "block" : undefined}
      className="filmpulse-chat-markdown leading-relaxed"
      isAnimating={isAnimating}
    >
      {content}
    </Streamdown>
  )
}

const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY
const TMDB_REGION = (process.env.NEXT_PUBLIC_TMDB_REGION ?? "US").trim().toUpperCase() || "US"
const TMDB_BASE_URL = "https://api.themoviedb.org/3"
const DICTATION_OFF_STATUS = "Dictation is off."
const WELCOME_MESSAGE: Message = {
  id: "welcome",
  content: "Hi! I'm your film recommendation assistant. Tell me some movies you like, and I'll suggest similar ones!",
  isBot: true,
}
const NATIVE_SPEECH_FALLBACK_ERRORS = new Set(["network", "service-not-allowed"])
const WATCH_PROVIDER_OPTIONS: WatchProviderOption[] = [
  { label: "Netflix", value: "Netflix" },
  { label: "Prime Video", value: "Amazon Prime Video" },
  { label: "Max", value: "Max" },
  { label: "Hulu", value: "Hulu" },
  { label: "Disney+", value: "Disney Plus" },
  { label: "Apple TV+", value: "Apple TV Plus" },
  { label: "Peacock", value: "Peacock" },
  { label: "Paramount+", value: "Paramount Plus" },
  { label: "Criterion", value: "Criterion Channel" },
  { label: "MUBI", value: "MUBI" },
]

let nowPlayingCache: { expiresAt: number; ids: Set<number> } | null = null
let nowPlayingRequest: Promise<Set<number>> | null = null

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null
  }

  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function hasMediaRecorderSupport(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false
  }

  return Boolean(
    navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined"
  )
}

function getSupportedDictationMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return ""
  }

  return (
    [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
    ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ""
  )
}

function dictationAudioFileName(mimeType: string): string {
  if (mimeType.includes("mp4")) {
    return "dictation.m4a"
  }
  if (mimeType.includes("mpeg")) {
    return "dictation.mp3"
  }
  return "dictation.webm"
}

function dictationErrorStatus(error?: string): string {
  switch (error) {
    case "audio-capture":
      return "No microphone input was detected. Check browser and macOS microphone access."
    case "network":
      return "Speech recognition could not reach the browser speech service. Recording audio instead may work."
    case "no-speech":
      return "No speech was detected. Click the mic again and start speaking right away."
    case "not-allowed":
      return "Microphone access was not allowed."
    case "service-not-allowed":
      return "The browser blocked the speech recognition service. Recording audio instead may work."
    case "aborted":
      return "Dictation was cancelled."
    default:
      return error ? `Dictation stopped: ${error}.` : "Dictation stopped before speech was recognized."
  }
}

function dictationRecordingErrorStatus(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ""

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Microphone access was not allowed."
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found."
    case "NotReadableError":
      return "The microphone is unavailable or already in use."
    case "SecurityError":
      return "This browser blocked microphone access for this page."
    default:
      return "Dictation recording could not start."
  }
}

function dictationButtonLabel(mode: DictationMode, supported: boolean): string {
  if (!supported) {
    return "Dictation is not supported in this browser"
  }
  if (mode === "transcribing") {
    return "Transcribing dictation"
  }
  if (mode === "recording") {
    return "Stop and transcribe dictation"
  }
  if (mode === "native") {
    return "Stop dictation"
  }
  return "Start dictation"
}

async function transcribeDictationAudio(audio: Blob, mimeType: string): Promise<string> {
  const formData = new FormData()
  formData.append("audio", audio, dictationAudioFileName(mimeType))

  const response = await fetch("/api/dictation/transcribe", {
    method: "POST",
    body: formData,
  })
  const payload = (await response.json().catch(() => ({}))) as { text?: unknown; error?: unknown }

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" && payload.error.trim()
        ? payload.error
        : "Could not transcribe dictation."
    )
  }

  return typeof payload.text === "string" ? payload.text.trim() : ""
}

function WebsiteIcon() {
  return <Globe size={24} style={{ margin: "0 10px", color: "white" }} aria-hidden="true" />
}

function MovieCardSkeleton() {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-xl border border-gray-600/70 bg-gray-900/35 p-3 sm:flex sm:gap-4 sm:rounded-lg">
      <div className="h-28 w-[72px] shrink-0 animate-pulse rounded-lg bg-gray-700 sm:w-20 sm:rounded-md" />
      <div className="min-w-0 flex-1 space-y-3 py-1">
        <div className="h-4 w-2/3 animate-pulse rounded bg-gray-700" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-gray-700" />
        <div className="space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-gray-700" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-gray-700" />
        </div>
        <div className="flex gap-2">
          <div className="h-7 w-24 animate-pulse rounded-full bg-gray-700" />
          <div className="h-7 w-16 animate-pulse rounded-full bg-gray-700" />
        </div>
      </div>
    </div>
  )
}

function sanitizeStringArray(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 120))
    .slice(0, limit)
}

function sanitizeAvailability(value: unknown): MovieAvailability | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const availability = value as Record<string, unknown>
  return {
    region: typeof availability.region === "string" && availability.region.trim() ? availability.region : "US",
    watchUrl: typeof availability.watchUrl === "string" && availability.watchUrl.trim() ? availability.watchUrl : null,
    inTheaters: availability.inTheaters === true,
    streaming: sanitizeStringArray(availability.streaming, 20),
    rent: sanitizeStringArray(availability.rent, 20),
    buy: sanitizeStringArray(availability.buy, 20),
    badges: sanitizeStringArray(availability.badges),
  }
}

function displayName(value: string | null | undefined, type: "language" | "region"): string | null {
  if (!value?.trim()) {
    return null
  }

  try {
    const name = new Intl.DisplayNames(["en"], { type }).of(value.trim())
    return name && name.toLowerCase() !== value.trim().toLowerCase() ? name : null
  } catch {
    return null
  }
}

function sanitizeRuntime(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

function movieReleaseYear(movie: RecommendedMovie): number | null {
  const year = String(movie.releaseYear).trim()
  return /^\d{4}$/.test(year) ? Number(year) : null
}

function availabilityBadgeClass(label: string): string {
  if (label === "In theaters") {
    return "border-pink-400/60 bg-pink-500/15 text-pink-100"
  }
  if (label.startsWith("Stream")) {
    return "border-purple-400/60 bg-purple-500/15 text-purple-100"
  }
  if (label === "Availability unknown") {
    return "border-gray-600 bg-gray-800 text-gray-300"
  }
  return "border-gray-500/70 bg-gray-800 text-gray-200"
}

function providerNames(providers?: TmdbWatchProvider[]): string[] {
  return [
    ...new Set(
      (providers ?? [])
        .map((provider) => provider.provider_name)
        .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    ),
  ]
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

function buildWatchSearchUrl(movie: RecommendedMovie): string {
  const year = typeof movie.releaseYear === "number" ? String(movie.releaseYear) : /^\d{4}$/.test(String(movie.releaseYear)) ? String(movie.releaseYear) : ""
  const query = year ? `${movie.title} ${year}` : movie.title
  return `https://www.justwatch.com/${justWatchRegion(TMDB_REGION)}/search?q=${encodeURIComponent(query)}`
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
  } catch {
    return null
  }
}

async function getNowPlayingMovieIds(): Promise<Set<number>> {
  if (!TMDB_API_KEY) {
    return new Set()
  }

  const now = Date.now()
  if (nowPlayingCache && nowPlayingCache.expiresAt > now) {
    return nowPlayingCache.ids
  }

  if (nowPlayingRequest) {
    return nowPlayingRequest
  }

  nowPlayingRequest = Promise.all([
    fetchTmdbJson<TmdbListResponse>("/movie/now_playing", { region: TMDB_REGION, page: 1 }),
    fetchTmdbJson<TmdbListResponse>("/movie/now_playing", { region: TMDB_REGION, page: 2 }),
  ])
    .then((pages) => {
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
    })
    .finally(() => {
      nowPlayingRequest = null
    })

  return nowPlayingRequest
}

async function fetchMovieAvailability(movie: RecommendedMovie): Promise<MovieAvailability | undefined> {
  if (!TMDB_API_KEY || !movie.tmdbId) {
    return undefined
  }

  const [watchProviders, nowPlayingIds] = await Promise.all([
    fetchTmdbJson<TmdbWatchProviderResponse>(`/movie/${movie.tmdbId}/watch/providers`),
    getNowPlayingMovieIds(),
  ])
  const regionProviders = watchProviders?.results?.[TMDB_REGION]
  const streaming = providerNames(regionProviders?.flatrate)
  const rent = providerNames(regionProviders?.rent)
  const buy = providerNames(regionProviders?.buy)
  const inTheaters = nowPlayingIds.has(movie.tmdbId)

  return {
    region: TMDB_REGION,
    watchUrl: buildWatchSearchUrl(movie),
    inTheaters,
    streaming,
    rent,
    buy,
    badges: availabilityBadges({ inTheaters, streaming, rent, buy }),
  }
}

function normalizeProviderName(provider: string): string {
  return provider
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function providerNameMatches(availableProvider: string, selectedProvider: string): boolean {
  const family = (provider: string): string => {
    const key = normalizeProviderName(provider)
    if (/^(?:hbo max|max)(?:$| )/.test(key)) return "max"
    if (key === "amazon" || /^(?:amazon prime video|prime video)(?:$| )/.test(key)) return "prime"
    if (key === "disney" || /^disney plus(?:$| )/.test(key)) return "disney"
    if (/^apple tv(?:$| )/.test(key)) return "apple"
    if (key === "paramount" || /^paramount plus(?:$| )/.test(key)) return "paramount"
    if (/^peacock(?:$| )/.test(key)) return "peacock"
    if (/^netflix(?:$| )/.test(key)) return "netflix"
    if (/^hulu(?:$| )/.test(key)) return "hulu"
    if (/^mubi(?:$| )/.test(key)) return "mubi"
    if (/^criterion channel(?:$| )/.test(key)) return "criterion"
    return key
  }
  const available = family(availableProvider)
  const selected = family(selectedProvider)
  return Boolean(available && selected && available === selected)
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

function applyWatchPreferencesToMovies(
  movies: RecommendedMovie[],
  preferences: WatchPreferences
): RecommendedMovie[] {
  if (preferences.mode === "any") {
    return movies
  }

  return movies.filter((movie) => movieMatchesWatchPreferences(movie, preferences))
}

function MovieRecommendationCard({
  movie,
  index = 0,
  feedbackState,
  isLoading,
  onMoreLikeThis,
  onFeedback,
  watchPreferences,
}: {
  movie: RecommendedMovie
  index?: number
  feedbackState: FeedbackType | null
  isLoading: boolean
  onMoreLikeThis: (movie: RecommendedMovie) => void
  onFeedback: (movie: RecommendedMovie, type: FeedbackType) => void
  watchPreferences: WatchPreferences
}) {
  const likedSelected = feedbackState === "liked"
  const lovedSelected = feedbackState === "loved_this"
  const notInterestedSelected = feedbackState === "not_interested"
  const availability = movie.availability
  const preferredStreamingProvider = availability && watchPreferences.mode === "home"
    ? availability.streaming.find((provider) =>
        hasSelectedStreamingProvider({ ...availability, streaming: [provider] }, watchPreferences.streamingProviders)
      )
    : undefined
  const badges = (availability?.badges && availability.badges.length > 0 ? availability.badges : ["Availability unknown"])
    .filter((badge) => watchPreferences.mode !== "home" || watchPreferences.includeRentals || !/^(Rent|Buy):/.test(badge))
    .map((badge) => preferredStreamingProvider && badge.startsWith("Stream:") ? `Stream: ${preferredStreamingProvider}` : badge)
  const watchUrl = availability?.watchUrl ?? buildWatchSearchUrl(movie)
  const watchLabel = availability?.inTheaters ? "Watch options" : "Where to watch"
  const filmDetails = [
    movie.runtime ? `${movie.runtime} min` : null,
    displayName(movie.originalLanguage, "language"),
  ].filter(Boolean).join(" · ")

  return (
    <motion.div
      initial={{ opacity: 0, x: -120, scale: 0.985 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ delay: index * 0.08, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="grid grid-cols-[86px_minmax(0,1fr)] gap-3 rounded-2xl border border-gray-600/70 bg-gray-900/35 p-3 text-left shadow-lg shadow-black/10 sm:flex sm:gap-4 sm:rounded-lg sm:shadow-none"
    >
      {movie.poster ? (
        <img
          src={movie.poster}
          alt={movie.title}
          loading="lazy"
          className="h-[129px] w-[86px] shrink-0 rounded-xl object-cover shadow-md sm:h-28 sm:w-20 sm:rounded-md"
        />
      ) : (
        <div className="flex h-[129px] w-[86px] shrink-0 items-center justify-center rounded-xl bg-gray-700 text-center text-[11px] text-gray-400 sm:h-28 sm:w-20 sm:rounded-md">
          No Image
        </div>
      )}

      <div className="contents min-w-0 flex-1 sm:block">
        <div className="min-w-0 self-start">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="min-w-0 text-[15px] font-semibold leading-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 sm:text-sm">
              {movie.title}
            </h3>
            <span className="text-[12px] leading-tight text-gray-400 sm:text-xs">
              {movie.releaseYear} | {movie.genre}
            </span>
          </div>

          {filmDetails ? <p className="mt-1 text-xs text-gray-400">{filmDetails}</p> : null}

          <div className="mt-2 flex flex-wrap gap-1.5">
            {badges.map((badge) => (
              <span
                key={`${movie.tmdbId ?? movie.title}-${badge}`}
                className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight sm:text-[11px] ${availabilityBadgeClass(
                  badge
                )}`}
              >
                {badge === "In theaters" ? <Ticket className="h-3 w-3" /> : null}
                <span className="truncate">{badge === "In theaters" ? "Listed in theaters" : badge}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="col-span-2 min-w-0 sm:col-span-1">
          {movie.reason ? (
            <p className="mt-1 text-[13px] leading-relaxed text-gray-200 sm:mt-2 sm:text-sm">{movie.reason}</p>
          ) : movie.overview ? (
            <p className="mt-1 max-h-20 overflow-hidden text-[13px] leading-relaxed text-gray-300 sm:mt-2 sm:max-h-16 sm:text-sm">
              {movie.overview}
            </p>
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-purple-400/40 bg-purple-400/10 px-3 py-2 text-[12px] font-medium leading-tight text-white hover:bg-purple-400/20 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:justify-start sm:py-1 sm:text-xs"
              onClick={() => onMoreLikeThis(movie)}
              disabled={isLoading}
            >
              <Sparkles className="h-3.5 w-3.5" />
              More like this
            </button>
            <button
              type="button"
              className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-[12px] font-medium leading-tight text-white hover:bg-gray-700 sm:min-h-0 sm:justify-start sm:py-1 sm:text-xs ${
                likedSelected ? "border-purple-400/70 bg-purple-500/20" : "border-gray-500/70 bg-gray-800"
              }`}
              onClick={() => onFeedback(movie, "liked")}
              aria-pressed={likedSelected}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              {likedSelected ? "Liked" : "Like"}
            </button>
            <button
              type="button"
              className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-[12px] font-medium leading-tight text-white hover:bg-gray-700 sm:min-h-0 sm:justify-start sm:py-1 sm:text-xs ${
                lovedSelected ? "border-pink-400/70 bg-pink-500/20" : "border-gray-500/70 bg-gray-800"
              }`}
              onClick={() => onFeedback(movie, "loved_this")}
              aria-pressed={lovedSelected}
            >
              <span className="inline-flex -space-x-1">
                <ThumbsUp className="h-3.5 w-3.5" />
                <ThumbsUp className="h-3.5 w-3.5" />
              </span>
              {lovedSelected ? "Loved" : "Love"}
            </button>
            <button
              type="button"
              className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-[12px] font-medium leading-tight text-white hover:bg-gray-700 sm:min-h-0 sm:justify-start sm:py-1 sm:text-xs ${
                notInterestedSelected ? "border-pink-400/70 bg-pink-500/20" : "border-gray-500/70 bg-gray-800"
              }`}
              onClick={() => onFeedback(movie, "not_interested")}
              aria-pressed={notInterestedSelected}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
              {notInterestedSelected ? "Hidden later" : "Not interested"}
            </button>
            {watchUrl ? (
              <a
                href={watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-purple-400/50 bg-purple-400/10 px-3 py-2 text-[12px] font-medium leading-tight text-white hover:bg-purple-400/20 sm:min-h-0 sm:justify-start sm:py-1 sm:text-xs"
              >
                <Play className="h-3.5 w-3.5" />
                {watchLabel}
              </a>
            ) : null}
            {movie.tmdbUrl ? (
              <a
                href={movie.tmdbUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-gray-500/70 bg-gray-800 px-3 py-2 text-[12px] font-medium leading-tight text-white hover:bg-gray-700 sm:min-h-0 sm:justify-start sm:py-1 sm:text-xs"
              >
                TMDB
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseSSEEvent(rawEvent: string): SSEEvent | null {
  const lines = rawEvent.split("\n")
  let event = "message"
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim()
      continue
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  return {
    event,
    data: dataLines.join("\n"),
  }
}

function extractMovieTitles(text: string): string[] {
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

function sanitizeMovieTitles(titles: string[]): string[] {
  const deduped = new Set<string>()

  for (const title of titles) {
    const normalized = normalizeMovieTitle(title)
    if (!normalized || !isLikelyMovieTitle(normalized)) {
      continue
    }
    deduped.add(normalized)
  }

  return [...deduped]
}

function sanitizeRecommendedMovies(value: unknown): RecommendedMovie[] {
  if (!Array.isArray(value)) {
    return []
  }

  const movies: RecommendedMovie[] = []
  const existingKeys = new Set<string>()

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue
    }

    const movie = item as Record<string, unknown>
    const title = typeof movie.title === "string" ? normalizeMovieTitle(movie.title) : ""

    if (!title || !isLikelyMovieTitle(title)) {
      continue
    }

    const tmdbId = typeof movie.tmdbId === "number" && Number.isInteger(movie.tmdbId) ? movie.tmdbId : undefined
    const key = tmdbId ? String(tmdbId) : title.toLowerCase()

    if (existingKeys.has(key)) {
      continue
    }

    existingKeys.add(key)
    movies.push({
      tmdbId,
      title,
      poster: typeof movie.poster === "string" ? movie.poster : null,
      tmdbUrl: typeof movie.tmdbUrl === "string" ? movie.tmdbUrl : null,
      releaseYear:
        typeof movie.releaseYear === "number" || typeof movie.releaseYear === "string" ? movie.releaseYear : "N/A",
      genre: typeof movie.genre === "string" && movie.genre.trim() ? movie.genre : "Unknown Genre",
      runtime: sanitizeRuntime(movie.runtime),
      originalLanguage: typeof movie.originalLanguage === "string" ? movie.originalLanguage.trim() || null : null,
      overview: typeof movie.overview === "string" ? movie.overview : undefined,
      popularity: typeof movie.popularity === "number" ? movie.popularity : undefined,
      voteAverage: typeof movie.voteAverage === "number" ? movie.voteAverage : undefined,
      reason: typeof movie.reason === "string" ? movie.reason : undefined,
      availability: sanitizeAvailability(movie.availability),
    })
  }

  return movies
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
  if (!title || title.length > 80 || !/[\p{L}\p{N}]/u.test(title)) {
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

export default function FilmPulse() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE])
  const [inputText, setInputText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [lastResponseId, setLastResponseId] = useState<string | null>(null)
  const lastResponseIdRef = useRef<string | null>(null)
  const [dictationMode, setDictationModeState] = useState<DictationMode>("idle")
  const [dictationStatus, setDictationStatus] = useState(DICTATION_OFF_STATUS)
  const [dictationSupported, setDictationSupported] = useState(true)
  const [preference, setPreference] = useState(0.5)
  const [watchMode, setWatchMode] = useState<WatchMode>("any")
  const [selectedStreamingProviders, setSelectedStreamingProviders] = useState<string[]>([])
  const [includeRentals, setIncludeRentals] = useState(false)
  const [feedbackEvents, setFeedbackEvents] = useState<FeedbackEvent[]>([])
  const [pendingScrollRequest, setPendingScrollRequest] = useState<{ messageId: string; alignPage: boolean } | null>(
    null
  )
  const feedbackEventsRef = useRef<FeedbackEvent[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const discardRecordingRef = useRef(false)
  const manualStopRef = useRef(false)
  const nativeFallbackInProgressRef = useRef(false)
  const lastDictationErrorRef = useRef<string | null>(null)
  const nativeStartedAtRef = useRef(0)
  const dictationModeRef = useRef<DictationMode>("idle")
  const dictationSessionRef = useRef(0)
  const recommendationAbortRef = useRef<AbortController | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const chatPanelRef = useRef<HTMLDivElement | null>(null)
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (!isLoading) {
      return
    }
    const intervalId = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [isLoading])

  useEffect(() => {
    return () => {
      recommendationAbortRef.current?.abort()
      recommendationAbortRef.current = null
      manualStopRef.current = true
      recognitionRef.current?.abort()
      discardRecordingRef.current = true

      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop()
      }

      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const updateMessageById = (messageId: string, updater: (message: Message) => Message) => {
    setMessages((prevMessages) =>
      prevMessages.map((message) => (message.id === messageId ? updater(message) : message))
    )
  }

  const feedbackKey = (title: string, tmdbId: number | null | undefined): string =>
    tmdbId ? String(tmdbId) : title.toLowerCase()

  const watchPreferences: WatchPreferences = {
    mode: watchMode,
    streamingProviders: watchMode === "home" ? selectedStreamingProviders : [],
    includeRentals: watchMode === "home" && includeRentals,
  }

  const handleWatchModeChange = (mode: WatchMode) => {
    setWatchMode(mode)
  }

  const toggleStreamingProvider = (provider: string) => {
    setSelectedStreamingProviders((currentProviders) =>
      currentProviders.includes(provider)
        ? currentProviders.filter((currentProvider) => currentProvider !== provider)
        : [...currentProviders, provider]
    )
  }

  const getEventFeedbackKey = (event: FeedbackEvent): string => feedbackKey(event.title, event.tmdbId)

  const getMovieFeedbackKey = (movie: RecommendedMovie): string => feedbackKey(movie.title, movie.tmdbId)

  const setMovieFeedbackEvent = (movie: RecommendedMovie, type: FeedbackType, options: { toggleOff?: boolean } = {}) => {
    const movieKey = getMovieFeedbackKey(movie)
    const currentEvent = [...feedbackEventsRef.current].reverse().find((event) => getEventFeedbackKey(event) === movieKey)
    const currentState = currentEvent?.type ?? null
    const withoutMovie = feedbackEventsRef.current.filter((event) => getEventFeedbackKey(event) !== movieKey)
    const shouldClearSignal = options.toggleOff === true && currentState === type
    const nextEvents = shouldClearSignal
      ? withoutMovie
      : [
          ...withoutMovie,
          {
            type,
            title: movie.title,
            tmdbId: movie.tmdbId ?? null,
            year: movieReleaseYear(movie),
          },
        ].slice(-40)

    feedbackEventsRef.current = nextEvents
    setFeedbackEvents(nextEvents)
  }

  const getMovieFeedbackState = (movie: RecommendedMovie): FeedbackType | null => {
    const movieKey = getMovieFeedbackKey(movie)

    for (let index = feedbackEvents.length - 1; index >= 0; index -= 1) {
      const event = feedbackEvents[index]
      const eventKey = getEventFeedbackKey(event)

      if (eventKey === movieKey) {
        return event.type
      }
    }

    return null
  }

  const setMessageRef = (messageId: string, node: HTMLDivElement | null) => {
    if (node) {
      messageRefs.current[messageId] = node
      return
    }
    delete messageRefs.current[messageId]
  }

  const smoothScrollToMessageTop = (messageId: string, offset = 8, alignPage = false) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = chatScrollRef.current
        const messageElement = messageRefs.current[messageId]

        if (!container || !messageElement) {
          return
        }

        if (alignPage) {
          messageElement.scrollIntoView({
            behavior: "smooth",
            block: "start",
          })
          return
        }

        const containerRect = container.getBoundingClientRect()
        const messageRect = messageElement.getBoundingClientRect()
        const targetTop = container.scrollTop + (messageRect.top - containerRect.top) - offset

        container.scrollTo({
          top: Math.max(0, targetTop),
          behavior: "smooth",
        })
      })
    })
  }

  useEffect(() => {
    if (!pendingScrollRequest) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (pendingScrollRequest.alignPage) {
        chatPanelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        })
      }
      smoothScrollToMessageTop(pendingScrollRequest.messageId, 12, !pendingScrollRequest.alignPage)
      setPendingScrollRequest(null)
    }, 50)

    return () => window.clearTimeout(timeoutId)
  }, [pendingScrollRequest])

  const setDictationMode = (nextMode: DictationMode) => {
    dictationModeRef.current = nextMode
    setDictationModeState(nextMode)
  }

  const appendDictationText = (transcript: string) => {
    const cleanTranscript = transcript.trim()

    if (!cleanTranscript) {
      return
    }

    const inputElement = inputRef.current

    setInputText((currentValue) => {
      const selectionStart = inputElement?.selectionStart ?? currentValue.length
      const selectionEnd = inputElement?.selectionEnd ?? currentValue.length
      const before = currentValue.slice(0, selectionStart)
      const after = currentValue.slice(selectionEnd)
      const leadingSpace = before && !/\s$/.test(before) ? " " : ""
      const trailingSpace = after && !/^[\s.,!?;:)]/.test(after) ? " " : ""
      const insertion = `${leadingSpace}${cleanTranscript}${trailingSpace}`
      const nextValue = `${before}${insertion}${after}`
      const nextCursor = before.length + insertion.length

      requestAnimationFrame(() => {
        if (!inputElement) {
          return
        }

        try {
          inputElement.selectionStart = nextCursor
          inputElement.selectionEnd = nextCursor
        } catch {
          // Some input types do not expose text selection. The dictated text still lands.
        }
      })

      return nextValue
    })
  }

  const stopMediaStream = () => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
  }

  const transcribeRecording = async (audio: Blob, mimeType: string) => {
    const dictationSession = dictationSessionRef.current
    if (!audio.size) {
      setDictationMode("idle")
      setDictationStatus("No speech was recorded.")
      return
    }

    setDictationMode("transcribing")
    setDictationStatus("Transcribing dictation...")

    try {
      const transcript = await transcribeDictationAudio(audio, mimeType)
      if (dictationSession !== dictationSessionRef.current) {
        return
      }
      appendDictationText(transcript)
      setDictationStatus(transcript ? "Added dictation." : "No speech was transcribed.")
    } catch (error) {
      if (dictationSession === dictationSessionRef.current) {
        setDictationStatus(error instanceof Error ? error.message : "Dictation could not be transcribed.")
      }
    } finally {
      if (dictationSession === dictationSessionRef.current) {
        setDictationMode("idle")
      }
    }
  }

  const startRecordingFallback = async () => {
    const dictationSession = dictationSessionRef.current
    if (!hasMediaRecorderSupport() || isLoading) {
      setDictationSupported(Boolean(getSpeechRecognitionConstructor()))
      setDictationMode("idle")
      setDictationStatus("Dictation recording is not available in this browser.")
      return
    }

    let stream: MediaStream | null = null

    try {
      setDictationStatus("Starting microphone recording...")
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      if (isLoading || dictationSession !== dictationSessionRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      const mimeType = getSupportedDictationMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      audioChunksRef.current = []
      discardRecordingRef.current = false
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (dictationSession === dictationSessionRef.current && event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        if (dictationSession !== dictationSessionRef.current) {
          return
        }
        discardRecordingRef.current = true
        mediaRecorderRef.current = null
        stopMediaStream()
        setDictationMode("idle")
        setDictationStatus("Dictation recording failed.")
      }

      recorder.onstop = () => {
        if (dictationSession !== dictationSessionRef.current) {
          return
        }
        const chunks = audioChunksRef.current
        const shouldDiscard = discardRecordingRef.current
        const recordedMimeType = recorder.mimeType || mimeType || "audio/webm"

        audioChunksRef.current = []
        discardRecordingRef.current = false
        mediaRecorderRef.current = null
        stopMediaStream()

        if (shouldDiscard) {
          return
        }

        const audio = new Blob(chunks, { type: recordedMimeType })
        void transcribeRecording(audio, recordedMimeType)
      }

      recorder.start()
      inputRef.current?.focus()
      setDictationSupported(true)
      setDictationMode("recording")
      setDictationStatus("Recording. Click the microphone again to transcribe.")
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      if (dictationSession === dictationSessionRef.current) {
        setDictationMode("idle")
        setDictationStatus(dictationRecordingErrorStatus(error))
      }
    }
  }

  const stopRecording = (shouldTranscribe = true) => {
    const recorder = mediaRecorderRef.current

    if (!recorder || recorder.state === "inactive") {
      return
    }

    discardRecordingRef.current = !shouldTranscribe
    recorder.stop()

    if (shouldTranscribe) {
      setDictationMode("transcribing")
      setDictationStatus("Transcribing dictation...")
      return
    }

    setDictationMode("idle")
    setDictationStatus(DICTATION_OFF_STATUS)
  }

  const stopDictation = () => {
    if (dictationModeRef.current === "recording") {
      stopRecording(true)
      return
    }

    if (dictationModeRef.current === "transcribing") {
      return
    }

    manualStopRef.current = true

    try {
      recognitionRef.current?.stop()
    } catch {
      recognitionRef.current?.abort()
    }

    recognitionRef.current = null
    setDictationMode("idle")
    setDictationStatus("Dictation stopped.")
  }

  const startDictation = () => {
    if (isLoading) {
      return
    }

    const SpeechRecognition = getSpeechRecognitionConstructor()

    if (!SpeechRecognition) {
      void startRecordingFallback()
      return
    }

    manualStopRef.current = true
    recognitionRef.current?.abort()
    manualStopRef.current = false
    nativeFallbackInProgressRef.current = false
    lastDictationErrorRef.current = null
    nativeStartedAtRef.current = 0

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = navigator.language || "en-US"

    recognition.onstart = () => {
      nativeStartedAtRef.current = Date.now()
      setDictationSupported(true)
      setDictationMode("native")
      setDictationStatus("Listening. Start speaking, then click the microphone to stop.")
    }

    recognition.onresult = (event) => {
      let transcript = ""

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]

        if (result.isFinal) {
          transcript += ` ${result[0].transcript}`
        }
      }

      appendDictationText(transcript)
    }

    recognition.onerror = (event) => {
      const error = event.error ?? "unknown"
      lastDictationErrorRef.current = error

      if (NATIVE_SPEECH_FALLBACK_ERRORS.has(error) && hasMediaRecorderSupport()) {
        nativeFallbackInProgressRef.current = true
        setDictationStatus("Browser speech service failed. Recording audio instead...")
        void startRecordingFallback()
        return
      }

      recognitionRef.current = null
      setDictationMode("idle")
      setDictationStatus(dictationErrorStatus(error))
    }

    recognition.onend = () => {
      recognitionRef.current = null

      if (nativeFallbackInProgressRef.current) {
        nativeFallbackInProgressRef.current = false
        return
      }

      const endedQuickly =
        nativeStartedAtRef.current === 0 || Date.now() - nativeStartedAtRef.current < 1200

      if (!manualStopRef.current && !lastDictationErrorRef.current && endedQuickly && hasMediaRecorderSupport()) {
        void startRecordingFallback()
        return
      }

      setDictationMode("idle")

      if (manualStopRef.current) {
        manualStopRef.current = false
        setDictationStatus("Dictation stopped.")
        return
      }

      if (!lastDictationErrorRef.current) {
        setDictationStatus("Dictation ended. Click the mic to start again.")
      }
    }

    recognitionRef.current = recognition
    inputRef.current?.focus()
    setDictationStatus("Starting dictation...")

    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      void startRecordingFallback()
    }
  }

  const handleDictationClick = () => {
    if (dictationModeRef.current === "idle") {
      startDictation()
      return
    }

    stopDictation()
  }

  const handleNewChat = () => {
    if (isLoading || recommendationAbortRef.current) {
      return
    }

    dictationSessionRef.current += 1
    manualStopRef.current = true
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (recognition) {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.onstart = null
      recognition.abort()
    }
    discardRecordingRef.current = true
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null
    stopMediaStream()
    audioChunksRef.current = []
    nativeFallbackInProgressRef.current = false
    lastDictationErrorRef.current = null
    nativeStartedAtRef.current = 0
    setDictationMode("idle")
    setDictationStatus(DICTATION_OFF_STATUS)
    setMessages([WELCOME_MESSAGE])
    setFeedbackEvents([])
    feedbackEventsRef.current = []
    setLastResponseId(null)
    lastResponseIdRef.current = null
    setInputText("")
    setPendingScrollRequest(null)
    messageRefs.current = {}
    requestAnimationFrame(() => {
      chatScrollRef.current?.scrollTo({ top: 0, behavior: "auto" })
      inputRef.current?.focus()
    })
  }

  const fetchMoviesWithPosters = async (movieTitles: string[]): Promise<RecommendedMovie[]> => {
    const titles = sanitizeMovieTitles(movieTitles)

    if (titles.length === 0) {
      return []
    }

    const movies = await Promise.all(
      titles.map(async (title): Promise<RecommendedMovie | null> => {
        if (!TMDB_API_KEY) {
          return { title, poster: null, tmdbUrl: null, releaseYear: "N/A", genre: "Unknown Genre" }
        }

        try {
          const tmdbSearchData = await fetchTmdbJson<TmdbListResponse>("/search/movie", {
            query: title,
            include_adult: false,
            page: 1,
          })

          if (!tmdbSearchData?.results || tmdbSearchData.results.length === 0) {
            return null
          }

          const movie = tmdbSearchData.results[0]
          const parsedReleaseYear = movie.release_date ? Number.parseInt(movie.release_date.slice(0, 4), 10) : NaN
          const releaseYear = Number.isFinite(parsedReleaseYear) ? parsedReleaseYear : "N/A"
          const movieDetails = await fetchTmdbJson<TmdbMovieDetails>(`/movie/${movie.id}`)
          const movieWithDetails: RecommendedMovie = {
            tmdbId: movie.id,
            title,
            poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
            tmdbUrl: `https://www.themoviedb.org/movie/${movie.id}`,
            releaseYear,
            genre: movieDetails?.genres?.[0]?.name ?? "Unknown Genre",
            runtime: sanitizeRuntime(movieDetails?.runtime),
            originalLanguage: movieDetails?.original_language ?? null,
            overview: movieDetails?.overview ?? movie.overview,
            popularity: movieDetails?.popularity ?? movie.popularity,
            voteAverage: movieDetails?.vote_average ?? movie.vote_average,
          }

          return {
            ...movieWithDetails,
            availability: await fetchMovieAvailability(movieWithDetails),
          }
        } catch {
          return null
        }
      })
    )

    return applyWatchPreferencesToMovies(
      movies.filter((movie): movie is RecommendedMovie => movie !== null),
      watchPreferences
    )
  }

  const submitUserMessage = async (rawMessage: string, retryMessageId?: string) => {
    const userMessage = rawMessage.trim()
    if (!userMessage || isLoading || recommendationAbortRef.current) {
      return
    }

    stopDictation()

    const retryIndex = retryMessageId ? messages.findIndex((message) => message.id === retryMessageId) : -1
    const retryMessage = retryIndex > 0 && retryIndex === messages.length - 1 && messages[retryIndex].status === "error" && !messages[retryIndex].movies?.length
      ? messages[retryIndex]
      : undefined
    if (retryMessageId && !retryMessage) {
      return
    }
    const contextMessages = retryMessage ? messages.slice(0, retryIndex - 1) : messages
    const userMessageId = createMessageId("user")
    const botMessageId = retryMessage?.id ?? createMessageId("bot")
    const hasPreviousUserMessage = contextMessages.some((message) => !message.isBot)
    const requestPreviousResponseId = retryMessage ? retryMessage.requestPreviousResponseId ?? null : lastResponseIdRef.current
    const abortController = new AbortController()
    recommendationAbortRef.current = abortController
    const updateResponse = (updater: (message: Message) => Message) => {
      if (recommendationAbortRef.current === abortController && !abortController.signal.aborted) {
        updateMessageById(botMessageId, updater)
      }
    }

    let streamedResponseText = ""
    let metadataMovieTitles: string[] = []
    let metadataMovies: RecommendedMovie[] = []
    let metadataReceived = false
    let metadataIntent: ResponseIntent = "recommendation"
    let metadataHasMovies = false
    let metadataMoviesAttached = false
    let streamErrored = false
    let streamCompleted = false
    const showRecommendationError = (message: string) => {
      updateResponse((currentMessage) => {
        const hasMovies = Boolean(currentMessage.movies?.length)
        return {
          ...currentMessage,
          content: hasMovies ? currentMessage.content : message,
          notice: hasMovies ? message : undefined,
          isLoadingMovies: false,
          status: "error",
        }
      })
    }
    const conversationHistory = contextMessages
      .map((message) => ({
        role: message.isBot ? "assistant" : "user",
        content: message.isBot
          ? [
              message.content,
              message.movies?.length
                ? `Recommended films:\n${message.movies
                    .map((movie) => `- ${movie.title} (${movie.releaseYear})${movie.reason ? `: ${movie.reason}` : ""}`)
                    .join("\n")}`
                : "",
              message.followUpContent ?? "",
            ].filter(Boolean).join("\n\n")
          : message.content,
      }))
      .filter((message) => message.content.trim().length > 0)
      .slice(-12)

    setIsLoading(true)
    const requestStartedAt = Date.now()
    setClockNow(requestStartedAt)
    setInputText("")
    const pendingMessage: Message = {
      id: botMessageId,
      content: "",
      isBot: true,
      movies: retryMessage?.movies ?? [],
      isLoadingMovies: !retryMessage?.movies?.length,
      status: "finding",
      progress: { constraints: [], completedStages: [] },
      requestStartedAt,
      requestText: userMessage,
      requestPreviousResponseId,
    }
    setMessages((prevMessages) => retryMessage
      ? prevMessages.map((message) => message.id === botMessageId ? pendingMessage : message)
      : [
          ...prevMessages,
          { id: userMessageId, content: userMessage, isBot: false, movies: [] },
          pendingMessage,
        ])
    setPendingScrollRequest({
      messageId: botMessageId,
      alignPage: !hasPreviousUserMessage,
    })

    try {
      const response = await fetch("/api/getRecommendation", {
        method: "POST",
        signal: abortController.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userMessage,
          preference,
          previousResponseId: requestPreviousResponseId,
          conversationHistory,
          previousRecommendations: contextMessages
            .filter((message) => message.isBot)
            .flatMap((message) =>
              (message.movies ?? []).map((movie) => ({
                tmdbId: movie.tmdbId ?? null,
                title: movie.title,
                year: movie.releaseYear,
                genre: movie.genre,
                reason: movie.reason,
                runtime: sanitizeRuntime(movie.runtime),
                originalLanguage: movie.originalLanguage && /^[a-z]{2,3}$/i.test(movie.originalLanguage.trim())
                  ? movie.originalLanguage.trim().toLowerCase()
                  : null,
                availability: movie.availability
                  ? {
                      region: movie.availability.region,
                      inTheaters: movie.availability.inTheaters,
                      streaming: sanitizeStringArray(movie.availability.streaming, 20),
                      rent: sanitizeStringArray(movie.availability.rent, 20),
                      buy: sanitizeStringArray(movie.availability.buy, 20),
                    }
                  : undefined,
              }))
            )
            .slice(-60),
          feedbackEvents: feedbackEventsRef.current,
          watchPreferences,
        }),
      })

      if (!response.ok || !response.body) {
        let message = "Sorry, I'm having trouble connecting to the recommendation service. Please try again later."

        try {
          const payload = (await response.json()) as { error?: unknown }
          if (typeof payload.error === "string" && payload.error.trim()) {
            message = payload.error
          }
        } catch {
          // Keep fallback message
        }

        throw new Error(message)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      const handleServerEvent = (eventName: string, rawData: string) => {
        if (recommendationAbortRef.current !== abortController || abortController.signal.aborted) {
          return
        }
        let parsedData: unknown = {}

        if (rawData.trim()) {
          try {
            parsedData = JSON.parse(rawData)
          } catch {
            parsedData = {}
          }
        }

        if (eventName === "status") {
          if (typeof parsedData === "object" && parsedData !== null) {
            const progress = parsedData as { stage?: unknown; brief?: unknown; constraints?: unknown; completedStages?: unknown }
            updateResponse((message) => ({
              ...message,
              progress: {
                stage: isRequestStage(progress.stage) ? progress.stage : message.progress?.stage,
                brief: typeof progress.brief === "string" ? progress.brief.trim().slice(0, 300) : message.progress?.brief,
                constraints: Array.isArray(progress.constraints) ? sanitizeStringArray(progress.constraints, 6) : message.progress?.constraints ?? [],
                completedStages: Array.isArray(progress.completedStages)
                  ? [...new Set(progress.completedStages.filter(isRequestStage))]
                  : message.progress?.completedStages ?? [],
              },
            }))
          }
          return
        }

        if (eventName === "token") {
          const delta =
            typeof parsedData === "object" && parsedData !== null && "delta" in parsedData
              ? (parsedData as { delta?: unknown }).delta
              : undefined

          if (typeof delta === "string" && delta.length > 0) {
            streamedResponseText += delta
            updateResponse((message) => ({
              ...message,
              content: `${message.content}${delta}`,
              status: "streaming",
            }))
          }
          return
        }

        if (eventName === "followUpToken") {
          const delta =
            typeof parsedData === "object" && parsedData !== null && "delta" in parsedData
              ? (parsedData as { delta?: unknown }).delta
              : undefined

          if (typeof delta === "string" && delta.length > 0) {
            updateResponse((message) => ({
              ...message,
              followUpContent: `${message.followUpContent ?? ""}${delta}`,
              status: "streaming",
            }))
          }
          return
        }

        if (eventName === "metadata") {
          if (typeof parsedData === "object" && parsedData !== null) {
            metadataReceived = true
            const metadata = parsedData as { responseId?: unknown; movieTitles?: unknown; movies?: unknown; intent?: unknown }
            if (metadata.intent === "conversation" || metadata.intent === "clarification" || metadata.intent === "recommendation") {
              metadataIntent = metadata.intent
            }
            updateResponse((message) => ({ ...message, intent: metadataIntent }))

            if (typeof metadata.responseId === "string" && metadata.responseId.trim()) {
              lastResponseIdRef.current = metadata.responseId
              setLastResponseId(metadata.responseId)
            } else if (metadata.responseId === null) {
              lastResponseIdRef.current = null
              setLastResponseId(null)
            }

            if (Array.isArray(metadata.movieTitles)) {
              metadataMovieTitles = sanitizeMovieTitles(
                metadata.movieTitles.filter((title): title is string => typeof title === "string")
              )
            }

            metadataHasMovies = Array.isArray(metadata.movies)
            metadataMovies = sanitizeRecommendedMovies(metadata.movies)
            if (metadataIntent !== "recommendation") {
              updateResponse((currentMessage) => ({
                ...currentMessage,
                isLoadingMovies: false,
                status: "streaming",
              }))
            }
            if (metadataMovies.length > 0) {
              metadataMoviesAttached = true
              updateResponse((currentMessage) => ({
                ...currentMessage,
                movies: metadataMovies,
                isLoadingMovies: false,
                status: "streaming",
              }))
            }
          }
          return
        }

        if (eventName === "done") {
          streamCompleted = true
          return
        }

        if (eventName === "error") {
          streamErrored = true
          const message =
            typeof parsedData === "object" && parsedData !== null && "message" in parsedData
              ? (parsedData as { message?: unknown }).message
              : undefined

          showRecommendationError(
            typeof message === "string" && message.trim()
              ? message
              : "Sorry, I'm having trouble connecting to the recommendation service. Please try again later."
          )
        }
      }

      while (true) {
        const { value, done } = await reader.read()

        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })

        let boundaryIndex = buffer.indexOf("\n\n")
        while (boundaryIndex !== -1) {
          const rawEvent = buffer.slice(0, boundaryIndex)
          buffer = buffer.slice(boundaryIndex + 2)

          const parsedEvent = parseSSEEvent(rawEvent)
          if (parsedEvent) {
            handleServerEvent(parsedEvent.event, parsedEvent.data)
          }

          boundaryIndex = buffer.indexOf("\n\n")
        }
      }

      const trailingEvent = parseSSEEvent(buffer.trim())
      if (trailingEvent) {
        handleServerEvent(trailingEvent.event, trailingEvent.data)
      }

      if (!streamErrored) {
        if (!streamCompleted || !metadataReceived) {
          throw new Error("The recommendation connection ended before it finished. Please try again.")
        }

        if (!streamedResponseText.trim()) {
          showRecommendationError("I couldn't finish the recommendation response. Please try again.")
          return
        }

        if (metadataIntent !== "recommendation") {
          updateResponse((currentMessage) => ({
            ...currentMessage,
            notice: undefined,
            isLoadingMovies: false,
            status: "complete",
          }))
          return
        }

        const movieTitles =
          metadataMovieTitles.length > 0
            ? metadataMovieTitles
            : sanitizeMovieTitles(extractMovieTitles(streamedResponseText))
        if (!metadataMoviesAttached) {
          const moviesWithPosters =
            metadataHasMovies ? metadataMovies : await fetchMoviesWithPosters(movieTitles)

          updateResponse((currentMessage) => ({
            ...currentMessage,
            movies: moviesWithPosters,
            notice: moviesWithPosters.length === 0
              ? "No verified film matches were found. Try broadening your viewing filters or naming another movie you like."
              : undefined,
            isLoadingMovies: false,
            status: moviesWithPosters.length > 0 ? "complete" : "error",
          }))
        } else {
          updateResponse((currentMessage) => ({
            ...currentMessage,
            isLoadingMovies: false,
            status: "complete",
          }))
        }
      }
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : "Sorry, I'm having trouble connecting to the recommendation service. Please try again later."

      showRecommendationError(message)
    } finally {
      if (recommendationAbortRef.current === abortController) {
        recommendationAbortRef.current = null
        setIsLoading(false)
      }
    }
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    void submitUserMessage(inputText)
  }

  const handleMovieFeedback = (movie: RecommendedMovie, type: FeedbackType) => {
    setMovieFeedbackEvent(movie, type, { toggleOff: true })
  }

  const handleShowMoreLikeThis = (movie: RecommendedMovie) => {
    const feedbackState = getMovieFeedbackState(movie)
    if (feedbackState !== "liked" && feedbackState !== "loved_this") {
      setMovieFeedbackEvent(movie, "more_like_this")
    }
    const year = movieReleaseYear(movie)
    void submitUserMessage(`Show me more movies like ${movie.title}${year ? ` (${year})` : ""}.`)
  }

  const watchModeButtonClass = (mode: WatchMode): string =>
    `inline-flex min-h-10 items-center justify-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
      watchMode === mode
        ? "border-pink-400/70 bg-pink-500/20 text-white"
        : "border-gray-600 bg-gray-800/70 text-gray-300 hover:bg-gray-700"
    }`
  const isDictating = dictationMode === "native" || dictationMode === "recording"
  const isTranscribingDictation = dictationMode === "transcribing"
  const dictationLabel = dictationButtonLabel(dictationMode, dictationSupported)
  const dictationTitle = dictationStatus === DICTATION_OFF_STATUS ? dictationLabel : dictationStatus
  const hasStartedConversation = messages.some((message) => !message.isBot)
  const latestAssistantMessageId =
    [...messages].reverse().find((message) => message.isBot && message.id !== "welcome")?.id ?? null
  const visibleMessages = hasStartedConversation
    ? messages.filter((message) => message.id !== "welcome")
    : messages

  return (
    <div
      className={`min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white ${
        hasStartedConversation ? "py-3 sm:py-4" : "py-8"
      }`}
    >
      <div
        className={`mx-auto w-full ${
          hasStartedConversation
            ? "flex min-h-[calc(100vh-2rem)] max-w-5xl flex-col px-3 sm:px-4"
            : "max-w-4xl p-4"
        }`}
      >
        <div className="overflow-hidden">
          <header className="text-center mb-8">
            <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 mb-4">
              FilmPulse
            </h1>
            <p className="text-lg text-gray-300">
              Discover hidden gems and international cinema with AI-powered recommendations
            </p>
          </header>

          <div className="flex flex-col items-center mb-6">
            <p className="text-gray-300 text-sm mb-2">
              Film Preference
            </p>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={preference}
              onChange={(e) => setPreference(parseFloat(e.target.value))}
              className="filmpulse-slider w-3/4 cursor-pointer"
            />
            <div className="flex justify-between w-3/4 text-gray-400 text-xs mt-1">
              <span>Indie/Hidden Gems</span>
              <span>Popular</span>
            </div>
          </div>

          <div className="mb-6 space-y-3 rounded-lg border border-gray-700 bg-gray-800/60 p-3">
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                className={watchModeButtonClass("any")}
                onClick={() => handleWatchModeChange("any")}
                aria-pressed={watchMode === "any"}
              >
                <Sparkles className="h-4 w-4" />
                Any
              </button>
              <button
                type="button"
                className={watchModeButtonClass("theaters")}
                onClick={() => handleWatchModeChange("theaters")}
                aria-pressed={watchMode === "theaters"}
              >
                <Ticket className="h-4 w-4" />
                Theaters
              </button>
              <button
                type="button"
                className={watchModeButtonClass("home")}
                onClick={() => handleWatchModeChange("home")}
                aria-pressed={watchMode === "home"}
              >
                <Play className="h-4 w-4" />
                At home
              </button>
            </div>

            {watchMode === "home" ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {WATCH_PROVIDER_OPTIONS.map((provider) => {
                    const selected = selectedStreamingProviders.includes(provider.value)

                    return (
                      <button
                        key={provider.value}
                        type="button"
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          selected
                            ? "border-purple-300/70 bg-purple-500/25 text-white"
                            : "border-gray-600 bg-gray-900/50 text-gray-300 hover:bg-gray-700"
                        }`}
                        onClick={() => toggleStreamingProvider(provider.value)}
                        aria-pressed={selected}
                      >
                        {provider.label}
                      </button>
                    )
                  })}
                </div>

                <label className="inline-flex items-center gap-2 rounded-full border border-gray-600 bg-gray-900/50 px-3 py-2 text-sm text-gray-200">
                  <input
                    type="checkbox"
                    checked={includeRentals}
                    onChange={(event) => setIncludeRentals(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-500 bg-gray-800 accent-pink-500"
                  />
                  Open to rentals
                </label>
              </div>
            ) : null}
            <p className="text-xs text-gray-400">
              Watch availability: {displayName(TMDB_REGION, "region") ?? "your configured region"}
              {watchMode === "theaters" ? <span className="mt-1 block">Regional listings; check local showtimes.</span> : null}
            </p>
          </div>
        </div>

        <Card
          ref={chatPanelRef}
          className={`bg-gray-800 border-gray-700 shadow-xl ${
            hasStartedConversation ? "flex h-[calc(100svh-2rem)] min-h-[28rem]" : ""
          }`}
        >
          <CardContent className={`p-3 sm:p-6 ${hasStartedConversation ? "flex min-h-0 flex-1 flex-col" : ""}`}>
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={handleNewChat}
                disabled={isLoading}
                className="rounded-full border border-gray-600 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                New chat
              </button>
            </div>
            <div
              ref={chatScrollRef}
              className={`space-y-4 mb-4 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800 ${
                hasStartedConversation ? "min-h-0 flex-1 pr-1 sm:pr-2" : "max-h-[60vh]"
              }`}
            >
              <AnimatePresence>
                {visibleMessages.map((msg) => {
                  const isFinding = msg.status === "finding" && !msg.content.trim()
                  const hasRecommendationArea =
                    msg.isBot && (Boolean(msg.movies?.length) || (!isFinding && msg.intent === "recommendation" && msg.isLoadingMovies))
                  const isRequestPending = isLoading && msg.isBot && msg.id === latestAssistantMessageId
                  const isLatestAssistantStreaming = msg.id === latestAssistantMessageId && msg.status === "streaming"
                  const hasFollowUp = Boolean(msg.followUpContent?.trim())
                  const isIntroAnimating = isLatestAssistantStreaming && !hasFollowUp
                  const isFollowUpAnimating = isLatestAssistantStreaming && hasFollowUp

                  return (
                    <motion.div
                      key={msg.id}
                      ref={(node) => setMessageRef(msg.id, node)}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      transition={{ duration: 0.3 }}
                      className={`flex ${msg.isBot ? "justify-start" : "justify-end"}`}
                    >
                    <div
                      className={`${
                        msg.isBot
                          ? hasStartedConversation
                            ? "w-full max-w-full"
                            : "w-full max-w-full sm:max-w-[86%]"
                          : "max-w-[88%] sm:max-w-[80%]"
                      } p-2.5 rounded-lg sm:p-3 ${
                        msg.isBot
                          ? "bg-gray-700 text-white"
                          : "bg-gradient-to-r from-purple-400 to-pink-600 text-white"
                      }`}
                    >
                      {isRequestPending ? (
                        <RequestProgressPanel
                          progress={msg.progress}
                          elapsedSeconds={Math.max(0, Math.floor((clockNow - (msg.requestStartedAt ?? clockNow)) / 1000))}
                        />
                      ) : null}

                      {msg.content.trim() && !(isRequestPending && msg.content.trim() === msg.progress?.brief?.trim()) ? (
                        <ChatMarkdown content={msg.content} isAnimating={isIntroAnimating} />
                      ) : null}

                      {hasRecommendationArea && (
                        <div className="mt-4 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-300">
                              {msg.isLoadingMovies ? "Your picks are taking shape" : "Here are my picks"}
                            </p>
                            {msg.isLoadingMovies ? (
                              <span className="text-xs text-gray-400">Verified film details will appear here.</span>
                            ) : null}
                          </div>

                          <AnimatePresence>
                            {msg.isLoadingMovies
                              ? [0, 1, 2].map((item) => <MovieCardSkeleton key={`skeleton-${msg.id}-${item}`} />)
                              : msg.movies?.map((movie, movieIndex) => (
                                  <MovieRecommendationCard
                                    key={movie.tmdbId ?? `${msg.id}-${movie.title}`}
                                    movie={movie}
                                    index={movieIndex}
                                    feedbackState={getMovieFeedbackState(movie)}
                                    isLoading={isLoading}
                                    onMoreLikeThis={handleShowMoreLikeThis}
                                    onFeedback={handleMovieFeedback}
                                    watchPreferences={watchPreferences}
                                  />
                                ))}
                          </AnimatePresence>
                        </div>
                      )}

                      {hasFollowUp ? (
                        <div className="mt-4 border-t border-gray-600/60 pt-3">
                          <ChatMarkdown content={msg.followUpContent ?? ""} isAnimating={isFollowUpAnimating} />
                        </div>
                      ) : null}

                      {msg.notice ? (
                        <p role="status" className="mt-4 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
                          {msg.notice}
                        </p>
                      ) : null}

                      {msg.status === "error" && !msg.movies?.length && msg.id === latestAssistantMessageId && msg.requestText ? (
                        <button
                          type="button"
                          onClick={() => void submitUserMessage(msg.requestText ?? "", msg.id)}
                          disabled={isLoading}
                          className="mt-3 inline-flex items-center gap-2 rounded-full border border-purple-300/40 bg-purple-300/10 px-3 py-2 text-xs font-medium text-purple-100 hover:bg-purple-300/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          Retry request
                        </button>
                      ) : null}
                    </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>

            <form onSubmit={handleSubmit} className="flex gap-2 mt-4">
              <div className="relative flex-grow">
                <Input
                  ref={inputRef}
                  type="text"
                  value={inputText}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setInputText(e.target.value)}
                  placeholder="Enter movies you like..."
                  disabled={isLoading}
                  className="w-full bg-gray-700 border-gray-600 pr-12 text-white placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:border-pink-500 selection:bg-pink-500/40 selection:text-white"
                />
                <button
                  type="button"
                  onClick={handleDictationClick}
                  onMouseDown={(event) => event.preventDefault()}
                  disabled={isLoading || !dictationSupported || isTranscribingDictation}
                  aria-label={dictationLabel}
                  title={dictationTitle}
                  className={`absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border transition-colors ${
                    isDictating || isTranscribingDictation
                      ? "border-pink-300/70 bg-pink-500/25 text-pink-100"
                      : "border-gray-500/70 bg-gray-800/80 text-gray-300 hover:border-purple-300/70 hover:bg-purple-500/20 hover:text-white"
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  {isTranscribingDictation ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isDictating ? (
                    <MicOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </button>
                <span className="sr-only" aria-live="polite">
                  {dictationStatus}
                </span>
              </div>
              <Button
                type="submit"
                disabled={isLoading}
                className="bg-gradient-to-r from-purple-400 to-pink-600 hover:from-purple-500 hover:to-pink-700 text-white"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 text-center text-gray-400 text-sm">
        <p>Powered by TMDB</p>
      </div>

      <footer style={{ textAlign: "center", paddingTop: "20px" }}>
        <p
          style={{
            marginTop: "0",
            fontWeight: "bold",
            fontSize: "1rem",
            background: "linear-gradient(to right, #c084fc, #db2777)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Presented by Thomas DeVito
        </p>

        <div style={{ display: "flex", justifyContent: "center", marginTop: "10px" }}>
          <a href="https://thomasdevito.me/" target="_blank" rel="noopener noreferrer" aria-label="Website">
            <WebsiteIcon />
          </a>
          <a href="https://x.com/thomasfdevito" target="_blank" rel="noopener noreferrer">
            <FontAwesomeIcon icon={faTwitter} style={{ margin: "0 10px", fontSize: "24px", color: "white" }} />
          </a>
          <a href="https://t.me/doubting_tom" target="_blank" rel="noopener noreferrer">
            <FontAwesomeIcon icon={faTelegram} style={{ margin: "0 10px", fontSize: "24px", color: "white" }} />
          </a>
          <a href="https://www.linkedin.com/in/tdevito" target="_blank" rel="noopener noreferrer">
            <FontAwesomeIcon icon={faLinkedin} style={{ margin: "0 10px", fontSize: "24px", color: "white" }} />
          </a>
          <a href="https://github.com/tommyd2377" target="_blank" rel="noopener noreferrer">
            <FontAwesomeIcon icon={faGithub} style={{ margin: "0 10px", fontSize: "24px", color: "white" }} />
          </a>
        </div>
        <br />

        <div
          style={{
            fontFamily: "Arial, sans-serif",
            fontSize: "16px",
            textAlign: "center",
            color: "white",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.25rem" }}>
            Made with{" "}
            <Heart
              aria-hidden="true"
              className="h-[1.15em] w-[1.15em] translate-y-[0.06em] text-[#e25555]"
              fill="currentColor"
              strokeWidth={0}
            />{" "}
            in NYC
          </span>
        </div>
      </footer>
    </div>
  )
}
