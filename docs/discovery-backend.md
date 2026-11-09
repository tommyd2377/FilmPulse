# FilmPulse discovery backend

## Local scope and browsing

A protected Vercel Preview is ready, and the selected hosted FilmPulse Supabase project has its schema installed. Hosted app configuration and the bounded browse/pick/undo verification are complete. The legacy Firebase project is untouched. The poster-grid home page fetches movie pages from TMDB only when a visitor browses. It does not import entire service catalogs or run background refreshes. The earlier bulk-refresh command and worker have been removed. See [protected preview setup](protected-preview.md).

At home supports the featured services through exact regional TMDB provider aliases: Netflix, Prime Video, Max/HBO Max, Hulu, Disney+, Apple TV+, Peacock, Paramount+, Criterion and MUBI. “Find another service” loads/searches the other providers returned for the chosen country; these use validated TMDB provider IDs through the same query path. Up to 20 services may be combined in a mix. Provider coverage is determined by TMDB, not a fixed two-service backend.

Selected services are queried with subscription/free/ad-supported access types. Paid channels are distinct provider choices and may require a separate plan. Broad name-prefix matches are not used. Rental/purchase results are included only with the separate opt-in, and are labeled Rent/Buy. Theaters use regional now-playing results, not local showtimes.

“Search movies” and “Browse a mix” appear together above setup and the poster grid. The existing debounced title-search endpoint provides up to six choices with release years. A starting title can be chosen before viewing setup; when filters are ready, the round request supplies only its `startingMovieId`. The server resolves and validates current TMDB movie details, including rejecting adult records. The inspiration title can be outside the selected services; recommended films must still meet the viewing filters. Search does not create a favorite. Its verified seed metadata is saved in the round, and further mixes can reuse that seed only through a round owned by the current guest. Existing positive-pick history continues to influence ranking. Search errors do not fall back to an unrelated popular mix.

A visitor without picks starts with regional, selected-service popular movies. After a pick, candidates come from that exact movie's TMDB recommendations and similar-movie lists. If the first direct matches are unavailable, the source queries movies sharing specific plot keywords from that seed, constrained to the selected services and genres. Generic keywords such as “sequel” or “based on novel or book” are ignored. The seeded path never fetches an unrestricted popular/genre page to fill a gap. Each offered candidate must have a movie-list or plot-keyword relationship to the current seed. A distinctive genre from the current film is also required, so a shared broad Drama tag cannot qualify an unrelated film. Different movie IDs reset the cursor even when their genres are identical.

All saved positive picks contribute to a recalculated taste profile using genre overlap and synopsis vocabulary. Recent picks have a modest extra weight; older picks keep a nonzero contribution. Up to three representative earlier films supply additional recommendation-list overlap, without fetching every historical movie. That support reranks current-seed matches and never introduces unrelated history-only candidates. The latest movie remains the main anchor. Seeded rounds have no randomized exploration slot, and global popularity cannot qualify an unrelated film. Each follow-up card shows a brief factual match explanation.

Saved history is loaded only for the verified guest. Fresh mixes use a round-specific shuffle, bounded taste influence, and service/genre diversity to explore beyond earlier picks. Up to 240 recent exposures from the last 40 owned rounds are excluded, and the saved cursor advances even when refresh supplies no previous round. When a small catalog has too few unseen films, unseen choices keep priority and neutral repeats can fill the remaining places; favorites remain excluded. Explicit picks anchor follow-up batches, and undo removes that choice from the next profile. Cross-user collaborative ranking remains unimplemented. Follow-ups use content/list-based personalization, not a trained taste model or a guarantee of matching tone and pacing.

Before offering a seeded home recommendation, FilmPulse verifies that exact film's country-specific watch-provider response against the selected provider IDs and subscription/free/ad-supported offer types. Rent/buy remain explicit opt-ins. A film available only in another country, on an extra-cost channel, or as a rental does not qualify by default. Seeded theater candidates must also appear in the bounded regional now-playing pages. If fewer than six related matches are available, the UI explains the short batch; it does not pad with unrelated popular films.

Seeded pagination uses a previous round verified to belong to this visitor, with viewing/filter and exact seed context checked before reuse. Fresh mixes advance from the greater of the owned previous cursor and the persisted cursor for those viewing options. No caller can inject another visitor's cursor, favorite or taste history.

“Reset” confirms before clearing the verified visitor’s favorites and rounds (including exposures and trail). It preserves viewing preferences, shared movie metadata, the anonymous identity and rate limits. A guest-row lock and incremented taste version serialize reset with pick/undo/save: an in-flight round created from earlier taste cannot be saved after reset, and old tabs cannot pick from deleted rounds. The reset endpoint accepts no guest ID or other client ownership fields.

## Cache and source limits

Successful movie pages are cached in server memory for 15 minutes; provider lists for 12 hours. Cache keys include country, provider/access filters, genres, sort and page. Concurrent identical queries share one request. The cache is bounded to 240 entries and disappears on server restart. No stale results or sample-film fallback are used after an upstream error. An initial browse makes at most two requested-page passes per selected provider, with up to four independent service lookups in flight. Successful warm pages remain shared through the existing cache. A seeded browse reads one requested page of each current-seed relationship list, up to three earlier-seed recommendation pages, and—when needed—one requested page constrained by the seed's plot keywords. It verifies at most 16 candidate availability records, in batches of four. Cached first pages supply pagination bounds; no catalog is scanned. Theater checks examine at most two regional now-playing pages. No path exhaustively walks a catalog. All loops are bounded. There are no automatic HTTP retries. Network/5xx failures in an individual service page, optional historical relationship lookup, current relationship list, plot-keyword lookup or candidate offer check do not discard independently verified results. Unchecked films are omitted, partial results are labeled, and failed services are not retried in the second pass. Complete source outages remain errors rather than empty recommendations. Configuration, rate-limit, validation and request-budget errors still stop the browse. If the favorite saved before a follow-up failed, the UI says it was saved and “Load next movies” retries that same seed without another favorite write.

