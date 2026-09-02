# 02 Is the launch area printed on the mat, or anchored to the table?
- Raised: 2026-09-01 by the chat "FLL app feature requests and improvements"
- Status: open
- Default: on the mat, per the BIOGLOW table building instructions.
- Settles it: looking at the printed mat, or the season's own table instructions read again with this question in mind.

## Why it matters, in one number

**181 mm.** That is the strip of bare table on each side of the mat
(`geometry.ts`; the mat is centred left to right inside the 2362 mm table).
`mat_config`'s launch area is stored in TABLE coordinates, origin at the
launch area corner, so:

- if the launch area is printed ON THE MAT, its left edge is 181 mm from the
  table's own left edge, and its stored numbers are correct as they stand;
- if it is anchored to the TABLE -- the corner of the box rather than the
  corner of the sheet -- every stored launch dimension is displaced by that
  181 mm.

A robot leaves the launch area at the start of every run. A 181 mm error in
where the planner thinks it starts is roughly the robot's own length, and it
is applied to every waypoint on every launch.

## Why it is genuinely open

The BIOGLOW 2026-27 Robot Game Table Building Instructions describe the mat's
PLACEMENT (flush to the bottom wall, centred left to right) rather than the
sheet's own printed content, which is what made the mat's dimensions a
derivation in the first place. The same document is therefore not a direct
answer to where the launch area's edge is: it says where the mat goes, not
what is on it.

The default is "on the mat" because a launch area a team can see and place a
robot against is a printed feature of the sheet, and because the setup
instructions treat the sheet as the thing that is positioned.

## What is already shipped on the default

`MatCanvas` draws the launch area from `mat_config` in table coordinates and
labels it. Nothing in the app asks a mentor which anchor they measured
against, and nothing warns that the two readings differ by 181 mm.

## What would settle it

Standing in front of the printed mat. **Until somebody has, no waypoint near
the launch area should be trusted for a competition run without checking it
against the physical field first** -- which is the same caution decision 01
ends on, and the two compound: a crop error of 14 mm and an anchor error of
181 mm are both invisible on screen and both land on the same drive.
