# Project Handoff: Homelab Infrastructure Dashboard

Read this first if you are a new session (cloud or local) picking up the project.
Last updated: 2026-10-13. Repo: <https://github.com/NightmarePaladin/LLM-Manager>

## What this is

A class project: a web dashboard for managing an inventory of homelab servers. Target is a working, deployed MVP, with styling last. Stack: Next.js 16 (App Router) + TypeScript, Supabase (Postgres, Auth, RLS), Vercel, Tailwind/shadcn only in the styling phase. See `README.md` for setup and features.

## Rules from the user (follow exactly)

1. **Never read, grep, print, load or handle `.env*` files or Supabase URL/key values.** The user enters environment variables in Vercel themselves. Do not run `npm run test:rls` or anything that loads `.env.local`; ask the user to run it. Only `.env.example` may be edited.
2. **Ask before any destructive Supabase database change** (drops, deletes, removing auth users, altering or removing policies). Reads are fine.
3. **Ask before pushing to GitHub or deploying.** Commit locally as milestones.
4. **Do not create accounts or log in on the deployed site.** Test auth flows on localhost only, and the user starts `npm run dev` themselves.
5. **Functionality before appearance; keep scope small; no fake data.** Never show simulated monitoring data as real.
6. Do not report anything as tested unless it was actually run.
7. Keep explanations concise. Explain important decisions briefly.
8. Excluded from the MVP unless the user authorizes: Proxmox/Docker integration, auto-discovery, CPU/RAM/disk/network monitoring, history, alerts, AI diagnostics, roles/orgs, background workers.

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
| 7 Visual styling | **Next.** Not started |
| 8 LLM server monitoring | **Shelved** until the user is home with their LLM server. Not authorized |

Past problems already fixed: Vercel Framework Preset was "Other" (caused 404s on every route); fixed by setting Next.js and redeploying without build cache.

Still on the user's side: Supabase Auth Site URL should be the production domain. Localhost redirect URL only matters if email confirmation is enabled (it is currently disabled for the demo; the app does not pass `emailRedirectTo`).

Leftover test data in Supabase Auth: `e2e-tester-1@example.com` and several `rls-*@example.com` users from the RLS script. Deleting them is destructive, so ask first.

## Next: Phase 7 (styling)

Match the dark dashboard reference image (dark theme, left sidebar, stat cards, colored status badges, server table, modern typography, responsive). Use Tailwind CSS v4 and optionally shadcn/ui; tell the user about each dependency before installing.

- Real data only: Total / Online / Offline / Unknown cards, the inventory table, status badges.
- Omit or label as "future feature": response-time chart, resource-usage bars, network traffic, anomaly panels, alerts, uptime, logs, team sidebar items.
- Restyle login, register, add, edit and details pages too; sidebar collapses on mobile.
- Verify with lint, `npx tsc --noEmit`, `npm run build`, and screenshots in the browser against localhost (user runs `npm run dev`).
- Add screenshots to `README.md`. Commit in small milestones; ask before pushing.

## Later: Phase 8 idea (shelved, needs explicit approval)

Goal: real status for the user's LLM server. Vercel cannot reach private LAN IPs, so the recommended design is a **push agent**: a small script on the server sends heartbeats (and optional CPU/RAM/disk, and whether Ollama / LM Studio / llama.cpp is responding and which models are loaded) to an authenticated API route using a per-server token. Needs a heartbeat/token table and RLS. Status becomes online if the last heartbeat is recent. The alternative is pull checks through a tunnel (Cloudflare Tunnel / Tailscale Funnel), which exposes the network. Before planning, ask the user: which server software (Ollama, LM Studio, llama.cpp) and which OS (Linux, Windows, macOS).

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
components/     ServerForm, StatusBadge
lib/            supabase/{server,proxy}.ts, auth.ts, validation.ts, types.ts
supabase/migrations/   SQL migration
scripts/test-rls.mjs   two-user RLS check
proxy.ts        session refresh + route protection
```
