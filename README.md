# FilmPulse

Film discovery built on Next.js 16 and React 19: choose your streaming services, pick a favorite from a poster grid, and explore more movies like it. Anonymous positive picks and on-demand streaming availability provide the foundation for shared recommendations.

## Local poster-grid discovery

- Choose theaters or at home, select services and pick one favorite from a six-poster grid. Two thumbs up and double tap have the same positive action. Other films stay neutral; undo reverses the last pick.
- Search for a starting movie beside “Browse a mix,” before setup or above the posters. Results include years to distinguish titles; choosing one starts related recommendations within the selected viewing filters. Search sets a direction without creating a favorite.
- Refresh and “Browse a mix” advance through the visitor’s saved catalog cursor, avoid recently shown films, and balance services and genres. “Reset” clears that visitor’s saved picks and browsing trail after confirmation, keeping streaming services and region selected.
- All featured services work through the same on-demand TMDB path. “Find another service” searches additional providers available in the chosen country, including free/ad-supported streaming. Rent/buy remain a separate opt-in.
- Requested movie pages are cached in server memory for 15 minutes; provider lists for 12 hours. Further browsing fetches more pages. There is no bulk catalog import, refresh worker or background scan.
- Follow-up batches come from the chosen film's direct recommendation/similar lists and specific plot-keyword matches, ranked using all earlier saved picks. Each match is checked against exact regional streaming offers. Short batches are explained rather than filled with unrelated popular films.
- Posters come from TMDB. Only offered films, anonymous rounds and favorites are saved to **local Supabase Postgres**. Existing sample catalogs remain as legacy local data and are ignored by browsing.
- The poster-first layout has clear borders, compact viewing controls, reduced-motion support, and the earlier green light-mode header.
- The hosted FilmPulse Supabase project has its schema installed, anonymous sign-ins enabled and Preview/Production settings configured. A bounded hosted check verified browsing, real posters, saved picks and undo. The old Firebase project is untouched. The old AI chat routes remain in source but the poster-grid flow does not call them.

```sh
npm run db:local
npm run dev -- --hostname 127.0.0.1 --port 3100
```

`db:local` starts the project-scoped native Supabase stack and applies the local schema. It requires a supported Apple Silicon Mac; its first run downloads the CLI's native service binaries. Local test credentials remain in CLI state/server memory. Existing JSON preview favorites are preserved. Browsing uses the already-configured server TMDB development credential; it never displays or changes it.

```sh
npm run typecheck
npm run test:discovery
npm run test:discovery:db
```

Tests use mocked TMDB pages and local synthetic SQL fixtures, without external APIs. See [discovery backend documentation](docs/discovery-backend.md) for setup, source coverage, caching and verification limits.

## Protected preview

The existing Vercel project protects preview deployments with Vercel Authentication. Hosted discovery is configured through server-only Supabase variables. Local database/runtime state and environment files are excluded from uploads. Supabase is linked to the FilmPulse GitHub repository with automatic database deployments disabled. See [preview and backend setup](docs/protected-preview.md).

The upgrade pins Next.js 16.4.5, React 19.3.1 and the matching React types. Webpack remains the build path. TypeScript errors fail the build; Next.js 16 removed the previous `next lint` command, and this repository has no standalone ESLint setup.

## Retained conversational API
- `components/FilmPulse.tsx` retains the prior chat interface; `app/page.tsx` now renders `FilmDiscovery`.
- On a curation-cache miss, one streamed GPT-6.1 Sol **Responses API** call in `app/api/getRecommendation/route.ts` interprets the request, distinguishes recommendations from conversation or clarification, and supplies ordered film choices with concise reasons.
- Recommendations resolve to TMDB records before display. Minimum/maximum runtime, release-year, original-language, required/excluded-genre, and viewing filters are checked against metadata, and previous picks are excluded from new rounds. A film with an excluded genre remains ineligible even when it also has allowed genres.
- Completed film choices are checked against TMDB while the model continues. Verified cards arrive progressively over SSE; questions about existing picks and clarification requests return text without a new batch of cards.
- The waiting panel shows server-reported stages, the understood brief and constraints when available, and actual elapsed seconds. It marks only explicitly completed steps.
- Conversation history, previously recommended films, and session-only feedback guide follow-ups. **New chat** clears that context and feedback while preserving the preference controls.

