# Protected FilmPulse preview

## Scope

Use the existing Vercel `filmpulse` project and verify the hosted backend in Preview before the requested Production release. The project currently enables Vercel Authentication for all previews (`prod_deployment_urls_and_all_previews`). Keep that protection enabled; access requires an authorized Vercel account.

The local app remains available on `http://127.0.0.1:3100`. Local picks are not copied to hosted Supabase. There are no bulk imports or background refresh jobs.

Hosted-backend preview URL: <https://filmpulse-fbmriuolz-thomas-projects-5f14069c.vercel.app>.

## Hosted backend handoff

The selected hosted Supabase project is `FilmPulse` (`lteffhdulcjbpdwuwdpu`, West US). Its API URL is `https://lteffhdulcjbpdwuwdpu.supabase.co`. Migration `20261108175025_film_discovery.sql` has been applied. The repository migration filename matches the hosted migration history so a later GitHub integration does not treat it as a new migration. Local SQL content and picks are unchanged.

All ten private tables have RLS enabled. Browser roles have neither schema access nor permission to execute the repository RPC; `service_role` can execute it. A hosted read under the service role returns an empty taste profile for a fresh guest. Anonymous sign-ins have been enabled in the project dashboard. All four Vercel connection variables are saved as Secret values for Preview and Production.

The approved hosted browser check passed on November 8, 2026: US Prime Video + Apple TV+ produced six films, a Project Hail Mary pick produced six seed-related films, and all twelve posters loaded. SQL confirmed the saved favorite, taste history and related round. Undo restored the starting mix and removed the favorite/history. Two rounds and twelve offered movie records remain; there were no catalog imports or OpenAI calls. Browser error logs were empty, and the green header rendered as RGB 81,184,49 without desktop overflow. This check does not claim all services or recommendation quality were exhaustively verified.

Configure these server-only variables in Vercel's **Preview** and **Production** environments. Do not paste credential values into chat or commit them:

| Name | Purpose |
| --- | --- |
| `FILMPULSE_DATA_MODE` | Set to `supabase` |
| `FILMPULSE_SUPABASE_URL` | Selected hosted project's HTTPS URL |
| `FILMPULSE_SUPABASE_PUBLISHABLE_KEY` | Server-created anonymous sessions |
| `FILMPULSE_SUPABASE_SECRET_KEY` | Privileged server-only repository access |

The existing server-side `TMDB_API_KEY` is already configured for Vercel Preview. No OpenAI calls are needed by poster discovery. Environment changes require a new Preview deployment before they take effect.

## GitHub connection

Vercel is connected to `tommyd2377/FilmPulse`, with `main` as its production branch. Supabase's GitHub integration is now connected to that repository with working directory `.`. The owner completed the GitHub App authorization. Supabase automatic branching and automatic production deployment are disabled, so pushes do not create database preview branches or apply hosted schema changes automatically. Vercel's existing GitHub deployment behavior remains active. The local Supabase config is for the native development stack; it is not a hosted Auth configuration to push.

Before backend configuration, the production runtime defaults to `unconfigured`, displays a connection notice, and disables discovery controls. Do not set hosted mode to `local`: the development database must remain on loopback.

## Verification

- Run `npm run typecheck`, `npm run test:discovery`, `npm run test:discovery:db` against the local stack, and `npm run build`.
- Use isolated browser checks with mocked movie APIs to verify onboarding, filters, pick/undo, layout and light mode without live provider calls.
- Verify the deployment is `READY`, targets Preview, and rejects an unauthenticated request before opening it for owner testing.
- After hosted setup, verify an authorized session can browse, save a pick and retain that pick. Any live TMDB check needs its own bounded approval; builds and mocked checks do not establish that hosted behavior.

`.vercelignore` excludes environment files, `.filmpulse-data/`, and local Supabase link/runtime files. Never upload the local runtime or credentials.

The Next.js upgrade clears the framework's reported dependency advisories. The dependency audit still reports existing findings in other packages, including the retained chat renderer and build tools; this change does not claim a clean repository-wide audit. Review those separately before a public rollout.

Hosted security advisors report only [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), an intentional deny-by-default choice for these private, server-only tables. Performance advisors report [three foreign-key index suggestions](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) and [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) on the empty database. These informational notices do not establish tested production performance.
