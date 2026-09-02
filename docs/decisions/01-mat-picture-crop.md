# 01 Is the club's field picture a crop of the mat, or is it a different rectangle?
- Raised: 2026-09-01 by the chat "FLL app feature requests and improvements"
- Status: open
- Default: treat it as a real crop. The aspect error is about 14 mm at the long edge, which is below the planner's own placement tolerance.
- Settles it: measuring the printed mat, or re-exporting the picture from a source whose crop is known.

## The numbers

The club's own field picture is **2019 by 1153 pixels**, an aspect ratio of
1.7511. The mat is 2000 by 1134 mm (`src/lib/planner/geometry.ts`, and see
`docs/history/planner-mat-dimensions-a5nt7m.md` for how those two numbers are
derived and which of them is confirmed twice), an aspect ratio of 1.7637.

The picture is therefore **0.71 percent off** the mat's own ratio.

## What depends on the answer

If the picture IS a crop of the mat and the 0.71 percent is scanning or
export slop, then calibrating to its corners is correct and the residual
error is spread across the sheet. Taken at the long edge, 0.71 percent of
2000 mm is about **14 mm**. A waypoint is placed by a finger on a tablet and
a robot's own repeatability across a 2 m drive is worse than that, so it
disappears into the noise.

If the picture is NOT a crop of the mat -- if it includes a sliver of border
wall on one axis, or is a notebook diagram of the whole table rather than a
photograph of the sheet -- then the two corner taps are landing on the wrong
rectangle and the error is systematic rather than slop. **That is the case
0017's calibration exists to catch and cannot catch by itself**: two taps
define a transform whatever they land on.

## What is already shipped on the default

`MatCalibrator` offers a one-tap confirmation when a fresh upload is "the
right shape to be a crop of the mat", and corner tapping when it is not. The
shape test is what makes this decision a default rather than a silent
assumption: a picture that fails it leads with corner tapping and says why.
The aspect note deliberately **does not block the save** and does not read as
an error, because a legitimate picture can fail the test (the official FLL
engineering notebook path-planning diagram is nearer 1.75:1, and a mentor
calibrating one for real hit exactly this; see
`docs/history/record-two-defects-a-mentor-s-first-real-calibration-found.md`).

## What would settle it

A tape measure on the printed mat, or the picture re-exported from a source
whose crop is known. Until then: **verify against the printed mat before any
waypoint is trusted for a competition run**, which is the same sentence
decision 02 ends on and for the same reason.
