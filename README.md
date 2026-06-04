# FilmPulse

AI-powered film discovery companion built on Next.js 14 that curates indie gems, international standouts, and blockbuster crowd-pleasers through a conversational UX.

## Overview
- `app/page.tsx` renders the `FilmPulse` chat interface.
- Chat generation now runs server-side through the OpenAI **Responses API** in `app/api/getRecommendation/route.ts`.
- The client streams assistant text in real time over SSE for a more natural conversational feel.
- The route uses stateful conversation continuity via `previous_response_id`.
- Before generation, the route can analyze the user's taste, resolve seed films through TMDB, build a candidate set, and rerank those candidates with OpenAI.
- After generation, metadata returns server-enriched movie cards when available, with title extraction + client TMDB enrichment kept as a fallback.

## How It Works
1. User submits a message and slider preference in `components/FilmPulse.tsx`.
2. Client calls `POST /api/getRecommendation` with:
   - `userMessage`
   - `preference`
   - `previousResponseId` (optional)
   - `feedbackEvents` (optional session-only movie feedback)
   - `watchPreferences` (optional theater/streaming/rental filters)
3. Route analyzes taste, resolves TMDB seed films, gathers similar/recommended candidates, applies watch filters, and reranks candidates when enough data is available.
4. Route calls `openai.responses.create({ stream: true })` with model instructions tuned for a warm, conversational movie concierge style. If candidate reranking succeeded, the model is instructed to recommend only the selected movies.
5. Route emits SSE events:
   - `token` for text deltas
   - `metadata` with `{ responseId, movieTitles, movies }`
   - `error` for failures
   - `done` when complete
6. Client appends token deltas into the bot message as they arrive.
7. Client renders server-returned `movies` first, then falls back to `movieTitles` enrichment if needed.
8. Card actions record session-only feedback for "more like this", "like/liked", "love/loved", and "not interested".

## API Footprint
- **OpenAI Responses API** (`gpt-5.5` default): primary generation path, streamed.
- **OpenAI Responses API** (`gpt-5.4-mini` default): structured taste analysis and candidate reranking.
- **OpenAI Responses API** (`gpt-5-mini` default): structured title extraction pass.
- **TMDB Search + Movie Details + Similar + Recommendations + Watch Providers + Now Playing APIs**: server-side candidate layer, fallback enrichment, availability badges, and theater status.

## Route Contract
`POST /api/getRecommendation`

Request body:

```json
{
  "userMessage": "string",
  "preference": 0.5,
  "previousResponseId": "resp_optional",
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
event: token
data: {"delta":"..."}

event: metadata
data: {"responseId":"resp_...","movieTitles":["..."],"movies":[{"tmdbId":123,"title":"..."}]}

event: error
data: {"message":"..."}

event: done
data: {}
```

## Getting Started
1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` with:

```bash
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-5.5
OPENAI_RANK_MODEL=gpt-5.4-mini
OPENAI_EXTRACT_MODEL=gpt-5-mini
TMDB_API_KEY=your_tmdb_key
NEXT_PUBLIC_TMDB_API_KEY=your_tmdb_key
```

3. Run dev server:

```bash
npm run dev
```

4. Open `http://localhost:3000`.

## Notes
- OpenAI keys are now server-only (`OPENAI_API_KEY`), not exposed in browser code.
- SDK is pinned to `openai@^6.22.0`.
- Stateful conversation is enabled with `store: true` + `previous_response_id`.
- Session feedback is not persisted yet. Real cross-user "people who liked this also liked" signals should be added with a database-backed feedback table in a later pass.

Have ideas or spot a great film pairing? Open an issue or reach out at [@thomasfdevito](https://x.com/thomasfdevito).
