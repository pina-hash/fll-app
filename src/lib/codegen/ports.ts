/**
 * WHAT IS PLUGGED INTO WHICH PORT. ONE QUESTION, ONE ANSWER, SIX PORTS.
 *
 * `left_motor`, `right_motor`, `movement_pair`, `left_color_port`,
 * `right_color_port` and `attachment_motors` are six columns answering ONE
 * question, and the form used to ask it six times: two dropdowns, a text box
 * wanting "AB", two more dropdowns and a row of checkboxes. A fourth grader
 * looking at a robot does not hold six answers, they hold one picture of a hub
 * with things plugged into it. This module is that picture as data.
 *
 * MOVEMENT PAIR IS DERIVED AND STOPS BEING A FIELD. It was a SECOND SOURCE OF
 * TRUTH that could silently disagree with the two drive ports: a child could
 * set the left motor to C, the right to D, and leave "AB" sitting in the text
 * box, and the emitter would then bake a movement pair naming two ports with no
 * drive motors in them. Nothing checked it and nothing could. Here it is
 * `leftMotor + rightMotor` and there is no other way to produce one, so the two
 * CANNOT disagree. The column is still stored, exactly as before; it is just
 * no longer asked for. tests/codegen-ports.test.ts is what holds that.
 *
 * WHICH COLOUR SENSOR IS "LEFT" IS DECIDED BY PORT LETTER, and it is decided
 * rather than guessed because the schema has two distinct columns and 0024
 * requires them to differ. A child marks two ports as colour sensors; the
 * alphabetically first is the left one. That is a rule, it is visible on the
 * screen under the hub, and a team that wants them the other way round swaps
 * the plugs, which is the real world's answer anyway.
 *
 * THIS IS NOT THE EMITTER. Nothing here changes what is generated: it produces
 * exactly the same `RobotConfig` fields the six controls used to produce.
 */

import type { RobotConfig } from './toolkit.js';
import { PORTS } from './defaults.js';

export type Port = (typeof PORTS)[number];

/**
 * What a child can put in a port. Five choices, in the order they are offered.
 * `empty` is a real answer and not an absence: "nothing is in this one" is
 * something a nine-year-old can say about a robot in front of them.
 */
export const PORT_ROLES = ['left-drive', 'right-drive', 'colour', 'attachment', 'empty'] as const;
export type PortRole = (typeof PORT_ROLES)[number];

/** Fourth-grade labels. These are what the port chips and the chooser say. */
export const ROLE_LABEL: Record<PortRole, string> = {
	'left-drive': 'Left driving wheel',
	'right-drive': 'Right driving wheel',
	colour: 'Colour sensor',
	attachment: 'Attachment motor',
	empty: 'Nothing'
};

/** The short word that fits inside a port on the drawn hub. */
export const ROLE_SHORT: Record<PortRole, string> = {
	'left-drive': 'Left drive',
	'right-drive': 'Right drive',
	colour: 'Colour',
	attachment: 'Motor',
	empty: 'Empty'
};

export type PortMap = Record<Port, PortRole>;

/** Exactly two drive motors and exactly two colour sensors, which is what 0024's
 *  columns require: both drive ports are NOT NULL and must differ, and so are
 *  both colour ports. */
const COLOUR_SLOTS = 2;

/** The map a stored (or default) configuration describes. */
export function portMapFromConfig(config: RobotConfig): PortMap {
	const map = Object.fromEntries(PORTS.map((p) => [p, 'empty'])) as PortMap;
	for (const port of config.attachmentMotors) {
		if (isPort(port)) map[port] = 'attachment';
	}
	// Colour and drive are written AFTER attachments on purpose: a row whose
	// attachment_motors array happens to name a drive port is a row that
	// disagrees with itself, and the named columns are the ones to believe.
	if (isPort(config.leftColorPort)) map[config.leftColorPort] = 'colour';
	if (isPort(config.rightColorPort)) map[config.rightColorPort] = 'colour';
	if (isPort(config.leftMotor)) map[config.leftMotor] = 'left-drive';
	if (isPort(config.rightMotor)) map[config.rightMotor] = 'right-drive';
	return map;
}

