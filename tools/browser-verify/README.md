# `tools/browser-verify` -- the repeatable visual pass

`CLAUDE.md`'s verification standard asks for measurements no test in `tests/`
can make: **"A CLAIM ABOUT WHAT A SCREEN LOOKS LIKE IS MEASURED ON EVERY
SCREEN, NOT SAMPLED"**, every text node's effective foreground and background
resolved through the ancestor stack, both grounds, 375 and 1440, 0px
horizontal overflow. That needs a real browser. This is the instrument: a
session either runs it and reports numbers, or names precisely what stopped
it.

```bash
npm run verify:browser                     # both widths, every listed dev route
npm run verify:browser -- --probe          # what this container's browser can do
npm run verify:browser -- --selftest       # negative controls; exits 1 if a check is broken
npm run verify:browser -- --route route-planner --width 375
npm run verify:browser -- --break low-contrast --route route-planner
npm run verify:browser -- --json out.json --verbose
node tools/browser-verify/routes/_tools/verify-loader-guards.mjs   # no browser needed
```

**Ported from `pina-hash/idea-app`'s `tools/browser-verify/` on 2026-09-02.**
`checks.mjs`, `probe.mjs` and most of `browser.mjs`, `run.mjs` and
`selftest.mjs` are that repo's files; what this repo changed is listed under
"What the port changed" below.

## What this container has

Measured 2026-09-02 by `--probe` and by the runs below, not assumed:

| Question | Answer |
| --- | --- |
| Chromium present? | **Yes** -- `141.0.7390.37` at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` |
| How is it found? | `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, resolved by `playwright-core` |
| Google Fonts | **Blocked** by the harness itself (see the limits below) |

### The dependency is pinned, and the pin is load bearing

`playwright-core@1.56.1`, **exact**, chosen over `playwright`:

- `playwright-core` has no install-time browser download, so `npm install` in
  this repo cannot be broken by a blocked CDN.
- The version must match the preinstalled build. Playwright pins a Chromium
  build number per release; `1.56.1` wants build **1194**, which is what is on
  disk. A different minor wants a different build, and a casual `npm update`
  is what would take this harness out with a "browser not found" that reads
  like a missing tool.

`browser.mjs` resolves the executable through a reported fallback chain
(`chromium.executablePath()`, then `$CHROMIUM_PATH`, then three known paths),
so a moved binary is a named error rather than a stack trace.

## What it covers, and what it cannot

