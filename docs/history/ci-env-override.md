---
title: "CI's placeholder env is scoped to the one step that needs it (`claude/ci-env-override-q4t6sn`, `.github/workflows/ci.yml` only, no migration)"
date: 2026-09-02
branches: [claude/ci-env-override-q4t6sn]
migrations: []
subsystems: ["Build, tests, conventions"]
---

The first CI run this repo ever had went red, and it went red for a reason that
lives entirely in `ci.yml`. This bundle moves two placeholder variables out of
the workflow-level `env:` block onto the single step that needs them, and adds
a guard so the same mistake cannot come back silently. One file changed. No
SQL, nothing under `src/`, nothing under `tests/`.

### WHAT THE RED RUN ACTUALLY SAID

Run 1 on `claude/idea-standard-conformance-y51l0n`, at `acf0f56`
(`actions/runs/33613337123`):

    Test Files  30 failed | 18 passed (48)
         Tests  372 passed | 334 skipped (706)

    stack:          success
    check:          success
    test:           failure
    history-verify: success

Every one of the 30 failing files failed the same way, in `beforeAll`, before a
single assertion in it ran:

    Error: sign-in as test-...@boscotech.edu failed: fetch failed
     > signIn tests/db/harness.ts:71:19
     > seedMentor tests/db/harness.ts:158:17

That is the shape that matters. The stack had booted, the chain and `seed.sql`
had been applied, and `npm run check` had passed. `fetch failed` is undici
saying the hostname did not resolve, which is not something a healthy local
stack on `127.0.0.1` can produce. The suite was not talking to the stack the
job had just started.

### THE CAUSE, AND WHY THE COMMENT ABOVE IT WAS THE DEFECT

`ci.yml` carried two placeholders in a workflow-level `env:` block, under a
comment ending:

    # The test suite does not read these two: it reads
    # `.env.test` (vitest.config.ts), which names the local stack.

