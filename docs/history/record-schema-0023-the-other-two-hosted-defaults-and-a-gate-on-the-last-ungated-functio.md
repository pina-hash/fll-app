---
title: "2026-08-25 -- Schema 0023: the other two hosted defaults, and a gate on the last ungated function"
date: 2026-08-25
branches: []
migrations: ["0023"]
subsystems: ["Foundation, auth, schema"]
record_order: 17
---

The two things 0021 and 0022 each wrote down and did not do.

### What the defaults actually differed by

Measured on both environments before anything changed. `pg_default_acl` in
`public`, grantor `postgres`, which is the row that governs because
migrations connect as `postgres`:

    TABLES     linked  anon=arwdDxtm   authenticated=arwdDxtm
               local   anon=Dxtm       authenticated=Dxtm
               difference: a, r, w, d -- INSERT, SELECT, UPDATE, DELETE

    SEQUENCES  linked  anon=rwU        authenticated=rwU
               local   anon=w          authenticated=w
               difference: r, U -- SELECT and USAGE

Both keep `Dxtm` on tables (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN), which
is the "nothing useful by default" CLAUDE.md has always described. The
`supabase_admin` rows are IDENTICAL on both sides and were left alone.

**Nothing was leaking.** `anon` held no table privilege on either
environment, and `authenticated` held SELECT and DELETE across the same 28
tables on both. There are ZERO sequences in `public`, so that half governs
nothing that exists. The convention worked; every table in the chain states
its own revoke and every table had done it.

### Why it changed anyway

A convention holds until somebody forgets, and the forgotten case is
invisible: the migration is silent about grants it did not write, and until
0022 the suite only ever looked at local. Proved on PRODUCTION, both
directions, in a self-undoing `do` block that raised its result so nothing
committed:

    with 0023 ................ postgres=arwdDxtm | service_role=arwdDxtm
    hosted default restored .. postgres=arwdDxtm | anon=arwdDxtm |
                               authenticated=arwdDxtm | service_role=arwdDxtm

The same table, forgotten the same way, is owner-only under 0023 and fully
readable and writable by `anon` without it. Confirmed afterwards that no
probe table was left behind and the default was unchanged.

`revoke all` rather than "match local", because local's remaining `D` is
TRUNCATE, which no RLS policy governs. Not reachable through PostgREST, which
is how local got away with it, but "not reachable through the API we happen
to use" is weaker than "not granted". The chain needs none of these defaults.
Because the file is in the chain it applies to both environments, so they
converge instead of drifting further apart. `service_role` is untouched, as
in 0021 and 0022.

ALTER DEFAULT PRIVILEGES governs objects created after it and nothing else,
so this could not affect an existing row, table or grant. The guard asserts
that anyway, plus that `authenticated` can still SELECT at least 20 tables,
which would catch a later edit turning one of those statements into a real
sweep.

### The gate on team_accent_options

**A signed-in mentor or a signed-in student.** It was the only SECURITY
DEFINER function in `public` with no caller check, direct or delegated.

Ruled out in order: **mentor only** is wrong, because `AccentPicker.svelte`
is on the student's own /me/team screen and a Run Captain proposes the
colour; **the caller's team** is meaningless, because `teams.accent` is
unique across live teams by partial index, so "which colours are taken" is
inherently a question about the OTHER teams and a team-scoped answer would
always say "nothing is taken"; **nobody** is already true for `anon`, which
lost EXECUTE in 0021, and this is the second line of defence beneath that.

Board devices are excluded deliberately: `current_student_id()` reads
`students` and a board lives in `team_board_devices`, so it answers NULL and
the gate refuses. That is CLAUDE.md's existing rule that a board is a device
and not a person. There is no board caller; the two callers are the mentor
team page and the student /me/team page.

It raises rather than returning `[]`. "Probing reveals nothing" governs the
anon doors, where an empty answer is what stops a stranger learning whether
something exists; every caller that now reaches this function is signed in,
and an empty palette on a colour picker reads as a broken screen.
`board_live_summary` is the precedent for a signed-in caller of the wrong
kind. The function moved from `language sql` to `plpgsql`, which
`create or replace` allows because the signature and return type are
unchanged, so the signature trap does not apply.

### Measured

- Linked project after 0023: table default `postgres=arwdDxtm |
  service_role=arwdDxtm`, sequence default `postgres=rwU | service_role=rwU`.
  Neither API role appears in either.
- The three new remote assertions were run BEFORE the push and failed on
  exactly the three things 0023 fixes (table default, the gate, the ledger),
  while the sequence assertion correctly passed. That is the control that
  they bite.
- **Permissive mutation, the gate:** 0018's ungated definition was restored
  on local and `tests/board-device.test.ts` reddened with
  `expected undefined to be 'Only a mentor or a team member ...'`, which is
  the board reading the palette. Restored with `db reset` and confirmed
  byte-identical: `md5(pg_get_functiondef(...))` is
  `bb3fca7938c6a4a1b2ed486c1ca575a8` before and after.
- Live on production with the real anon key: `team_accent_options` still
  `42501` from 0021; positive control `team_size_cap` still returns 6.
- Live on local, both halves of the gate: a board is refused by name, a
  mentor gets 11 options, a student gets 11 options.
- `npx svelte-check`: **0 errors, 0 warnings, 683 files.**
- Full suite: **41 files, 562 tests, all passing.**

### Not verified

- **The gate was not exercised by a signed-in caller against the linked
  project.** Production has one mentor (Google OAuth) and zero students, so
  there is no session to sign in with. The remote assertion is from the
  catalog (the body carries the check and is still DEFINER); the live
  both-directions proof is on local against real GoTrue sessions.
- **`supabase_admin`'s defaults are untouched** on both environments. They
  are identical on both sides, this chain creates nothing as that role, and
  changing a platform role's defaults is not this file's business.

### Deferred

- Nothing from 0021 or 0022 is still open. The three hosted defaults that
  matter to this chain are closed for both API roles.

