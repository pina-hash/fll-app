# fll-app engineering history

The per-bundle record: what each migration and code-only bundle changed, why it
was built that way, what was measured, and what was deliberately left undone.

**`CLAUDE.md` is authoritative for how to work in this repo. This file is the
record of how those rules came to exist.** If the two ever appear to disagree,
`CLAUDE.md` wins and this file is the dated account of an earlier state.
Entries are dated accounts of what shipped and are not edited to match later
changes.

## When to read this file

When you need the REASON behind a rule in `CLAUDE.md`, or are diagnosing a
subsystem and want to know what was measured when it shipped. Do not read it
end to end; jump by migration number.

## How to append

A shipped bundle appends a new `##` section at the END, following the shape
below: what changed, the load-bearing decisions and why, what was measured,
what is explicitly NOT verified, and what was deferred. Add its row to the
migration index. Promote a line into `CLAUDE.md` only if it changes how a
future unrelated task should be done.

## Migration index

| File | Bundle |
| --- | --- |
| `0001_foundation_types_helpers.sql` | 2026-08-22 foundation |
| `0002_mentors.sql` | 2026-08-22 foundation |
| `0003_teams.sql` | 2026-08-22 foundation |
| `0004_students.sql` | 2026-08-22 foundation |
| `0005_role_assignments.sql` | 2026-08-22 foundation |
| `0006_meetings.sql` | 2026-08-22 foundation |
| `0007_tasks_blockers_evidence.sql` | 2026-08-22 foundation |
| `0008_realtime.sql` | 2026-08-22 foundation |

---

## 2026-08-22 -- Foundation: scaffold, schema 0001-0008, RLS, both auth paths

### What changed

A new repository, modelled on `pina-hash/idea-app`'s conventions (migration
shape, SECURITY DEFINER RPC shape, realtime publication block, soft-delete
stamps, flat test layout, CSS-token design system) with none of its schema or
business logic. Eight migrations, a local-only seed, a vitest suite of 90 tests
against the real local stack, and the smallest app that exercises both sign-in
paths: `/login`, `/auth/callback`, `/auth/error`, `/auth/signout`, and a
placeholder `/app` shell.

### Load-bearing decisions

- **One Auth instance, two populations, one trigger.** `0002`'s
  `handle_new_auth_user` on `auth.users` is the gate for everyone: Google +
  boscotech.edu becomes a mentor (first one is admin, under an advisory lock);
  `@fll.invalid` is accepted only while `student_create` has raised a
  transaction-local GUC (`fll.creating_student`); everything else raises,
  which aborts GoTrue's insert and therefore the sign-in. Both the SQL path
  (the exact insert GoTrue performs) and the GoTrue paths (public sign-up,
  admin `createUser`) are tested.
