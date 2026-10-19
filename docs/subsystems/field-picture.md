# The field picture

Moved verbatim from `CLAUDE.md` (Conventions) on 2026-10-19, so `CLAUDE.md` stays under 3,000 words. `CLAUDE.md` links here; keep this file current in the same change as anything it describes.

### The field picture

The route planner can draw the real field layout under its schematic. That
picture is FIRST and LEGO copyrighted and this repo is public, so the rules
below are about DISTRIBUTION first and accuracy second. Both are load-bearing.

- **NO FIRST OR LEGO *SEASON OR GAME* ARTWORK IS EVER TRACKED, BUNDLED, OR
  PUBLICLY SERVED** -- field layouts, mat graphics, mission model renders,
  building instructions, season lockups.
  Not in git, not in `static/`, not in a component as a data URI, not on any
  public URL. (The official LOGO files are the deliberate exception and ARE
  tracked; see "FIRST branding" below for why and under what permission.) The working copy lives in `local-assets/`, which is gitignored
  for exactly this reason, and is used only to develop and test against. The
  ONE path into the app is a mentor uploading it to `teams/<team_id>/field`
  in the private `mat` bucket, read back by a signed URL that expires in ten
  minutes (`MAT_IMAGE_URL_TTL_S`). Storage RLS answers that folder to a
  mentor or to a member of that team and to nobody else; `mat_images` (0017)
  carries the row, and its `storage_path` is GENERATED so a client cannot
  point a team's row at another team's object. A fixture standing in for the
  picture -- in a dev harness, a test, a screenshot -- is DRAWN BY THIS REPO,
  never a crop of theirs.
- **WHY `local-assets/` EXISTS AT ALL.** Some source material has to be on
  the machine to build against and cannot be committed. That directory is
  where it goes, and everything in it is assumed undistributable. Do not read
  from it at runtime, do not import from it, and do not add a build step that
  copies out of it.
- **A BACKGROUND PICTURE IS NEVER STRETCHED TO FIT, AND AN UNCALIBRATED ONE
  IS NOT DRAWN.** A real field layout includes the border walls, so the
  picture is a different shape from the 2362 by 1143 mm playing surface
  inside it. Stretching it to the mat rectangle moves every mission marker,
  and the error is INVISIBLE -- the picture still fills the rectangle and
  still looks like a mat. Measured on the club's own layout image, corner to
  corner stretch is 183 mm out at the corner of the surface and 4 mm out dead
  centre: a robot's length of error hiding behind a centre that agrees. So a
  mentor taps two opposite corners of the playing surface and
  `src/lib/planner/calibration.ts` derives the transform; a picture with no
  stored calibration is left off the mat entirely. There is no fallback
  transform anywhere, and adding one is not an improvement.
- **THE CALIBRATION IS PROVED BEFORE IT IS DRAWN, TWICE.** By arithmetic
  (`tests/planner-calibration.test.ts`, known inputs, green before any screen
  existed, the way `geometry.ts` was), and by SHOWING A MENTOR. A wrong
  transform cannot be caught downstream, so `MatCalibrator.svelte` draws the
  mat back onto the picture -- surface outline, 250 mm grid, a tick every
  foot -- and asks for a look before saving. Any future surface that maps
  between a picture and the world owes the same confirmation.
- **THE TRANSFORM LIVES IN TYPESCRIPT, LIKE THE ROUTE GEOMETRY, AND FOR THE
  SAME REASON**: it recomputes under a finger, mid-gesture, possibly offline.
  There is no SQL twin. 0017 stores the two taps and refuses a pair it could
  not invert; it does not restate the arithmetic.
- **THE MAT IS A LIGHT PLATE ON BOTH GROUNDS.** `MatCanvas` and
  `MatCalibrator` carry `data-ground="light"`, so the schematic, the picture,
  the scrim and every overlay look the same whether the app around them is
  white or dark. The dimming scrim is `--surface-0` and a real field layout is
  a LIGHT drawing, so on a white ground "dim" means "fade the picture toward
  white until the plan on top reads". Let the scrim follow a dark ground and
  the same slider fades a light drawing toward black: glare at 0%, black at
  90%, and in the middle the picture passes through the lightness of the ink on
  top of it and the labels vanish. The cost, accepted: on the dark ground the
  planner is a light rectangle in dark chrome. A fixture standing in for the
  picture is a LIGHT drawing too, or the harness is testing the easy case.
- **ANYTHING DRAWN OVER THE PICTURE CARRIES ITS OWN CONTRAST.** A layout is
  dense line art in every colour, so nothing on top may assume an even dark
  ground. `MatCanvas` switches on a contrast layer only while a picture is
  shown: the dimming scrim (a per-team setting), a dark casing under the
  route, and `paint-order: stroke` outlines behind every label. With no
  picture none of it is drawn and the schematic stays plain. A new overlay
  element joins that layer or it is illegible on a busy mat.
- **A SCREEN WHERE TWO TAPS MUST LAND IN THE SAME FRAME MUST NOT MOVE
  BETWEEN THEM.** The calibrator's instruction line changes at every step; on
  a narrow column that slid the picture 48 px up between tap one and tap two,
  so the second corner landed where the mentor was no longer aiming. All
  three sentences now share one grid cell, so the box is as tall as the
  longest at any width. A `min-height` cannot fix this: the wrap point
  depends on the width.
