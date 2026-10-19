# Machine and toolchain

Moved verbatim from `CLAUDE.md` (Commands) on 2026-10-19, so `CLAUDE.md` stays under 3,000 words. `CLAUDE.md` links here; keep this file current in the same change as anything it describes.

### Machine and toolchain

- **Docker is not installed on Windows; the local stack runs inside WSL2 Ubuntu.** Docker Engine and the Supabase CLI (2.115.0, pinned to match the Windows CLI) are installed there; run `supabase start|db reset|migration up|gen types` from WSL in `/mnt/c/fll-app-sk`. Ports forward to Windows, so `npm run dev` and `npm test` on Windows talk to `127.0.0.1:54321/54322` as usual.
- **`scripts/wsl-supabase.sh` is the wrapper that satisfies the credential rule**: it cds to the repo, exports `SUPABASE_ACCESS_TOKEN` from `.env`, and execs the CLI. Call it as `MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /mnt/c/fll-app-sk/scripts/wsl-supabase.sh <args>`.
- **`scripts/seed-local-session.mjs` fills the local stack with a plausible Friday session** (rosters, roles with deliberate gaps, a started meeting, attendance, tasks, blockers) through the real RPCs, so the console has something to show. Local only.
- **WSL shuts the VM down when no session is open, which kills the containers mid-run** (Postgres logs "database system was interrupted"). Keep a session open (`wsl.exe -d Ubuntu -- sleep infinity` in the background) for the length of any test or migration work. Every `supabase` call is `MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /mnt/c/...script.sh` -- pass a script path, not an inline command; inline quoting is mangled across the Windows/WSL boundary, and Git Bash rewrites `/mnt/c/...` unless `MSYS_NO_PATHCONV=1` is set.
- **`npm run build` on Windows:** Vite builds, then `@sveltejs/adapter-vercel` fails creating a symlink (`EPERM`). Pre-existing, Linux/Vercel unaffected. The adapter runtime is pinned to `nodejs22.x` in `vite.config.ts` because the adapter refuses an unknown local Node major (26) otherwise.
- **SvelteKit config lives in `vite.config.ts`** (`sveltekit({ adapter, compilerOptions })`), not `svelte.config.js`. Kit 2.63 scaffolds it that way; do not add a second config file.
