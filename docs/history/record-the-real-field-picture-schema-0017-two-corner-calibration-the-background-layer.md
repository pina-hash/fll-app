---
title: "2026-08-24 -- The real field picture: schema 0017, two-corner calibration, the background layer"
date: 2026-08-24
branches: []
migrations: ["0017"]
subsystems: ["Route planner, field picture"]
record_order: 9
---

The route planner could already show a background picture. It stretched
whatever was uploaded corner to corner across the 2362 by 1143 mm mat
rectangle, on the assumption that a mentor had cropped it exactly to the mat
borders, and it let any signed-in account in the club read it. The club's
actual picture is the official BIOGLOW field layout, which breaks both
assumptions at once: it includes the border walls, so it is a different shape
from the surface inside it, and it is FIRST and LEGO copyrighted, so it
cannot be shown to a bucket-wide audience and certainly cannot enter a public
repo. This bundle replaces the transform and narrows the door.

### What changed

- **`supabase/migrations/0017_mat_image_calibration.sql`.** `mat_images`: one
  row per team, holding the picture's pixel size, the two calibration corners
  as fractions of the picture, and the dim setting. `storage_path` is
  `GENERATED ALWAYS` as `teams/<team_id>/field`, so a client cannot make a
  team's row point at another team's object. Three checks make a stored
  calibration one that can actually be inverted: all four corners or none, all
  inside the frame, and at least 0.05 of the picture on each axis. Mentors
  write; mentors and the row's own team read. The storage read policy replaces
  0012's bucket-wide `using (bucket_id = 'mat')` with one scoped on
  `storage.foldername(name)[2]`, so an object outside `teams/<team_id>/` --
  including 0012's root-level `mat.jpg` -- falls to mentors only.
- **`src/lib/planner/calibration.ts`**, the whole transform: two opposite
  corners of the playing surface, in picture fractions, give an origin and an
  INDEPENDENT scale per axis. `imageToMat`, `matToImage`, and the SVG matrix
  that lays a unit-square `<image>` onto the mat rectangle. Orientation is
  free: a mirrored or upside-down picture produces a negative scale and maps
  correctly, which is why the placement is a matrix and not `x/y/width/height`
  (`<image width>` refuses a negative).
- **`MatCalibrator.svelte`**: tap the launch-area corner, tap the opposite
  one, then look at the mat drawn BACK onto the picture -- surface outline,
  250 mm grid, a tick every foot -- before saving. Four percentage fields are
  the same state as the taps: the keyboard path, and the way to nudge a corner
  by a tenth of a percent.
- **`MatCanvas.svelte`**: the picture is placed by its calibration and clipped
  to the mat rectangle, so the walls are cut away. A picture with no
  calibration is NOT DRAWN. A contrast layer switches on only while a picture
  is shown: a dimming scrim at the team's setting, a dark casing under the
  route, `paint-order: stroke` outlines behind every label, heavier grid,
  frame and dots.
- **`field-image.ts`** replaces `photo.ts`. An already-acceptable file is
  uploaded UNTOUCHED (a layout is line art; a JPEG round trip softens exactly
  the edges a mentor calibrates against), and only an oversized or unusual one
  is re-encoded, PNG staying PNG. A new upload CLEARS the calibration, because
  two corners describe one picture.
- **Signed URLs are ten minutes** (`MAT_IMAGE_URL_TTL_S`), down from eight
  hours, and the canvas asks for a fresh one once if a draw fails.
- **`local-assets/` is gitignored**, and CLAUDE.md gained a "The field
  picture" section stating the distribution rule, the no-stretch rule, and the
  contrast rule.

### Load-bearing decisions

- **THE TRANSFORM IS TWO CORNERS AND NOTHING MORE.** Two opposite corners of
  an axis-aligned rectangle are exactly the freedom a picture-inside-walls
  needs: an origin and an independent scale per axis. Rotation and perspective
  were deliberately left out. A picture taken at an angle is the wrong
  picture, not a harder transform, and pretending otherwise would put a fourth
  and fifth number in front of a mentor with nothing to measure them against.
