/**
 * ROUTE GEOMETRY. The one implementation of "a path becomes robot moves".
 *
 * THE POINT OF THE PLANNER IS THIS FILE. Kids can picture where the robot
 * should go; they cannot turn the picture into the numbers their SPIKE Prime
 * code takes. Every number the movement list shows -- turn N degrees left or
 * right, drive N centimeters -- comes from here and nowhere else.
 *
 * WHY THIS RULE LIVES IN TYPESCRIPT AND NOT SQL. The repo's standing rule is
 * that a derived answer is defined once, in SQL. This one is defined once, in
 * TypeScript, because it has to be recomputed live under a child's finger
 * mid-drag on a tablet that may be offline: SQL cannot run there. The rule is
 * still defined exactly once -- there is no SQL twin, and no screen computes a
 * turn or a drive any other way.
 *
 * CONVENTIONS, FIXED HERE AND MIRRORED BY THE MAT RENDERING:
 * - Coordinates are millimeters. Origin is the launch area corner of the
 *   TABLE, x along the 93 inch edge, y along the 45 inch edge, y UP as the
 *   field is displayed (origin bottom left). The TABLE, not the mat: see the
 *   two rectangles below. Every stored waypoint and mission position is in
 *   this space, which is why the correction to the mat's size changed no
 *   stored number and no database CHECK.
 * - Headings are degrees counterclockwise from +x, normalized to [0, 360).
 * - A positive turn is LEFT (counterclockwise seen from above), negative is
 *   RIGHT. Turns are reported in (-180, 180]: the robot never turns the long
 *   way around.
 * - The first segment gets no turn by default: the kid aims the robot in the
 *   launch area. Pass `initialHeadingDeg` to model a fixed starting aim.
 * - Drives are centimeters because that is the unit the students' code takes.
 */

/* ---------------------------------------------------------------------------
   THE FIELD IS TWO RECTANGLES AND THIS IS THE ONLY PLACE THAT SAYS SO.

   THE TABLE is the wooden box the match is played in: 2362 by 1143 mm inside
   its border walls, which is the 93 by 45 inches everybody quotes. It is the
   coordinate space (origin at the launch area corner, y up) and it is the
   DRIVABLE region: a robot may sit on bare table beside the mat, so a
   waypoint may too.

   THE MAT is the printed sheet inside it: 2000 by 1134 mm. It is SMALLER
   than the table on purpose, and the missions are printed on it.

   FIRST PUBLISHES THE STRIPS AND THE GAP, NOT THE MAT. The BIOGLOW 2026-27
   Robot Game Table Building Instructions state the setup, not the sheet: the
   mat lies flush against the bottom border wall and centred left to right,
   which leaves a strip of bare table 181 mm (7.15 in) by 1143 mm on EACH
   side and a 9 mm (0.35 in) gap at the top wall. So the mat's own size is
   DERIVED here, in the direction FIRST states it:

       2362 - 2 x 181 = 2000   the mat's width
       1143 -     9   = 1134   the mat's height

   THE 2000 IS CONFIRMED TWICE and the 1134 is not. The official mat
   wireframe is a 20 cm grid TEN COLUMNS wide across the long axis, which is
   2000 mm independently of any arithmetic done here. Nothing publishes the
   short axis the same way, so the 1134 rests on the 9 mm top gap alone; if
   that figure is ever restated, this is the line to change.

   WHAT THIS REPLACES, BECAUSE IT WAS WRONG FOR SIX BUNDLES. These constants
   used to read "the official mat is 93 by 45 inches: 2362 by 1143 mm". The
   numbers were the table's and the sentence said mat, so the planner laid
   every uploaded picture of the MAT across the whole TABLE: 18.1% too long
   on x, 0.8% too tall on y, and because those two are DIFFERENT the stretch
   also rotated every heading the movement list reports. One rectangle where
   there are two is not a rounding error, it is the module's one job.

   NOTHING ELSE IN THE REPO HARDCODES ANY OF THESE FIVE NUMBERS.
   --------------------------------------------------------------------------- */

/** Inside the border walls: the coordinate space and the drivable region. */
export const TABLE_WIDTH_MM = 2362;
export const TABLE_HEIGHT_MM = 1143;

/** Bare table each side of the mat, from the Table Building Instructions. */
export const MAT_SIDE_STRIP_MM = 181;
/** Bare table between the top edge of the mat and the top wall. Same source. */
export const MAT_TOP_GAP_MM = 9;

/** The printed mat: 2000 by 1134 mm, derived above and asserted in the tests. */
export const MAT_WIDTH_MM = TABLE_WIDTH_MM - 2 * MAT_SIDE_STRIP_MM;
export const MAT_HEIGHT_MM = TABLE_HEIGHT_MM - MAT_TOP_GAP_MM;

/**
 * Where the mat's own (0, 0) sits in table coordinates. Flush with the bottom
 * wall, so the y offset is genuinely zero; the x offset is one side strip.
 */
export const MAT_ORIGIN_X_MM = MAT_SIDE_STRIP_MM;
export const MAT_ORIGIN_Y_MM = 0;

/** A point in the mat's own millimetres, in table millimetres. */
export function matToTable(p: PointMm): PointMm {
	return { x: p.x + MAT_ORIGIN_X_MM, y: p.y + MAT_ORIGIN_Y_MM };
}

