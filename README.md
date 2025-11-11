# FilmPulse

AI-powered film discovery companion built on Next.js 14 that curates indie gems, international standouts, and blockbuster crowd-pleasers through a conversational UX.

## Overview
- Conversational chat UI in `app/page.tsx` renders the `FilmPulse` component for a full-screen, animated experience.
- Client-side OpenAI integration in `components/FilmPulse.tsx` streams user prompts and chat history to the `gpt-4o` Chat Completions API.
- Responses are parsed for bolded film titles, which trigger follow-up calls to the TMDB Search and Movie Detail REST endpoints to enrich each recommendation with posters, release years, genres, and canonical links.
- A preference slider steers the system prompt toward indie discoveries, mainstream hits, or a blend of both, allowing the model to tailor the tone and depth of its suggestions.
- Recommendations are presented with Framer Motion transitions, Tailwind styling, and quick links to TMDB alongside social call-to-actions.

## How It Works
1. **Collect context** – User messages are stored in component state alongside prior bot replies so every submission preserves the conversation arc.
2. **Shape the prompt** – Before hitting OpenAI, `handleSubmit` builds a system message describing the desired voice plus the current slider preference, then injects the full chat transcript followed by the latest user query.
3. **Call OpenAI** – `openai.chat.completions.create({ model: "gpt-4o", ... })` returns a natural-language reply rich with bolded film titles and short hooks.
4. **Extract candidates** – The helper `extractMovieTitles` scrapes every `**Title**` occurrence from the response so only explicit film mentions move forward.
5. **Enrich with TMDB** – For each title, the app calls `https://api.themoviedb.org/3/search/movie` to resolve the canonical ID, then immediately requests `https://api.themoviedb.org/3/movie/{id}` for genre metadata and release year. Poster URLs are composed with the TMDB image CDN.
6. **Render the carousel** – Each recommendation is displayed with artwork, metadata, and a TMDB deep link, wrapped in subtle animation and adaptive styling for desktop/mobile.
7. **Fall back endpoint** – `app/api/getRecommendation/route.ts` exposes a server-side proxy for OpenAI (`gpt-3.5-turbo`) when you prefer to keep keys off the client.

## API Footprint
- **OpenAI Chat Completions (gpt-4o)** – Primary recommendation engine, invoked directly from the browser via the official `openai` SDK with `dangerouslyAllowBrowser: true` to unblock client-side usage.
- **TMDB Search + Movie Detail API** – Secondary enrichment layer that converts OpenAI text into structured data, posters, and links.

## Getting Started
1. Clone or download this repository.
2. Install dependencies:
	```bash
	npm install
	```
3. Provide the required environment variables (see below).
4. Launch the dev server:
	```bash
	npm run dev
	```
5. Visit `http://localhost:3000` and start describing movies you love.

## Environment Variables
Create a `.env.local` file with:

```
OPENAI_API_KEY=your_openai_key
TMDB_API_KEY=your_tmdb_key
```

> **Note:** `components/FilmPulse.tsx` currently hard-codes sample keys and enables `dangerouslyAllowBrowser`. Replace those inline strings with `process.env.NEXT_PUBLIC_*` values or route requests through `app/api/getRecommendation` before deploying publicly.

## Unique Experience Highlights
- Slider-adjusted prompting keeps recommendations aligned with your appetite for hidden gems vs. blockbusters.
- Chat history awareness means FilmPulse references earlier picks, refining its tone and follow-ups organically.
- Posters, genres, and release years materialize moments after the AI reply, creating an interactive “AI + data” co-pilot rather than plain text.
- Built with Tailwind CSS, Radix UI primitives, Framer Motion, and Lucide icons for a polished yet lightweight interface.

## Status & Next Steps
- ✅ Core recommendation loop with OpenAI + TMDB enrichment
- ✅ Animated UI & social attribution footer
- ⏳ Swap hard-coded API keys for environment-driven configuration
- ⏳ Add testing around title extraction and TMDB fallbacks

Have ideas or spot a great film pairing? Open an issue or reach out at [@thomasfdevito](https://x.com/thomasfdevito).
