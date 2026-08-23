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
 * - Coordinates are millimeters. Origin is the launch area corner of the mat.
 *   x runs along the 93 inch edge, y along the 45 inch edge, y UP as the mat
 *   is displayed (origin bottom left).
 * - Headings are degrees counterclockwise from +x, normalized to [0, 360).
 * - A positive turn is LEFT (counterclockwise seen from above), negative is
 *   RIGHT. Turns are reported in (-180, 180]: the robot never turns the long
 *   way around.
 * - The first segment gets no turn by default: the kid aims the robot in the
 *   launch area. Pass `initialHeadingDeg` to model a fixed starting aim.
 * - Drives are centimeters because that is the unit the students' code takes.
 */

/** The official mat is 93 by 45 inches: 2362 by 1143 millimeters. */
export const MAT_WIDTH_MM = 2362;
export const MAT_HEIGHT_MM = 1143;

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
 * A route -- ordered waypoints in mat millimeters -- becomes the movement
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
