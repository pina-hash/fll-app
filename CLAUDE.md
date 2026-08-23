# CLAUDE.md

Operating rules for working in this repository. Everything here changes how a
task is done, whatever the task is.

**The per-bundle historical record lives in [`docs/HISTORY.md`](docs/HISTORY.md)**
-- what each migration and code-only bundle changed, why, what was measured, and
what was left undone. Read it when you need the REASON a rule below exists
before changing it. Do not read it end to end.

---

## What this is

`fll-app` runs Bosco Tech's four FIRST LEGO League teams through the BIOGLOW
2026-27 season: mentors drive Friday (4:30-6:00) and Saturday (9:00-11:00)
sessions from a console; students (ages 9-13) work a team board from tablets.

- **Stack:** SvelteKit 2 (Svelte 5, runes) + Supabase + Vercel
- **Repo:** https://github.com/pina-hash/fll-app
- **Local path:** `C:\fll-app-sk` (`C:\fll-app` is the unrelated `fll-camp` static site -- do not confuse them)
- **Supabase project:** its own project, separate from idea-app's. Linked via `supabase link`.
- **Conventions** are carried over from `pina-hash/idea-app` (migrations, definer RPCs, realtime, soft delete, test layout, design-system layout). Business logic and schema are not.

### Build phases

1. **This repo's foundation (done):** scaffold, schema (0001-0008), RLS, both auth paths, login screen, placeholder `/app` shell.
2. **Mentor console** (next): teams, roster, PIN reset UI, meetings, the live phase clock.
3. **Student runtime** (after): the team board, tasks, blockers, evidence upload, the local-first write queue.

---

## Commands

```bash
npm run dev                     # dev server (http://localhost:5173)
npx svelte-check                # type + a11y check -- baseline 0 errors, 0 warnings
npx vitest run                  # full suite; NEEDS the local stack running
npm run build                   # dies on Windows in the adapter's closeBundle with a symlink EPERM (see traps)
supabase start                  # local stack: applies the chain + seed.sql
supabase db reset               # re-apply the chain + seed from scratch
supabase migration up           # apply pending files to the running local stack
supabase db push                # apply pending files to the linked project (never the seed)
supabase gen types typescript --local > src/lib/supabase/database.types.ts
```

### Supabase CLI credentials

- **Never run a bare `supabase` command in this repo.** Read
  `SUPABASE_ACCESS_TOKEN` out of `.env` and put it in the environment of that
  one command:

  ```bash
  SUPABASE_ACCESS_TOKEN="$(grep '^SUPABASE_ACCESS_TOKEN=' .env | cut -d= -f2- | tr -d '\r\n"')" supabase projects list
  ```

- **WHY: a bare command does not fail, it succeeds against the wrong account.**
  With the variable unset the CLI falls through to the machine's global login,
  which lives in Windows Credential Manager -- ambient state shared by every
  repo on this machine and silently re-pointed by any `supabase login` run
  anywhere else, including in `idea-app` and `frc-app`. There is no prompt and
  no error; the command just reads or writes someone else's projects. The
  failure mode that bites is a create/unpause landing in the wrong org, or
  refused by that org's active-project cap -- and by then the damage is
  remote, not local.
- **`.env` is the repo's own answer to "which account is this."** It is
  gitignored (`.gitignore:16`), it travels with the checkout, and it is the
  only credential statement that cannot drift when a sibling repo logs in.
  Pinning it per command is what makes this repo's Supabase identity a
  property of the repo instead of a property of the laptop.
- Applies to every `supabase` invocation that talks to the hosted API
  (`projects`, `orgs`, `link`, `db push`, `secrets`, `gen types --linked`).
  Purely local commands (`start`, `db reset`, `migration up`,
  `gen types --local`) do not need the token, but set it anyway rather than
  keeping two habits.
- The WSL wrapper scripts are covered by the same rule: the token is exported
  inside the script, because the Windows environment does not cross into WSL.

### Machine and toolchain

- **Docker is not installed on Windows; the local stack runs inside WSL2 Ubuntu.** Docker Engine and the Supabase CLI (2.115.0, pinned to match the Windows CLI) are installed there; run `supabase start|db reset|migration up|gen types` from WSL in `/mnt/c/fll-app-sk`. Ports forward to Windows, so `npm run dev` and `npx vitest run` on Windows talk to `127.0.0.1:54321/54322` as usual.
- **WSL shuts the VM down when no session is open, which kills the containers mid-run** (Postgres logs "database system was interrupted"). Keep a session open (`wsl.exe -d Ubuntu -- sleep infinity` in the background) for the length of any test or migration work. Every `supabase` call is `MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash /mnt/c/...script.sh` -- pass a script path, not an inline command; inline quoting is mangled across the Windows/WSL boundary, and Git Bash rewrites `/mnt/c/...` unless `MSYS_NO_PATHCONV=1` is set.
- **`npm run build` on Windows:** Vite builds, then `@sveltejs/adapter-vercel` fails creating a symlink (`EPERM`). Pre-existing, Linux/Vercel unaffected. The adapter runtime is pinned to `nodejs22.x` in `vite.config.ts` because the adapter refuses an unknown local Node major (26) otherwise.
- **SvelteKit config lives in `vite.config.ts`** (`sveltekit({ adapter, compilerOptions })`), not `svelte.config.js`. Kit 2.63 scaffolds it that way; do not add a second config file.