- **AN UNCALIBRATED PICTURE IS NOT DRAWN, AND THERE IS NO FALLBACK.** This is
  the whole bundle in one rule. The old behaviour was not "no calibration", it
  was "a guessed calibration", and the guess looked exactly like a correct
  one. `fetchMatImage` returns `calibration: null` for any stored pair the
  transform could not invert, and null means the layer is absent.
- **THE CONFIRMATION IS PART OF THE FEATURE, NOT POLISH.** Nothing downstream
  can catch a wrong transform, so the only defence is a drawing a mentor can
  judge against the mat in front of them. The aspect check is the one mis-tap
  arithmetic can catch alone (two corners on the same side make a rectangle of
  the wrong shape) and it names the number rather than just objecting.
- **PER-TEAM FOLDER, GENERATED PATH.** The boundary is a constraint before it
  is a policy, the same instinct as the composite foreign keys on the work
  surface. A client can send `storage_path` and still cannot change it.
- **THE DIM SLIDER IS LOCAL FIRST, PERSISTED FOR MENTORS.** The row is
  mentor-writable, so a student dragging it adjusts their own screen for the
  session rather than being told a write failed.
- **THE CALIBRATOR'S INSTRUCTION BOX IS ONE GRID CELL HOLDING ALL THREE
  SENTENCES.** Measured: with the sentences swapped in and out, a narrow
  column slid the picture 48 px UP between tap one and tap two, so the second
  corner landed where the mentor was no longer aiming. A `min-height` does not
  fix it because the wrap point depends on the width.

### What was measured

- **The error the old transform made, on the club's own 2019 by 1153 image**:
  against a plausible true calibration, corner-to-corner stretch is **183 mm**
  out at the corner of the playing surface, **153 mm** a little inside it, and
  **4 mm** dead centre. A SPIKE Prime robot is about 200 mm long, and the
  agreeing centre is why the error hides.
- **`tests/planner-calibration.test.ts`, 26 tests, green before any screen
  existed**: both tapped corners map to (0, 0) and (2362, 1143), the midpoint
  to the mat centre, the other two rectangle corners to the other two mat
  corners; an off-square calibration (0.72 of the width by 0.60 of the height
  on a square picture) maps by two independent scales; the inverse round-trips
  to 1e-12; all four picture orientations map correctly; degenerate pairs are
  refused with a positive control one step wider; the drawing matrix puts the
  tapped corners on the mat rectangle corners.
- **The calibration tests bite**: `imageToMat` mutated to the old stretch
  reddened **14 of the 26**; `calibration.ts` restored to an identical md5
  (`1ca1732cdb8a965296cfaf49daec2797`) and re-verified green.
- **`tests/mat-image-roundtrip.test.ts`, 19 tests, against the REAL picture**
  (`local-assets/bioglow-field.png`, 2019x1153, 187101 bytes, printed by the
  file so it is never in doubt): a real mentor GoTrue session uploads it into
  `teams/<id>/field`, calibrates, places a mission marker through the
  transform with the shipping `applyPlannerOp`, and a FRESH signed-in client
  reloads the whole page through `loadPlannerData` -- the marker returns at
  the same millimetre AND redraws within one pixel of the tap. The negative
  control reads the same stored millimetre through stretch-to-fit and lands
  more than 50 px away.
- **The picture is signed-URL only**: the URL serves the exact byte count; the
  same URL with the token stripped is refused; the public object endpoint does
  not serve it; an anon client cannot mint a signed URL at all. Positive
  control on every one.
- **Another team cannot fetch it**: no row, no signed URL, an empty list and a
  refused download, with the service role showing the row and the object both
  exist. Their OWN team's folder is the positive control and lists.
- **The isolation tests bite**: the storage read policy reverted to 0012's
  `using (bucket_id = 'mat')` and the `mat_images` select policy widened to
  `using (true)` reddened exactly the two cross-team tests; restored by
  `supabase db reset` from the migration files and re-verified green (policy
  expression re-read from `pg_policy`).
