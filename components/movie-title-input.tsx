"use client"

import { useEffect, useId, useRef, useState, type RefObject } from "react"
import { Film, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"

interface MovieMatch {
  id: number
  title: string
  year: string | null
  poster: string | null
}

interface MovieTitleInputProps {
  inputRef: RefObject<HTMLInputElement>
  value: string
  onValueChange: (value: string) => void
  disabled: boolean
  autocompleteEnabled: boolean
}

// Keep earlier titles and conversational prefixes when inserting a match.
function movieSearchSegment(value: string, caret: number) {
  const before = value.slice(0, caret)
  let start = Math.max(before.lastIndexOf(","), before.lastIndexOf(";"), before.lastIndexOf("\n")) + 1
  start += before.slice(start).match(/^\s*/)?.[0].length ?? 0
  const prefix = before.slice(start).match(/^(?:i\s+(?:(?:really|also)\s+)?(?:like|liked|love|loved|enjoy|enjoyed)|(?:(?:show|find|recommend)(?:\s+me)?\s+)?(?:movies?|films?)\s+(?:like|similar\s+to)|(?:more|something)\s+like|similar\s+to)\s+/i)
  start += prefix?.[0].length ?? 0
  const nextSeparator = value.slice(caret).search(/[,;\n]/)
  return { start, end: nextSeparator === -1 ? value.length : caret + nextSeparator, query: before.slice(start).trim() }
}

export function MovieTitleInput({ inputRef, value, onValueChange, disabled, autocompleteEnabled }: MovieTitleInputProps) {
  const listId = useId()
  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState<number | null>(null)
  const [dismissedValue, setDismissedValue] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [result, setResult] = useState<{ query: string; movies: MovieMatch[]; status: "loading" | "ready" | "error" }>({
    query: "", movies: [], status: "ready",
  })
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const segment = movieSearchSegment(value, Math.min(caret ?? value.length, value.length))
  const query = segment.query
  const open = focused && !disabled && autocompleteEnabled && dismissedValue !== value && query.length >= 2 && query.length <= 100
  const movies = result.query === query ? result.movies : []
  const status = result.query === query ? result.status : "loading"

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    setActiveIndex(-1)
    setResult({ query, movies: [], status: "loading" })
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/movies/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        if (!response.ok) throw new Error("Movie search unavailable")
        const data = await response.json()
        if (!controller.signal.aborted) {
          setResult({ query, movies: Array.isArray(data.movies) ? data.movies : [], status: "ready" })
        }
      } catch {
        if (!controller.signal.aborted) setResult({ query, movies: [], status: "error" })
      }
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  useEffect(() => {
    if (open && activeIndex >= 0) optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" })
  }, [open, activeIndex])

  const chooseMovie = (movie: MovieMatch) => {
    const title = movie.year ? `${movie.title} (${movie.year})` : movie.title
    const nextValue = value.slice(0, segment.start) + title + value.slice(segment.end)
    const nextCaret = segment.start + title.length
    setDismissedValue(nextValue)
    setActiveIndex(-1)
    setCaret(nextCaret)
    onValueChange(nextValue)
    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true })
      inputRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  return (
    <div className="relative" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
    }}>
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => {
          setCaret(event.currentTarget.selectionStart)
          setDismissedValue(null)
          setActiveIndex(-1)
          onValueChange(event.currentTarget.value)
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onFocus={() => setFocused(true)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === "Escape" && open) {
            event.preventDefault()
            setDismissedValue(value)
          } else if (open && (event.key === "ArrowDown" || event.key === "ArrowUp") && movies.length > 0) {
            event.preventDefault()
            setDismissedValue(null)
            setActiveIndex((current) => event.key === "ArrowDown"
              ? (current + 1) % movies.length
              : (current <= 0 ? movies.length : current) - 1)
          } else if (event.key === "Enter" && open && activeIndex >= 0 && movies[activeIndex]) {
            event.preventDefault()
            chooseMovie(movies[activeIndex])
          } else if (event.key === "Tab") {
            setDismissedValue(value)
          }
        }}
        placeholder="Enter movies you like..."
        aria-label="Message"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 && movies[activeIndex] ? `${listId}-${movies[activeIndex].id}` : undefined}
        autoComplete="off"
        disabled={disabled}
        className="w-full bg-muted border-border pr-12 text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary selection:bg-primary/40 selection:text-foreground"
      />
      {open ? (
        <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
          <p className="border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">Movie titles · Select to add to your message</p>
          <div role="status" aria-live="polite" className={status === "loading" || status === "error" || movies.length === 0 ? "px-3 py-3 text-sm text-muted-foreground" : "sr-only"}>
            {status === "loading" ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Searching movies…</span>
              : status === "error" ? "Movie search is unavailable. You can still send your message."
              : movies.length === 0 ? "No matching movies. You can still send your message."
              : `${movies.length} movie suggestions available. Use the arrow keys to choose.`}
          </div>
          <ul id={listId} role="listbox" aria-label="Movie title suggestions" className="max-h-[min(22rem,50svh)] overflow-y-auto overscroll-contain p-1">
            {movies.map((movie, index) => (
              <li key={movie.id} role="presentation">
                <button
                  ref={(node) => { optionRefs.current[index] = node }}
                  id={`${listId}-${movie.id}`}
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  tabIndex={-1}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => chooseMovie(movie)}
                  className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent ${activeIndex === index ? "bg-accent text-accent-foreground" : ""}`}
                >
                  <span className="relative flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted text-muted-foreground">
                    <Film className="h-5 w-5" aria-hidden="true" />
                    {movie.poster ? <img src={movie.poster} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.hidden = true }} /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium">{movie.title}</span>
                    <span className="block text-xs text-muted-foreground">{movie.year ?? "Release year unavailable"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
