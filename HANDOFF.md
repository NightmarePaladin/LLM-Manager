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

Test auth users from earlier runs were deleted on 2026-10-14. The RLS and ingest scripts create new throwaway `rls-*`/`ingest-*@example.com` users each run; deleting them is destructive, so ask first.

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
| 3 | Python agent (`agent/`): CPU/RAM/disk/network, dry-run, systemd unit, requirements, install docs | **Written. Verified on Windows against a mock endpoint and against the local dev server + real Supabase (5 consecutive 10 s reports stored). **Running on Steve (Linux, hostname jeeves) as a systemd service since 2026-10-14 ~15:34 UTC, reporting to production** |
| 4 | Dashboard: latest readings, last report, online/stale badge, 30 s refresh | **Verified on localhost with real readings (Online, then Stale after the agent stopped). Not yet seen on the deployed site** |
| 5 | Verification: apply 0002, run `test:ingest`, Steve end to end, invalid-token rejection on production, deploy | **Partly done.** 0002 applied; deployed (commit `ee7c66d`); production rejects missing/invalid tokens (401) and bad payloads (400); Steve's real readings land in `server_metrics` every ~30 s (verified in Supabase: 4 consecutive rows 30 s apart, last 7 s old at check time, values match Steve dry-run: CPU 0.1%, RAM 7.7%, disk 69%). **Still open: `npm run test:ingest` (user-run); user confirmation that the deployed dashboard shows Steve Online; `0003` drop of servers.status** |
| 6 | Ollama status and loaded models | **Code written, tests pass. Migration 0004 applied to Supabase 2026-10-14 (verified: columns exist, ingest function grants intact, bogus token rejected, Steve unaffected). **Verified in production 2026-10-14: Steve runs agent 0.2.0 and reports `ollama_up=true`, version 0.40.3, and the loaded model `riftspeak-dolphin:latest` (8.0B, Q4_K_M, 7.02 GB, 100% in VRAM) every ~30 s. User confirmation that the deployed dashboard badge and model table render is still pending.** Agent 0.2.0 (opt-in `LLM_MANAGER_OLLAMA_URL`; reads `/api/version` and `/api/ps`), migration `0004_ollama_metrics.sql` (additive columns + updated `ingest_telemetry`), dashboard Ollama column and server-page model table. 54 vitest tests + 8 agent unittest tests pass. |
| 7 | AMD GPU/VRAM, CPU/GPU temperatures (optional, graceful when missing) | **Code written, tests pass; NOT applied or verified on real hardware.** Agent 0.3.0 reads amdgpu sysfs (`gpu_busy_percent`, `mem_info_vram_*`, hwmon temps; picks the AMD card with the most VRAM) and psutil CPU sensors; migration `0005_gpu_and_temperatures.sql` (additive columns + updated `ingest_telemetry`) written, dry-run tested inside a rolled-back transaction, **applied to Supabase 2026-10-14** (columns present, grants intact). Verified on real hardware with `--dry-run` on Steve: gpu 1%, VRAM 17.1 GB total, GPU edge 30 C / hotspot 32 C. Steve is a KVM VM, so `cpu_temp_c` is correctly null (no CPU sensors; a Proxmox host agent would expose them). **Verified stored in Supabase from agent 0.3.0 on Steve (2026-10-14 15:57 UTC): gpu_percent 0, VRAM 59.9 MB / 17.1 GB, GPU 29 C, hotspot 32 C, cpu_temp null.** |
| 8 | Seven-day history charts, retention pruning, more servers (Proxmox hosts, VMs, LXC) | **History charts: deployed code + migration applied; NOT yet seen rendering with real data.** Migration `0006_metric_history.sql` (`get_metric_history`, SECURITY INVOKER so RLS applies; dry-run tested in a rolled-back transaction) **applied 2026-10-14** (SECURITY INVOKER, authenticated only; advisor shows no new warnings); server page shows 1 h / 24 h / 7 d charts (CPU, memory, network, GPU, VRAM, temperatures; gaps for outages; tooltip, keyboard and table view). Retention pruning and more servers: planned |

**Manual status removal (approved 2026-10-14):** app code no longer reads or writes `servers.status`; the StatusBadge was replaced by a monitoring badge derived from reports. The database column still exists (it defaults to `unknown`, so the app keeps working). `supabase/migrations/0003_drop_manual_status.sql` drops it and is **destructive: do not apply without asking the user to confirm at that moment.**

### Local verification (2026-10-14, localhost only)

Throwaway user `claude-local-test-187fd935@example.com` and server `local-test-pc` were created on localhost (which uses the real Supabase project). The real agent (run from this Windows PC, 10 s interval) sent 5 reports; all returned 200 and 5 rows were stored with values matching the agent output. Dashboard showed Online with the stored CPU/RAM/disk/network values, then Stale after about 90 s without reports. Token generation UI worked (token shown once). Rejections observed against the route: no token 401, unknown token 401, right token with wrong server id 401, cpu 500 returns 400. The revoke flow and cross-user isolation are covered by `test:ingest`, which the user still has to run.

Leftover test data from this run was deleted on 2026-10-14 (see Pending production steps).

### Steve production verification (2026-10-14)

Steve (`a568fbb7-a3ab-4337-b6ad-f0cd927af07b`) first reported to the example placeholder domain (config not edited), got 401, and that token was revoked. After fixing the config, Steve reports to `https://llm-manager-paladins2.vercel.app/api/telemetry` and rows arrive about every 30 s. The agent now refuses to run with example placeholder values. An unused extra token for Steve is still active (revoke it from the UI or ask the user before revoking).

### Gotcha: GitHub raw cache

`raw.githubusercontent.com/.../main/...` is cached for about 5 minutes after a push, so a fresh push can still serve the old agent file. When updating the agent on a server right after a push, use a commit-pinned URL (`.../LLM-Manager/<commit-sha>/agent/llm_manager_agent.py`) and check `AGENT_VERSION` in the downloaded file.

### Pending production steps (as of the GPU/history commit)

1. ~~Apply 0005 and 0006~~ Done 2026-10-14.
2. Update the agent on Steve to 0.3.0 (use a commit-pinned raw URL) and run `--dry-run` there to confirm real GPU/temperature values.
3. Test data deleted on 2026-10-14 with explicit user approval: auth users `claude-local-test-187fd935`, `rls-a-82b3ad4c`, `rls-b-11e3776f`, `e2e-tester-1` (@example.com) and, by cascade, the `local-test-pc` server with its tokens and metrics. Remaining account: `bob@bob.com` (owns Steve). **Still needs explicit user confirmation:** applying `0003_drop_manual_status.sql`.
4. Retention pruning (about 2,880 rows per server per day) needs a delete job; ask first.

### Easter egg

The dashboard has a "Got a secret code?" box (`components/SecretCode.tsx`, `lib/prank.ts`). Typing the code word shows a fake full-screen "Hacking the Pentagon" joke with scrolling nonsense text until the viewer presses Esc or clicks Exit (no on-screen disclaimer by the owner's choice; the dialog's accessible name says it is a joke). It is purely client-side cosmetic, makes no network calls, can be closed with Esc or a button, and slows down under `prefers-reduced-motion`. The code word is in `lib/prank.ts`. Verified in the browser on a temporary localhost page (wrong code, right code in any case, full speed, keeps scrolling past 15 s with no disclaimer text, Esc/button exit); not yet seen inside the signed-in dashboard.

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
