---
title: "2026-08-25 -- Two defects a mentor's first real calibration found"
date: 2026-08-25
branches: []
migrations: []
subsystems: ["Route planner, field picture"]
record_order: 18
---

Both surfaced from one mentor's first attempt at calibrating the mat with the
official FLL engineering notebook path-planning diagram, which reads the
whole field but measures nearer 1.75:1, not the mat's own 2.07:1.

### The aspect note read as an error over a legitimate picture

The aspect check (0017) exists to catch one mistake arithmetic can notice on
its own: two corners tapped on the SAME side of the mat, which produces a
rectangle of the wrong shape. But calibration scales each axis independently,
so a picture that is not drawn to true 2.07:1 calibrates correctly anyway,
and the arithmetic cannot tell that apart from the mistake it can catch --
both produce an off-ratio tapped rectangle. The message ("Check you tapped
corners that are diagonally opposite...") only spoke to the mistake, in the
bold `--warning` treatment used elsewhere for real errors, and the mentor
read it as one and stopped.

Saving was never actually blocked by this check; the save button is gated on
`usable` alone (spans above `MIN_CALIBRATION_SPAN`), which the aspect ratio
never touches. The defect was entirely in what the message implied, not in
what it did.

Rewritten to keep the ratio, name the likely benign cause first (the picture
may simply not be drawn to scale), point at the actual check (does the drawn
grid sit on the mat), and only then give the diagonal-opposite guidance --
one message, because the arithmetic still cannot distinguish the two causes.
Moved off the bold warning treatment (`cal__warn`, `--warning`) onto the same
neutral `small muted` style the confirmation text already uses, since "your
picture is not to scale" is not a problem to fix.

### "Calibrate now" did nothing when the calibrator was already open

The mat setup panel's copy and button were written for the ONE state where
the calibrator is closed. `calibrating = true` when it is already true is a
no-op with nothing to show for it: the panel kept saying "This picture has no
calibration yet, so it is not shown on the mat" and its "Calibrate now"
button reopened what was already on screen, above a panel a mentor is often
scrolled past. It read as broken.

`goToCalibrator()` replaces the bare `calibrating = true` everywhere in
RoutePlanner.svelte: it sets the flag AND scrolls `matBlockEl` into view,
unconditionally, so the button does something visible whether the calibrator
was already open or not -- including on first upload, where the calibrator
used to open automatically off screen while the file input stayed in view.
The panel's own paragraph now checks `calibrating` first and says the
calibrator is open above, and its button relabels to "Go to the calibrator".
The setup checklist's "Finish calibrating" item got the same fix, for the
same reason: it had the identical no-op.

### The duplicate save message

"New picture saved. Calibrate it before it is shown." (field-image.ts) was
rendered twice at once on a fresh upload: once inside `MatCalibrator` (which
receives `pictureMsg` as its `message` prop) and again in the panel's own
`{#if pictureMsg}` paragraph, because the panel had no reason to know the
calibrator was already showing the same string. The panel now suppresses its
copy of `pictureMsg` while `calibrating` is true.

### Measured

Driven through the REAL `RoutePlanner` and `MatCalibrator` components in a
browser, mentor scenario, via `/dev/route-planner`. `computer` coordinate
clicks were unavailable in this session (the pane would not composite a
screenshot); taps were dispatched as real `PointerEvent`s at coordinates
computed from the SVG's `getBoundingClientRect()` and the calibrator's own
`pointFromEvent` math, onto the exact `onpointerdown` handler a real tap
reaches -- the same technique a testing library uses, not a shortcut around
the component.

- **A new dev-harness fixture**, `uncalibrated-nonscale`: playing surface
  980 by 560 inside a 1200 by 700 picture, a clean 1.75:1, matching the real
  notebook diagram's proportions. Tapping its real corners: note reads
  "Those corners make a 1.75:1 rectangle; the playing surface itself is
  2.07:1. That is often fine...", save button `disabled: false`, and saving
  produced exactly one persisted calibration op with no duplicate message
  anywhere -- the panel's own paragraphs, read from the DOM, are the static
  explainer and "The calibrator is open above...", nothing else.
- **Negative control, same fixture:** two corners tapped on the same (top)
  side, 1.75:1 fixture, spans both comfortably above `MIN_CALIBRATION_SPAN`
  so this exercises the aspect branch rather than the degenerate one:
  19.60:1 rectangle, same message text (unavoidable -- one signal, two
  causes), and it still names the actual mistake and the fix. Save stayed
  enabled, matching the pre-existing "warns, does not block" design; this
  bundle did not add a hard block.
- **Regression control:** the original fixture, drawn to the mat's true
  2.07:1, produces NO note on its real corners -- the plain "playing surface
  is 1032 by 499 pixels" confirmation, unchanged.
- **The degenerate case** (two corners almost on top of each other) still
  disables save, unchanged; the "almost on top" message itself did not
  render in this run because `calibrationFromCorners` returns `null` below
  `MIN_CALIBRATION_SPAN` and the branch is gated on a non-null `candidate` --
  pre-existing, not touched by this bundle, not one of the two defects, and
  not a regression (`git diff` confirms that line is untouched).
- All of the above repeated at 375 and 1440 px: `document.documentElement
  .scrollWidth - window.innerWidth` is **0 at both widths**, before tapping,
  after tapping, and with the aspect note visible.
- `npx svelte-check`: **0 errors, 0 warnings, 683 files.**
- Full suite: **41 files, 562 tests, all passing.** No test asserted the old
  copy, so none needed updating.

### Not verified

- **The exact production string** ("New picture saved. Calibrate it before
  it is shown.", from `field-image.ts`) was not reproduced verbatim: the dev
  harness's `onUploadPicture`/`onSaveCalibration` are canned mocks
  ("harness: nothing is uploaded here.", "harness: calibration logged, not
  stored.") that never touch Supabase Storage. The suppression mechanism
  (`pictureMsg && !calibrating`) was exercised end to end with the harness's
  own strings taking the identical code path; the production string itself
  is a constant this bundle did not change.
- **No migration.** This is copy and control-flow only; nothing in
  `supabase/` changed, so there is nothing to push and nothing for
  `migration list --linked` to report.

### Deferred

- The degenerate-candidate gap above (no message when `candidate` is `null`)
  is a pre-existing rough edge, not one of the two reported defects. Left as
  found.

---

