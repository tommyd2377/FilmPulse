"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ChevronRight, Film, Loader2, Search, X } from "lucide-react"

export type StartingMovie = { id: number; title: string; year: string | null; poster: string | null }

export function DiscoveryMovieSearch({ value, onValueChange, onSelect, disabled }: {
  value: string
  onValueChange: (value: string) => void
  onSelect: (movie: StartingMovie) => void
  disabled: boolean
}) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [focused, setFocused] = useState(false)
  const [dismissedValue, setDismissedValue] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [result, setResult] = useState<{ query: string; movies: StartingMovie[]; status: "loading" | "ready" | "error" }>({ query: "", movies: [], status: "ready" })
  const query = value.trim()
  const open = focused && !disabled && dismissedValue !== value && query.length >= 2
  const movies = result.query === query ? result.movies : []
  const status = result.query === query ? result.status : "loading"

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setResult({ query, movies: [], status: "loading" })
    setActiveIndex(-1)
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/movies/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        if (!response.ok) throw new Error("Movie search unavailable")
        const data = await response.json()
        if (!controller.signal.aborted) setResult({ query, movies: Array.isArray(data.movies) ? data.movies : [], status: "ready" })
      } catch {
        if (!controller.signal.aborted) setResult({ query, movies: [], status: "error" })
      }
    }, 300)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [open, query])

  useEffect(() => {
    if (open && activeIndex >= 0) optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" })
  }, [open, activeIndex])

  function choose(movie: StartingMovie) {
    const title = movie.year ? `${movie.title} (${movie.year})` : movie.title
    setDismissedValue(title); setActiveIndex(-1)
    onValueChange(title); onSelect(movie)
  }

  return (
    <div className="discovery-search" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
    }}>
      <div className="discovery-search-field">
        <Search className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
        <input
          ref={inputRef} type="search" role="combobox" aria-label="Search for a starting movie"
          placeholder="Search movies" autoComplete="off" maxLength={100}
          value={value} disabled={disabled} aria-autocomplete="list" aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && activeIndex >= 0 && movies[activeIndex] ? `${listId}-${movies[activeIndex].id}` : undefined}
          onFocus={() => setFocused(true)}
          onChange={event => { onValueChange(event.target.value); setDismissedValue(null); setActiveIndex(-1) }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return
            if (event.key === "Escape") { event.preventDefault(); setDismissedValue(value); setActiveIndex(-1) }
            else if (open && movies.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
              event.preventDefault()
              setActiveIndex(index => event.key === "ArrowDown" ? (index + 1) % movies.length : (index <= 0 ? movies.length : index) - 1)
            } else if (event.key === "Enter" && open && activeIndex >= 0 && movies[activeIndex]) {
              event.preventDefault(); choose(movies[activeIndex])
            } else if (event.key === "Tab") setDismissedValue(value)
          }}
        />
        {value && <button type="button" aria-label="Clear movie search" disabled={disabled} onClick={() => { onValueChange(""); setDismissedValue(null); inputRef.current?.focus() }}><X className="h-4 w-4" aria-hidden="true" /></button>}
      </div>
      {open && <div className="discovery-search-results">
        <div role="status" aria-live="polite" className={status === "ready" && movies.length ? "sr-only" : "discovery-search-message"}>
          {status === "loading" ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Searching movies…</>
            : status === "error" ? "Movie search is unavailable. Try another search or browse a mix."
            : !movies.length ? "No matching movies. Try another title or year."
            : `${movies.length} movies found. Use the arrow keys to choose a starting movie.`}
        </div>
        <ul id={listId} role="listbox" aria-label="Starting movie results">
          {movies.map((movie, index) => <li key={movie.id} role="presentation">
            <button
              ref={node => { optionRefs.current[index] = node }} id={`${listId}-${movie.id}`}
              type="button" role="option" aria-selected={activeIndex === index} tabIndex={-1}
              aria-label={`Start with ${movie.title}${movie.year ? ` (${movie.year})` : ""}`}
              onPointerDown={event => event.preventDefault()} onPointerMove={() => setActiveIndex(index)} onClick={() => choose(movie)}
              className={activeIndex === index ? "is-active" : ""}
            >
              <span className="discovery-search-poster"><Film className="h-4 w-4" aria-hidden="true" />{movie.poster && <img src={movie.poster} alt="" onError={event => { event.currentTarget.hidden = true }} />}</span>
              <span className="min-w-0 flex-1"><strong>{movie.title}</strong><small>{movie.year ?? "Year unavailable"}</small></span>
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </li>)}
        </ul>
        <p className="discovery-search-hint">Sets your starting point. Two thumbs up saves a favorite.</p>
      </div>}
    </div>
  )
}
