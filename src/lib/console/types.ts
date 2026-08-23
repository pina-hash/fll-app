/**
 * The shapes the mentor console reads, and the parsers that turn the jsonb
 * `board_live_summary` (0009) returns into them.
 *
 * The parsers are defensive for the same reason `principal.ts` is: a payload
 * this code cannot understand must degrade to "nothing to show" rather than
 * throw inside a realtime callback, where nobody would see the error and the
 * board would simply stop updating.
 */

export type TeamAccent = 'cyan' | 'chartreuse' | 'magenta' | 'amber';

export const TEAM_ACCENTS: TeamAccent[] = ['cyan', 'chartreuse', 'magenta', 'amber'];

export const ACCENT_LABEL: Record<TeamAccent, string> = {
	cyan: 'Cyan',
	chartreuse: 'Chartreuse',
	magenta: 'Magenta',
	amber: 'Amber'
};

export type MeetingKind = 'friday' | 'saturday';

export type TeamRole =
	| 'lead_builder'
	| 'lead_programmer'
	| 'run_captain'
	| 'innovation_lead'
	| 'notebook_values_lead';

export type RoleTier = 'primary' | 'second';

export type TaskStatus = 'open' | 'active' | 'blocked' | 'done';

export const TASK_STATUSES: TaskStatus[] = ['open', 'active', 'blocked', 'done'];

/** The five roles in the order the database's enum declares them. */
export const TEAM_ROLES: TeamRole[] = [
	'lead_builder',
	'lead_programmer',
	'run_captain',
	'innovation_lead',
	'notebook_values_lead'
];

export const ROLE_LABEL: Record<TeamRole, string> = {
	lead_builder: 'Lead Builder',
	lead_programmer: 'Lead Programmer',
	run_captain: 'Run Captain',
	innovation_lead: 'Innovation Lead',
	notebook_values_lead: 'Notebook and Values Lead'
};

/** A short form for the places a card has no room for the full label. */
export const ROLE_SHORT: Record<TeamRole, string> = {
	lead_builder: 'Builder',
	lead_programmer: 'Programmer',
	run_captain: 'Run Captain',
	innovation_lead: 'Innovation',
	notebook_values_lead: 'Notebook'
};

export interface BoardPhase {
	id: string;
	ordinal: number;
	name: string;
	planned_minutes: number;
	started_at: string | null;
	ended_at: string | null;
}

export interface BoardMeeting {
	id: string;
	kind: MeetingKind;
	meeting_date: string;
	planned_start_at: string;
	planned_end_at: string;
	started_at: string | null;
	ended_at: string | null;
	current_phase_id: string | null;
	phase_count: number;
	phase: BoardPhase | null;
}

export interface BoardTeam {
	team_id: string;
	name: string;
	join_code: string;
	accent: TeamAccent;
	fll_team_number: number | null;
	roster_size: number;
	present_count: number;
	tasks_opened: number;
	tasks_closed: number;
	tasks_open_now: number;
	open_blockers: number;
	roles_unfilled: number;
	roles_without_second: number;
	last_task_closed_at: string | null;
}

export interface BoardSnapshot {
	/** The database's clock at the moment of the fetch. See `clock.ts`. */
	server_now: string;
	window_from: string;
	window_to: string;
	meeting: BoardMeeting | null;
	teams: BoardTeam[];
}

/** One row of `team_resolve_roles`: the single answer to "who is on R today". */
export interface ResolvedRole {
	role: TeamRole;
	primary_student_id: string | null;
	primary_name: string | null;
	primary_present: boolean;
	second_student_id: string | null;
	second_name: string | null;
	second_present: boolean;
	active_student_id: string | null;
	active_tier: RoleTier | null;
	active_name: string | null;
	unfilled: boolean;
	has_second: boolean;
}

function obj(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string | null {
	return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
function accent(v: unknown): TeamAccent {
	return TEAM_ACCENTS.includes(v as TeamAccent) ? (v as TeamAccent) : 'cyan';
}

export function parsePhase(raw: unknown): BoardPhase | null {
	const r = obj(raw);
	const id = r && str(r.id);
	if (!r || !id) return null;
	return {
		id,
		ordinal: num(r.ordinal),
		name: str(r.name) ?? 'Phase',
		planned_minutes: num(r.planned_minutes),
		started_at: str(r.started_at),
		ended_at: str(r.ended_at)
	};
}

export function parseMeeting(raw: unknown): BoardMeeting | null {
	const r = obj(raw);
	const id = r && str(r.id);
	if (!r || !id) return null;
	return {
		id,
		kind: r.kind === 'saturday' ? 'saturday' : 'friday',
		meeting_date: str(r.meeting_date) ?? '',
		planned_start_at: str(r.planned_start_at) ?? '',
		planned_end_at: str(r.planned_end_at) ?? '',
		started_at: str(r.started_at),
		ended_at: str(r.ended_at),
		current_phase_id: str(r.current_phase_id),
		phase_count: num(r.phase_count),
		phase: parsePhase(r.phase)
	};
}

function parseTeam(raw: unknown): BoardTeam | null {
	const r = obj(raw);
	const teamId = r && str(r.team_id);
	if (!r || !teamId) return null;
	return {
		team_id: teamId,
		name: str(r.name) ?? 'Team',
		join_code: str(r.join_code) ?? '',
		accent: accent(r.accent),
		fll_team_number: typeof r.fll_team_number === 'number' ? r.fll_team_number : null,
		roster_size: num(r.roster_size),
		present_count: num(r.present_count),
		tasks_opened: num(r.tasks_opened),
		tasks_closed: num(r.tasks_closed),
		tasks_open_now: num(r.tasks_open_now),
		open_blockers: num(r.open_blockers),
		roles_unfilled: num(r.roles_unfilled),
		roles_without_second: num(r.roles_without_second),
		last_task_closed_at: str(r.last_task_closed_at)
	};
}

/** Null when the payload is not a board snapshot at all. */
export function parseBoardSnapshot(raw: unknown): BoardSnapshot | null {
	const r = obj(raw);
	if (!r || !Array.isArray(r.teams)) return null;
	return {
		server_now: str(r.server_now) ?? new Date().toISOString(),
		window_from: str(r.window_from) ?? '',
		window_to: str(r.window_to) ?? '',
		meeting: parseMeeting(r.meeting),
		teams: r.teams.map(parseTeam).filter((t): t is BoardTeam => t !== null)
	};
}

export function parseResolvedRoles(raw: unknown): ResolvedRole[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((row) => {
			const r = obj(row);
			if (!r || !TEAM_ROLES.includes(r.role as TeamRole)) return null;
			return {
				role: r.role as TeamRole,
				primary_student_id: str(r.primary_student_id),
				primary_name: str(r.primary_name),
				primary_present: r.primary_present === true,
				second_student_id: str(r.second_student_id),
				second_name: str(r.second_name),
				second_present: r.second_present === true,
				active_student_id: str(r.active_student_id),
				active_tier: r.active_tier === 'primary' || r.active_tier === 'second' ? r.active_tier : null,
				active_name: str(r.active_name),
				unfilled: r.unfilled === true,
				has_second: r.has_second === true
			} satisfies ResolvedRole;
		})
		.filter((r): r is ResolvedRole => r !== null);
}
