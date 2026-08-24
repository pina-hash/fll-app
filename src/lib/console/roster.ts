/**
 * What `team_roster_state` (0013, rewritten by 0019) returns, and the parser
 * for it.
 *
 * A SEAT IS ONE ANSWER, FROM ONE PLACE. Since 0019 a seat is taken either by a
 * student on the roster or by a seat card a mentor has handed out and nobody
 * has spent yet, and "how many are left" is the cap minus both. That
 * subtraction is stated once, in SQL: a console that counted students here and
 * forgot the unspent cards would offer a seventh card for a team that has none
 * left, and the child holding it would be refused at the login screen with the
 * mentor watching.
 *
 * THE JOIN WINDOW IS GONE. 0019 removed `team_join_open` and the two stored
 * columns behind it; a seat is now a card, which is a thing a mentor can print
 * and take back. Nothing here reports whether sign-ups are open, because there
 * is no such state any more.
 */

export interface TeamRosterState {
	team_id: string;
	name: string;
	/** teams.short_name -- what the team called itself, or null. */
	short_name: string | null;
	join_code: string;
	accent: string;
	size_cap: number;
	roster_size: number;
	/** Seat cards handed out and neither spent nor voided. Each holds a seat. */
	claims_open: number;
	seats_left: number;
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
				short_name: maybeStr(r.short_name),
				join_code: str(r.join_code),
				accent: str(r.accent),
				size_cap: num(r.size_cap),
				roster_size: num(r.roster_size),
				claims_open: num(r.claims_open),
				seats_left: num(r.seats_left)
			};
		})
		.filter((row): row is TeamRosterState => row !== null);
}
