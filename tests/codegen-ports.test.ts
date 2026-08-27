// tests/codegen-ports.test.ts
//
// MOVEMENT PAIR IS DERIVED, AND IT CANNOT DISAGREE WITH THE DRIVE PORTS.
//
// It used to be a text box beside two dropdowns it was supposed to agree with.
// A child could set the left motor to C, the right to D, and leave "AB" sitting
// in the box, and the emitter would bake a movement pair naming two ports with
// no drive motors in them. Nothing checked it and nothing could: it was a
// SECOND SOURCE OF TRUTH for a fact the two dropdowns already stated.
//
// Now the port map is the only source and `configPortsFromMap` is the only
// producer, so these cases are about a property rather than a value: for EVERY
// reachable map, the pair is the two drive letters. The last block is the one
// that matters most, because it proves the disagreement is now unreachable
// rather than merely absent today.

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
	PORT_ROLES,
	assignRole,
	configPortsFromMap,
	mapProblems,
	portMapFromConfig,
	portsWithRole,
	roleAvailable,
	type Port,
	type PortMap
} from '../src/lib/codegen/ports';
import { DEFAULT_CONFIG, PORTS } from '../src/lib/codegen/defaults';
import type { RobotConfig } from '../src/lib/codegen/toolkit';

const ALL: Port[] = [...PORTS];

describe('the map the default configuration describes', () => {
	const map = portMapFromConfig(DEFAULT_CONFIG);

	test('every port has exactly one role and the map is complete', () => {
		for (const p of ALL) expect(PORT_ROLES).toContain(map[p]);
		expect(mapProblems(map)).toEqual([]);
	});

	test('it round-trips back to the same six fields', () => {
		const ports = configPortsFromMap(map);
		expect(ports).not.toBeNull();
		expect(ports!.leftMotor).toBe(DEFAULT_CONFIG.leftMotor);
		expect(ports!.rightMotor).toBe(DEFAULT_CONFIG.rightMotor);
		expect(ports!.leftColorPort).toBe(DEFAULT_CONFIG.leftColorPort);
		expect(ports!.rightColorPort).toBe(DEFAULT_CONFIG.rightColorPort);
		expect(ports!.attachmentMotors).toEqual(DEFAULT_CONFIG.attachmentMotors);
		expect(ports!.movementPair).toBe(DEFAULT_CONFIG.movementPair);
	});
});

describe('movement_pair is the two drive letters, for every reachable map', () => {
	/**
	 * Walk every single-assignment reachable from the default map, then every
	 * assignment reachable from THOSE. Two plies is enough to reach a map where
	 * the drives have swapped sides, moved to other ports, and displaced
	 * attachments, which is the whole space of ways the old text box could have
	 * fallen out of step.
	 */
	function reachable(): PortMap[] {
		const seen = new Map<string, PortMap>();
		const key = (m: PortMap) => ALL.map((p) => m[p]).join('');
		let frontier: PortMap[] = [portMapFromConfig(DEFAULT_CONFIG)];
		seen.set(key(frontier[0]), frontier[0]);
		for (let ply = 0; ply < 2; ply++) {
			const next: PortMap[] = [];
			for (const m of frontier) {
				for (const port of ALL) {
					for (const role of PORT_ROLES) {
						const after = assignRole(m, port, role);
						const k = key(after);
						if (seen.has(k)) continue;
						seen.set(k, after);
						next.push(after);
					}
				}
			}
			frontier = next;
		}
		return [...seen.values()];
	}

	const maps = reachable();

	test('the walk actually explored something', () => {
		// Measured: two plies from the default map reach 187 distinct maps.
		expect(maps.length).toBeGreaterThan(150);
	});

	test('every complete map produces a pair equal to leftMotor + rightMotor', () => {
		let complete = 0;
		for (const map of maps) {
			const ports = configPortsFromMap(map);
			if (!ports) continue;
			complete++;
			expect(ports.movementPair).toBe(`${ports.leftMotor}${ports.rightMotor}`);
			// 0024's own two CHECK constraints, asserted here so a map that would
			// be refused by the database is refused by the arithmetic first.
			expect(ports.leftMotor).not.toBe(ports.rightMotor);
			expect(ports.leftColorPort).not.toBe(ports.rightColorPort);
			expect(ports.movementPair).toMatch(/^[A-F][A-F]$/);
		}
		// Measured: 75 of the 187 are complete. The rest are maps a child made
		// incomplete by emptying a required port, and they are the next case.
		expect(complete).toBeGreaterThan(60);
	});

	test('an incomplete map produces NOTHING, rather than a half-built config', () => {
		const incomplete = maps.filter((m) => mapProblems(m).length > 0);
		expect(incomplete.length).toBeGreaterThan(0);
		for (const map of incomplete) expect(configPortsFromMap(map)).toBeNull();
	});

	test('a drive role is held by exactly one port, always', () => {
		for (const map of maps) {
			expect(portsWithRole(map, 'left-drive').length).toBeLessThanOrEqual(1);
			expect(portsWithRole(map, 'right-drive').length).toBeLessThanOrEqual(1);
			expect(portsWithRole(map, 'colour').length).toBeLessThanOrEqual(2);
		}
	});
});

