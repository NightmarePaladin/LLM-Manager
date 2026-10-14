# Project Handoff: Homelab Infrastructure Dashboard

Read this first if you are a new session (cloud or local) picking up the project.
Last updated: 2026-10-14. Repo: <https://github.com/NightmarePaladin/LLM-Manager>

## What this is

A web dashboard for managing homelab servers. The inventory MVP is deployed and styled; the **active objective is live infrastructure monitoring** (see "Monitoring: approved, active" below), turning the manually maintained inventory into a real-time dashboard. Stack: Next.js 16 (App Router) + TypeScript, Supabase (Postgres, Auth, RLS), Vercel, Tailwind/shadcn only in the styling phase. See `README.md` for setup and features.

## Rules from the user (follow exactly)

1. **Never read, grep, print, load or handle `.env*` files or Supabase URL/key values.** The user enters environment variables in Vercel themselves. Do not run `npm run test:rls` or anything that loads `.env.local`; ask the user to run it. Only `.env.example` may be edited.
2. **Ask before any destructive Supabase database change** (drops, deletes, removing auth users, altering or removing policies). Reads are fine.
3. **Ask before pushing to GitHub or deploying.** Commit locally as milestones.
4. **Do not create accounts or log in on the deployed site.** Test auth flows on localhost only, and the user starts `npm run dev` themselves.
5. **Functionality before appearance; keep scope small; no fake data.** Never show simulated monitoring data as real.
6. Do not report anything as tested unless it was actually run.
7. Keep explanations concise. Explain important decisions briefly.
8. **Monitoring is approved and active (authorized 2026-10-14).** The old "monitoring is shelved / not authorized" restriction is removed. Approved scope: Python push agent, authenticated ingestion API, telemetry table, live dashboard readings. Still excluded unless the user authorizes: full Proxmox API integration, Docker integration, auto-discovery, alerts, AI diagnostics, roles/orgs, background workers.
9. **Do not claim monitoring exists until it is implemented and verified.** Unavailable metrics are stored and shown as unavailable (null / "n/a"), never as zero. Never show simulated data as real.
10. **Agent security:** the Python agent never holds Supabase credentials of any kind, only its own per-server token. Privileged keys (if any ever exist) stay server-side in Vercel and never reach the browser. All agent traffic is HTTPS.

## Technical decisions

