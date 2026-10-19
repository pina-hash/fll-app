# Tooling, the test split and standing branches

Moved verbatim from `CLAUDE.md` (Commands; Branches) on 2026-10-19, so `CLAUDE.md` stays under 3,000 words. `CLAUDE.md` links here; keep this file current in the same change as anything it describes.

**THE SUITE IS TWO PROJECTS AND THE SPLIT WAS MEASURED, NOT REASONED.** Run at
0f2e3fa with nothing listening on 54321/54322: **16 files passed in full and
32 failed on `ECONNREFUSED`**, which is the definition `vitest.config.ts` uses.
`pure` (343 tests, 6.3s) is everything that needs no Supabase client and no
Postgres, so it runs on a machine with no Docker; `db` is the rest. 16 + 32 =
48, the whole suite, no overlap. **A file moves between the lists by hand when
it changes what it imports**, and the mistake that costs anything is loud: a db
file listed as pure fails visibly without the stack.

**The visual pass and the status check, neither of which is in CI:**

```bash
npm run verify:browser -- --selftest    # 68 negative controls; exits 1 if a check is broken
npm run verify:browser -- --break low-contrast --route route-planner
node tools/browser-verify/routes/_tools/verify-loader-guards.mjs   # no browser needed

# Standing branches, main against integration, the migration high-water mark.
# FETCH tools/idea-status.py FROM idea-app FIRST; do not vendor a copy here,
# because a second copy is the copy that goes stale.
python3 /tmp/status.py --repo pina-hash/fll-app
```

**`--repo` DOES NOT EXIST IN `tools/idea-status.py` YET**, checked against
`pina-hash/idea-app` at `d6811eb` on 2026-09-02: that script hardcodes
`REPO = "https://github.com/pina-hash/idea-app.git"` and its argument parser
takes only `--since` and `--keep`. The line above is the INTENDED invocation,
written down so it is ready when idea-app's own prompt 0005 lands the flag.
Until then the script reports on idea-app whatever you pass it.

- **Four branches stood when this workflow landed (2026-09-02) and the first
  sweep leaves all four alone**, which is correct rather than broken:
  `claude/planner-mat-dimensions-a5nt7m` and
  `claude/robot-build-manual-access-513wpq` are already contained in `main`
  and skip as "already in integration";
  `claude/merge-branches-migration-script-0w3t1u` and
  `claude/notebook-write-permissions-sbwtjq` have no CI run on their tip,
  because they were pushed before `ci.yml` existed, and skip as "CI is
  unknown". Pushing any commit to either of the last two gives it a run.
