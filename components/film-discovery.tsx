"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowLeft, Check, ChevronRight, Film, Loader2, RotateCcw, SlidersHorizontal, Sofa, Sparkles, ThumbsUp, Ticket } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { FilmFooter } from "@/components/film-footer"
import { discoveryHeaders } from "@/lib/discovery/client-auth"
import { GENRE_NAMES, STREAMING_SERVICES, isServiceKey, serviceLabel, type DataMode, type DiscoveryMovie, type DiscoveryRound, type ServiceOption, type WatchPreferences } from "@/lib/discovery/types"

const PREFERENCES_KEY = "filmpulse-discovery-preferences-v1"
const defaultPreferences: WatchPreferences = { mode: "home", services: [], includeRentals: false, region: "US" }
type TrailEntry = { round: DiscoveryRound; movie: DiscoveryMovie }

function TwoThumbs() {
  return <span className="inline-flex -space-x-1" aria-hidden="true"><ThumbsUp className="h-4 w-4" /><ThumbsUp className="h-4 w-4 -translate-y-0.5" /></span>
}

function MoviePoster({ movie, busy, pick }: { movie: DiscoveryMovie; busy: boolean; pick: () => void }) {
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [posterFailed, setPosterFailed] = useState(false)
  const availableLabel = movie.availableOn.join(", ")
  const shortAvailability = `${movie.availableOn[0] ?? "Availability"}${movie.availableOn.length > 1 ? ` +${movie.availableOn.length - 1}` : ""}`
  useEffect(() => setPosterFailed(false), [movie.posterPath])
  return (
    <div
      className={`discovery-poster discovery-poster-${(movie.genreIds[0] ?? 0) % 5} relative aspect-[3/4] touch-manipulation select-none overflow-hidden bg-muted`}
      onPointerDown={event => { start.current = { x: event.clientX, y: event.clientY } }}
      onPointerCancel={() => { start.current = null; lastTap.current = null }}
      onPointerUp={event => {
        if (busy || event.pointerType === "mouse" || !start.current) return
        if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 12) { lastTap.current = null; return }
        const now = Date.now(), previous = lastTap.current
        if (previous && now - previous.time < 350 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 25) { lastTap.current = null; pick() }
        else lastTap.current = { time: now, x: event.clientX, y: event.clientY }
      }}
      onDoubleClick={() => { if (!busy) pick() }}
      aria-label={`${movie.sample ? "Illustrative poster" : "Poster"} for ${movie.title}. Use Pick this to find similar movies.`}
    >
      {movie.posterPath && !movie.sample && !posterFailed ? <img src={`https://image.tmdb.org/t/p/w500${movie.posterPath}`} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setPosterFailed(true)} /> : <><span className="discovery-poster-geometry" aria-hidden="true" /><span className="discovery-poster-title absolute inset-x-3 bottom-4 z-10 font-serif text-xl leading-tight text-white sm:text-2xl">{movie.title}</span></>}
      <span className="discovery-provider" aria-label={availableLabel ? `Available on ${availableLabel}` : "Availability"}>{shortAvailability}</span>
    </div>
  )
}