TMDB pagination is limited to 500 pages. On-demand browsing can explore successive pages within that source limit; this is not a claim that every title in a streaming service's inventory is available. TMDB's watch availability comes from its JustWatch partnership and varies by country/provider. Cached timestamps describe when FilmPulse queried its source, not when Netflix/Prime updated their catalog. TMDB popularity is not a service's official weekly viewing chart.

Movie posters use TMDB's image CDN. A missing/failed image receives a title fallback. No streaming-account connection is used. TMDB and JustWatch attribution remains visible.

## Supabase setup

```sh
npm run db:local
npm run dev -- --hostname 127.0.0.1 --port 3100
```

The pinned CLI uses its experimental native runtime on supported Apple Silicon macOS. It starts local Postgres, Auth and REST without Docker. State/downloads are under ignored `.filmpulse-data/supabase/`. Project CLI calls disable telemetry. No login, remote project creation, link or deployment is performed. Generated local test credentials are captured into server memory and never printed by the wrapper. Loopback API/database addresses are required for local mode.

`npm run db:local -- --migrate-only` applies local schema changes without starting services. Existing `.filmpulse-data/discovery.json` data is copied transactionally once, leaving the original unchanged. An old local guest cookie can claim its imported rounds/favorites into the new verified anonymous session. That compatibility path is disabled in hosted mode. Local setup no longer seeds sample catalogs. Historical catalog tables are preserved for existing local data and are not read by the active browsing path.

Stop only this project's stack, preserving data:

```sh
SUPABASE_HOME="$PWD/.filmpulse-data/supabase" SUPABASE_TELEMETRY_DISABLED=1 ./node_modules/.bin/supabase stop
```

Do not reset the database or delete the data directory if you want to retain picks.

## Anonymous preferences and SQL

There is no sign-in screen or public profile. The server creates/verifies a Supabase anonymous session. Access/refresh tokens remain in HTTP-only, SameSite Strict cookies, with Secure on HTTPS. They are unavailable to browser JavaScript. Clearing cookies or changing devices loses continuity.

The browser calls only Next.js discovery APIs. A separate privileged server client calls a service-role-only repository function. The private `film_discovery` schema enables RLS on every table and grants no browser policies. Public/anonymous/authenticated roles cannot access its tables or invoke the repository. The security-definer function has an empty search path and qualified table names. Its browser-role denial is covered by local SQL tests.

Only offered film metadata, round/exposure context and favorite signals are written during browsing. A film's real metadata replaces earlier illustrative metadata when it is offered. Favorites have a unique guest/movie key; totals are derived rather than maintained in a hot counter. A per-guest SQL lock protects simultaneous pick/undo actions. A pick requires an owned, unexpired round and a movie actually offered in it. Replays count once; cross-tab undo cannot remove a previously existing favorite. The other films stay neutral.

API requests validate country/services and reject supplied ownership fields, cross-origin requests and bodies over 8 KiB. Rounds are limited to 20 per guest per minute. No OpenAI calls are made by this flow. HyperRank/collaborative ranking is not implemented yet; saved positive signals provide its foundation.

## Configuration and verification

Local browsing reuses the existing server `TMDB_API_KEY` (or the existing legacy TMDB variable). No credential values are retrieved, changed, generated or copied into browser code. A temporary `FILMPULSE_TMDB_REQUEST_LIMIT` may bound the total upstream reads during an isolated verification process; ordinary on-demand usage has no background requests. API failures stop the request with a visible retry option.

The hosted adapter recognizes server-only `FILMPULSE_DATA_MODE=supabase`, `FILMPULSE_SUPABASE_URL`, `FILMPULSE_SUPABASE_PUBLISHABLE_KEY` and `FILMPULSE_SUPABASE_SECRET_KEY`. The owner authorized transferring the existing hosted project's connection values into Vercel Preview and Production. They are stored as Secret values, outside source control. An unconfigured production runtime keeps discovery disabled. Before broader public rollout, review auth abuse controls, source licensing and retention of rounds/legacy tables.

- `npm run test:discovery` uses mocked provider/movie pages for all featured services, additional provider IDs, progressive browsing, cache expiry, failure handling and ownership/input validation. It makes no external calls.
- `npm run test:discovery:db` checks real local SQL/Auth/REST with synthetic fixtures and an injected offline source. It preserves owner data and removes its own fixtures.
- `npm run typecheck` and `npm run build` check static correctness/compilation. Browser checks must distinguish mocked flows from any explicitly bounded live API verification.

## Primary references

- [Movie-specific recommendations](https://developer.themoviedb.org/reference/movie-recommendations)
- [Similar movies: genres and plot keywords](https://developer.themoviedb.org/reference/movie-similar)
- [TMDB Discover filters](https://developer.themoviedb.org/reference/discover-movie)
- [TMDB/JustWatch availability](https://developer.themoviedb.org/reference/movie-watch-providers)
- [TMDB popularity](https://developer.themoviedb.org/docs/popularity-and-trending)
- [Supabase native local runtime](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes)
- [Anonymous Supabase sessions](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Database function permissions](https://supabase.com/docs/guides/database/functions)