- Env vars are **server-only**: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (no `NEXT_PUBLIC_`). There is no browser Supabase client; everything runs in Server Components and Server Actions.
- Next.js 16 renamed middleware: use `proxy.ts` (not `middleware.ts`). It refreshes the session and redirects logged-out users from `/dashboard` and `/servers/*` to `/login`. Server code re-checks with `getUser()` (`lib/auth.ts`). **Read `node_modules/next/dist/docs/` before writing Next.js code** (see `AGENTS.md`).
- `cacheComponents` and `partialPrefetching` were turned off in `next.config.ts`; per-user dynamic pages broke the build with them on.
- RLS on `public.servers` limits every operation to `owner_id = auth.uid()`. `owner_id` defaults to `auth.uid()`.
- Validation: zod (`lib/validation.ts`) in Server Actions, plus HTML attributes and DB check constraints.
- Errors are passed to pages through `?error=` query params (no client state).
- Single table. Migration: `supabase/migrations/0001_create_servers.sql` (already applied to the user's Supabase project).
- Windows host; paths contain spaces.

## Status

| Phase | State |
|---|---|
| 1 Planning | Done |
| 2 Setup | Done |
| 3 Server CRUD | Done |
| 4 Auth + dashboard | Done |
| 5 Functional testing | Done: lint, tsc, production build pass; `scripts/test-rls.mjs` 13/13 pass; route protection checked; local UI flow (register, add, edit, delete, stats, logout, login) passed |
| 6 Deployment | Mostly done. Pushed to GitHub `main`. Vercel project `llm-manager` deploys from `main`. Production domains `llm-manager-paladins2.vercel.app` and `llm-manager-eosin.vercel.app` return 200 on `/login`/`/register` and 307 to `/login` on protected routes. **Not yet confirmed:** the user's own live register/add/edit/delete test on the deployed site |
| 7 Visual styling | Done (commit `3b3fc1b`: dark Tailwind dashboard, sidebar, stat cards, styled auth/forms). Not re-verified in this session |
| 8 Live monitoring | **Approved, active. Planning only: no monitoring code, migration, endpoint, agent or dashboard change exists yet.** See milestones below |

Past problems already fixed: Vercel Framework Preset was "Other" (caused 404s on every route); fixed by setting Next.js and redeploying without build cache.

Still on the user's side: Supabase Auth Site URL should be the production domain. Localhost redirect URL only matters if email confirmation is enabled (it is currently disabled for the demo; the app does not pass `emailRedirectTo`).

Leftover test data in Supabase Auth: `e2e-tester-1@example.com` and several `rls-*@example.com` users from the RLS script. Deleting them is destructive, so ask first.

## Monitoring: approved, active (Phase 8)

**Goal / success criterion:** Steve (Linux AI server: Radeon RX 9070 XT, Ollama) sends real CPU, RAM, disk and network readings to Supabase every 30 seconds, and those values appear in the existing Vercel dashboard. Nothing below is implemented yet unless marked Done.

### Architecture

```
Linux host -> Python agent (psutil, 30 s) -> HTTPS POST /api/telemetry (Next.js on Vercel)
           -> Supabase Postgres (RPC ingest_telemetry) -> dashboard (Server Components, refresh ~30 s)
```

- **Agent auth:** per-server bearer token. Only its SHA-256 hash is stored (`agent_tokens`). The token is generated by the logged-in owner from the server detail page and shown once.
- **Ingestion without privileged keys:** the route validates the payload (zod), then calls a `SECURITY DEFINER` Postgres function `ingest_telemetry(token, payload)` using the existing publishable key. The function hashes and looks up the token, rejects revoked or unknown tokens, and inserts for that token's server only. No service-role key is needed, so none is added. (Fallback if this proves unworkable: a service-role key as a server-only Vercel env var. Ask the user first.)
- **Tables (additive migration `0002`):** `agent_tokens` (server_id, token_hash, created_at, last_used_at, revoked_at) and `server_metrics` (server_id, recorded_at set by the DB, nullable metric columns, index on `(server_id, recorded_at desc)`). RLS: owners may select metrics for their servers and manage their own tokens; there is **no** direct insert policy on metrics, only the definer function writes them.
- **Server status:** the manual `servers.status` is left untouched. The dashboard derives a monitoring state from the latest sample: `online` (under ~90 s old), `stale` (~90 s or older), `not monitored` (no samples).
- **Refresh:** a small client component calls `router.refresh()` every 30 s. No browser Supabase client, no `NEXT_PUBLIC_` vars.
- **Network rates** are computed by the agent from counter deltas (the first sample is null). `recorded_at` is the database clock, not the agent's.
- `proxy.ts` matcher must exclude `/api/telemetry` so agent calls skip the browser-session check.

### Milestones

| # | Milestone | State |
|---|---|---|
| 1 | Docs: HANDOFF.md and CLAUDE.md updated, repo inspected, plan written | Done |
| 2 | Backend: migration 0002, `/api/telemetry`, token generation UI, tests | Not started (awaiting user approval) |
| 3 | Python agent (CPU/RAM/disk/network, dry-run, systemd unit, requirements.txt, install docs) | Not started |
| 4 | Dashboard: latest readings, last report, online/stale badge, 30 s refresh | Not started |
| 5 | Verification: tests, invalid-token rejection, production build, Steve end to end | Not started |
| 6 | Ollama status and loaded models | Planned |
| 7 | AMD GPU/VRAM, CPU/GPU temperatures (optional, graceful when missing) | Planned |
| 8 | Seven-day history charts, retention pruning, more servers (Proxmox hosts, VMs, LXC) | Planned |

### Known constraints and issues

- **Node.js/npm are not installed on the dev machine** (checked 2026-10-14). `npm run lint`, `tsc`, `build` and tests cannot run locally until Node is installed. Python 3.12 is available.
- Migration `0002` must be applied by the user in the Supabase SQL editor (Claude sessions have no Supabase access). Rule 2 still applies: the migration is additive only.
- Steve-side steps (install agent, create token, run the systemd service) and any check on the deployed site are done by the user (rules 1 and 4).
- Dashboard still says "Status is set manually. Automated monitoring is a future feature." Change that copy only when monitoring is verified.
- Telemetry volume at 30 s is about 2,880 rows per server per day. Retention pruning is deferred to milestone 8 and needs user approval (deletes).

### Required configuration (once implemented)

- Vercel/Supabase: no new env vars expected (existing `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`).
- Agent on Steve: API URL (`https://<production domain>/api/telemetry`), agent token, interval 30 s. Setup instructions will be added here when the agent exists.

## Useful commands

```bash
npm run dev         # user runs this; dev server on localhost:3000
npm run lint
npx tsc --noEmit
npm run build
npm run test:rls    # user runs this (needs .env.local)
```

## Layout

```
app/            pages, routes, server actions (auth/, dashboard/, login/, register/, servers/)
components/     ServerForm, StatusBadge, Brand, NavLinks
lib/            supabase/{server,proxy}.ts, auth.ts, validation.ts, types.ts
supabase/migrations/   SQL migration
scripts/test-rls.mjs   two-user RLS check
proxy.ts        session refresh + route protection
(planned) agent/ Python monitoring agent; app/api/telemetry/ ingestion route; migration 0002
```