## How It Works
1. User submits a message and slider preference in `components/FilmPulse.tsx`.
2. Client calls `POST /api/getRecommendation` with:
   - `userMessage`
   - `preference`
   - `conversationHistory` (optional recent user/assistant messages)
   - `previousRecommendations` (optional films already shown, including known runtime, language, and availability)
   - `feedbackEvents` (optional session-only movie feedback)
   - `watchPreferences` (optional theater/streaming/rental filters)
3. **Any** uses the curator's film knowledge, with exact TMDB verification afterward. **At home** first supplies a regional catalog based on selected streaming providers and rental preferences; additional choices still need availability verification. **Theaters** supplies a current regional TMDB catalog and accepts only choices from its IDs.
4. The single structured response contains intent, requested final count (1–10, default 5), reply, metadata constraints, ordered choices, and a follow-up. It can supply up to two reserve choices beyond the requested count, at most 12 total. As complete choices arrive, the server checks exact title/year identity, model-assessed mood fit, metadata constraints, exclusions, and viewing availability. Eligible cards publish in the curator's order without waiting for the full response to finish.
5. Route emits SSE events:
   - `status` with the current stage and any available brief, constraints, and completed steps
   - repeated `metadata` with `{ intent, recommendationCount, responseId, movieTitles, movies }`; `movies` is the cumulative verified list
   - `token` for text deltas
   - `followUpToken` for the question displayed after the cards
   - `error` for failures
   - `done` at the end of the stream, including after an error
6. Client updates progress, text, and verified cards as events arrive. Received cards remain visible if a later stream error occurs; an incomplete connection is reported instead of silently appearing successful. A failed latest request with no cards offers a manual retry using the original context.
7. Empty verified results prompt the user to broaden the request. The route does not fall back to an unverified generated movie list, and an explicit empty `movies` array prevents client title-extraction fallback. Interrupted curation reports an error, preserving any cards already verified.
8. Card actions record session-only feedback for "more like this", "like/liked", "love/loved", and "not interested". **New chat** resets messages, response continuity, feedback, and active dictation.

## API Footprint
- **OpenAI Responses API** (`gpt-6.1-sol`, `service_tier: "ultrafast"`, `reasoning.effort: "low"`): zero calls on an exact-context curation-cache hit; one streamed call on a miss for every viewing mode and for conversation or clarification. The active route handles interpretation, choices, reasons, and presentation together. All retained text helpers also use Sol with Ultrafast. Automatic retries, slower-tier fallbacks and prewarming are not enabled.
- **OpenAI audio transcription API**: dictation keeps its speech-transcription model; Sol and Ultrafast are not supported on that endpoint.
- **TMDB Search + Movie Details + Person Credits + Discover + Watch Providers + Now Playing APIs**: exact film identity, runtime/language/year/genre checks, seed/direct-work exclusions, provider catalogs, availability badges, and regional theatrical choices. Availability follows TMDB's configured region (US by default), rather than a user's signed-in streaming account.

## Route Contract
`POST /api/getRecommendation`

Request body:

```json
{
  "userMessage": "string",
  "preference": 0.5,
  "conversationHistory": [
    { "role": "user", "content": "I loved Titanic." },
    { "role": "assistant", "content": "Recommended films: Atonement (2007)" }
  ],
  "previousRecommendations": [
    { "title": "Atonement", "tmdbId": 4347, "year": 2007 }
  ],
  "watchPreferences": {
    "mode": "home",
    "streamingProviders": ["Netflix", "Max"],
    "includeRentals": false
  },
  "feedbackEvents": [
    {
      "type": "more_like_this",
      "title": "Movie title",
      "tmdbId": 123
    }
  ]
}
```

