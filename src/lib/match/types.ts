/**
 * The shapes `match_run_history` (0015) returns, and the defensive parser that
 * turns its jsonb into them.
 *
 * Defensive for the same reason `$lib/console/types` is: a payload this code
 * cannot understand must degrade to "no runs yet" rather than throw on a phone
 * at the mat, where nobody would see the error and the screen would simply be
 * blank.
 */
import { parseScoring, type MatchMission } from './rules';

export interface RunHistoryRow {
	id: string;
	started_at: string;
	elapsed_s: number | null;
	points: number;
	note: string;
	strategy_id: string | null;
	strategy_version: number | null;
	strategy_label: string | null;
	/** The running maximum as of this run. Computed in SQL, never accumulated here. */
	best_so_far: number;
	launches_attempted: number;
	lines_scored: number;
}

export interface RunHistory {
	team_id: string;
	server_now: string;
	run_count: number;
	best_points: number;
	/** Newest first, which is how a list reads. Reverse it for a trendline. */
	runs: RunHistoryRow[];
}

function obj(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}
function num(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function maybeNum(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function maybeStr(v: unknown): string | null {
	return typeof v === 'string' && v.length > 0 ? v : null;
}

function parseRun(raw: unknown): RunHistoryRow | null {
	const r = obj(raw);
	const id = r && maybeStr(r.id);
	if (!r || !id) return null;
	return {
		id,
		started_at: str(r.started_at),
		elapsed_s: maybeNum(r.elapsed_s),
		points: num(r.points),
		note: str(r.note),
		strategy_id: maybeStr(r.strategy_id),
		strategy_version: maybeNum(r.strategy_version),
		strategy_label: maybeStr(r.strategy_label),
		best_so_far: num(r.best_so_far),
		launches_attempted: num(r.launches_attempted),
		lines_scored: num(r.lines_scored)
	};
}

/** An empty history for a payload that is not one; never null, never a throw. */
export function parseRunHistory(raw: unknown, teamId: string): RunHistory {
	const r = obj(raw);
	if (!r || !Array.isArray(r.runs)) {
		return { team_id: teamId, server_now: new Date().toISOString(), run_count: 0, best_points: 0, runs: [] };
	}
	const runs = r.runs.map(parseRun).filter((run): run is RunHistoryRow => run !== null);
	return {
		team_id: maybeStr(r.team_id) ?? teamId,
		server_now: maybeStr(r.server_now) ?? new Date().toISOString(),
		run_count: runs.length,
		best_points: num(r.best_points),
		runs
	};
}

/** The `missions` rows the mat screen needs, from a plain PostgREST select. */
export function toMatchMissions(
	rows: { id: string; code: string; name: string; points_label: string; scoring: unknown }[] | null
): MatchMission[] {
	return (rows ?? []).map((row) => ({
		id: row.id,
		code: row.code,
		name: row.name,
		pointsLabel: row.points_label,
		scoring: parseScoring(row.scoring)
	}));
}
