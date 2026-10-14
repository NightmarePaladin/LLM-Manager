# Homelab Infrastructure Dashboard

A web dashboard for keeping an inventory of the servers in a homelab. Users register, log in, and manage their own servers (add, view, edit, delete). The dashboard shows how many servers are online, offline, or unknown, calculated from the real database records.

Built as a class project. Repository: <https://github.com/NightmarePaladin/LLM-Manager>

## Tech stack

| Area | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Components + Server Actions) |
| Language | TypeScript |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth (email + password) via `@supabase/ssr` |
| Validation | zod |
| Hosting | Vercel |

Styling (Tailwind CSS / shadcn/ui) is planned as the final phase; the UI is currently plain HTML.

## Features

- Register, log in, log out
- Protected routes: `/dashboard` and `/servers/*` redirect to `/login` when logged out
- Server inventory: add, list, view details, edit, delete
- Server fields: name, IP/hostname, OS, type (physical / VM / container / other), description, timestamps, owner
- Dashboard counts: total, online, offline, unknown
- Row Level Security: each user can only see and change their own servers

Monitoring (in progress, see `HANDOFF.md`): a Python agent in `agent/` reports CPU, RAM, disk and network every 30 s to `/api/telemetry`; the dashboard shows online/stale state from real reports.

## How it works

- All Supabase calls run on the server (Server Components and Server Actions). There is no browser Supabase client, so the Supabase URL and key are **server-only** environment variables (no `NEXT_PUBLIC_` prefix).
- `proxy.ts` (the Next.js 16 replacement for `middleware.ts`) refreshes the session and redirects unauthenticated users. Server code re-checks the user with `getUser()`.
- Postgres Row Level Security is the real security boundary. Policies on `public.servers` limit select, insert, update and delete to rows where `owner_id = auth.uid()`.

```
app/            pages, routes and server actions
components/     ServerForm, MonitoringBadge, AutoRefresh, AgentTokenPanel
lib/            Supabase clients, auth helper, zod schemas, types
supabase/migrations/   SQL migration (servers table + RLS)
scripts/test-rls.mjs   two-user RLS verification
proxy.ts        session refresh + route protection
```

## Setup

Requirements: Node.js 20+ and a free [Supabase](https://supabase.com) project.

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Create the database table.** In the Supabase dashboard open **SQL Editor**, paste the contents of `supabase/migrations/0001_create_servers.sql`, and run it.
3. **Configure Auth.** In Supabase go to **Authentication → Providers → Email**. For a simple demo, turn off "Confirm email" so new users are logged in immediately. If you leave it on, users must confirm by email before logging in.
4. **Set environment variables.** Copy `.env.example` to `.env.local` and fill in the values from **Project Settings → API**:
   ```
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
   ```
   Never commit `.env.local`. Never use the service-role key in this app.
5. **Run it**
   ```bash
   npm run dev
   ```
   Open <http://localhost:3000>, register an account, and add a server.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type check |
| `npm run test:rls` | Creates two throwaway users and verifies RLS isolation. Needs `.env.local` and "Confirm email" disabled. Leaves the throwaway users in Supabase Auth; delete them under Authentication → Users. |

## Deploying to Vercel

1. Push the repository to GitHub and import it in Vercel (framework preset: Next.js).
2. In **Project → Settings → Environment Variables**, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` for Production and Preview.
3. Deploy.
4. In Supabase go to **Authentication → URL Configuration**. Set **Site URL** to your Vercel URL and add it (and `http://localhost:3000` for local work) to **Redirect URLs**.
5. Visit the deployed site, register, and add a server to confirm it works.

## Known limitations

- No password reset, email change, or profile pages.
- No pagination or search on the inventory table.
- Delete has no confirmation prompt.
- The UI is unstyled until the final styling phase.

## Roadmap (not part of the MVP)

- Visual redesign: dark theme, sidebar, status cards (Tailwind + shadcn/ui)
- Resource metrics (CPU, RAM, disk, network) and history charts
- Alerts and notifications
- Proxmox and Docker integrations
- Search, filtering, and sorting
- Screenshots in this README after styling