export function isPort(value: string): value is Port {
	return (PORTS as readonly string[]).includes(value);
}

/** The ports holding a role, in A to F order. */
export function portsWithRole(map: PortMap, role: PortRole): Port[] {
	return PORTS.filter((p) => map[p] === role);
}

/**
 * What is still missing, as sentences a nine-year-old can act on. Empty means
 * the map is complete and `configPortsFromMap` will answer.
 */
export function mapProblems(map: PortMap): string[] {
	const out: string[] = [];
	if (portsWithRole(map, 'left-drive').length !== 1) out.push('Say which port the LEFT driving wheel is in.');
	if (portsWithRole(map, 'right-drive').length !== 1) out.push('Say which port the RIGHT driving wheel is in.');
	const colour = portsWithRole(map, 'colour').length;
	if (colour < COLOUR_SLOTS) {
		out.push(
			colour === 0
				? 'Mark the two ports your colour sensors are in.'
				: 'Mark one more port as a colour sensor. There are two.'
		);
	}
	return out;
}

/** True when a port may take this role right now, and the reason when it may not. */
export function roleAvailable(map: PortMap, port: Port, role: PortRole): { ok: boolean; why: string } {
	if (map[port] === role) return { ok: true, why: '' };
	if (role === 'colour' && portsWithRole(map, 'colour').length >= COLOUR_SLOTS) {
		const held = portsWithRole(map, 'colour').join(' and ');
		return { ok: false, why: `Two colour sensors already, in ${held}. Set one to Nothing first.` };
	}
	return { ok: true, why: '' };
}

/**
 * Put `role` in `port`.
 *
 * THE TWO DRIVE ROLES SWAP RATHER THAN DUPLICATE. There is exactly one left
 * driving wheel, so telling the map that port C holds it has to say something
 * about the port that held it a moment ago: that port takes whatever C was
 * doing. A swap is the only move that keeps the map complete at every step,
 * which is what lets the config below never be half-built.
 *
 * COLOUR DOES NOT SWAP, IT REFUSES. Two ports are already the answer, so a
 * third would have to displace one of them and there is no non-arbitrary way to
 * pick which. `roleAvailable` says so in a sentence instead, and the child sets
 * one to Nothing first. Predictable beats clever on a screen for nine-year-olds.
 */
export function assignRole(map: PortMap, port: Port, role: PortRole): PortMap {
	if (!roleAvailable(map, port, role).ok) return map;
	const next: PortMap = { ...map };
	if (role === 'left-drive' || role === 'right-drive') {
		const previous = portsWithRole(map, role)[0];
		if (previous && previous !== port) next[previous] = map[port];
	}
	next[port] = role;
	return next;
}

/** Exactly the six config fields the six removed controls used to produce. */
export type PortConfig = Pick<
	RobotConfig,
	'leftMotor' | 'rightMotor' | 'movementPair' | 'leftColorPort' | 'rightColorPort' | 'attachmentMotors'
>;

/**
 * The map as configuration, or null when it is not complete yet.
 *
 * `movementPair` IS `leftMotor + rightMotor` AND THERE IS NO OTHER WAY TO MAKE
 * ONE. That is the whole point of this function existing: the pair used to be
 * typed into a box beside the two dropdowns it was supposed to agree with.
 */
export function configPortsFromMap(map: PortMap): PortConfig | null {
	if (mapProblems(map).length > 0) return null;
	const leftMotor = portsWithRole(map, 'left-drive')[0];
	const rightMotor = portsWithRole(map, 'right-drive')[0];
	const [leftColorPort, rightColorPort] = portsWithRole(map, 'colour');
	return {
		leftMotor,
		rightMotor,
		movementPair: `${leftMotor}${rightMotor}`,
		leftColorPort,
		rightColorPort,
		attachmentMotors: portsWithRole(map, 'attachment')
	};
}