/** A point in table millimetres, in the mat's own. Negative means off the mat. */
export function tableToMat(p: PointMm): PointMm {
	return { x: p.x - MAT_ORIGIN_X_MM, y: p.y - MAT_ORIGIN_Y_MM };
}

/** Whether a table point is on the printed mat rather than on bare table. */
export function onMat(p: PointMm): boolean {
	const m = tableToMat(p);
	return m.x >= 0 && m.y >= 0 && m.x <= MAT_WIDTH_MM && m.y <= MAT_HEIGHT_MM;
}

/** A Robot Game match is 2 minutes 30 seconds. */
export const MATCH_SECONDS = 150;

export interface PointMm {
	x: number;
	y: number;
}

export interface Move {
	/** Absolute heading driven on this segment, degrees CCW from +x, [0, 360). */
	headingDeg: number;
	/** Signed turn taken before the drive. Positive = left, in (-180, 180]. */
	turnDeg: number;
	/** 'left', 'right', or null when no turn is needed. */
	turnDirection: 'left' | 'right' | null;
	/** Distance driven, in centimeters. */
	driveCm: number;
	from: PointMm;
	to: PointMm;
}

/** Heading from one point to another, degrees CCW from +x, in [0, 360). */
export function headingDeg(from: PointMm, to: PointMm): number {
	const raw = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
	return ((raw % 360) + 360) % 360;
}

/**
 * The signed turn from one heading to another, in (-180, 180]. This is where
 * wrapping lives: 350 to 10 is +20 (a small left), never -340.
 */
export function turnDelta(fromDeg: number, toDeg: number): number {
	const delta = (((toDeg - fromDeg) % 360) + 360) % 360;
	return delta > 180 ? delta - 360 : delta;
}

function distanceMm(a: PointMm, b: PointMm): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * A route -- ordered waypoints in TABLE millimetres -- becomes the movement
 * list. One Move per segment: turn to face the next waypoint, then drive to
 * it. Heading is tracked through the whole path. Consecutive duplicate
 * waypoints (a double tap) are skipped rather than emitting a zero drive.
 */
export function routeMoves(waypoints: PointMm[], initialHeadingDeg?: number): Move[] {
	const pts: PointMm[] = [];
	for (const p of waypoints) {
		const last = pts[pts.length - 1];
		if (!last || distanceMm(last, p) > 1e-6) pts.push(p);
	}
	if (pts.length < 2) return [];

	const moves: Move[] = [];
	let heading = initialHeadingDeg ?? headingDeg(pts[0], pts[1]);
	for (let i = 0; i < pts.length - 1; i++) {
		const from = pts[i];
		const to = pts[i + 1];
		const segHeading = headingDeg(from, to);
		const turn = turnDelta(heading, segHeading);
		moves.push({
			headingDeg: segHeading,
			turnDeg: turn,
			turnDirection: turn > 0 ? 'left' : turn < 0 ? 'right' : null,
			driveCm: distanceMm(from, to) / 10,
			from,
			to
		});
		heading = segHeading;
	}
	return moves;
}

export function totalDriveCm(moves: Move[]): number {
	return moves.reduce((sum, m) => sum + m.driveCm, 0);
}

/**
 * How long one launch takes: driving at the robot's speed, plus a dwell for
 * every mission it attempts (lining up, working the model, backing off).
 */
export function launchSeconds(
	driveCm: number,
	missionCount: number,
	speedCmPerS: number,
	dwellSPerMission: number
): number {
	if (!(speedCmPerS > 0)) return Number.POSITIVE_INFINITY;
	return driveCm / speedCmPerS + missionCount * Math.max(0, dwellSPerMission);
}

/**
 * How long the whole strategy takes: every launch, plus the between-launch
 * handling time (swap the attachment, aim, relaunch) for every gap between
 * consecutive launches.
 */
export function strategySeconds(launchDurationsS: number[], betweenLaunchesS: number): number {
	const gaps = Math.max(0, launchDurationsS.length - 1);
	return launchDurationsS.reduce((sum, s) => sum + s, 0) + gaps * Math.max(0, betweenLaunchesS);
}

/** One scoring line of a mission, as stored in missions.scoring. */
export interface ScoringLine {
	label: string;
	points: number;
	bonus?: boolean;
}

/**
 * The points a team plans to score on one mission: the sum of the scoring
 * lines they ticked. Indexes outside the list are ignored, and a repeated
 * index counts once, so a stale selection never inflates the total.
 */
export function plannedPoints(scoring: ScoringLine[], selectedLines: number[]): number {
	let sum = 0;
	for (const i of new Set(selectedLines)) {
		const line = scoring[i];
		if (line && Number.isFinite(line.points)) sum += line.points;
	}
	return sum;
}

/** Whether a point sits inside the launch area rectangle anchored at the origin. */
export function inLaunchArea(p: PointMm, launchWmm: number, launchHmm: number): boolean {
	return p.x >= 0 && p.y >= 0 && p.x <= launchWmm && p.y <= launchHmm;
}

/** "1:52" from 112 seconds. Rounds to the nearest whole second. */
export function formatSeconds(totalS: number): string {
	if (!Number.isFinite(totalS)) return '--:--';
	const s = Math.max(0, Math.round(totalS));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