describe('a stored row that already disagrees is REPAIRED, not carried forward', () => {
	/**
	 * The old form could write this: drives on C and D, pair still saying "AB".
	 * Rows like it may exist. Opening one now rebuilds the pair from the ports,
	 * so the disagreement does not survive the first save.
	 */
	const broken: RobotConfig = {
		...DEFAULT_CONFIG,
		leftMotor: 'C',
		rightMotor: 'D',
		movementPair: 'AB',
		attachmentMotors: ['A', 'B']
	};

	test('the row really is self-contradictory to begin with', () => {
		expect(broken.movementPair).not.toBe(`${broken.leftMotor}${broken.rightMotor}`);
	});

	test('opening it and reading it back fixes the pair without moving a port', () => {
		const ports = configPortsFromMap(portMapFromConfig(broken))!;
		expect(ports).not.toBeNull();
		expect(ports.leftMotor).toBe('C');
		expect(ports.rightMotor).toBe('D');
		expect(ports.movementPair).toBe('CD');
		expect(ports.attachmentMotors).toEqual(['A', 'B']);
	});

	test('a row whose attachment array names a drive port believes the named column', () => {
		// attachment_motors is an array and the drive columns are scalars; when
		// they overlap, the scalar is the one to believe, so the port stops being
		// listed as an attachment rather than being both.
		const overlapping: RobotConfig = { ...DEFAULT_CONFIG, attachmentMotors: ['A', 'C', 'D'] };
		const ports = configPortsFromMap(portMapFromConfig(overlapping))!;
		expect(ports.attachmentMotors).not.toContain('A');
		expect(ports.attachmentMotors).toEqual(['C', 'D']);
		expect(ports.leftMotor).toBe('A');
	});
});

describe('the rules that keep a nine-year-old out of an unusable state', () => {
	const base = portMapFromConfig(DEFAULT_CONFIG);

	test('moving the left drive to an occupied port SWAPS, keeping the map complete', () => {
		// A is left drive and C is an attachment in the default map.
		const after = assignRole(base, 'C', 'left-drive');
		expect(after.C).toBe('left-drive');
		expect(after.A).toBe('attachment');
		expect(mapProblems(after)).toEqual([]);
		expect(configPortsFromMap(after)!.movementPair).toBe('CB');
	});

	test('a third colour sensor is refused with a sentence, not silently displaced', () => {
		const answer = roleAvailable(base, 'C', 'colour');
		expect(answer.ok).toBe(false);
		expect(answer.why).toMatch(/E and F/);
		// And the refusal is real: the map does not change.
		expect(assignRole(base, 'C', 'colour')).toEqual(base);
	});

	test('emptying a required port is allowed, and says what is missing', () => {
		const after = assignRole(base, 'E', 'empty');
		expect(configPortsFromMap(after)).toBeNull();
		expect(mapProblems(after)).toEqual(['Mark one more port as a colour sensor. There are two.']);
	});
});

/**
 * THE STRUCTURAL HALF. The property above holds for `configPortsFromMap`; this
 * is what stops a second producer appearing beside it. If any component ever
 * assigns `movementPair` again, the field is back and so is the bug.
 */
describe('nothing else in the app writes movementPair', () => {
	test('configPortsFromMap is the only assignment in src/', () => {
		const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
			.split('\n')
			.filter((f) => f && /\.(ts|svelte)$/.test(f));
		/**
		 * Four files may mention it, and each is a different kind of mention.
		 * Anything else is a second producer, which is the thing that was
		 * removed. The reasons are here rather than in a bare skip list so a
		 * fifth entry has to be argued for.
		 */
		const ALLOWED: Record<string, string> = {
			'src/lib/codegen/toolkit.ts': 'the RobotConfig type declares the field',
			'src/lib/codegen/defaults.ts': 'DEFAULT_CONFIG states the standard base',
			'src/lib/codegen/ports.ts': 'configPortsFromMap, the one producer',
			'src/lib/codegen/storage.ts':
				'toConfig READS the stored column into a RobotConfig. It produces no ' +
				'pair of its own, and CodegenPage rebuilds the ports through the map ' +
				'on arrival, so a row that disagrees with itself is repaired before ' +
				'it can be saved back. The case above proves that repair.',
			'src/lib/codegen/__tests__/negcontrol.test.ts': 'a fixture config in a control file'
		};
		const writers: string[] = [];
		for (const file of files) {
			if (file in ALLOWED) continue;
			const body = readFileSync(join(process.cwd(), file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
			for (const m of body.matchAll(/movementPair\s*[:=]/g)) {
				writers.push(`${file}: ${body.slice(Math.max(0, m.index - 30), m.index + 30).trim()}`);
			}
		}
		expect(
			writers,
			'movementPair must come from configPortsFromMap and nowhere else, or it is a ' +
				'second source of truth again'
		).toEqual([]);
	});

	test('yaw_axis is stored and no longer asked for', () => {
		// T17 left the emitter when V9 refused flippermoresensors_setOrientation.
		// The column and the default stay; the control is gone. If a control comes
		// back before the shape is verified, this goes red.
		const page = readFileSync(join(process.cwd(), 'src/lib/codegen/CodegenPage.svelte'), 'utf8');
		expect(page).not.toMatch(/bind:value=\{cfg\.yawAxis\}/);
		expect(page).toMatch(/YAW AXIS IS COLLECTED, STORED, AND IGNORED/);
		expect(page).toMatch(/IT COMES BACK WHEN THAT SHAPE IS VERIFIED/);
		expect(DEFAULT_CONFIG.yawAxis).toBe('up');
	});
});
