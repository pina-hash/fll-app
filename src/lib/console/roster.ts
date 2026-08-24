/**
 * What `team_roster_state` (0013) returns, and the parser for it.
 *
 * SEATS AND THE WINDOW ARE ONE ANSWER, FROM ONE PLACE. "How many seats are
 * left" is the cap minus the active roster, and "are sign-ups open" has two
 * bounds inside it (the meeting the window was opened in, and the local day it
 * was opened on). Both are stated once in SQL and asked for here; a console
 * that counted rows and compared timestamps itself would be a second
 * implementation that drifts the first Friday a meeting runs past midnight
 * UTC, which every Friday does.
 */

export interface TeamRosterState {
	team_id: string;
	name: string;
	join_code: string;
	accent: string;
	size_cap: number;
	roster_size: number;
	seats_left: number;
	join_open: boolean;
	join_open_since: string | null;
	join_open_meeting_id: string | null;
}

function obj(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function num(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}
function maybeStr(v: unknown): string | null {
	return typeof v === 'string' && v.length > 0 ? v : null;
}

/** An empty list for a payload that is not one, including the "not a mentor" empty. */
export function parseRosterState(raw: unknown): TeamRosterState[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((row): TeamRosterState | null => {
			const r = obj(row);
			const id = r && maybeStr(r.team_id);
			if (!r || !id) return null;
			return {
				team_id: id,
				name: str(r.name),
				join_code: str(r.join_code),
				accent: str(r.accent),
				size_cap: num(r.size_cap),
				roster_size: num(r.roster_size),
				seats_left: num(r.seats_left),
				join_open: r.join_open === true,
				join_open_since: maybeStr(r.join_open_since),
				join_open_meeting_id: maybeStr(r.join_open_meeting_id)
			};
		})
		.filter((row): row is TeamRosterState => row !== null);
}
