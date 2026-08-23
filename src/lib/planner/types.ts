/**
 * The shapes the route planner reads and edits. Parsed defensively from the
 * database rows: a malformed scoring list renders as no lines rather than a
 * crash on a tablet mid-meeting.
 */
import type { ScoringLine } from './geometry';

export interface MissionMarker {
	id: string;
	code: string;
	name: string;
	pointsLabel: string;
	scoring: ScoringLine[];
	sortOrder: number;
	/** Null until the mentor places the marker from the rulebook. */
	xMm: number | null;
	yMm: number | null;
}

export interface WaypointModel {
	id: string;
	launchId: string;
	xMm: number;
	yMm: number;
	sortOrder: number;
}

export interface LaunchMissionModel {
	id: string;
	launchId: string;
	missionId: string;
	sortOrder: number;
	/** Indexes into the mission's scoring list: the lines the team plans to score. */
	scoringLines: number[];
}

export interface LaunchModel {
	id: string;
	strategyId: string;
	name: string;
	attachmentName: string;
	sortOrder: number;
	missions: LaunchMissionModel[];
	waypoints: WaypointModel[];
}

export interface StrategyModel {
	id: string;
	teamId: string;
	version: number;
	label: string | null;
	launches: LaunchModel[];
}

export interface RobotProfileModel {
	id: string;
	teamId: string;
	widthMm: number;
	lengthMm: number;
	speedCmS: number;
	dwellS: number;
	betweenLaunchesS: number;
}

export interface MatSetupModel {
	launchWmm: number | null;
	launchHmm: number | null;
}

/** Mirrors 0012's column defaults, for a team that has no profile row yet. */
export function defaultRobotProfile(teamId: string): RobotProfileModel {
	return {
		id: crypto.randomUUID(),
		teamId,
		widthMm: 160,
		lengthMm: 200,
		speedCmS: 30,
		dwellS: 5,
		betweenLaunchesS: 8
	};
}

export function parseScoring(raw: unknown): ScoringLine[] {
	if (!Array.isArray(raw)) return [];
	const lines: ScoringLine[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const r = item as Record<string, unknown>;
		if (typeof r.label !== 'string' || typeof r.points !== 'number') continue;
		lines.push({ label: r.label, points: r.points, bonus: r.bonus === true });
	}
	return lines;
}

/** Ordering shared by every list the planner renders and every list it saves. */
export function bySortOrder<T extends { sortOrder: number; id: string }>(a: T, b: T): number {
	return a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
