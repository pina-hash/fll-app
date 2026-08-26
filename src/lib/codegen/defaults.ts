// The standard driving base, and the port vocabulary the form offers.
//
// These are DEFAULTS, not constants: the four teams' robots differ, and the
// whole reason robot_configs is a table is that a number retyped at the table
// on Saturday is a toolkit that drives long in every run. A team that has
// saved a row never sees these again.

import type { Calibration, RobotConfig } from './toolkit.js';

/** SPIKE Prime has six ports. */
export const PORTS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/** T17's six hub mountings. Only 'up' is currently honoured; see below. */
export const YAW_AXES = ['up', 'down', 'front', 'back', 'left', 'right'] as const;

/**
 * A standard SPIKE Prime driving base: 56 mm wheels driven directly off A and
 * B as a movement pair, colour sensors on E and F, two attachment motors on C
 * and D.
 */
export const DEFAULT_CONFIG: RobotConfig = {
	wheelDiameterMm: 56,
	trackWidthMm: 112,
	gearRatio: 1,
	movementPair: 'AB',
	leftMotor: 'A',
	rightMotor: 'B',
	attachmentMotors: ['C', 'D'],
	leftColorPort: 'E',
	rightColorPort: 'F',
	yawAxis: 'up'
};

/**
 * A plausible starting pair, not a measured one. A team MUST replace these by
 * reading their own sensor on their own mat: the emitter bakes
 * (raw - black) / (white - black) * 100 into the generated project, so these
 * two numbers are the difference between a line follower that works in the
 * hall it is run in and one that does not.
 */
export const DEFAULT_CALIBRATION: Calibration = { white: 95, black: 12 };

/**
 * The one configuration the emitter can currently honour. START RUN does not
 * emit the SPIKE orientation block, because that shape is not in the verified
 * registry and V9 correctly refuses an unverified shape. A hub mounted any way
 * but flat is therefore RECORDED and not honoured, and the form says so out
 * loud rather than generating a file that quietly turns the wrong way.
 */
export const EMITTED_YAW_AXIS = 'up';
