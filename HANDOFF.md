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
| 2 | Backend code: migration `0002`, `/api/telemetry`, token generation UI, unit tests, `scripts/test-ingest.mjs` | **Code written and committed locally. Vitest suite (36 tests: unit and mocked-route), lint, tsc and build pass. **Migration 0002 applied to the Supabase project on 2026-10-14** (structure verified: 3 tables with RLS, owner-only policies, no direct insert policy on metrics, `ingest_telemetry` is SECURITY DEFINER with empty search_path, and a bogus-token call returns `invalid_token`). **Verified on localhost 2026-10-14 (see Local verification below). `npm run test:ingest` (user-run) and production are NOT yet verified** |
| 3 | Python agent (`agent/`): CPU/RAM/disk/network, dry-run, systemd unit, requirements, install docs | **Written. Verified on Windows against a mock endpoint and against the local dev server + real Supabase (5 consecutive 10 s reports stored). NOT yet run on Steve or against production** |
| 4 | Dashboard: latest readings, last report, online/stale badge, 30 s refresh | **Verified on localhost with real readings (Online, then Stale after the agent stopped). Not yet seen on the deployed site** |
| 5 | Verification: apply 0002, run `test:ingest`, Steve end to end, invalid-token rejection on production, deploy | Not started |
| 6 | Ollama status and loaded models | Planned |
| 7 | AMD GPU/VRAM, CPU/GPU temperatures (optional, graceful when missing) | Planned |
| 8 | Seven-day history charts, retention pruning, more servers (Proxmox hosts, VMs, LXC) | Planned |

**Manual status removal (approved 2026-10-14):** app code no longer reads or writes `servers.status`; the StatusBadge was replaced by a monitoring badge derived from reports. The database column still exists (it defaults to `unknown`, so the app keeps working). `supabase/migrations/0003_drop_manual_status.sql` drops it and is **destructive: do not apply without asking the user to confirm at that moment.**

### Local verification (2026-10-14, localhost only)

Throwaway user `claude-local-test-187fd935@example.com` and server `local-test-pc` were created on localhost (which uses the real Supabase project). The real agent (run from this Windows PC, 10 s interval) sent 5 reports; all returned 200 and 5 rows were stored with values matching the agent output. Dashboard showed Online with the stored CPU/RAM/disk/network values, then Stale after about 90 s without reports. Token generation UI worked (token shown once). Rejections observed against the route: no token 401, unknown token 401, right token with wrong server id 401, cpu 500 returns 400. The revoke flow and cross-user isolation are covered by `test:ingest`, which the user still has to run.

Leftover test data (delete only with user confirmation): the test user above, its server, 1 agent token and 5 metric rows (deleting the server cascades).

### Known constraints and issues

- Node 24 LTS was installed on the dev machine on 2026-10-14 (winget). On Windows, open a new shell or refresh PATH if `node` is not found. `npm test` runs the vitest suite (unit tests plus `/api/telemetry` route tests with a mocked Supabase client); `npm run test:ingest` and `test:rls` need `.env.local` and are run by the user.
- Supabase advisor (2026-10-14) warns that `ingest_telemetry` is executable by `anon`/`authenticated` as SECURITY DEFINER. This is intentional (the route calls it with the publishable key; it only acts on a valid token hash plus matching server id). Also open: Auth leaked-password protection is disabled (user setting in the Supabase dashboard).
- Supabase connector (project-scoped `.mcp.json`) is connected; destructive changes still need explicit user confirmation. Rule 2 still applies: the migration is additive only.
- Steve-side steps (install agent, create token, run the systemd service) and any check on the deployed site are done by the user (rules 1 and 4).
- Dashboard subtitle now describes live readings; that wording is only accurate once monitoring is verified end to end.
- Telemetry volume at 30 s is about 2,880 rows per server per day. Retention pruning is deferred to milestone 8 and needs user approval (deletes).

### Required configuration (once implemented)

- Vercel/Supabase: no new env vars expected (existing `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`).
- Agent on Steve: API URL (`https://<production domain>/api/telemetry`), server ID, agent token, interval 30 s. Full setup in `agent/README.md`.

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
components/     ServerForm, MonitoringBadge, AutoRefresh, AgentTokenPanel, Brand, NavLinks
lib/            supabase/{server,proxy}.ts, auth.ts, validation.ts, types.ts
supabase/migrations/   SQL migration
scripts/test-rls.mjs   two-user RLS check
proxy.ts        session refresh + route protection
agent/          Python monitoring agent, systemd unit, install docs
app/api/telemetry/  ingestion route
tests/          vitest unit + route tests (npm test); scripts/test-ingest.mjs integration check
```