Response: `text/event-stream` with events:

```text
event: status
data: {"stage":"understanding","message":"Reading your request","completedStages":[]}

event: token
data: {"delta":"..."}

event: metadata
data: {"intent":"recommendation","recommendationCount":5,"responseId":null,"movieTitles":["..."],"movies":[{"tmdbId":123,"title":"...","releaseYear":2007,"runtime":123,"originalLanguage":"en"}]}

event: followUpToken
data: {"delta":"..."}

event: error
data: {"message":"..."}

event: done
data: {}
```

`intent` is `recommendation`, `conversation`, or `clarification`. The latter two carry `movies: []` and `movieTitles: []`. Metadata can arrive more than once as the verified list grows; `responseId` can be `null` during generation and remains `null` on a curation-cache hit. A recommendation can contain fewer than `recommendationCount` verified films; the reply explains the shortfall. Movie cards include `runtime` in minutes and `originalLanguage` as a language code when available (otherwise `null`), alongside the existing poster, genre, reason, and availability fields.

## Getting Started
1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` with:

```bash
OPENAI_API_KEY=your_openai_key
TMDB_API_KEY=your_tmdb_key
NEXT_PUBLIC_TMDB_API_KEY=your_tmdb_key
```

All text-model paths select `gpt-6.1-sol` with Ultrafast in code; the active recommendation path keeps low reasoning. Legacy text-model environment overrides are no longer used. Existing environment files need no changes.

3. Run dev server:

```bash
npm run dev
```

4. Open `http://localhost:3000`.

## Notes
- OpenAI keys are now server-only (`OPENAI_API_KEY`), not exposed in browser code.
- The OpenAI SDK dependency is `openai@^6.22.0`.
- [Ultrafast](https://developers.openai.com/api/docs/guides/ultrafast-mode) is the default for text generation, at its higher token rates. The installed SDK predates the tier literal, so a narrowly scoped type cast passes the documented API value without a dependency upgrade.
- Completed curations have a process-local cache with a fixed five-minute lifetime and at most 50 entries. Its key includes the exact request context, conversation, prior films, feedback, preferences, viewing filters, region, model, and contract version. Only error-free, terminal-complete recommendation rounds that verified the full requested count are admitted.
- Cache hits reuse the completed curation and rerun all catalog, mood-gate, identity, metadata, exclusion, and availability checks before displaying cards. An underfilled or failed hit is evicted without an automatic paid refresh. Cache-hit speed is distinct from fresh model generation; fresh requests have no five-second first-card guarantee.
- Conversation continuity uses explicit recent history and prior-film records, including known runtime, language, and provider facts. Responses use `store: true`; the active route does not depend on `previous_response_id`.
- Mood and thematic comparisons can use Sol's film knowledge as interpretation. Exact identity, runtime, year, language, and availability claims remain grounded in the supplied verified records.
- The curator assesses overall tone, pacing, emotional intensity, and emotional aftertaste separately. All four model checks must pass, the experience fit must be strong, and no mood violations may be listed. These are internal model assessments, not verified metadata or guarantees of a viewer's experience; missing or partial assessments are rejected.
- Explicit content exclusions are checked separately from genre and mood. Sexual-violence avoidance includes coercion, threats, exploitation and material implied/off-screen or referenced incidents; a non-graphic description is not enough to qualify. The curator must omit uncertain matches.
- `lib/openai-response-stream.ts` owns the OpenAI stream's single reader. It requires an explicit completed response and handles premature EOF, API failures, cancellation, and a request deadline as errors, with stream cleanup and no automatic retry.
- The retained chat interface still has session-only feedback. The new poster-grid flow persists anonymous favorites in Supabase; collaborative ranking is a later pass.

Have ideas or spot a great film pairing? Open an issue or reach out at [@thomasfdevito](https://x.com/thomasfdevito).