---

## Verification standard

- **The full suite once, at the end.** During development run only the files the change touches.
- **Assert both directions on any visibility or gating claim.** An empty result from a denied read is indistinguishable from an empty table: the same row is shown to exist through the service role in the same test.
- **Mutate in the PERMISSIVE direction to prove a boundary test bites.** `using (true)` reproduces the real leak; a policy commented out fails closed and reddens nothing. Restore the file byte-identically (md5) and re-verify green. The cross-team proof was mutated this way when it shipped (HISTORY: 0007).
- **`svelte-check` at the baseline: 0 errors, 0 warnings.** Re-derive it with `npx svelte-kit sync && npx svelte-check`; a session that measures a different number corrects this line in the same change.
- **A session that creates migration files lists their full repo paths at the end of its response**, one line per file, in apply order, and states what SQL undoes each one (every file carries a `TO UNDO` section; quote it).

---

## Database conventions

### Migrations

- SQL lives in `supabase/migrations/`, sequentially numbered `NNNN_<area>_<what>.sql`. **Applied by the Supabase CLI**, never pasted: `supabase migration up` locally, `supabase db push` to the linked project. The CLI records each file in `supabase_migrations.schema_migrations`.
- **Migrations are an immutable applied record.** Never rewrite an applied file to change behaviour; write a new one.
- **Idempotent where practical** (`create or replace`, `if not exists`, `drop policy if exists` before `create policy`, a catalog guard around `create type`). A failed first attempt is retried over a half-built schema.
- **A migration REFUSES rather than destroys.** If a precondition is unmet, raise with the counts and what to do about it. Report counts with `raise notice`.
- **Every file carries a header essay** (filename, SHOUTED thesis, WHY, what it does not do) and a `TO UNDO` section in prose-SQL. The header is where the reasoning lives; HISTORY.md cites it.
- **THE SIGNATURE TRAP.** A function gaining a parameter is `drop function`ed at its exact old argument types FIRST. Two overloads differing only by a defaulted trailing parameter make PostgREST unable to resolve the call. `tests/schema-catalog.test.ts` asserts `pg_proc` holds exactly one row per RPC.
- **Language-SQL helper bodies are validated at creation.** `0001` defines `is_mentor()` and friends before `mentors`/`students` exist, under `set check_function_bodies = off` (restored at the end of that section). A new SQL-language function that reads a table must come AFTER the table, or inside such a guard.
- **This Postgres image grants the API roles nothing useful by default.** The `postgres` role's default ACL on `public` gives `anon`/`authenticated`/`service_role` only TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. Every table therefore states its own grants: `revoke all ... from anon, authenticated; grant all ... to service_role; grant select ... to authenticated;` plus column-level write grants. A table without a `service_role` grant is invisible to the admin API and to every positive control in the tests.
- `supabase/seed.sql` is **local-only** (placeholder admin, four teams, the phase templates). `db push` never sends it; do not make production depend on it.

### RLS and grants

- **Every table has RLS enabled and at least one policy** (RLS on with no policy is deny-all, which would silently break a feature). One policy per operation, `to authenticated`, named as a lowercase sentence in double quotes, `drop policy if exists` first. `with check` mirrors `using` on UPDATE.
- **`anon` holds no table grant anywhere and can execute exactly one function** (`team_login_roster`). `tests/schema-catalog.test.ts` asserts both.
- **The team boundary is a CONSTRAINT first, a POLICY second.** Every row on the work surface carries `team_id`, and every student reference is a composite foreign key `(student_id, team_id) -> students (id, team_id)`. RLS then scopes students with `team_id = (select public.current_student_team_id())`. Do not add a table that names a student without the composite key.
- **Column-level grants are the tool for "server-owned" columns, for EVERY client.** `evidence.upload_timestamp`, `tasks.closed_at`, `blockers.raised_at`, `attendance.checked_in_at` (insert) appear in no client INSERT/UPDATE grant; the default or a trigger stamps them. A grant cannot distinguish mentor from student (one `authenticated` role), so **mentor-only columns** (`tasks.evidence_required`) are a `_mentor_only_columns` BEFORE UPDATE trigger, and columns pinning a row to its team/author are `_immutable_columns`.
- **Helpers named inside a `using` clause are granted EXECUTE to `authenticated`** (`is_mentor`, `is_admin_mentor`, `current_mentor_id`, `current_student_id`, `current_student_team_id`). They are SECURITY DEFINER so a policy on `students` can ask which team the caller is on without recursing. Private helpers are `_`-prefixed, revoked from public, and granted to nobody.
- **Every definer function pins `set search_path = ''`** and schema-qualifies every name (`extensions.crypt`, `auth.uid()`). Asserted by the catalog test.
- **No `FORCE ROW LEVEL SECURITY`.** The definer RPCs write as the owner; forcing RLS would break them.
- **Divergence from idea-app, deliberate:** idea-app has zero client write grants; this repo's feature tables accept RLS-governed direct writes (tasks, blockers, evidence, attendance, role assignments, meetings) because the spec calls for it and because a local-first write queue replays idempotent upserts against tables, not RPCs. Auth-sensitive writes (anything touching `auth.users`: student creation, PIN reset, deactivation; team creation, which mints a code) stay behind SECURITY DEFINER RPCs that re-check the caller in their own body.

