// tests/planner-geometry.test.ts
//
// THE MATH FIRST, IN ISOLATION. Every number the planner shows a child comes
// out of src/lib/planner/geometry.ts, so the known-answer cases live here and
// ran green before any UI existed: a square path is four 90 degree turns and
// four equal drives, a straight line is zero turns, and heading wraps
// correctly past 360 and past 0. This file needs no database and no stack.

import { describe, expect, test } from 'vitest';
import {
	MAT_HEIGHT_MM,
	MAT_WIDTH_MM,
	MATCH_SECONDS,
	formatSeconds,
	headingDeg,
	inLaunchArea,
	launchSeconds,
	plannedPoints,
	routeMoves,
	strategySeconds,
	totalDriveCm,
	turnDelta
} from '../src/lib/planner/geometry';

describe('mat constants', () => {
	test('the mat is 93 by 45 inches in millimeters and a match is 150 seconds', () => {
		expect(MAT_WIDTH_MM).toBe(2362);
		expect(MAT_HEIGHT_MM).toBe(1143);
		expect(MATCH_SECONDS).toBe(150);
	});
});

describe('headingDeg', () => {
	test('the four compass directions, y up', () => {
		const o = { x: 0, y: 0 };
		expect(headingDeg(o, { x: 100, y: 0 })).toBe(0);
		expect(headingDeg(o, { x: 0, y: 100 })).toBe(90);
		expect(headingDeg(o, { x: -100, y: 0 })).toBe(180);
		expect(headingDeg(o, { x: 0, y: -100 })).toBe(270);
	});

	test('a diagonal', () => {
		expect(headingDeg({ x: 0, y: 0 }, { x: 100, y: 100 })).toBeCloseTo(45, 6);
	});
});

describe('turnDelta: the wrap', () => {
	test('past 0/360 in both directions', () => {
		expect(turnDelta(350, 10)).toBe(20);
		expect(turnDelta(10, 350)).toBe(-20);
		expect(turnDelta(359, 1)).toBe(2);
		expect(turnDelta(1, 359)).toBe(-2);
	});

	test('no turn, small turns, and the half turn lands in (-180, 180]', () => {
		expect(turnDelta(90, 90)).toBe(0);
		expect(turnDelta(0, 90)).toBe(90);
		expect(turnDelta(90, 0)).toBe(-90);
		expect(turnDelta(0, 180)).toBe(180);
		expect(turnDelta(90, 270)).toBe(180);
		expect(turnDelta(0, 181)).toBe(-179);
	});
});

describe('routeMoves', () => {
	test('a square path returns four 90 degree turns and four equal drives', () => {
		// Robot aimed along +x, square driven starting north: every corner is a
		// 90, and the first leg needs a 90 too because the aim is perpendicular.
		const square = [
			{ x: 0, y: 0 },
			{ x: 0, y: 1000 },
			{ x: 1000, y: 1000 },
			{ x: 1000, y: 0 },
			{ x: 0, y: 0 }
		];
		const moves = routeMoves(square, 0);
		expect(moves).toHaveLength(4);
		expect(moves.map((m) => Math.abs(m.turnDeg))).toEqual([90, 90, 90, 90]);
		expect(moves.map((m) => m.driveCm)).toEqual([100, 100, 100, 100]);
		expect(moves.map((m) => m.turnDirection)).toEqual(['left', 'right', 'right', 'right']);
	});

	test('with the default aim (facing the first waypoint) the square starts turn-free', () => {
		const square = [
			{ x: 0, y: 0 },
			{ x: 0, y: 1000 },
			{ x: 1000, y: 1000 },
			{ x: 1000, y: 0 },
			{ x: 0, y: 0 }
		];
		const moves = routeMoves(square);
		expect(moves.map((m) => m.turnDeg)).toEqual([0, -90, -90, -90]);
	});

	test('a straight line returns zero turns', () => {
		const line = [
			{ x: 0, y: 0 },
			{ x: 500, y: 0 },
			{ x: 1500, y: 0 }
		];
		const moves = routeMoves(line);
		expect(moves).toHaveLength(2);
		expect(moves.map((m) => m.turnDeg)).toEqual([0, 0]);
		expect(moves.map((m) => m.turnDirection)).toEqual([null, null]);
		expect(moves.map((m) => m.driveCm)).toEqual([50, 100]);
	});

	test('a route that crosses the 0/360 seam turns the short way', () => {
		// First leg slightly below east (354.29), second slightly above (5.71):
		// the turn between them is +11.42 left, never -348 and change.
		const moves = routeMoves([
			{ x: 0, y: 100 },
			{ x: 1000, y: 0 },
			{ x: 2000, y: 100 }
		]);
		expect(moves).toHaveLength(2);
		expect(moves[0].headingDeg).toBeCloseTo(354.289, 3);
		expect(moves[1].headingDeg).toBeCloseTo(5.711, 3);
		expect(moves[1].turnDeg).toBeCloseTo(11.421, 3);
		expect(moves[1].turnDirection).toBe('left');
	});

	test('heading is TRACKED through the path, not reset per segment', () => {
		const moves = routeMoves(
			[
				{ x: 0, y: 0 },
				{ x: 1000, y: 0 },
				{ x: 1000, y: 1000 },
				{ x: 0, y: 1000 }
			],
			0
		);
		expect(moves.map((m) => m.turnDeg)).toEqual([0, 90, 90]);
		expect(moves.map((m) => m.headingDeg)).toEqual([0, 90, 180]);
	});

	test('duplicate consecutive waypoints are skipped, not zero-length drives', () => {
		const moves = routeMoves([
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			{ x: 1000, y: 0 }
		]);
		expect(moves).toHaveLength(1);
		expect(moves[0].driveCm).toBe(100);
		expect(moves[0].turnDeg).toBe(0);
	});

	test('fewer than two distinct waypoints is no movement at all', () => {
		expect(routeMoves([])).toEqual([]);
		expect(routeMoves([{ x: 5, y: 5 }])).toEqual([]);
		expect(
			routeMoves([
				{ x: 5, y: 5 },
				{ x: 5, y: 5 }
			])
		).toEqual([]);
	});
});

