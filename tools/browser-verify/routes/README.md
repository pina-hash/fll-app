# `tools/browser-verify/routes/` -- one file per route spec

This directory holds the individual route specs `../routes.mjs` assembles into
the array `run.mjs` drives. It exists for the same reason `docs/history/` and
`docs/prompt-ledger/entries/` do: a single array every lane appends to at the
same closing `];` is a shared write point two branches touch on every
unrelated pair of features. idea-app's copy of that array blocked a merge
three times in one day before it was split; this repo starts split.

**The loader's two collision guards are exercised by
`_tools/verify-loader-guards.mjs`** (`node
tools/browser-verify/routes/_tools/verify-loader-guards.mjs`), which mutates
this directory in place (a rename, then a decoy file) and restores it from an
in-memory copy, never with `git checkout --`: that is a discard to HEAD rather
than a scoped undo. Run it after touching the loop in `../routes.mjs` -- the
order of its checks matters more than it looks, and the comment above them
says why.

## Adding a route

Create `<slug>.mjs`, where `<slug>` is your route's own `path` with the
leading `/dev/` stripped, lowercased, and every run of non-alphanumeric
characters collapsed to a single `-`. `../routes.mjs`'s loader computes the
same slug from your spec's `path` and refuses to load the file if the two
disagree, so a typo in the filename is a load-time error rather than a route
silently never running.

This is collision-free BY CONSTRUCTION, not by convention: your route answers
on a URL nothing else in the app does, so your filename cannot collide with
another lane's. Do not derive a filename from a counter, a date or your branch
name -- any of those is a value two parallel sessions could pick identically,
which is the shared write point this split removes.

```js
export default {
	path: '/dev/your-route',
	label: 'What the surface is',
	// ...the fields below
};
```

## The spec shape

- `path` -- the dev route. Doubles as this file's own name (see above).
- `label` -- what the surface is.
- `aliasOf` -- present when this spec measures a different STATE of a route
  another spec already names; `urlFor` visits `aliasOf` instead of `path`.
  **This is how a second ground is measured**: one spec sets `dark`, its alias
  sets `light`, and the two filenames are independently derived from their own
  `path`s.
- `prepare` -- `[{ click } | { select } | { waitFor } | { evaluate }]`,
  reaching the state to measure, each with an optional `waitMs`.
  - `click` presses a selector and waits on an `until` predicate SOURCE,
    retrying and reporting the attempt count.
  - `select` chooses `value` in a `<select>` and waits on `until` the same
    way. **Use this and never a click for a `<select>`**: a coordinate click
    opens the browser's native popup, which no page-side predicate can see.
    Name the control by what it offers (`select:has(option[value="x"])`)
    rather than by its position.
  - `waitFor` is a page-side predicate SOURCE waited on until it holds, for a
    state reached by an async payload landing rather than by a press.
  - `evaluate` runs a page-side function SOURCE and reports its return value.

  **Every step is a measurement** (`prepare-click`, `prepare-select`,
  `prepare-wait`, `prepare-eval`), counted in the summary and gating
  `--strict`. A click or select step passes only if it ACTUALLY FIRED: an
  `until` the page satisfies at REST short-circuits the retry loop, so the
  step reaches no state while the report says it acted. Write the predicate
  against something only the interaction can produce.
- `settleMs` -- how long to let entrance animations finish before measuring.
- `contrast` -- `[{ selector, label, min }]`. 4.5 for copy, 3 for a boundary
  or large bold type. **Anchor the selector**: `contrast` reports the WORST
  match, so an unanchored selector folds two regions into one number and the
  next row becomes a duplicate of the first.
- `tapTargets` -- `[{ selector, label, min }]`. 44px is the floor for anything
  a finger uses. **`.btn--small` is a DESKTOP affordance** and
  `@media (pointer: coarse)` puts it back to 44px; the harness reports
  `pointer: fine`, so a `.btn--small` measuring under 44 here is the correct
  desktop reading and not a finding. Exclude it or measure the coarse case
  deliberately.
- `presence` -- `[{ selector, label, expectPresent, maxPresent, expectVisible,
  maxVisible }]`. The two `expect*` values are FLOORS; the two `max*` are the
  ceilings. **`expectPresent: 0` implies `maxPresent: 0`** -- a floor of zero
  asserts nothing, and every absence row means exactly zero. An absence row
  cannot tell "the rule holds" from "the selector was renamed", so **it
  belongs beside a positive control in the same spec** (the mark rows in
  `route-planner.mjs` sit beside `.bf__marks .mark`, which proves the markup
  is there to be found).
- `domOrder` -- `[{ before, after, label }]`, read from
  `compareDocumentPosition`, never from a boolean the page exposes.
- `orderResult` -- `[{ evaluate, expected, label }]`, for a claim about a
  WRITE that no DOM read can settle (the planner's persist log is exactly
  this shape: `[data-testid="persist-log"]` records every op the component
  would have queued).
- `statePairs` -- `[{ activeSelector, inactiveSelector, label }]`, asserting a
  selected control actually renders differently from its siblings rather than
  both merely clearing a contrast minimum. **This repo has one always-on
  active state** (`.shell__tab--on`, the console nav pill) and CLAUDE.md says
  every other selected state is `.btn--picked`'s treatment or the team's own
  accent, so this is the check that a second green active state has not
  appeared.
- `datalistOrder` -- `[{ inputSelector, evaluateExpected, label }]`.
- `motion` -- `[{ selector, label, expect }]`, `expect` being `'gated'`
  (default) or `'never'`. Sweeps every element under `selector` in BOTH
  reduced-motion states. In this repo the gate lives in one place
  (`src/lib/design-system/motion.css`: the classes ARE the gate), and the
  `'never'` direction is for the official marks, which FIRST's guidelines
  forbid altering -- motion is an alteration.
- `textContains` -- `[{ selector, label, must, mustNot }]`. The compliance
  check: `presence` proves an element is there and `contrast` proves its ink
  is readable, and **neither reads a word of it**. The trademark attribution
  is quoted from the IP policy verbatim, so its wording is exactly the kind of
  thing that can drift while every other check stays green.
- `ignoreConsole` -- regex sources for errors that belong to the FIXTURE.

## A harness must be in the room production is in

A spec's numbers are only as good as the layout chain the harness mounts. A
`/dev` route has no layout above it beyond the root, so it carries whatever
wrapper its own page puts there. Two things follow in this repo:

- **`BrandSurface` is mounted at the ROOT layout**, so every dev route does
  get the footer, the marks and the trademark attribution. That is why
  `route-planner.mjs` can measure them.
- **A team accent is set by `data-accent` on a wrapper**, and
  `/dev/route-planner`'s harness sets `data-accent="teal"`. A component
  measured with no accent is measured in a state no real team is ever in
  (0025 gives every live team a starting colour).
