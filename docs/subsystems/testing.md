# Testing

Moved verbatim from `CLAUDE.md` (Verification standard) on 2026-10-19, so `CLAUDE.md` stays under 3,000 words. `CLAUDE.md` links here; keep this file current in the same change as anything it describes.

### Testing

- **Vitest against the REAL local stack** (`supabase start`), not an embedded Postgres: the claims here are about GoTrue (a bcrypt hash written from SQL signs in), PostgREST (a column with no grant is refused with 42501) and Realtime, and only those services can confirm them.
- **Layout:** flat `tests/<area>-<concern>.test.ts`, one concern per file; `tests/db/harness.ts` is the only helper. `.env.test` (committed, local defaults only) is loaded by `vitest.config.ts`.
- **TWO VITEST PROJECTS, `pure` AND `db`, AND THE LISTS ARE HAND-MAINTAINED ON PURPOSE.** `vitest.config.ts` names the 16 pure files; everything else under `tests/` is `db`. The split was measured by running the suite with no stack (see Commands), not inferred from imports, and a file changes list only when a person moves it. CI runs both.
- **Three ways in, use the right one:** `sql` (postgres.js as `postgres`, bypasses RLS -- seeding and catalog assertions only); `asRole`/`asUser` (one transaction with `request.jwt.claims` + `set local role`, for SQLSTATE-level assertions); `signIn` (a real GoTrue session through Kong/PostgREST, for end-to-end proof).
- **Files run serially (`fileParallelism: false`) against one shared database.** Each file seeds its own mentor/teams/students with a run-unique suffix through the REAL RPCs and removes them in `afterAll` via `cleanupRun()`. Keep the flag.
- **Seed helpers go through the real RPCs** (`team_create`, `student_create`), never raw inserts, except `seedMentor`, which performs the exact `auth.users` insert GoTrue performs for a Google sign-in so the trigger is what makes the mentor.
- **Every denial test has a positive control** (the service role sees the row; the same statement as the owner succeeds). Expected codes: `42501` (RLS / privilege), `23P01` (exclusion), `23503` (foreign key), `23514` (check), `23505` (unique).
