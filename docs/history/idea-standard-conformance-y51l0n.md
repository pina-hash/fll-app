---
title: "The repo gets CI, an integrate lane, a split record and a browser harness (`claude/idea-standard-conformance-y51l0n`, docs and tooling only, no migration)"
date: 2026-09-02
branches: [claude/idea-standard-conformance-y51l0n]
migrations: []
subsystems: ["Build, tests, conventions"]
---

Brings this repo into conformance with section 2 of the IDEA repo workflow
standard, using `pina-hash/idea-app` as the reference implementation. Nothing
under `src/`, `supabase/migrations/` or `scripts/` was touched.

### THE STANDARD ITSELF COULD NOT BE READ, AND THAT IS THE FIRST THING TO KNOW

`docs/standards/IDEA_REPO_WORKFLOW_STANDARD.md` **does not exist in
`pina-hash/idea-app`**. Checked on `main` at `d6811eb` and on `integration` at
`2b54d87`, by filename and by a `grep` for `REPO_WORKFLOW` and
`WORKFLOW_STANDARD` across every `.md`, `.yml`, `.py` and `.mjs` in the tree:
no file, no reference, and no row for it in `docs/standards/REGISTER.md`,
which lists seventeen standards and is maintained by a tool.

`docs/standards/IDEA_instructions.md` (4.16) was read in full and is where the
branch and migration rules actually live in that repo.

So **every "the standard requires" claim below is reconstructed from the
conformance prompt's own enumeration of section 2**, not from the document.
Where the prompt was specific (three workflow files, a history split with a
verify tool, a decisions directory, a prompt ledger, a status tool line, a
browser harness, a test split) that is what was built. Where it was not (the
names of CLAUDE.md's "seven required sections") the choice is this bundle's
and is stated as such.

### What the tree contradicted

Seven claims in the prompt were checked against the tree and were wrong:

1. **The standard document does not exist** (above).
2. **`tools/idea-status.py` has no `--repo` flag.** At `d6811eb` it hardcodes
   `REPO = "https://github.com/pina-hash/idea-app.git"` and its parser takes
   only `--since` and `--keep`. The invocation is written into CLAUDE.md as
   the INTENDED one, saying so.
3. **idea-app has no `docs/decisions/`.** There was no README to copy, so this
   repo's was written from the prompt's description of what the directory is
   for.
4. **idea-app has no `deploy.yml`.** Only `ci.yml` and `integrate.yml`. The
   deploy workflow here was written to the shape the prompt specified.
5. **The WSL and credential mechanics were already under Commands**, as
   `### Supabase CLI credentials` and `### Machine and toolchain`. Nothing
   needed moving.
6. **There was no "Last reviewed" line in CLAUDE.md** to convert into a date
   and a sentence, so one was written.
7. **`tests/db/` already existed** (`harness.ts`, `linked.ts`). It was not
   created and was not changed.

Everything else the prompt claimed held: the four standing branches and their
states, the 4,697-line `docs/HISTORY.md` with two bundles owing an entry, 47
files under `tests/`, no `.github/`, no `tools/`, no `docs/prompt-ledger/`,
migrations 0001 to 0025, and a build that passes here (15.5s) while dying on
Windows.

### The test split, which is the decision the rest rests on

**Measured, not reasoned.** The whole suite was run at `0f2e3fa` with nothing
listening on `127.0.0.1:54321/54322`:

| | |
| --- | --- |
| Files that passed in full | **16** |
| Files that failed on `ECONNREFUSED 127.0.0.1:54322` | **32** |
| Total | 48 (46 under `tests/`, 2 under `src/lib/codegen/__tests__/`) |

Those 16 are `vitest.config.ts`'s `pure` project (343 tests, **6.3s**, no
Docker); the 32 are `db`. The two lists partition the suite exactly, confirmed
with `vitest list` per project: 16 + 32 = 48, no overlap. `fileParallelism:
false` moved to the root config so both projects inherit it.

Two files failed PARTIALLY without the stack (`device-team` at 4 of 7,
`schema-catalog` at 1 of 22), which is why the lists are hand-maintained
rather than derived from imports: a file that is mostly pure still belongs in
`db`.

### CI runs a real Supabase stack, and the alternative was not available

The prompt offered (a) `supabase start` on the runner or (b) porting to
embedded Postgres as idea-app's `tests/db/` does, preferring (a) if the stack
boots in under five minutes.

**(a), and it is the only honest choice here.** `tests/db/harness.ts`'s own
header says why: the claims are about GoTrue (a bcrypt hash written from SQL
signs in), PostgREST (a column with no grant is refused with 42501), Realtime
and Storage, and an embedded Postgres can confirm none of them. Porting to (b)
would keep the tests green while deleting what they test.