- **In the browser, in the live DOM at 1440x900**: the fixture picture's four
  playing-surface corners land on the mat rectangle corners at **(0, 0),
  (2362, 0), (0, 1143), (2362, 1143)** exactly, read off the rendered
  `<image>`'s own transform. The negative control: the PICTURE's own corners
  land at (-192, 1374) and (2554, -229), outside the mat, which is where
  stretch-to-fit wrongly put the origin.
- **The calibration flow, driven in the browser**: two synthetic taps at the
  fixture's known corners produce 7% / 85.6% / 93% / 14.3%, the surface is
  reported as exactly 1032 by 499 pixels, and no aspect warning fires. The
  negative control, two corners on the same side, warns "26.46:1, but the
  playing surface is 2.07:1". The stage top is identical before, between and
  after the taps.
- **The contrast layer is off unless it is needed**: over the picture, labels
  carry a `rgb(11, 18, 32)` outline with `paint-order: stroke`, the route a
  26 px casing, the grid comes up to near-white at 0.4. Toggled off, all of it
  reverts to `paint-order: normal`, `stroke: none`, no casing.
- **The harness link proved both ways**: a `data-sentinel` attribute added
  inside `MatCanvas.svelte` appeared in the harness and the file was restored
  to an identical md5 (`0d965e209a9593339feb8bee493fb2b8`); the dev guard
  inverted to `if (dev)` answered 404 and was restored to an identical md5
  (`d1df12ef269cefaef6922823c9b117b9`), 200 again after.
- **375px and 1440px: 0px horizontal overflow** with no picture, an
  uncalibrated one and a calibrated one, and on the calibrator itself. The
  mission chips scroll inside their own `overflow-x: auto` container, as
  before.
- `npx svelte-check`: **0 errors, 0 warnings** (640 files). Full suite: **35
  files, 383 tests**, green.
- **The linked project is at 0017.** It was at 0016 when this bundle started;
  `supabase db push` applied 0017 and `supabase migration list` now shows
  local and remote level at 0017 for every file in the chain.

### What is explicitly NOT verified

- **`prepareFieldImage` -- the browser-only decode and re-encode half of the
  upload.** It needs `createImageBitmap` and a canvas, so the round-trip test
  drives `uploadFieldImage` with real PNG bytes instead. What is unproved is
  specifically the pass-through-versus-re-encode decision and the pixel
  measurement, not the network path or the calibration.
- **The mentor console pages through a real Google sign-in.** OAuth needs a
  human. The upload, calibration, storage and reload paths are proved at the
  data layer with a real mentor GoTrue session, and the UI is proved in the
  harness mounting the real `RoutePlanner`; what is unproved is the two joined
  end to end in one browser tab.
- **Screenshots.** The Browser pane was not displayed in this session, so
  every visual claim above is a measurement read out of the live DOM
  (transforms, computed styles, bounding rectangles) rather than a picture.
  For the calibration claim that is the stronger evidence; for "does it look
  right over a real layout" it is not evidence at all, and a mentor's eye on
  the confirmation overlay remains the last check.
- **The real picture rendered under the schematic.** The browser checks used
  the harness's own drawn stand-in, because the real layout is copyrighted and
  cannot be a fixture. The real one went through the storage and calibration
  path in the test suite, not through a rendered canvas.
- **Whether the club's chosen calibration is correct.** Only a mentor looking
  at the confirmation overlay can say that. Nothing here knows where the
  playing surface is in their picture.

### Deferred

- **Rotation and perspective correction.** Two corners cannot model either.
  A picture taken at an angle should be retaken.
- **Per-team mission positions.** `missions.position_*` is still global, as
  0011 left it: all four teams play the same mat, so one placement serves
  them all. Only the PICTURE is per team, because the file is theirs.
- **Calibrating from the launch area rectangle instead.** `mat_config` still
  holds the launch area as two numbers a mentor measures; it could be tapped
  on the picture once a calibration exists. Not needed to fix the marker
  positions, which is what this bundle was for.
- **Removing 0012's root-level `mat.jpg` if the linked project has one.** The
  migration refuses to delete objects; it only narrows who may read them, and
  reports the count.

---

