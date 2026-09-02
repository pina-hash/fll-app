---
title: "2026-08-23 -- Pin the Supabase CLI credential to `.env` (docs only)"
date: 2026-08-23
branches: []
migrations: []
subsystems: ["Foundation, auth, schema", "Build, tests, conventions"]
record_order: 2
---

### What changed

- `CLAUDE.md` gains **### Supabase CLI credentials** between the commands
  fence and **### Machine and toolchain**: never run a bare `supabase`
  command in this repo; read `SUPABASE_ACCESS_TOKEN` from `.env` into the
  environment of that one command.
- No code, no schema, no migration.

### Load-bearing decisions

- **The rule is a pin against drift, not a fix for a live mismatch.** See the
  measurement below: as of today the global CLI login and `.env` resolve to
  the *same* account. The rule earns its place anyway, because the global
  login is ambient machine state -- Windows Credential Manager, shared by
  every repo, rewritten by any `supabase login` run in `idea-app`, `frc-app`,
  or anywhere else. A bare command reads whatever that happens to be at the
  moment, with no prompt and no error. Making the credential a property of
  the repo removes the whole class of question.
- **Per-command, not `export` in a shell profile.** A profile export is the
  same ambient-state failure with a different owner: it leaks into sibling
  repos and outlives the session that set it. Prefixing the one command keeps
  the blast radius to the command.
- **Set it for local commands too**, even though `start`/`db reset`/
  `migration up`/`gen types --local` never reach the hosted API. Two habits
  means eventually reaching for the wrong one on the command that matters.

### What was measured

All from `C:\fll-app-sk` on 2026-08-23.

- **`.env` is gitignored and untracked.** `git check-ignore -v .env` ->
  `.gitignore:16:.env`. `git ls-files` lists only `.env.example` and
  `.env.test` (both deliberately allowlisted by `!` rules).
- **The CLI honours `SUPABASE_ACCESS_TOKEN`** -- proved with a negative
  control, not assumed: a syntactically valid but bogus `sbp_000...` token
  returns `LegacyProjectsListUnexpectedStatusError ... "Unauthorized"`, so the
  variable is load-bearing and the real run below is not the global login in
  disguise.
- **`supabase projects list` with the `.env` token** returns four projects,
  all in org `avkkuocbjpehyyxmnzhq` ("pina-hash's Org"): `sparc-hq`
  (ACTIVE_HEALTHY), `fll-app` (ACTIVE_HEALTHY), `logbook` (INACTIVE),
  `idea-app` (INACTIVE).
- **THE PREMISE THIS BUNDLE STARTED FROM IS WRONG, and the record should say
  so.** The same command with the variable unset (`env -u`) returns a
  byte-equivalent project list, and `supabase orgs list` returns the same
  single org either way. The machine's global CLI login is **not** a different
  account from this repo's `.env` token -- today they are the same account,
  which owns exactly one org.
- **What is separate is the PROJECT, not the account.** `fll-app`
  (`ypusbfatsmoukvlfgrqf`) and `idea-app` (`ajhlxbkctsqnrbbqtyrt`) are
  distinct projects inside one org. `CLAUDE.md`'s "its own project, separate
  from idea-app's" is accurate as written and was not changed.
- **The project-limit worry is real but differently shaped.** It is a
  same-org active-project cap, not a wrong-account cap: two of the four
  projects are ACTIVE_HEALTHY and two are paused. Unpausing `idea-app` or
  `logbook` is the operation that would hit it -- and it would hit it with
  either credential.
- **The documented snippet was run verbatim** after the edit, copy-pasted out
  of `CLAUDE.md`, and returned the project list. An earlier draft of that line
  had its `\r\n` collapsed into real newlines by the writing tool; the
  verbatim run is what caught it.
- `CLAUDE.md` re-checked as LF-only (0 CR bytes) per the repo's line-ending
  rule.

### What is explicitly NOT verified

- **That the two credentials are the same token**, as opposed to two tokens
  on one account. The global login is in Windows Credential Manager, not a
  readable `~/.supabase/access-token` file (that directory holds only
  `telemetry.json` and `traces/`), and it was not extracted -- identity was
  compared through the API's answers instead.
- **That the accounts will stay the same.** This is precisely what the rule
  defends against and precisely what a one-time measurement cannot promise.
- **`db push` / `link` under the rule.** Only the read-only `projects list`
  and `orgs list` were exercised. The repo is not currently linked
  (`supabase/.temp` holds no `project-ref`, which is why every run above also
  printed "Cannot find project ref").

### Deferred

- A wrapper script (e.g. `scripts/supabase.sh`) that sources `.env` and execs
  the CLI, so the rule is enforced by tooling instead of by habit. Not written
  because the WSL indirection already means each call is a script, and a
  second wrapper layer would have to agree with it.
- Re-linking the repo (`supabase link --project-ref ypusbfatsmoukvlfgrqf`)
  under the rule; out of scope for a documentation bundle.
---

