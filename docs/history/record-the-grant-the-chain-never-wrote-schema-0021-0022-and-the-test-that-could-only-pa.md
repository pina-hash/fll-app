---
title: "2026-08-25 -- The grant the chain never wrote: schema 0021-0022, and the test that could only pass"
date: 2026-08-25
branches: []
migrations: ["0021", "0022"]
subsystems: ["Foundation, auth, schema", "Build, tests, conventions"]
record_order: 16
---

The linked project granted `anon` EXECUTE on all 85 functions in `public`.
The local stack granted 5. Nothing in `supabase/` asked for either number,
`tests/schema-catalog.test.ts` had asserted the correct 5 since 0013, and it
had been green the whole time.

### What was actually wrong

- **A hosted Supabase project carries `ALTER DEFAULT PRIVILEGES` the local
  CLI image does not.** Measured, same query both sides, `pg_default_acl`
  objtype `f`, grantor `postgres`: local `postgres=X/postgres`; linked
  `postgres=X/postgres | anon=X/postgres | authenticated=X/postgres |
  service_role=X/postgres`. Migrations connect as `postgres`, so on the
  linked project every `create function` in this chain acquired an explicit
  `anon=X` at creation. `grep -rn "default privileges" supabase/` is empty:
  this was never ours.
- **The per-RPC `revoke all ... from public` could not have caught it.** That
  removes PUBLIC's implicit grant; the default is an explicit grant to a
  named role. Both statements are correct and neither was going to see the
  other. Tables escaped only because the table convention states
  `revoke all ... from anon, authenticated` BY NAME; functions had no
  equivalent line.
- **The test could only pass.** It ran against local, the one environment
  where the bug cannot occur.

### What was actually reachable, which is not the same as what was granted

Probed against the linked project with its real anon key, writers driven with
nonexistent uuids so a fall-through could not touch real data. Team rows and
counts were byte-identical before and after.

- **Every writer refused**: `team_create`, `student_create`,
  `student_reset_pin`, `team_regenerate_join_code`, `meeting_cancel`,
  `team_archive`, `team_claim_codes_issue`, `team_set_short_name`,
  `team_confirm_accent`, `strategy_snapshot`, `notebook_entry_delete`. Two
  independent mechanisms, neither of them the function grant: every DEFINER
  RPC re-checks its caller, and `is_mentor()` is `select exists (...)`, which
  cannot return NULL, so the bare `if not public.is_mentor()` in 0003 and
  0004 fires rather than falling through the way CLAUDE.md warns a
  NULL-returning gate does. The private `_` helpers are SECURITY INVOKER, so
  they ran AS anon and died on the table grants this chain does state.
- **What answered**: `team_accent_options` (the only DEFINER function in
  `public` with no caller check, direct or delegated) and four pure helpers,
  `_student_email`, `_student_slug_base`, `_generate_claim_code`,
  `_generate_join_code`. Nothing stored was disclosed: the helpers compute,
  and `team_accent_options`'s `taken_by` fields are null until a team picks a
  colour. `_student_email` leaks nothing an attacker could not already
  compute, because that rule is mirrored in `src/lib/auth/student-identity.ts`,
  which ships to every browser.
- So the exposure was one read of not-yet-populated data and four pieces of
  derivable arithmetic. Written down at this length because the honest
  finding is narrower than "85 functions were exposed", and the next person
  reading the migration header deserves the real number.

### 0021, anon

Revokes EXECUTE from `anon` across `public`, hands back exactly the five
doors, and neutralises the `postgres` default so the next migration does not
re-open it. Refuses if any of the five is missing beforehand (the sweep would
otherwise lock out the login screen or the parent link), and refuses again if
anon can execute anything but those five afterwards.

### 0022, authenticated: benign, and changed anyway

The same default over-granted 29 functions to `authenticated`: 14 trigger
functions (PostgREST will not call one outside a trigger), 14 SECURITY
INVOKER helpers, and one DEFINER, `student_claim_seat`, already a deliberate
`anon` door. **Not an exposure**, measured rather than argued. Worst
candidate is `_student_detach_from_team`: any student id, no caller check,
deletes role assignments. Reproduced on a seeded local stack with the
over-grant replicated, signed in as one student against a teammate:

    Maya deletes Diego's role_assignments directly ...... 0 rows
    Maya nulls Diego's task assignments directly ........ 0 rows
    the same delete as the table owner .................. 2 rows
    current_student_id() = Maya, is_mentor() = false