### RPC shape

`<area>_<verb>_<object>`, SECURITY DEFINER, `set search_path = ''`, `revoke all ... from public`, `grant execute ... to authenticated` (or `to anon, authenticated` for the one public one), returns `jsonb`. `p_*` parameters, `v_*` locals, `%rowtype` captures, `for update` before a state check. Errors: `raise exception '<sentence in the user's own terms, ending in a period.>'` -- no ERRCODE, no table names. A student-facing write takes no identity parameter; the caller is `auth.uid()`.

### Realtime

`meetings`, `meeting_phases`, `tasks`, `blockers`, `attendance` are in `supabase_realtime` with **replica identity full** (mentors hard-delete on the work surface, and a DELETE event with only a key cannot be filtered by `team_id`). Publishing grants no read: RLS is evaluated per subscriber. Adding a table is the idempotent `do $$` block in `0008`; copy it.

### Soft delete

A nullable `timestamptz` per noun -- `mentors.deactivated_at`, `students.deactivated_at`, `teams.archived_at` -- and **the filter is stated where the read is**: the identity helpers (so a deactivated account loses every policy at once), `team_login_roster`, `auth_whoami`, `student_create`. A new read over one of those tables states its own `... is null`. The work surface (tasks, blockers, evidence, attendance) hard-deletes; mentors only. Deactivating a student also bans the auth user and drops its sessions (`student_deactivate`); the stamp alone would leave the PIN working.

### Local-first write queue (not built yet; the schema is shaped for it)

- Every insert grant includes `id`: the device mints the uuid, so a replayed insert is a conflict, not a duplicate, and a queued update already knows its target.
- `updated_at` is server-stamped on every mutable table; clients never send it.
- Natural unique keys make retries upserts: `attendance (meeting_id, student_id)`, `evidence.storage_path`.
- Nothing depends on a server-generated sequence.

---

## Auth

Two populations, one Auth instance. The boundary for both is `0002`'s trigger on `auth.users`; everything in the dashboard is a convenience.

