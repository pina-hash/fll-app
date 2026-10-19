---
title: "CLAUDE.md cut from 13,685 to 2,874 words (wc -w); every moved paragraph lives verbatim in docs/subsystems/ (docs only, no migration)"
date: 2026-10-19
branches: [main]
migrations: []
subsystems: ["Documentation"]
---

### What changed

One solo session, ledger entry 0007, pushed to `main`. Mr. Pina asked for this repo's
`CLAUDE.md` to come in under 3,000 words, with every paragraph moved verbatim into linked
`docs/subsystems/` files and the migration rule and standing rules kept in place. The
same was done to frc-app's `CLAUDE.md` the same day.

Whole sections moved, headings included, into 13 files under `docs/subsystems/`:
`build-phases`, `tooling` (the measured `pure`/`db` suite split, the visual pass and
status commands, the `--repo` note, and the branches standing at the 2026-09-02
cutover), `machine-and-toolchain`, `testing`, `database` (every Migrations bullet after
the first two, then RLS and grants, RPC shape, Realtime, soft delete), `write-queue`,
`auth`, `app-conventions`, `visual-theme`, `skill-hub-content`, `code-generator`,
`field-picture` and `first-branding`. `CLAUDE.md` keeps one linked line for each.

### What stayed in CLAUDE.md, deliberately

Writing (the dash rule), What this is, the Commands block, Supabase CLI credentials,
Branches (all but the 2026-09-02 standing-branch inventory), History, the Verification
standard, and the whole apply path at the top of Database conventions: delivered by
`supabase db push` or not delivered, a migration and its test in one commit, the landing
script, what `deploy.yml`'s typed confirmation means, plus the first two Migrations
bullets (CLI-applied, never pasted; an immutable applied record).

### Added, and rewritten

One new bullet under History: `CLAUDE.md` stays under 3,000 words, a subsystem's rules
live in its `docs/subsystems/` file, and a new subsystem gets a file and a line.

The "Last reviewed" paragraph was replaced. Its original text:

**Last reviewed 2026-09-02**, by the bundle that brought this repo into
conformance with the IDEA repo workflow standard's section 2: CI, the
integrate and deploy workflows, the history split, `docs/decisions/`, the
prompt ledger and the browser harness.

### How the move was proved

`tools/claude-md-coverage.mjs` (new, kept, identical to frc-app's copy) splits the old
`CLAUDE.md` into units (a bullet with its continuation lines, a numbered item, a table
row, a heading, a code line, or a run of prose lines) and requires each one as an exact
substring of the new `CLAUDE.md`, `docs/subsystems/`, or a file named with `--also`. Its
positive controls run every time: every unit must be found in its own source, and a unit
with a sentinel appended must not be found. Without this file as `--also` it reports
exactly one unit missing, the replaced "Last reviewed" paragraph; with it, every unit is
found. The count is in the commit message. Re-run with:

    node tools/claude-md-coverage.mjs --old 09ca3be:CLAUDE.md --also docs/history/claude-md-split-fll.md

Comments in `.github/workflows/` and `docs/history/_tools/` that cite "CLAUDE.md" for a
rule now point at text that may live in a linked `docs/subsystems/` file. They were left
as they are; the rule text is unchanged.

### Not verified

No code, SQL or workflow changed, so the db suite was not run (it needs a local Supabase
stack this container does not have). `npm run test:pure`, `npm run check` and
`npm run history:verify` were run; their numbers are in the commit message.