The third line is the positive control that makes the zeroes mean refusal
rather than an empty table; the fourth is the negative control that the
session was really a student. `role_assignments` carries one DELETE policy
and its qual is `is_mentor()`. The function then dies on
`permission denied for table match_runs`.

Changed regardless, for two reasons that are not "it might be exploitable":
the catalog test asserts underscore helpers are executable by nobody, and
against the linked project that assertion FAILED on all 26; and the default
was still open, so the next private helper somebody writes, which in this
schema is as likely as not to be SECURITY DEFINER, would arrive callable by
every signed-in student. 0022 revokes by name over the underscore prefix
only (never `revoke ... on all functions`, which would strip the 56 public
RPCs and take the console down), closes the `authenticated` default, and
asserts both that 0 helpers are open AND that 4 sampled public RPCs survive.

Proved safe before revoking: no column DEFAULT, RLS policy or CHECK
constraint on the linked project names a `public._` function, so nothing
evaluates one as the calling role.

### The test

`tests/db/linked.ts` reads the linked project's catalog through the
Management API (needs only `SUPABASE_ACCESS_TOKEN`, no database password) and
`tests/schema-catalog.test.ts` now asserts the five doors, the closed private
helpers, anon's absent table privileges, the neutralised default and the
applied ledger against production as well as local.

- **It reads `.env` BEFORE `process.env`, which is the opposite of the usual
  order.** This machine's shell carries a token for the account idea-app and
  frc-app use. Environment-first failed with a Management API 403. A 403 is
  the lucky outcome: another account that owned a project of its own would
  answer 200 and the suite would assert the grants of a database nobody here
  runs.
- **It skips LOUDLY via `process.stderr.write`, not `console.warn`.** Vitest
  intercepts `console.*`; the first version warned into the void and the run
  printed a bare "5 skipped", which is precisely the silent pass the whole
  arrangement exists to end.

### Measured

- Linked project, real anon key, after 0021: all five doors execute
  (`team_size_cap` 6; `team_login_roster` returns Team 1 and its join code;
  `student_claim_seat` gives its own "That seat code does not work"
  refusal, which is proof it RAN). Negative control, ten previously reachable
  functions, all `42501`: `team_accent_options`, `_student_email`,
  `_student_slug_base`, `_generate_claim_code`, `_generate_join_code`,
  `is_mentor`, `auth_whoami`, `team_create`, `team_claim_codes`,
  `strategy_can_edit`.
- Linked project after both: anon executes **5 of 85**, 0 private helpers
  open to anon or authenticated, `postgres` function default names neither
  role.
- The new remote assertions were run BEFORE 0022 was pushed and **failed on
  exactly the three things 0022 fixes** while passing the two 0021 fixed.
  That is the control that they bite.
- The loud-skip path was exercised by hiding `supabase/.temp/project-ref`:
  banner printed, 5 skipped, run still green.
- `supabase db reset` rebuilds 0001-0022 clean, guards and all.
- `tests/schema-catalog.test.ts`: **19 passed.**

### Not verified

- **0021 and 0022 were each applied to production outside the chain before
  the ledger knew about them**, exactly as 0019 and 0020 had been. Both were
  confirmed by their end state and repaired with
  `migration repair --status applied`. The habit, not the schema, is the
  thing still unfixed here.
- **The `authenticated` grant on the 14 trigger functions and on
  `student_claim_seat` is left standing** on the linked project. Neither is
  reachable in a way that matters and 0022 restores a rule about underscore
  helpers, not a full grant-for-grant reconciliation with local.

### Deferred

- **The table and sequence hosted defaults are untouched.** `anon` holds no
  table privilege today, because every table in this chain states its own
  revoke. A future table whose author forgets that line is world-readable on
  the linked project and correct on local: the same bug in a different hat.
  0021 section 5 records the measurement.
- **`team_accent_options` still has no caller check.** It is now
  `authenticated`-only and reveals which team took which colour, which
  teammates can see anyway. It should probably still gate.