- **Mentors:** Google only, boscotech.edu only. First sign-in inserts the `mentors` row; any other Google domain, or any email-provider account, is refused inside the insert, which aborts GoTrue and the sign-in. The first mentor row is the admin (under an advisory lock). `is_admin` is edited by admins through RLS; `_mentors_guard_update` stops self-demotion, self-deactivation and demoting the last admin.
- **Students:** no real email, no self-registration. `student_create` (mentor-only RPC) writes `auth.users` + `auth.identities` + `students` in one transaction, raising a transaction-local flag (`fll.creating_student`) that the trigger requires for any `@fll.invalid` address. Address = `{join_code lowercased}-{slug}@fll.invalid`; `.invalid` is RFC 2606 reserved. Slug = lowercased first name + last initial in `[a-z0-9]`, deduped per team with a numeric suffix, STORED so a rename never changes a login. PIN = 6 digits (GoTrue's 6-character minimum).
- **PIN reset is SQL:** `student_reset_pin` writes `auth.users.encrypted_password = extensions.crypt(pin, extensions.gen_salt('bf', 10))` and deletes `auth.sessions` for the user. **Proved end to end against GoTrue v2.195** (`tests/student-auth.test.ts`: sign in, reset, old PIN refused, new PIN accepted, old refresh token dead). The admin-API fallback was not needed and does not exist.
- **The login screen** (`/login`): student types the team code -> `team_login_roster` (anon RPC: team id + name + `first_name`/`last_initial`/`slug` per active student, nothing else) -> taps a name -> PIN -> `signInWithPassword` with the address built by `src/lib/auth/student-identity.ts`, which mirrors `public._student_email` and is held to it by `tests/login-roster.test.ts`. Mentors: `signInWithOAuth({ provider: 'google', queryParams: { hd: 'boscotech.edu' } })`.
- **Server side** uses the current `@supabase/ssr` pattern: `src/hooks.server.ts` creates the per-request client, resolves claims with `getClaims()` (retried three times on a genuine error, never on a clean "no session"), resolves the **principal** with one `auth_whoami` call, and guards `authedPrefixes` (`/app`). No claims -> `/login?next=`; claims but no principal (a deactivated account) -> `/auth/error?reason=no-access`. `src/routes/+layout.server.ts` / `+layout.ts` expose `supabase`, `claims`, `principal`; `+layout.svelte` invalidates `supabase:auth` on auth state change.
- **ONE MODULE KNOWS EACH CREDENTIAL.** `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` are read in exactly two places (hooks, root `+layout.ts`). `SUPABASE_SERVICE_ROLE_KEY` has no reader yet; if one is added it is one `$lib/server/*` module read via `$env/dynamic/private`.
- **Probing reveals nothing.** A denied read is an empty result, not an error; a surface a caller may not see answers like one that does not exist.

---

## Testing

- **Vitest against the REAL local stack** (`supabase start`), not an embedded Postgres: the claims here are about GoTrue (a bcrypt hash written from SQL signs in), PostgREST (a column with no grant is refused with 42501) and Realtime, and only those services can confirm them.
- **Layout:** flat `tests/<area>-<concern>.test.ts`, one concern per file; `tests/db/harness.ts` is the only helper. `.env.test` (committed, local defaults only) is loaded by `vitest.config.ts`.
- **Three ways in, use the right one:** `sql` (postgres.js as `postgres`, bypasses RLS -- seeding and catalog assertions only); `asRole`/`asUser` (one transaction with `request.jwt.claims` + `set local role`, for SQLSTATE-level assertions); `signIn` (a real GoTrue session through Kong/PostgREST, for end-to-end proof).
- **Files run serially (`fileParallelism: false`) against one shared database.** Each file seeds its own mentor/teams/students with a run-unique suffix through the REAL RPCs and removes them in `afterAll` via `cleanupRun()`. Keep the flag.
- **Seed helpers go through the real RPCs** (`team_create`, `student_create`), never raw inserts, except `seedMentor`, which performs the exact `auth.users` insert GoTrue performs for a Google sign-in so the trigger is what makes the mentor.
- **Every denial test has a positive control** (the service role sees the row; the same statement as the owner succeeds). Expected codes: `42501` (RLS / privilege), `23P01` (exclusion), `23503` (foreign key), `23514` (check), `23505` (unique).

---

## App conventions

- **Svelte 5 runes** (`$props`, `$state`, `$derived`); forced on for project files in `vite.config.ts`.
- **Server-only code lives in `$lib/server/*`** (none yet). SvelteKit refuses to bundle it client-side, which is what makes it a boundary.
- **`src/lib/auth/student-identity.ts` is pure** and mirrors the database; change the address or slug rule in `0004`'s `_student_email`/`_student_slug_base` and here in the same bundle, and the mirror test holds them together.
- **Generated types** (`src/lib/supabase/database.types.ts`) are regenerated after every migration bundle and committed.
- **Sign-out is a POST** (`/auth/signout`); never a GET a prefetch could fire.

---

## Visual theme

The token layer is `src/lib/design-system/` (pure CSS custom properties: `fonts`, `colors`, `typography`, `effects`, `motion`, entered through `index.css`), imported once by `src/app.css`, which holds the shared classes (`.card`, `.btn`, `.field`, `.input`, `.tile`, text roles). **Do not invent colours or name a font face as a literal**; design against the tokens.

- Dark by default (tablets in a lit room; bioluminescence on deep water). `--glow-green` is the primary action and "live"; `--glow-cyan` is links and focus; `--glow-violet` is the mentor register; `--amber` is blocked/attention; `--coral` is errors only.
- `--boundary` carries meaning and clears 3:1 on every ground; `--hairline` decorates. Do not raise `--hairline`.
- Touch targets are 44px minimum (`.btn`, `.tile`, `.input`); body text never below 17px. The users are nine.
- Everything animated is gated behind `prefers-reduced-motion: no-preference` (`motion.css`: the classes are the gate).

---

## Keeping the documentation current

- **A shipped bundle appends its record to `docs/HISTORY.md`**, at the end: what changed, the load-bearing decisions and why, what was measured, what is explicitly NOT verified, what was deferred.
- **Something is promoted into `CLAUDE.md` only when it changes how a FUTURE UNRELATED task should be done.** When a rule here changes, edit it in place and put the reasoning in the history entry; never two versions of one rule.
- **Commit subjects are plain changelog copy.** Commit and push every session to `main`; do not leave work uncommitted and do not create branches.
