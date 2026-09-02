---
title: "2026-08-25 -- The ledger disagreed with the database: 0019 and 0020 repaired"
date: 2026-08-25
branches: []
migrations: []
subsystems: ["Foundation, auth, schema"]
record_order: 15
---

`migration list --linked` reported 0019 and 0020 as unapplied against a
production database that provably had `student_claim_codes`, which only
0019 creates. The suspicion going in was a wrong-project link: a bare
`supabase` command falls through to the machine's global login, which is
ambient state shared with `idea-app` and `frc-app` and is silently
re-pointed by a `supabase login` run in either of them.

That suspicion was wrong, on three counts. `supabase/.temp/linked-project.json`
already named `ypusbfatsmoukvlfgrqf`; the `.env` token resolved to the same
project and showed it `linked: true`; and running `migration list --linked`
with that token explicitly pinned still reported 0019 and 0020 as unapplied.
The link and the credential were both correct.

What was actually wrong: production held the 0019 and 0020 SCHEMA but not
the 0019 and 0020 LEDGER ROWS. Verified against the schema itself before
touching anything: `student_claim_codes` and all 19 of 0019's functions
present; 0013's `student_self_enroll`, `team_join_open` and the two
`teams.join_open_*` columns correctly gone; `meetings.cancelled_at` and
`notebook_entries.deleted_at` present; and the IN-PLACE rewrites had landed
too, which object existence alone would not have caught -- `_students_team_cap`
counts `student_claim_codes`, `_resolve_current_meeting_id` filters
`cancelled_at`, and the notebook read policy filters `deleted_at`. The SQL
had reached production by a path that writes no ledger row (the dashboard
SQL editor or a direct execute), not `supabase db push`, and two later
bundles had then asserted "production remains at 0020" from that state
without re-checking.

Repaired with `supabase migration repair --status applied 0019 0020`, which
writes only the two ledger rows and no DDL. `migration list --linked`
afterward showed a remote version on all 20 rows through 0020.

The session also tested the credential rule itself, since it exists
precisely to prevent a wrong-project problem and had not caught this one.
It fires correctly: a bogus token is refused rather than silently falling
through, and the documented WSL wrapper resolves the same project end to
end. It had nothing to catch here, because this was a wrong LEDGER, not a
wrong ACCOUNT -- the rule's blind spot is that the global fallthrough on
this machine happens to point at the same org today, so the failure mode it
guards against is latent rather than exercised.

### Measured

- `supabase/.temp/project-ref` and `linked-project.json`: `ypusbfatsmoukvlfgrqf`.
- The `.env` token's project list: exactly two projects, `sparc-hq` and
  `fll-app`, one org.
- `migration list --linked`, before repair: 0001-0018 with a remote version,
  0019 and 0020 with an empty one, WITH the token pinned.
- `migration list --linked`, after repair: a remote version on all 20 rows.
- The bare-command fallthrough (`env -u SUPABASE_ACCESS_TOKEN`) currently
  resolves to the same org as `.env`, so it could not be used to demonstrate
  the failure the credential rule guards against on this machine.

### Not verified

- **Why the SQL reached production outside `db push` in the first place** is
  inferred from HISTORY's own record (the bundle that shipped 0019 and 0020
  was authored in a checkout with no `.env` and explicitly deferred the
  push), not directly observed. The repeat of the same failure on 0021 in
  the very next bundle shows the cause was not fixed by writing this down
  once; see the standing rule this incident earned in CLAUDE.md.

