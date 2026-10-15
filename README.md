# FilmPulse

AI-powered film discovery companion built on Next.js 14 that curates indie gems, international standouts, and blockbuster crowd-pleasers through a conversational UX.

## Overview
- `app/page.tsx` renders the `FilmPulse` chat interface.
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
- Session feedback is not persisted yet. Real cross-user "people who liked this also liked" signals should be added with a database-backed feedback table in a later pass.

Have ideas or spot a great film pairing? Open an issue or reach out at [@thomasfdevito](https://x.com/thomasfdevito).
