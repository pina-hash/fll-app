/**
 * THE MATCH CLOCK AND THE PREVIEW TALLY.
 *
 * 150 SECONDS IS A CONSTANT, NOT A SETTING. An FLL match is 2:30. It is not
 * configurable, it is not stored, and nothing in SQL uses it (0015's header
 * says so): a number a mentor could accidentally change is worse than a number
 * written once, here.
 *
 * THIS CLOCK IS LOCAL AND MUST STAY LOCAL. Every other timer in this app ticks
 * off a server-corrected wall clock, because a tablet four minutes fast would
 * show four minutes of phantom overrun on a phase. A match timer is the
 * opposite problem: it is started by a thumb, it has to be exact and
 * continuous while the phone is in a gym with no signal, and nothing on the
 * server knows or cares when the robot left the base. So it measures with
 * `performance.now()`, which is monotonic and immune to the clock being
 * corrected mid-run, and it never asks the server anything.
 *
 * THE TALLY HERE IS A PREVIEW AND SAYS SO. The authoritative score is
 * `match_runs.points`, priced by trigger from the missions table and writable
 * by nobody (0015). But a child ticking boxes at the mat, possibly offline,
 * has to see the number move under their finger before any server has seen the
 * run. `previewPoints` computes that from the SAME `missions.scoring` rows the
 * server priced from, so the two cannot disagree about a mission -- and every
 * screen that reports a RESULT (the history list, the best-so-far trendline)
 * reads the server's number, never this one.
 */

/** An FLL match: 2 minutes 30 seconds. */
export const MATCH_SECONDS = 150;

/** When the countdown turns amber: the last thirty seconds. */
export const MATCH_WARN_SECONDS = 30;

/** One scoring line of one mission, as `missions.scoring` (0011) stores it. */
export interface MissionLine {
	label: string;
	points: number;
	bonus?: boolean;
}

/** A mission as the mat screen needs it: the numbers, joined to its prose elsewhere. */
export interface MatchMission {
	id: string;
	code: string;
	name: string;
	pointsLabel: string;
	scoring: MissionLine[];
}

/** One line a team says they achieved, and how many times. */
export interface ScoredLine {
	missionId: string;
	lineIndex: number;
	quantity: number;
}

/**
 * `2:30`, `0:07`. Always mm:ss with a two-digit seconds field, because a
 * countdown that changes width is a countdown that is hard to read across a
 * table.
 */
export function formatMatchClock(seconds: number): string {
	const clamped = Math.max(0, Math.ceil(seconds));
	const m = Math.floor(clamped / 60);
	const s = clamped % 60;
	return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The PREVIEW total: what the team has ticked so far, priced from the mission
 * list this device was served. See the header -- the truth is the server's
 * `match_runs.points`, and this exists so the number moves at the mat.
 */
export function previewPoints(lines: ScoredLine[], missions: MatchMission[]): number {
	const byId = new Map(missions.map((m) => [m.id, m]));
	let total = 0;
	for (const line of lines) {
		const mission = byId.get(line.missionId);
		const scoring = mission?.scoring?.[line.lineIndex];
		if (!scoring) continue;
		total += scoring.points * Math.max(1, line.quantity);
	}
	return total;
}

/** Reads `missions.scoring` jsonb defensively; a malformed row scores nothing. */
export function parseScoring(raw: unknown): MissionLine[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((entry): MissionLine | null => {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
			const row = entry as Record<string, unknown>;
			const label = typeof row.label === 'string' ? row.label : '';
			const points = typeof row.points === 'number' && Number.isFinite(row.points) ? row.points : 0;
			if (!label) return null;
			return { label, points, bonus: row.bonus === true };
		})
		.filter((line): line is MissionLine => line !== null);
}