export default function FilmDiscovery({ mode }: { mode: DataMode }) {
  const reduceMotion = useReducedMotion() === true
  const [screen, setScreen] = useState<"welcome" | "services" | "browse">("welcome")
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [round, setRound] = useState<DiscoveryRound | null>(null)
  const [trail, setTrail] = useState<TrailEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const [pendingSeed, setPendingSeed] = useState<number | null | undefined>(undefined)
  const [pendingPick, setPendingPick] = useState<DiscoveryMovie | null>(null)
  const [providerOptions, setProviderOptions] = useState<ServiceOption[]>([])
  const [providerRegion, setProviderRegion] = useState("")
  const [moreServices, setMoreServices] = useState(false)
  const [serviceQuery, setServiceQuery] = useState("")
  const [servicesBusy, setServicesBusy] = useState(false)
  const [servicesError, setServicesError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const restored = useRef(false)
  const scrollToNext = useRef(false)
  const viewRef = useCallback((node: HTMLElement | null) => {
    if (node) window.scrollTo({ top: 0, behavior: "instant" })
  }, [])
  const gridRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || !scrollToNext.current) return
    scrollToNext.current = false
    node.parentElement?.scrollIntoView({ block: "start", behavior: "instant" })
  }, [])

  async function request<T>(path: string, body: unknown, method = "POST"): Promise<T> {
    const headers = await discoveryHeaders(mode)
    let response: Response
    try { response = await fetch(`/api/discovery/${path}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body) }) }
    catch { throw new Error("The connection was interrupted. Please try again.") }
    const payload = await response.json().catch(() => { throw new Error("Your movies could not be loaded. Please try again.") })
    if (!response.ok) throw new Error(payload.error || "Your movies could not be loaded.")
    return payload as T
  }

  async function loadRound(nextPreferences: WatchPreferences, seedId: number | null, excludeIds: number[] = [], moveToResults = true) {
    const next = await request<DiscoveryRound>("rounds", { preferences: nextPreferences, seedId, excludeIds: excludeIds.slice(-300), previousRoundId: moveToResults ? round?.id ?? null : null })
    scrollToNext.current = moveToResults
    setRound(next)
    setPendingSeed(undefined)
    setAnnouncement(next.movies.length ? `${next.movies.length} movies to explore${next.seed ? ` from ${next.seed.title}` : ""}.` : "No movies are available for these choices yet.")
    return next
  }

  async function start(nextPreferences: WatchPreferences) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(null); setScreen("browse"); setRound(null); setTrail([]); setPendingSeed(null); setPendingPick(null)
    try {
      await loadRound(nextPreferences, null, [], false)
      setTrail([])
      try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(nextPreferences)) } catch {}
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Your movies could not be loaded."); setPendingSeed(null) }
    finally { inFlight.current = false; setBusy(false) }
  }

  useEffect(() => {
    if (restored.current) return
    restored.current = true
    try {
      const value = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "null")
      if (!value || !["home", "theaters"].includes(value.mode) || !/^[A-Z]{2}$/.test(value.region) || !Array.isArray(value.services) || typeof value.includeRentals !== "boolean") return
      const next: WatchPreferences = { mode: value.mode, services: value.services.filter(isServiceKey), region: value.region, includeRentals: value.includeRentals }
      if (next.mode === "home" && !next.services.length && !next.includeRentals) return
      setPreferences(next); void start(next)
    } catch {}
    // Restore the viewing choices once. Movie picks remain in the anonymous backend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pick(movie: DiscoveryMovie) {
    if (inFlight.current || !round || round.selectedId !== null) return
    inFlight.current = true; setBusy(true); setError(null); setPendingPick(null)
    const previous = round
    let saved = false
    try {
      await request("picks", { roundId: previous.id, movieId: movie.tmdbId })
      saved = true
      setRound({ ...previous, selectedId: movie.tmdbId })
      setTrail(history => [...history, { round: previous, movie }].slice(-20))
      setPendingSeed(movie.tmdbId)
      await loadRound(previous.preferences, movie.tmdbId, [...trail.flatMap(entry => entry.round.movies.map(movie => movie.tmdbId)), ...previous.movies.map(movie => movie.tmdbId)])
    } catch (failure) { if (!saved) setPendingPick(movie); setError(failure instanceof Error ? failure.message : "Your pick could not be saved.") }
    finally { inFlight.current = false; setBusy(false) }
  }

  async function anotherMix() {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(null)
    const seed = pendingSeed !== undefined ? pendingSeed : round?.seed?.tmdbId ?? null
    setPendingSeed(seed)
    try { await loadRound(round?.preferences ?? preferences, seed, round?.movies.map(movie => movie.tmdbId)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Your movies could not be loaded.") }
    finally { inFlight.current = false; setBusy(false) }
  }

  async function undo() {
    const last = trail.at(-1)
    if (!last || inFlight.current) return
    inFlight.current = true; setBusy(true); setError(null)
    try {
      await request("picks", { roundId: last.round.id }, "DELETE")
      scrollToNext.current = true
      setRound(last.round); setTrail(trail.slice(0, -1)); setPendingSeed(undefined)
      setAnnouncement(`Your pick of ${last.movie.title} was undone. Previous movies restored.`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Your pick could not be undone.") }
    finally { inFlight.current = false; setBusy(false) }
  }

  async function toggleMoreServices() {
    setMoreServices(!moreServices)
    if (moreServices || providerRegion === preferences.region) return
    setServicesBusy(true); setServicesError(null)
    try {
      const data = await request<{ services: ServiceOption[] }>(`services?region=${preferences.region}`, undefined, "GET")
      setProviderOptions(data.services); setProviderRegion(preferences.region)
    } catch (failure) { setServicesError(failure instanceof Error ? failure.message : "Services could not be loaded.") }
    finally { setServicesBusy(false) }
  }

  function labelForService(key: WatchPreferences["services"][number]) {
    return providerOptions.find(service => service.key === key)?.label ?? round?.catalogs.find(catalog => catalog.key === `${preferences.region}_${key}`)?.label ?? serviceLabel(key)
  }
  const selectedExtras = preferences.services.filter(key => key.startsWith("tmdb:")).map(key => ({ key, label: labelForService(key) }))
  const extraOptions = [...new Map([...selectedExtras, ...providerOptions].map(service => [service.key, service])).values()]
  const shownExtras = extraOptions.filter(service => service.label.toLowerCase().includes(serviceQuery.toLowerCase()))
  const featuredSelected = STREAMING_SERVICES.every(service => preferences.services.includes(service.key))
  const canStart = (preferences.services.length > 0 || preferences.includeRentals) && preferences.services.length <= 20
  const viewing = round?.preferences ?? preferences
  const selectedServices = viewing.services.map(labelForService)
  const serviceSummary = selectedServices.length > 2 ? `${selectedServices.length} services` : selectedServices.join(" + ")
  const missing = round?.missingCatalogs.map(key => serviceLabel(key.slice(3))).join(", ")
  const viewMotion = {
    initial: { opacity: 0, y: reduceMotion ? 0 : 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reduceMotion ? 0 : -8 },
    transition: { duration: reduceMotion ? 0 : 0.2, ease: "easeOut" as const },
  }
  return (
    <div className={`discovery-root mx-auto max-w-[1600px] px-4 pb-6 sm:px-7 lg:px-10 ${screen === "browse" ? "is-browsing" : ""}`}>
      <header className="discovery-header flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5"><img src="/filmpulse-icon.svg" alt="" className="h-9 w-9" /><h1 className="text-2xl font-bold tracking-tight text-brand">FilmPulse</h1></div>
        <div className="flex items-center gap-4"><span className="discovery-tagline hidden text-xs font-medium tracking-wide text-muted-foreground sm:inline">Find your next favorite.</span><ThemeToggle /></div>
      </header>
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
      {mode === "unconfigured" && <p role="alert" className="discovery-notice mt-5 text-sm">Movie discovery is not connected yet.</p>}

      <AnimatePresence mode="wait" initial={false}>
        {screen === "welcome" ? (
          <motion.section ref={viewRef} key="welcome" {...viewMotion} className="discovery-setup-layout">
            <div className="discovery-setup-intro">
              <p className="discovery-eyebrow"><span aria-hidden="true" /> Welcome to FilmPulse</p>
              <h2 className="discovery-heading">How are you<br className="hidden sm:block" /> watching?</h2>
              <p className="discovery-lead">A great movie is a few good picks away.</p>
              <div className="discovery-intro-note"><Sparkles className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" /><span>Choose a favorite. Explore more like it. Find your movie.</span></div>
              <p className="discovery-privacy">No profiles. No sign-up. Just your taste.</p>
              {round && <button type="button" onClick={() => setScreen("browse")} className="discovery-text-link mt-3">Back to your movies</button>}
            </div>
            <div className="discovery-setup-panel">
              <div className="discovery-panel-heading"><div><p className="discovery-eyebrow">Make yourself at home</p><h3>Choose where to watch</h3></div><Film className="h-5 w-5 text-brand" aria-hidden="true" /></div>
              <div className="discovery-mode-grid">
                <button type="button" aria-label="In theaters" className="discovery-mode" disabled={busy || mode === "unconfigured"} onClick={() => { const next = { ...preferences, mode: "theaters" as const, services: [], includeRentals: false }; setPreferences(next); void start(next) }}>
                  <span className="discovery-mode-icon"><Ticket className="h-6 w-6" aria-hidden="true" /></span><span className="discovery-mode-copy"><strong>In theaters</strong><small>Find a film on the big screen</small></span><ChevronRight className="discovery-mode-arrow" aria-hidden="true" />
                </button>
                <button type="button" aria-label="At home" className="discovery-mode" disabled={busy || mode === "unconfigured"} onClick={() => { setPreferences({ ...preferences, mode: "home" }); setScreen("services") }}>
                  <span className="discovery-mode-icon"><Sofa className="h-6 w-6" aria-hidden="true" /></span><span className="discovery-mode-copy"><strong>At home</strong><small>Explore your streaming services</small></span><ChevronRight className="discovery-mode-arrow" aria-hidden="true" />
                </button>
              </div>
            </div>
          </motion.section>
        ) : screen === "services" ? (
          <motion.section ref={viewRef} key="services" {...viewMotion} className="discovery-setup-layout discovery-services-layout">
            <div className="discovery-setup-intro">
              <button type="button" disabled={servicesBusy} onClick={() => setScreen("welcome")} className="discovery-back"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Viewing options</button>
              <p className="discovery-eyebrow"><span aria-hidden="true" /> At home</p>
              <h2 className="discovery-heading">What’s on<br className="hidden sm:block" /> your screen?</h2>
              <p className="discovery-lead">Choose your services. We’ll start there.</p>
              <div className="discovery-intro-note"><Sparkles className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" /><span>You can change your services whenever you like.</span></div>
              <p className="discovery-privacy">No streaming-account connection needed.</p>
            </div>
            <div className="discovery-setup-panel">
              <div className="discovery-panel-heading"><div><p className="discovery-eyebrow">Make it yours</p><h3>Your streaming services</h3></div><button type="button" className="discovery-text-link" onClick={() => setPreferences({ ...preferences, services: featuredSelected ? preferences.services.filter(key => !STREAMING_SERVICES.some(service => service.key === key)) : [...new Set([...preferences.services, ...STREAMING_SERVICES.map(service => service.key)])] })}>{featuredSelected ? "Clear featured" : "Select featured"}</button></div>
              <div className="discovery-service-grid">{STREAMING_SERVICES.map(service => <label key={service.key} className={`discovery-service ${preferences.services.includes(service.key) ? "is-selected" : ""}`}><input type="checkbox" checked={preferences.services.includes(service.key)} onChange={event => setPreferences({ ...preferences, services: event.target.checked ? [...preferences.services, service.key] : preferences.services.filter(key => key !== service.key) })} className="h-4 w-4 shrink-0 accent-primary" /><span>{service.label}</span></label>)}</div>
              <div className="discovery-more-services">
                <button type="button" className="discovery-text-link" disabled={servicesBusy} aria-expanded={moreServices} onClick={() => void toggleMoreServices()}>{servicesBusy ? "Loading services…" : moreServices ? "Hide other services" : "Find another service"}</button>
                {servicesError && <p role="alert" className="mt-2 text-sm">{servicesError}</p>}
                {moreServices ? <><input type="search" aria-label="Search streaming services" placeholder="Search services in your region" value={serviceQuery} onChange={event => setServiceQuery(event.target.value)} className="discovery-service-search" /><p className="mt-2 text-xs text-muted-foreground">Included streaming, free or with ads. Channels may require a separate plan.</p><div className="discovery-extra-services">{shownExtras.map(service => <label key={service.key} className={`discovery-service ${preferences.services.includes(service.key) ? "is-selected" : ""}`}><input type="checkbox" checked={preferences.services.includes(service.key)} onChange={event => setPreferences({ ...preferences, services: event.target.checked ? [...preferences.services, service.key] : preferences.services.filter(key => key !== service.key) })} className="h-4 w-4 shrink-0 accent-primary" /><span>{service.label}</span></label>)}</div>{!servicesBusy && !shownExtras.length && <p className="mt-2 text-sm text-muted-foreground">No matching services.</p>}</> : selectedExtras.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Also selected: {selectedExtras.map(service => service.label).join(", ")}</p>}
              </div>
              <div className="discovery-settings">
                <label className="discovery-rental"><input type="checkbox" checked={preferences.includeRentals} onChange={event => setPreferences({ ...preferences, includeRentals: event.target.checked })} className="h-4 w-4 shrink-0 accent-primary" /><span>Include rent or buy<small>Also show movies with an extra charge.</small></span></label>
                <label className="discovery-region">Watch region<select disabled={servicesBusy} value={preferences.region} onChange={event => { setPreferences({ ...preferences, region: event.target.value }); setProviderOptions([]); setMoreServices(false); setServiceQuery(""); setServicesError(null) }}><option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option><option value="AU">Australia</option></select></label>
              </div>
              {preferences.services.length > 20 && <p role="alert" className="mb-3 text-sm">Choose up to 20 services for one mix.</p>}
              <button type="button" disabled={!canStart || busy || servicesBusy} onClick={() => void start(preferences)} className="discovery-primary w-full">Find my starting mix<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          </motion.section>
        ) : (
          <motion.section ref={viewRef} key="browse" {...viewMotion} className="discovery-browse-layout">
            <div className="discovery-toolbar">
              <button type="button" aria-label="Change viewing options" title={selectedServices.join(" + ")} onClick={() => setScreen("welcome")} disabled={busy} className="discovery-viewing-control">
                <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{viewing.mode === "theaters" ? "In theaters" : serviceSummary || "Rent or buy"}{viewing.includeRentals && viewing.services.length ? " + rent / buy" : ""}<span className="discovery-viewing-region"> · {viewing.region}</span></span>
              </button>
              {round?.catalogs.some(catalog => catalog.source === "sample") && <details className="discovery-sample-info"><summary>Sample catalog</summary><p>These films and availability are illustrative.</p></details>}
            </div>
            <div className="discovery-results">
              <div className="discovery-results-heading"><div><h2>{round?.seed ? `More like ${round.seed.title}` : "Pick your favorite."}</h2>{!round?.seed && <p>Double tap a poster or tap the two thumbs up.</p>}</div>{trail.length > 0 && <button type="button" disabled={busy || !!pendingPick} onClick={() => void undo()} className="discovery-undo"><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Undo last pick</button>}</div>
              {error && <div role="alert" className="discovery-notice mb-5 text-sm"><p>{error}</p><button type="button" onClick={() => pendingPick ? void pick(pendingPick) : void anotherMix()} disabled={busy} className="discovery-text-link mt-2">Try again</button></div>}
              {missing && <p role="status" className="discovery-notice mb-5 text-sm text-secondary-foreground">No matching service listings for {missing} in {round?.preferences.region}. These services haven’t been added to this mix.</p>}
              {round?.catalogs.some(catalog => catalog.stale) && <p className="discovery-notice mb-5 text-xs text-muted-foreground">Some availability was last checked more than six hours ago. A refresh is due.</p>}
              {busy && !round ? <div className="discovery-movie-grid" aria-label="Loading movies">{Array.from({ length: 6 }, (_, index) => <div key={index} className="discovery-skeleton animate-pulse motion-reduce:animate-none" />)}</div> : null}
              <AnimatePresence mode="wait" initial={false}>
                {round && round.movies.length > 0 && <motion.div ref={gridRef} key={round.id} className="discovery-movie-grid" initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -5 }} transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}>
                  {round.movies.map((movie, index) => <motion.article key={movie.tmdbId} initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.23, delay: reduceMotion ? 0 : Math.min(index * 0.035, 0.18) }} className="discovery-movie" aria-label={movie.title}>
                    <MoviePoster movie={movie} busy={busy || !!pendingPick || round.selectedId !== null} pick={() => void pick(movie)} />
                    <div className="discovery-movie-body"><div className="discovery-movie-heading"><h3 title={movie.title}>{movie.title}</h3><p>{movie.releaseYear ?? "Year unavailable"} <span aria-hidden="true">·</span> {GENRE_NAMES[movie.genreIds[0]] ?? "Film"}</p></div>
                      {round.seed && movie.reason && <p className="discovery-match-reason" title={movie.reason}>{movie.reason}</p>}
                      <button type="button" className="discovery-primary w-full px-2 text-xs sm:text-sm" aria-label={`Pick ${movie.title} as your favorite and find more like it`} disabled={busy || !!pendingPick || round.selectedId !== null} onClick={() => void pick(movie)}>{round.selectedId === movie.tmdbId ? <><Check className="h-4 w-4" aria-hidden="true" />Picked</> : <><TwoThumbs />Pick this</>}</button>
                      <div className="discovery-movie-links">{movie.sample ? <details><summary>Where to watch</summary><p>Sample availability: {movie.availableOn.join(", ")}.</p></details> : <a href={`https://www.justwatch.com/${round.preferences.region.toLowerCase()}/search?q=${encodeURIComponent(movie.title)}`} target="_blank" rel="noopener noreferrer">Where to watch</a>}<a href={`https://www.themoviedb.org/movie/${movie.tmdbId}`} target="_blank" rel="noopener noreferrer">TMDB ↗</a></div>
                    </div>
                  </motion.article>)}
                </motion.div>}
              </AnimatePresence>
              {!busy && round?.seed && round.movies.length > 0 && round.movies.length < 6 && <p role="status" className="discovery-catalog-note">Found {round.movies.length} related {round.movies.length === 1 ? "film" : "films"} for your viewing options. Try another mix or add a service for more matches.</p>}
              {!busy && round && !round.movies.length && <div className="discovery-empty"><Film className="mx-auto h-6 w-6 text-brand" aria-hidden="true" /><p className="mt-3 font-medium">{round.seed ? "No close matches for these viewing options." : "No movies in this mix yet."}</p><p className="mt-2 text-sm text-muted-foreground">Try another mix or change your services and watch region.</p><button type="button" className="discovery-text-link mt-3" onClick={() => setScreen(round.preferences.mode === "theaters" ? "welcome" : "services")}>Change viewing options</button></div>}
              {busy && round && <p role="status" className="discovery-loading"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />Finding your next mix…</p>}
              <div className="discovery-results-footer"><p>{viewing.mode === "theaters" ? "Check local showtimes before you go." : "Found one? Use “Where to watch.”"}</p><button type="button" className="discovery-secondary" disabled={busy || !!pendingPick || mode === "unconfigured" || (!!round && round.selectedId !== null && pendingSeed === undefined)} onClick={() => void anotherMix()}>Show another mix <ChevronRight className="h-4 w-4" aria-hidden="true" /></button></div>
              {round?.catalogs.length ? <p className="discovery-catalog-note">{round.catalogs.some(catalog => catalog.source === "sample") ? "Sample catalog · illustrative availability" : `Availability checked ${new Date(Math.min(...round.catalogs.map(catalog => Date.parse(catalog.checkedAt)))).toLocaleString()}`}</p> : null}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
      <p className="discovery-attribution">Movie data: <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a> · Availability: <a href="https://www.justwatch.com/" target="_blank" rel="noopener noreferrer">JustWatch</a></p>
      <FilmFooter />
    </div>
  )
}
