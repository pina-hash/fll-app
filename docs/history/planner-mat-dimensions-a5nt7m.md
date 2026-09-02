---
title: "The table and the mat become two rectangles (`claude/planner-mat-dimensions-a5nt7m`, code only, no migration)"
date: 2026-08-28
branches: [claude/planner-mat-dimensions-a5nt7m]
migrations: []
subsystems: ["Route planner, field picture"]
---

**RECONSTRUCTED FROM GIT ON 2026-09-02, NOT FROM A SESSION REPORT.** This
bundle merged to `main` as `a0d5f6a` (merge `8bf71dc`) and wrote no entry;
the record below is read off its own commit message and diff, so it carries
what the diff can show and not what the session measured beyond what it
stated. Where it says a number, that number is quoted from the commit
message. Nothing here was re-measured.

### What was wrong

`src/lib/planner/geometry.ts` declared `MAT_WIDTH_MM = 2362` and
`MAT_HEIGHT_MM = 1143` and called that the mat. **Those numbers are the
inside of the robot game TABLE.** The printed mat is 2000 by 1134 mm and sits
inside it: 181 mm of bare table on each side, flush with the bottom wall, and
a 9 mm gap at the top.

Because the planner treated the table rectangle as the mat, an uploaded
picture of the mat was stretched 2362/2000 on x and 1143/1134 on y. Every
long axis drive in the movement list was **18.1 percent too long**, and
because the two factors differ the stretch was anisotropic: `headingDeg` ran
over distorted coordinates, so every turn was bent by an amount that depended
on its direction. The commit states the worked case: **a 45 degree path on
the mat came back as 40.5 degrees.**

The error had stood for six bundles, which is what a wrong constant with a
right-sounding name buys. 93 by 45 inches is a real published figure and it
is the TABLE's.

### The shape of the fix

- **`geometry.ts` is the one home of the field's dimensions**, and it now
  states five numbers rather than two, each with the source document named.
  The coordinate space stays the TABLE, origin at its launch area corner, so
  **no stored row changed meaning and 0012's CHECK constraints stayed
  exact**. That is the reason this bundle needed no migration.
- **The mat's own size is DERIVED in the direction FIRST publishes it.** The
  BIOGLOW 2026-27 Robot Game Table Building Instructions state the setup, not
  the sheet: mat flush to the bottom wall, centred left to right, 181 mm
  (7.15 in) of bare table each side, 9 mm (0.35 in) at the top. So
  `2362 - 2 x 181 = 2000` and `1143 - 9 = 1134`.
- **The 2000 is confirmed twice and the 1134 is not**, and the file says so
  in place: the official mat wireframe is a 20 cm grid ten columns wide
  across the long axis, which is 2000 mm independently of the arithmetic
  above. Nothing publishes the short axis the same way, so the 1134 rests on
  the 9 mm top gap alone. **That is the line to change if the gap figure is
  ever restated.**
- `calibration.ts`: the two corner taps now locate the MAT in the picture,
  which is the rectangle with a printed edge a mentor can actually hit.
  `imageToMat`, `matToImage` and `calibrationMatrix` land the picture on the
  mat at its correct offset inside the table.
- `MatCanvas` draws the table as the drivable region and the mat as a
  distinct sheet inside it, with the two side strips and the top gap visible
  as bare table. The picture, the grid and the mat frame belong to the mat.
  **The waypoint clamp is unchanged: the table is drivable**, because a robot
  may legally sit on bare table beside the sheet.
- `units.ts` gains a second tick series. The table series keeps the round
  numbers and the inch ticks, which were always the table's 93 by 45 inches;
  the mat series marks where the printed sheet starts and ends, labelled in
  the mat's own coordinates and drawn on the opposite edges.
- `MatCalibrator` states the mat's size as a fact rather than asking for it,
  and offers a one tap confirmation when a fresh upload is the right shape to
  be a crop of the mat. Corner tapping is always one control away and needs
  no re-upload; when the shape test fails the screen leads with corner
  tapping and says why in one sentence.

### The contrast defect it also closed

Older than this change and found by the sweep: over a background picture the
blanket label halo was drawn behind the waypoint number, whose ink is light
on most team accents, **so a light glyph sat on a light halo at a ratio of
1.00**. The dot carries that label's contrast; it needs no halo, and the halo
is gone.

### What this entry does not record

The session's own verification. The diff touches
`tests/mat-image-roundtrip.test.ts`, `tests/planner-calibration.test.ts` and
`tests/planner-geometry.test.ts` (+501 lines across the three), so the
arithmetic was tested; whether the planner was driven in a browser
afterwards, and what a mentor saw, is not recoverable from git and is not
claimed here.

The nine files it changed: `MatCalibrator.svelte`, `MatCanvas.svelte`,
`RoutePlanner.svelte`, `calibration.ts`, `geometry.ts`, `units.ts` and the
three test files.
