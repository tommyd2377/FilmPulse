# FilmPulse

AI-powered film discovery companion built on Next.js 14 that curates indie gems, international standouts, and blockbuster crowd-pleasers through a conversational UX.

## Overview
- `app/page.tsx` renders the `FilmPulse` chat interface.
- Chat generation now runs server-side through the OpenAI **Responses API** in `app/api/getRecommendation/route.ts`.
- The client streams assistant text in real time over SSE for a more natural conversational feel.
- The route uses stateful conversation continuity via `previous_response_id`.
- After generation, a structured extraction pass returns movie titles as JSON, then TMDB enrichment adds posters, release years, genres, and links.

## How It Works
1. User submits a message and slider preference in `components/FilmPulse.tsx`.
2. Client calls `POST /api/getRecommendation` with:
   - `userMessage`
   - `preference`
   - `previousResponseId` (optional)
3. Route calls `openai.responses.create({ stream: true })` with model instructions tuned for a warm, conversational movie concierge style.
4. Route emits SSE events:
   - `token` for text deltas
   - `metadata` with `{ responseId, movieTitles }`
   - `error` for failures
   - `done` when complete
5. Client appends token deltas into the bot message as they arrive.
6. Client enriches `movieTitles` with TMDB poster/details data and renders recommendation cards.
7. If structured extraction returns no titles, client falls back to bold-title regex extraction.

## API Footprint
- **OpenAI Responses API** (`gpt-5.2` default): primary generation path, streamed.
- **OpenAI Responses API** (`gpt-5-mini` default): structured title extraction pass.
- **TMDB Search + Movie Details API**: enrichment layer for posters and metadata.

## Route Contract
`POST /api/getRecommendation`

Request body:

```json
{
  "userMessage": "string",
  "preference": 0.5,
  "previousResponseId": "resp_optional"
}
```

Response: `text/event-stream` with events:

```text
event: token
data: {"delta":"..."}

event: metadata
data: {"responseId":"resp_...","movieTitles":["..."]}

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
OPENAI_MODEL=gpt-5.2
OPENAI_EXTRACT_MODEL=gpt-5-mini
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

Have ideas or spot a great film pairing? Open an issue or reach out at [@thomasfdevito](https://x.com/thomasfdevito).