**It drives `/dev` routes only.** Those mount the real components with fixture
props, need no account and no Supabase, and answer 404 in a production build
(`if (!dev) error(404)` in each one's `+page.server.ts`). This is a hard
boundary, not a starting set.

**It drives ONE route today**: `/dev/route-planner`. There are eight
directories under `src/routes/dev` with a page (`brand`, `codegen`,
`example-plan`, `live-board`, `match-timer`, `notebook`, `route-planner`,
`student-screen`), and the other seven are unlisted rather than excluded. The
planner went first because it is the surface with the most ways to be wrong
that a test cannot see: it is the app's one forced light plate, it draws
labels on SVG where there is no background to inherit, and it puts a
deliberately wide child in a grid track. `routes/route-planner.mjs`'s header
states all three with the CLAUDE.md rule each one is measuring.

**A route earns a place by one question** -- if this surface broke silently,
would anyone find out before a student did -- not by existing. The obvious
next three are `/dev/student-screen` (375px, the runtime nine-year-olds use),
`/dev/live-board` (phone-first, and the one always-on green active state) and
`/dev/brand` (every mark, every ground).

**It cannot reach a signed-in route.** `/app/**` needs a real session;
`/board` and `/p/<token>` need rows. Those are verified against a local stack
by hand. Do not report this harness as covering a signed-in page.

Two limits belong in any report that quotes these numbers:

- **Web fonts do not load.** The harness blocks every non-loopback request,
  which is what makes a run deterministic (whether a webfont arrived changes
  text metrics, and this harness reports tap-target GEOMETRY). So **every
  pixel measurement is approximate**, tap targets included: a control's box
  depends on Rajdhani's line box, which this run never loads. **Contrast is
  unaffected** -- colour is resolved by painting the computed
  `color`/`background` and reading the pixel back, which does not depend on
  which face drew the glyphs. Every run prints the blocked count.
- **`prefers-reduced-motion` is `no-preference` for every check except
  `motion`.** A contrast, geometry or presence finding describes that state
  and never the reduced one; the two are not inferable from each other.

## The ground is chosen, never inherited

`src/app.html`'s blocking script resolves the ground before first paint from
`localStorage['fll-theme']`, and **`resolveGround('system')` answers `dark`
whatever the device prefers** (CLAUDE.md: "THE DEFAULT GROUND IS THE APP'S
OWN, NOT THE OPERATING SYSTEM"). So emulating `prefers-color-scheme` measures
nothing here. A spec sets the ground with `setGround('dark' | 'light')` from
`routes/_shared.mjs`, which writes the key AND stamps `data-theme` (the
blocking script has already run by the time any step fires).

**Both grounds are owed on every claim** (CLAUDE.md: "THE LIGHT GROUND IS
MEASURED AS THOROUGHLY AS THE DARK ONE, ON STUDENT SURFACES TOO"). The one
spec here currently sets `dark` only, and that is a gap rather than a
decision: the light ground is the next thing to add, as a second spec with
`aliasOf` pointing at the same route.

## Current findings

**The whole run reports 38 measurements over 2 route/width runs, 0 outside
threshold**, measured 2026-09-02 on `claude/idea-standard-conformance-y51l0n`
at the commit that added this directory. **This paragraph is a snapshot and it
drifts** -- the run is the authority, and a session measuring a different
number corrects this line in the same change.

Numbers worth having in the record, from that run:

| | |
| --- | --- |
| Planner section headings | 12.73:1 on `--surface-1` |
| Muted explanatory copy | 6.8:1 |
| The launch area label, on the mat | 14.21:1 (dark ink on the forced light plate) |
| The ruler tick labels | 14.21:1 |
| The trademark attribution | 6.13:1 on the footer's chrome |
| Smallest non-compact planner control | 65.3 x 44 px, 0 of 5 under the 44px floor |
| Horizontal overflow | 0px at both 375 and 1440 |
| Console errors | 0 |

**The forced light plate is the one worth reading twice.** `--fg-hero`-weight
ink at 14.21:1 inside a page whose own body is `#181818` is the plate
re-declaring its tokens rather than inheriting them, which is exactly the bug
CLAUDE.md says has landed five times across two apps. It is now measured
rather than asserted.

## Negative controls -- the part that makes the numbers mean anything

A check that has never failed has not been tested.

`--selftest` puts every check to a pair of self-contained fixtures, one built
to break it and one built to pass it, and prints both measured values. It
exits non-zero if a check comes back green on the broken fixture or red on the
sound one. **68 controls, 34 negative and 34 positive, 0 instrument failures**
(measured 2026-09-02; re-derive rather than trusting this line).

`--break <preset>` is the **live** control: it injects a defect into the real
page before measuring, so a session can prove a check bites on the surface in
front of it. **Measured on `/dev/route-planner` at 375px:
`--break low-contrast` reddened exactly the five contrast rows, at 1:1, and
left the other thirteen measurements green.** That one-preset-one-measurement
property is what makes a live control worth anything.

| Preset | Reddens |
| --- | --- |
| `overflow` | `horizontal-scroll` |
| `tiny-taps` | `tap-target` |
| `low-contrast` | `contrast` |
| `invisible` | `presence` |
| `console-error` | `console-errors` |
| `blank-text` | `text-contains` |
| `motion` | `motion` |

The room-wrapper selectors in `overflow` and `invisible`, and the footer
selector in `blank-text`, name THIS repo's classes (`.harness`, `.surface`,
`.rp`, `.mat`, `.bf__tm`). A preset that silently matches nothing is a live
control that proves nothing, in the reassuring direction.

`routes/_tools/verify-loader-guards.mjs` is the same argument for the route
loader: it renames a spec, then plants a duplicate, and requires both of the
loader's refusals to actually throw. It needs no browser.

## What the port changed

Everything else is idea-app's file. These are this repo's:

- **`routes/` holds one spec, not 63**, and the `order` export that repo's
  files carry belongs to its own split. Nothing here has one; specs sort by
  filename.
- **`server.mjs` probes `/dev/route-planner`** on boot, because it has to poll
  a route that exists here.
- **`routes/_shared.mjs` carries `WIDTHS` and `setGround`**, not
  `SETTLE_ENTRANCE` (this repo has no entrance-faded cards).
- **A SELECT STEP, WHICH IDEA-APP'S HARNESS DOES NOT HAVE.** Every interesting
  state of `/dev/route-planner` is behind a `<select>` in the harness bar, and
  a `<select>` cannot be coordinate-clicked: the click opens a native popup no
  page-side predicate can see. So `selectUntil` (browser.mjs),
  `prepareSelectResult` (checks.mjs) and the `{ select, value, until }` step
  (run.mjs), with two controls in `selftest.mjs`.

  **It retries, and not retrying cost this bundle a run.** A one-shot
  `evaluate` that set `.value` and dispatched `change` reported success, left
  the control reading "calibrated", and never reached Svelte's binding, which
  was not attached yet. The picture never rendered, and three measurements at
  each width came back as findings about a state the run had not reached.
  Retried, the same selection takes **three to five attempts** (measured
  across four runs). This is CLAUDE.md's "paint is not interactivity" and
  idea-app's own reason for `clickUntil`, one control type over.
- **The `--break` presets name this repo's wrappers** (see the table above).

## Why it is not in `npm test` and not in CI

- `npm test` is the vitest suite: a real Supabase stack, real migrations, no
  DOM. This needs a browser and a dev server, and a browser failure would read
  as a database failure.
- A full run is **26.3s wall clock** for 2 route/width runs and 38
  measurements, of which **17.7s is the vite dev boot** (measured 2026-09-02).
  The boot is close to fixed, so the marginal cost of a route is small and the
  floor is not: budget roughly 2 to 4 seconds per route/width on top of ~18s.
  `--selftest` is ~34s for its 68 controls.
- **The exit code is 0 even with findings** by default. It is a measuring
  instrument. `--strict` exits 1, for a session that wants that.

**Recommendation: leave it out of CI until the route list is larger and the
finding list has been stable across several sessions.** A browser-shaped flake
that blocks the integrate sweep costs more than this catches today.

## Files

| File | |
| --- | --- |
| `run.mjs` | CLI, report formatting, `--break` presets |
| `browser.mjs` | Executable resolution, launch, `waitForApp`, `clickUntil`, `selectUntil`, external-request blocking |
| `server.mjs` | Boots and stops `vite dev`, handing the placeholder public env to the CHILD PROCESS so no `.env` is written to the repo |
| `checks.mjs` | The checks and the in-page colour/visibility helpers |
| `routes.mjs` | Assembles the route table from `routes/`; read it first |
| `routes/` | One file per route spec. See `routes/README.md` before adding one |
| `routes/_tools/verify-loader-guards.mjs` | Negative controls for the loader's two refusals; no browser needed |
| `probe.mjs` | The environment capability probe |
| `selftest.mjs` | The negative controls |
