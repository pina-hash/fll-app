/**
 * THE SETUP CHAIN, STATED ONCE. The planner is built on things a mentor does
 * first: place the 15 mission dots on the mat, measure the Base rectangle,
 * and (optionally) add a calibrated field picture. Until those are done the
 * screen must SAY so, name who fixes it, and offer the action to whoever
 * holds it -- never present a blank canvas or a disabled control a student
 * cannot use. This module is the one place that reads the chain's state, so
 * the mentor checklist and the student notice can never disagree about it.
 */
import type { MatImageModel, MatSetupModel, MissionMarker } from './types';

export interface SetupState {
	missionsPlaced: number;
	missionsTotal: number;
	/** True when every mission dot has a position. */
	allMissionsPlaced: boolean;
	/** True when the Base rectangle has both sides measured. */
	baseMarked: boolean;
	picture: 'none' | 'uncalibrated' | 'ready';
	/** True when everything except the optional picture is done. */
	ready: boolean;
}

export function setupState(
	missions: MissionMarker[],
	matSetup: MatSetupModel,
	matImage: MatImageModel | null
): SetupState {
	const placed = missions.filter((m) => m.xMm !== null && m.yMm !== null).length;
	const baseMarked = matSetup.launchWmm !== null && matSetup.launchHmm !== null;
	const picture: SetupState['picture'] =
		matImage === null ? 'none' : matImage.calibration === null ? 'uncalibrated' : 'ready';
	return {
		missionsPlaced: placed,
		missionsTotal: missions.length,
		allMissionsPlaced: missions.length > 0 && placed === missions.length,
		baseMarked,
		picture,
		ready: missions.length > 0 && placed === missions.length && baseMarked
	};
}
