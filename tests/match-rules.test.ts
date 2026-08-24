// tests/match-rules.test.ts
//
// THE MAT SCREEN'S PURE HALF. The countdown's formatting and the preview tally
// are the two things that run under a child's finger, offline, with nothing to
// ask -- so they are pure functions and they are tested as pure functions,
// like the planner's geometry.
//
// THE TALLY IS A PREVIEW AND THE SERVER'S NUMBER IS THE TRUTH. That claim is
// only worth anything if the two agree, so the fixtures here are the REAL
// scoring lines from 0011's seed. tests/match-runs.test.ts asserts the server
// half against the same missions table; between them the preview and the
// priced total are pinned to the same source.

import { describe, expect, test } from 'vitest';
import {
	MATCH_SECONDS,
	MATCH_WARN_SECONDS,
	formatMatchClock,
	parseScoring,
	previewPoints,
	type MatchMission
} from '../src/lib/match/rules';

// M01 and M02, verbatim from 0011's seed.
const MISSIONS: MatchMission[] = [
	{
		id: 'm01',
		code: 'M01',
		name: 'Drone Survey',
		pointsLabel: '20 + 10 bonus',
		scoring: [
			{ label: 'Drone is off the mat', points: 20 },
			{ label: 'Bonus: LiDAR map flipped AND scan marker in the survey area', points: 10, bonus: true }
		]
	},
	{
		id: 'm02',
		code: 'M02',
		name: 'Exploding Seeds',
		pointsLabel: '10 each seed',
		scoring: [{ label: 'Each seed off the stalk', points: 10 }]
	}
];

describe('the match clock', () => {
	test('an FLL match is 2:30 and the warning is the last thirty seconds', () => {
		expect(MATCH_SECONDS).toBe(150);
		expect(formatMatchClock(MATCH_SECONDS)).toBe('2:30');
		expect(MATCH_WARN_SECONDS).toBe(30);
	});

	test('seconds are always two digits, so the countdown does not change width', () => {
		expect(formatMatchClock(9)).toBe('0:09');
		expect(formatMatchClock(60)).toBe('1:00');
		expect(formatMatchClock(61)).toBe('1:01');
		expect(formatMatchClock(119)).toBe('1:59');
		for (const seconds of [0, 1, 7, 59, 60, 99, 150]) {
			expect({ seconds, tail: formatMatchClock(seconds).split(':')[1].length }).toEqual({ seconds, tail: 2 });
		}
	});

	test('it rounds UP, so a clock reading 0:01 still has time on it', () => {
		// A countdown that shows 0:00 while the robot is still allowed to move
		// would stop a run a second early. Ceil is what keeps the last second
		// visible for the whole of that second.
		expect(formatMatchClock(0.1)).toBe('0:01');
		expect(formatMatchClock(0)).toBe('0:00');
		expect(formatMatchClock(149.2)).toBe('2:30');
	});

	test('it never shows a negative clock', () => {
		// Overrun is displayed as time ELAPSED past 2:30 by the component; the
		// formatter itself clamps, so a rounding slip cannot print "-0:01".
		expect(formatMatchClock(-5)).toBe('0:00');
		expect(formatMatchClock(-0.001)).toBe('0:00');
	});
});

describe('the preview tally', () => {
	test('it prices each line from the mission list and multiplies by the count', () => {
		expect(previewPoints([{ missionId: 'm01', lineIndex: 0, quantity: 1 }], MISSIONS)).toBe(20);
		expect(previewPoints([{ missionId: 'm01', lineIndex: 1, quantity: 1 }], MISSIONS)).toBe(10);
		expect(previewPoints([{ missionId: 'm02', lineIndex: 0, quantity: 3 }], MISSIONS)).toBe(30);
		expect(
			previewPoints(
				[
					{ missionId: 'm01', lineIndex: 0, quantity: 1 },
					{ missionId: 'm01', lineIndex: 1, quantity: 1 },
					{ missionId: 'm02', lineIndex: 0, quantity: 3 }
				],
				MISSIONS
			)
		).toBe(60);
	});

	test('nothing ticked is nothing scored', () => {
		expect(previewPoints([], MISSIONS)).toBe(0);
	});

	test('a line or mission that is not in the list scores nothing rather than throwing', () => {
		// The mat screen must not blank out because the mission list moved on
		// under a queued draft.
		expect(previewPoints([{ missionId: 'nope', lineIndex: 0, quantity: 1 }], MISSIONS)).toBe(0);
		expect(previewPoints([{ missionId: 'm02', lineIndex: 9, quantity: 1 }], MISSIONS)).toBe(0);
		expect(previewPoints([{ missionId: 'm01', lineIndex: -1, quantity: 1 }], MISSIONS)).toBe(0);
	});

	test('a quantity below one still counts as one, which is what a ticked box means', () => {
		expect(previewPoints([{ missionId: 'm01', lineIndex: 0, quantity: 0 }], MISSIONS)).toBe(20);
	});
});

describe('reading missions.scoring back out of jsonb', () => {
	test('the seeded shape round-trips', () => {
		const raw = [
			{ label: 'Drone is off the mat', points: 20 },
			{ label: 'Bonus: LiDAR map flipped', points: 10, bonus: true }
		];
		expect(parseScoring(raw)).toEqual([
			{ label: 'Drone is off the mat', points: 20, bonus: false },
			{ label: 'Bonus: LiDAR map flipped', points: 10, bonus: true }
		]);
	});

	test('anything malformed degrades to no lines instead of throwing at the mat', () => {
		expect(parseScoring(null)).toEqual([]);
		expect(parseScoring('nope')).toEqual([]);
		expect(parseScoring({})).toEqual([]);
		expect(parseScoring([null, 7, 'x'])).toEqual([]);
		// A line with no label is not a line a child can tick.
		expect(parseScoring([{ points: 20 }])).toEqual([]);
		// A line with a label but no usable points is worth nothing, not NaN.
		expect(parseScoring([{ label: 'Half a rule', points: 'lots' }])).toEqual([
			{ label: 'Half a rule', points: 0, bonus: false }
		]);
	});
});
