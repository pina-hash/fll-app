# 0001 Bring fll-app into conformance with the IDEA repo workflow standard, section 2
- Issued: 2026-09-02 09:00 UTC
- By: claude.ai chat "FLL app feature requests and improvements", conformance lane
- Owns: `.github/workflows/**`, `docs/**` (including the split of `docs/HISTORY.md`), `tools/**`, `tests/db/**` (new, if you create it), `CLAUDE.md`, `package.json` (scripts and devDependencies only), `vitest.config.ts`, and `README.md`
- Migration permitted: no. Highest on origin/main at issue: 0025
- Status: pushed
- Branch: claude/idea-standard-conformance-y51l0n
- Notes: The first prompt recorded in this repo's ledger, and the prompt that creates
  the directory it is recorded in. It adds CI (`ci.yml`), the integrate sweep
  (`integrate.yml`, copied from idea-app) and a deploy workflow; splits
  `docs/HISTORY.md` into `docs/history/<slug>.md` with idea-app's verify tooling;
  creates `docs/decisions/` with three open entries; ports the browser-verify
  harness; and reorders `CLAUDE.md` into the standard's sections without deleting
  a rule.

  Deliberately excluded: `src/**`, `supabase/migrations/**` and
  `scripts/land-migration.sh` (which lives on
  `claude/merge-branches-migration-script-0w3t1u`, unmerged). The build-manual
  door (nav entry, redirect, student link) is a separate lane. The four standing
  `claude/**` branches are not merged, rebased or deleted.