**THE BOOT TIME WAS NOT MEASURED, AND THE REASON IS NOT THE RUNNER.** This
session's container could not pull the images: `dockerd` starts fine, but
Docker Hub answered **429 Too Many Requests** on
`supabase/realtime:v2.129.0` and CloudFront answered **403 Forbidden** on the
blob fetches for `gotrue`, `storage-api` and `postgres-meta`, on both
`docker.io` and `ghcr.io`, after three retries each. The attempt failed in
**51s** with nothing running. So the 32 db tests were **not run in this
session at all**, and the five-minute budget the choice was supposed to be
made against is **unverified**. A GitHub-hosted runner has no such rate limit
and is expected to boot in one to two minutes, but that is an expectation and
this entry does not record it as a measurement.

`ci.yml` starts the stack with `-x studio,logflare,vector,edge-runtime` (the
four services no test reaches) and **prints the boot time**, so the first real
run answers the question this session could not.

### The history split

27 entries out of a 4,697-line file, one file each, front matter then the body
byte for byte. **The heading is derived from `title` at read time and is not
retyped into the body** -- idea-app added that only later, after a retyped
heading drifted from its title three times, so this split starts where that
one ended up.

`npm run history:verify` reassembles all 27 and compares two ways: a byte
compare through `git show` against `0f2e3fa`, and a pinned sha256
(`c8dade45...`, 281,921 bytes). Both **IDENTICAL**. The pointer commit is
separate from the split commit so the reassembly could be proved against a
tree holding both.

The old file's hand-maintained migration index table is gone and
`npm run history:index` inverts one from front matter instead. That table is
the argument for doing so: it stopped at 0016 while the chain stood at 0025.

**Two owed entries were reconstructed from git** (`a0d5f6a`, the mat geometry
correction; `04d8668`, the build manual screen) and each says in its first
paragraph that it is a reconstruction and that its figures are the commit's
words rather than a re-measurement.

### The browser harness, and the step it turned out to need

`tools/browser-verify/` is idea-app's, with one route spec for
`/dev/route-planner` and this repo's selectors in the `--break` presets.

**A SELECT STEP HAD TO BE ADDED, AND NOT RETRYING IT COST A RUN.** Every state
of that harness page is behind a `<select>`, which cannot be
coordinate-clicked: the click opens a native popup no page-side predicate can
see. The first version set `.value` from an `evaluate` and dispatched
`change`. It reported success. The control read "calibrated". The binding
never fired, because it was not attached yet, and **six measurements (three at
each width) came back as findings about a state the run had never reached**.
Retried, the same selection takes **three to five attempts**. That is
CLAUDE.md's "paint is not interactivity" and idea-app's own reason for
`clickUntil`, one control type over. `selectUntil`, `prepareSelectResult` and
the `{ select, value, until }` step, with two negative controls of their own.

Measured on the harness commit:

| | |
| --- | --- |
| Route/width runs | 2 (`/dev/route-planner` at 375 and 1440) |
| Measurements | 38, **0 outside threshold** |
| Wall clock | 26.3s, of which **17.7s is the vite dev boot** |
| `--selftest` | **68 controls, 34 negative, 0 instrument failures** (~34s) |
| `--break low-contrast` | reddened exactly the 5 contrast rows at 1:1, left the other 13 green |
| Loader guards | both fire |

The number worth keeping: **the launch area label and the ruler ticks measure
14.21:1** inside a page whose body is `#181818`. That is `MatCanvas`'s forced
light plate re-declaring its tokens rather than inheriting them, which is the
bug CLAUDE.md says has landed five times across two apps, now measured rather
than asserted.

### What is NOT verified

- **The three workflows have never run.** They are YAML-parsed and no more.
  The first push to this branch is what tries them.
- **The 32 database tests did not run in this session** (the image pull
  failed, above). `npm run check` is 0 errors and 0 warnings, `npm test --
  --project pure` is 343 passing, and `npm run build` succeeds; the db half is
  unproven here and CI is what proves it.
- **The light ground is not measured.** The one route spec sets `dark`. That
  is a gap against CLAUDE.md's "THE LIGHT GROUND IS MEASURED AS THOROUGHLY AS
  THE DARK ONE", and the fix is a second spec with `aliasOf`.
- **Seven of the eight dev routes are undriven.** `/dev/student-screen`,
  `/dev/live-board` and `/dev/brand` are the obvious next three.

### Deferred, deliberately

- **`scripts/land-migration.sh` was not merged, moved or referenced as
  present.** It is on `claude/merge-branches-migration-script-0w3t1u`,
  unmerged, and CLAUDE.md names it as being on that branch. The four standing
  branches were not merged, rebased or deleted.
- **The build-manual door** (the nav entry in `src/routes/app/+layout.svelte`,
  the redirect in `src/routes/app/+page.server.ts`, the student link in
  `src/lib/student/StudentScreen.svelte`) is out of this bundle's paths and is
  the highest-value app work in the queue.
- **A `0027` narrowing `notebook_entry_delete`** is filed as
  `docs/decisions/03-notebook-delete-widening.md` rather than written, because
  the number after 0026 is not this repo's to take while that branch stands.
