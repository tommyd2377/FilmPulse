"use client"

import { useRef, useState, FormEvent, ChangeEvent } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTwitter, faTelegram, faLinkedin, faGithub } from '@fortawesome/free-brands-svg-icons'
import { Loader2, Send } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

interface RecommendedMovie {
  title: string
  poster: string | null
  tmdbUrl: string | null
  releaseYear: number | string
  genre: string
}

interface Message {
  id: string
  content: string
  isBot: boolean
  movies?: RecommendedMovie[]
}

interface SSEEvent {
  event: string
  data: string
}

const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY

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

export default function FilmPulse() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      content: "Hi! I'm your film recommendation assistant. Tell me some movies you like, and I'll suggest similar ones!",
      isBot: true,
    },
  ])
  const [inputText, setInputText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [lastResponseId, setLastResponseId] = useState<string | null>(null)
  const lastResponseIdRef = useRef<string | null>(null)
  const [preference, setPreference] = useState(0.5)
  const [activeMovieMenuId, setActiveMovieMenuId] = useState<string | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const updateMessageById = (messageId: string, updater: (message: Message) => Message) => {
    setMessages((prevMessages) =>
      prevMessages.map((message) => (message.id === messageId ? updater(message) : message))
    )
  }

  const setMessageRef = (messageId: string, node: HTMLDivElement | null) => {
    if (node) {
      messageRefs.current[messageId] = node
      return
    }
    delete messageRefs.current[messageId]
  }

  const smoothScrollToMessageTop = (messageId: string) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = chatScrollRef.current
        const messageElement = messageRefs.current[messageId]

        if (!container || !messageElement) {
          return
        }

        const containerRect = container.getBoundingClientRect()
        const messageRect = messageElement.getBoundingClientRect()
        const targetTop = container.scrollTop + (messageRect.top - containerRect.top) - 8

        container.scrollTo({
          top: Math.max(0, targetTop),
          behavior: "smooth",
        })
      })
    })
  }

  const fetchMoviesWithPosters = async (movieTitles: string[]): Promise<RecommendedMovie[]> => {
    const titles = sanitizeMovieTitles(movieTitles)

    if (titles.length === 0) {
      return []
    }

    const movies = await Promise.all(
      titles.map(async (title) => {
        if (!TMDB_API_KEY) {
          return { title, poster: null, tmdbUrl: null, releaseYear: "N/A", genre: "Unknown Genre" }
        }

        try {
          const tmdbSearchResponse = await fetch(
            `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(title)}&api_key=${TMDB_API_KEY}`
          )

          if (!tmdbSearchResponse.ok) {
            return { title, poster: null, tmdbUrl: null, releaseYear: "N/A", genre: "Unknown Genre" }
          }

          const tmdbSearchData = (await tmdbSearchResponse.json()) as {
            results?: Array<{ id: number; poster_path?: string | null; release_date?: string }>
          }

          if (!tmdbSearchData.results || tmdbSearchData.results.length === 0) {
            return null
          }

          const movie = tmdbSearchData.results[0]

          const movieDetailsResponse = await fetch(
            `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_API_KEY}`
          )

          const movieDetails = movieDetailsResponse.ok
            ? ((await movieDetailsResponse.json()) as { genres?: Array<{ name: string }> })
            : null

          return {
            title,
            poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
            tmdbUrl: `https://www.themoviedb.org/movie/${movie.id}`,
            releaseYear: movie.release_date ? new Date(movie.release_date).getFullYear() : "N/A",
            genre: movieDetails?.genres?.[0]?.name ?? "Unknown Genre",
          }
        } catch {
          return null
        }
      })
    )

    return movies.filter((movie): movie is RecommendedMovie => movie !== null)
  }

  const submitUserMessage = async (rawMessage: string) => {
    const userMessage = rawMessage.trim()
    if (!userMessage || isLoading) {
      return
    }

    const userMessageId = createMessageId("user")
    const botMessageId = createMessageId("bot")

    let streamedResponseText = ""
    let metadataMovieTitles: string[] = []
    let streamErrored = false
    const conversationHistory = messages
      .filter((message) => message.content.trim().length > 0)
      .slice(-12)
      .map((message) => ({
        role: message.isBot ? "assistant" : "user",
        content: message.content,
      }))

    setIsLoading(true)
    setInputText("")
    setActiveMovieMenuId(null)
    setMessages((prevMessages) => [
      ...prevMessages,
      { id: userMessageId, content: userMessage, isBot: false, movies: [] },
      { id: botMessageId, content: "", isBot: true, movies: [] },
    ])
    smoothScrollToMessageTop(botMessageId)

    try {
      const response = await fetch("/api/getRecommendation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userMessage,
          preference,
          previousResponseId: lastResponseIdRef.current,
          conversationHistory,
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
        let parsedData: unknown = {}

        if (rawData.trim()) {
          try {
            parsedData = JSON.parse(rawData)
          } catch {
            parsedData = {}
          }
        }

        if (eventName === "token") {
          const delta =
            typeof parsedData === "object" && parsedData !== null && "delta" in parsedData
              ? (parsedData as { delta?: unknown }).delta
              : undefined

          if (typeof delta === "string" && delta.length > 0) {
            streamedResponseText += delta
            updateMessageById(botMessageId, (message) => ({
              ...message,
              content: `${message.content}${delta}`,
            }))
          }
          return
        }

        if (eventName === "metadata") {
          if (typeof parsedData === "object" && parsedData !== null) {
            const metadata = parsedData as { responseId?: unknown; movieTitles?: unknown }

            if (typeof metadata.responseId === "string" && metadata.responseId.trim()) {
              lastResponseIdRef.current = metadata.responseId
              setLastResponseId(metadata.responseId)
            }

            if (Array.isArray(metadata.movieTitles)) {
              metadataMovieTitles = sanitizeMovieTitles(
                metadata.movieTitles.filter((title): title is string => typeof title === "string")
              )
            }
          }
          return
        }

        if (eventName === "error") {
          streamErrored = true
          const message =
            typeof parsedData === "object" && parsedData !== null && "message" in parsedData
              ? (parsedData as { message?: unknown }).message
              : undefined

          updateMessageById(botMessageId, (currentMessage) => ({
            ...currentMessage,
            content:
              typeof message === "string" && message.trim()
                ? message
                : "Sorry, I'm having trouble connecting to the recommendation service. Please try again later.",
            movies: [],
          }))
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
        if (!streamedResponseText.trim()) {
          updateMessageById(botMessageId, (currentMessage) => ({
            ...currentMessage,
            content: "I couldn't generate a recommendation this time. Try asking in a different way.",
            movies: [],
          }))
          return
        }

        const movieTitles = sanitizeMovieTitles([...metadataMovieTitles, ...extractMovieTitles(streamedResponseText)])
        const moviesWithPosters = await fetchMoviesWithPosters(movieTitles)

        updateMessageById(botMessageId, (currentMessage) => ({
          ...currentMessage,
          movies: moviesWithPosters,
        }))
      }
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : "Sorry, I'm having trouble connecting to the recommendation service. Please try again later."

      updateMessageById(botMessageId, (currentMessage) => ({
        ...currentMessage,
        content: message,
        movies: [],
      }))
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    void submitUserMessage(inputText)
  }

  const handleShowMoreLikeThis = (movieTitle: string) => {
    void submitUserMessage(`Show me more movies like ${movieTitle}.`)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white py-8">
      <div className="max-w-4xl mx-auto p-4">
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
            Movie Preference: {preference === 0 ? "Indie/Hidden Gems" : preference === 1 ? "Blockbusters" : "Mixed"}
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
            <span>Blockbusters</span>
          </div>
        </div>

        <Card className="bg-gray-800 border-gray-700 shadow-xl">
          <CardContent className="p-6">
            <div
              ref={chatScrollRef}
              className="space-y-4 mb-4 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800"
            >
              <AnimatePresence>
                {messages.map((msg) => (
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
                      className={`max-w-[80%] p-3 rounded-lg ${
                        msg.isBot
                          ? "bg-gray-700 text-white"
                          : "bg-gradient-to-r from-purple-400 to-pink-600 text-white"
                      }`}
                    >
                      <div
                        dangerouslySetInnerHTML={{
                          __html: msg.content.replace(
                            /\*\*(.*?)\*\*/g,
                            "<strong class='inline-block font-semibold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600'>$1</strong>"
                          ),
                        }}
                      />

                      {msg.movies && msg.movies.length > 0 && (
                        <div className="flex flex-wrap mt-2">
                          {msg.movies.map((movie, idx) => {
                            const movieActionId = `${msg.id}-movie-${idx}`
                            const isMovieMenuOpen = activeMovieMenuId === movieActionId

                            return (
                              <div key={movieActionId} className="mr-4 mb-4 text-center">
                                <button
                                  type="button"
                                  className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                                  onClick={() =>
                                    setActiveMovieMenuId((currentId) =>
                                      currentId === movieActionId ? null : movieActionId
                                    )
                                  }
                                  aria-expanded={isMovieMenuOpen}
                                  aria-label={`Movie actions for ${movie.title}`}
                                >
                                  {movie.poster ? (
                                    <img
                                      src={movie.poster}
                                      alt={movie.title}
                                      loading="lazy"
                                      className="w-32 h-auto rounded-lg border-2 border-transparent hover:border-purple-400 hover:shadow-lg transition-all duration-300"
                                    />
                                  ) : (
                                    <div className="w-32 h-48 bg-gray-700 flex items-center justify-center rounded-lg">
                                      <span className="text-gray-400 text-xs">No Image</span>
                                    </div>
                                  )}
                                </button>

                                <p className="text-xs mt-1 font-semibold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
                                  {movie.title}
                                </p>
                                <p className="text-xs text-gray-400">
                                  {movie.releaseYear} | {movie.genre}
                                </p>

                                {isMovieMenuOpen && (
                                  <div className="mt-2 w-40 rounded-md border border-gray-600 bg-gray-900/95 p-1.5 shadow-lg">
                                    <button
                                      type="button"
                                      className="w-full rounded px-2 py-1.5 text-xs text-left text-white hover:bg-gray-700 disabled:opacity-50"
                                      onClick={() => handleShowMoreLikeThis(movie.title)}
                                      disabled={isLoading}
                                    >
                                      Show more like this
                                    </button>
                                    {movie.tmdbUrl ? (
                                      <a
                                        href={movie.tmdbUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-1 block w-full rounded px-2 py-1.5 text-xs text-left text-white hover:bg-gray-700"
                                        onClick={() => setActiveMovieMenuId(null)}
                                      >
                                        Go to TMDB
                                      </a>
                                    ) : (
                                      <span className="mt-1 block w-full rounded px-2 py-1.5 text-xs text-left text-gray-500">
                                        TMDB unavailable
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <form onSubmit={handleSubmit} className="flex gap-2 mt-4">
              <Input
                type="text"
                value={inputText}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setInputText(e.target.value)}
                placeholder="Enter movies you like..."
                disabled={isLoading}
                className="flex-grow bg-gray-700 border-gray-600 text-white placeholder-gray-400 focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:border-pink-500 selection:bg-pink-500/40 selection:text-white"
              />
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

      <footer style={{ textAlign: "center", paddingTop: "20px" }}>
        <p
          className="text font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 mb-4"
          style={{
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            color: "white",
          }}
        >
          Presented by Thomas DeVito
        </p>

        <div style={{ display: "flex", justifyContent: "center", marginTop: "2px" }}>
          <a href="https://x.com/thomasfdevito" target="_blank" rel="noopener noreferrer">
            <FontAwesomeIcon icon={faTwitter} style={{ margin: "0 10px", fontSize: "24px", color: "white" }} />
          </a>
          <a href="https://telegram.com" target="_blank" rel="noopener noreferrer">
            <FontAwesomeIcon icon={faTelegram} style={{ margin: "0 10px", fontSize: "24px", color: "white" }} />
          </a>
          <a href="https://www.linkedin.com/in/tdevito" target="_blank" rel="noopener noreferrer">
            <FontAwesomeIcon icon={faLinkedin} style={{ margin: "0 10px", fontSize: "24px", color: "white" }} />
          </a>
          <a href="https://github.com/tommyd2377" target="_blank" rel="noopener noreferrer">
            <FontAwesomeIcon icon={faGithub} style={{ margin: "0 10px", fontSize: "24px", color: "white" }} />
          </a>
        </div>

        <div className="mt-8 text-center text-gray-400 text-sm">
          <p>Powered by TMDB and OpenAI</p>
        </div>

        <div
          style={{
            fontFamily: "Arial, sans-serif",
            fontSize: "16px",
            textAlign: "center",
            color: "#333",
          }}
        >
          Made with <span style={{ color: "#e25555", fontSize: "24px" }}>&hearts;</span> in NYC
        </div>
      </footer>
    </div>
  )
}