Both halves of that sentence are true in isolation and the conclusion is false.
`tests/db/harness.ts` reads EXACTLY those two names:

    export const LOCAL = {
        url: required('PUBLIC_SUPABASE_URL'),
        anonKey: required('PUBLIC_SUPABASE_ANON_KEY'),
        ...

and `vitest.config.ts` supplies them with

    loadEnv({ path: fileURLToPath(new URL('./.env.test', import.meta.url)) });

which passes no `override`. **dotenv's `config()` does not replace a name
`process.env` already carries.** A workflow-level `env:` block is inherited by
every step of every job, so the test step started with both names already set
to the placeholders, dotenv skipped those two lines of `.env.test`, and every
client in the suite was pointed at `https://ci-placeholder.supabase.co`. The
service key and the database URL still came from `.env.test`, so the postgres.js
half of the harness worked and only the GoTrue and PostgREST half died. That is
why the failure looked like an auth problem rather than a configuration one.

Measured rather than reasoned, with the same dotenv call `vitest.config.ts`
makes (dotenv 17.4.2), run twice:

    PUBLIC_SUPABASE_URL preset   -> injected env (3) -> "https://ci-placeholder.supabase.co"
    PUBLIC_SUPABASE_URL unset    -> injected env (4) -> "http://127.0.0.1:54321"

dotenv's own count gives it away: three of `.env.test`'s four lines were
injected in the CI case, not four.

### WHY THE STEP SCOPE IS LOAD BEARING AND NOT TIDINESS

The placeholders exist for `svelte-check`, which type-checks against
`$env/static/public`. `svelte-kit sync` GENERATES that module from whichever
`PUBLIC_`-prefixed names are in `process.env` at sync time, and three files
import those two by name (`src/routes/+layout.ts`, `src/hooks.server.ts`,
`src/lib/server/service-client.ts`). Measured on this checkout, in both
directions:

    sync with the two names set   -> declare module '$env/static/public' {
                                         export const PUBLIC_SUPABASE_ANON_KEY: string;
                                         export const PUBLIC_SUPABASE_URL: string;
                                     }
    sync with them unset          -> declare module '$env/static/public' {
                                     }

And on this checkout, `npm run check` itself, run both ways:

    with the two names set   -> 726 FILES 0 ERRORS 0 WARNINGS
    with them unset          -> 726 FILES 5 ERRORS, in src/hooks.server.ts,
                                src/lib/server/service-client.ts and
                                src/routes/+layout.ts, every one of them
                                "has no exported member 'PUBLIC_SUPABASE_...'"

So the check step needs them present and the test step needs them absent, and
those are not a preference apart: they are opposite requirements on the same two
names in the same job. A step-level `env:` is the only place that can hold both
answers at once.

`npm ci` runs `prepare`, which is `svelte-kit sync || echo ''`, and that runs
before any step-level env exists, so the module `npm ci` leaves behind is the
empty one. **It does not matter**, and this was checked rather than assumed:
`npm run check` is `svelte-kit sync && svelte-check`, so the check step
regenerates the module from its own environment before svelte-check reads it.
The regeneration is a full overwrite in both directions, which is what the two
measurements above show. No second placement is needed.

### THE GUARD, AND THE PROOF THAT IT BITES

The `Test suite` step now refuses before `npm test` if either name is set:

    if [ -n "${PUBLIC_SUPABASE_URL:-}" ] || [ -n "${PUBLIC_SUPABASE_ANON_KEY:-}" ]; then
      echo "::error::PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY is set in this step's environment. ..."
      exit 1
    fi

A comment cannot stop this coming back, because the comment that was there is
what carried the wrong claim for a whole bundle. The message names the mechanism
so the next reader does not rediagnose it from `fetch failed`.

Exercised three ways, by extracting the step's own `run:` body out of the YAML
and running it under bash:

1. As shipped, both names unset (the real post-fix CI condition): exit 0.
2. As shipped, `PUBLIC_SUPABASE_URL` set to the placeholder (the regression):
   the error prints and exit 1.
3. Condition inverted in the file (`-n` to `-z`), both names unset: exit 1,
   confirming the branch is reachable and not dead. Restored and md5-compared:
   `cbcccf359932139bcaae9e012f56dd48` before and after.

### WHAT WAS MEASURED IN THIS SESSION

- `npm test -- --project pure`: **16 files, 343 tests, all passing.**
- `npm run check` with the two placeholders set, which is what the changed step
  now does: **726 files, 0 errors, 0 warnings**, the baseline CLAUDE.md states.
  Without them, 5 errors: the control that shows the placeholders are still
  earning their place.
- `npm run history:verify`: 27 entries, 281921 bytes, sha256 IDENTICAL.
- The YAML parses, the workflow-level `env:` key is gone entirely (it held only
  those two), and the only step-level `env:` in the job is on
  `Type and a11y check`.
- `svelte-kit sync` with and without the two names, quoted above.
- dotenv precedence with and without a preset name, quoted above.

### WHAT IS EXPLICITLY NOT VERIFIED

**The fix itself is unproven until the next CI run, and this bundle does not
claim otherwise.** Docker's CLI is installed in this container but the daemon is
not running (`dial unix /var/run/docker.sock: no such file or directory`), and
there is no Supabase CLI, so the local stack could not be started and the `db`
project could not be run at all. The failing path is exactly the one that needs
that stack. What was proved here is the mechanism (dotenv precedence, the sync
regeneration, the guard firing); what proves the fix is run 3 going green.

The four `TypeError: Cannot read properties of undefined` failures in `afterAll`
in `board-device`, `mat-image-roundtrip`, `match-runs` and `student-isolation`
are cascade from `beforeAll` never completing, and are expected to vanish with
sign-in. If one survives a green sign-in it is a separate lane, in files this
bundle does not own.

### DEFERRED, DELIBERATELY

- **The Node 20 action deprecation.** `actions/checkout@v4`,
  `actions/setup-node@v4` and `supabase/setup-cli@v1` are being forced onto
  Node 24 by the runner and warn about it. A warning is not a failure and
  bumping three action majors is its own decision with its own blast radius.
- **`.env.test`, `vitest.config.ts` and `tests/**`.** The failure surfaces in
  `tests/db/harness.ts` and the fix is not there. Giving `loadEnv` an
  `override: true` would fix this CI run and break the documented ability to
  point the suite at a different stack from the environment, which both
  `.env.test` and `vitest.config.ts` state in their headers. The environment
  should win; nothing should have been putting a placeholder in it.
- **`history:verify`'s `git byte compare: unavailable`** on CI. That is the
  shallow-checkout fallback behaving as its own header describes; the sha256
  compare ran and was IDENTICAL, so the run verified something.