- **Student creation and PIN reset are SQL.** `student_create` writes
  `auth.users` (every token column `''`, not NULL -- GoTrue scans them into
  Go strings), `auth.identities`, and `students` in one transaction.
  `student_reset_pin` writes `encrypted_password = extensions.crypt(pin,
  extensions.gen_salt('bf', 10))` (cost 10 to match GoTrue's own) and deletes
  `auth.sessions` for the user. **Both were proved end to end against GoTrue
  v2.195 on the local stack**: sign in with the PIN, reset as a mentor, old
  PIN refused, new PIN accepted, the pre-reset refresh token dead. The
  admin-API fallback the spec allowed for was therefore not built.
- **The slug is stored, not derived.** `students.slug` is computed once by
  `student_create` (`_student_slug_base` + numeric dedupe under a `for update`
  lock on the team row) so a later rename never changes a login. The client
  mirror (`src/lib/auth/student-identity.ts`) is held to
  `public._student_email` by `tests/login-roster.test.ts`.
- **The join code is permanent.** It is half of every student address on the
  team, so `teams.join_code` has no client UPDATE grant and no rotation RPC.
  Rotation would be a new bundle that re-mints every address.
- **The team boundary is a composite foreign key before it is a policy.**
  `students (id, team_id)` is unique and every student reference on
  `role_assignments`, `tasks`, `blockers`, `evidence` is `(student_id,
  team_id)` against it; `evidence (task_id, team_id)` and `blockers (task_id,
  team_id)` do the same against `tasks (id, team_id)`. Cross-team rows are
  impossible regardless of policy.
- **Column-level grants are how "server-owned" is enforced for every client.**
  `evidence.upload_timestamp` (the spec's explicit requirement),
  `tasks.closed_at`/`created_at`, `blockers.raised_at`,
  `attendance.checked_in_at` (insert) appear in no client INSERT/UPDATE grant.
  Tested through PostgREST for a student AND a mentor, through SQL as
  `authenticated`, and against the catalog.
- **Mentor-only columns are a trigger**, because one `authenticated` role
  cannot carry two grant sets: `_mentor_only_columns('evidence_required')` on
  `tasks`. `_immutable_columns` pins team/author columns on tasks and blockers.
- **One holder per (team, role, tier) is an exclusion constraint** over
  `daterange(effective_from, effective_to, '[)')` with btree_gist, plus a
  second constraint so one student cannot hold both tiers of a role at once.
- **Meetings are shared, not per team**, readable by every signed-in user,
  written by mentors. `meetings.current_phase_id` is a composite foreign key
  `(current_phase_id, id) -> meeting_phases (id, meeting_id)` with
  `on delete set null (current_phase_id)` (Postgres 15+), so the live pointer
  can never name another meeting's phase. `phase_templates` + `meeting_create`
  stamp the Friday (90) / Saturday (120) phases.
- **Realtime: five tables, replica identity full.** Mentors hard-delete on the
  work surface and a DELETE event with only a key cannot be filtered by
  `team_id`. The publication block is idempotent on both axes (copied shape).
- **RLS-governed direct writes on feature tables** -- a deliberate divergence
  from idea-app's "zero client write grants". The spec defines team-scoped
  read AND write policies, and a local-first write queue replays idempotent
  upserts against tables (client-minted `id` in every insert grant,
  server-stamped `updated_at`, natural unique keys). Auth-sensitive writes
  stay behind definer RPCs.
- **`check_function_bodies = off` around 0001's helpers.** SQL-language
  bodies are validated at creation and the tables they read arrive in
  0002/0004, while 0003's policies already need `current_student_team_id()`.
  Switched off for that section, `reset` after it.
- **Explicit `service_role` grants on every table.** The supabase/postgres
  17.6.1.159 image's default ACL for `postgres`-owned tables in `public`
  gives the three API roles only TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. The
  first test run reddened on every service-role positive control; the fix is
  a stated grant per table rather than a reliance on defaults.
- **`team_login_roster` returns the team id.** The spec asks for "team id,
  team name, roster" and for "no ids that grant access"; a team id grants
  nothing (every read of team data is RLS on the signed-in identity), so it
  is returned and the student/auth ids, PIN and grade are not. Asserted by
  key-set in `tests/login-roster.test.ts`.

### What was measured

- `supabase db reset` applies 0001-0008 + `seed.sql` cleanly on the local
  stack (Postgres 17.6, GoTrue 2.195, PostgREST 16.1, Realtime 2.129,
  storage-api 1.69). Seed result: one admin mentor (`is_admin = true` via
  the trigger), four teams with valid codes, templates summing to 90 / 120.
- `npx vitest run`: 9 files, **90 tests, 90 passed**, ~8 s.
- **Mutation proof:** `0007`'s "students read their own team tasks" policy
  flipped to `using (true)`, `db reset`, `tests/team-isolation.test.ts`:
  3 failed (list, by-id, SQL path) / 17 passed. File restored
  (md5-identical), reset, 20 / 20.
- `npx svelte-check`: 0 errors, 0 warnings.
- `npm run build` on Linux (WSL, Node 22): `.vercel/output` produced
  (`index.func`, `app.func`, `login.func`, static). On Windows the adapter
  fails creating a symlink (`EPERM`) after Vite succeeds -- pre-existing
  adapter behaviour, recorded as a trap.

### What is explicitly NOT verified

- **A real Google sign-in.** The trigger's Google branch is tested with the
  exact `auth.users` row GoTrue writes for an OAuth sign-up, and the refusal
  branch through GoTrue's public and admin endpoints; the browser redirect
  round trip against the dashboard's Google provider is not automated.
- **Realtime delivery.** Publication membership and replica identity are
  asserted in the catalog; no test subscribes to a channel and receives a
  phase-change event.
- **Storage uploads.** The bucket and the four `storage.objects` policies are
  created and asserted present; no test uploads an object.
- **Slug dedupe under true concurrency.** The `for update` on the team row is
  the serialisation; the test covers sequential duplicates only.
- **The "first mentor is admin" rule on an empty table** is shown on the seed
  row (created by the trigger) and by later mentors not being admin; it is
  not re-run on an emptied `mentors` table because every later table
  references mentors.

### Deferred

- Join-code rotation (re-mints every student address on the team).
- A rate limit on `team_login_roster` (32^6 codes; PostgREST has none).
- The local-first write queue itself, and a phase-transition RPC that stamps
  `meeting_phases.started_at`/`ended_at` alongside `current_phase_id` (today a
  mentor updates the pointer directly through RLS).
- Student reads of mentor display names (a "resolved by" label): students
  currently cannot read `mentors` at all.
