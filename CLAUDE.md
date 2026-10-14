# CLAUDE.md

Read `HANDOFF.md` first: it is the source of truth for status, rules and the plan. Also follow `AGENTS.md` (this Next.js version differs from older ones; read `node_modules/next/dist/docs/` before writing Next.js code).

Current objective: live infrastructure monitoring (approved 2026-10-14): Python agent -> HTTPS `/api/telemetry` -> Supabase -> dashboard. Update `HANDOFF.md` after every milestone, and do not claim monitoring features exist until they are implemented and verified.

Standing rules (details in `HANDOFF.md`): never read or handle `.env*` or key values; additive migrations only, and ask before destructive DB changes; ask before pushing or deploying; no logins on the deployed site; no fake data (unavailable metrics are null, not zero); agents never receive Supabase credentials; do not rebuild working code.