describe('time', () => {
	test('a launch is drive time at the configured speed plus dwell per mission', () => {
		// 300 cm at 30 cm/s is 10 s; two missions at 5 s dwell is 10 more.
		expect(launchSeconds(300, 2, 30, 5)).toBe(20);
		expect(launchSeconds(0, 0, 30, 5)).toBe(0);
	});

	test('a zero or negative speed answers infinity rather than dividing by zero', () => {
		expect(launchSeconds(100, 0, 0, 5)).toBe(Number.POSITIVE_INFINITY);
		expect(launchSeconds(100, 0, -5, 5)).toBe(Number.POSITIVE_INFINITY);
	});

	test('a strategy is its launches plus the handling gap between consecutive launches', () => {
		expect(strategySeconds([40, 35, 30], 8)).toBe(105 + 16);
		expect(strategySeconds([40], 8)).toBe(40);
		expect(strategySeconds([], 8)).toBe(0);
	});

	test('totalDriveCm sums the drives', () => {
		const moves = routeMoves([
			{ x: 0, y: 0 },
			{ x: 300, y: 0 },
			{ x: 300, y: 400 }
		]);
		expect(totalDriveCm(moves)).toBe(70);
	});

	test('formatSeconds renders match clocks the way a scoreboard does', () => {
		expect(formatSeconds(112)).toBe('1:52');
		expect(formatSeconds(150)).toBe('2:30');
		expect(formatSeconds(0)).toBe('0:00');
		expect(formatSeconds(90.4)).toBe('1:30');
		expect(formatSeconds(Number.POSITIVE_INFINITY)).toBe('--:--');
	});
});

describe('points', () => {
	const scoring = [
		{ label: 'Partially extended', points: 10 },
		{ label: 'Completely extended', points: 20 },
		{ label: 'Bonus', points: 10, bonus: true }
	];

	test('the planned total is the sum of the ticked scoring lines', () => {
		expect(plannedPoints(scoring, [0])).toBe(10);
		expect(plannedPoints(scoring, [1, 2])).toBe(30);
		expect(plannedPoints(scoring, [])).toBe(0);
	});

	test('out-of-range and repeated indexes cannot inflate the total', () => {
		expect(plannedPoints(scoring, [1, 1, 1])).toBe(20);
		expect(plannedPoints(scoring, [7, -1, 1])).toBe(20);
		expect(plannedPoints([], [0, 1])).toBe(0);
	});
});

describe('launch area', () => {
	test('inside, on the border, and outside', () => {
		expect(inLaunchArea({ x: 100, y: 100 }, 400, 600)).toBe(true);
		expect(inLaunchArea({ x: 400, y: 600 }, 400, 600)).toBe(true);
		expect(inLaunchArea({ x: 401, y: 100 }, 400, 600)).toBe(false);
		expect(inLaunchArea({ x: -1, y: 100 }, 400, 600)).toBe(false);
	});
});
