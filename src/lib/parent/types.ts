/**
 * The shape `parent_view` (0014) returns, and the parser that turns its jsonb
 * into it.
 *
 * Defensive for the usual reason, plus one specific to this surface: the page
 * is opened by somebody with no account, no support channel and no reason to
 * know what a stack trace is. A payload this code cannot understand has to
 * become "this link is not working" rather than a 500.
 */
import { isTeamAccent, type TeamAccent } from '$lib/console/types';

export interface ParentTeam {
	name: string;
	accent: TeamAccent | null;
	fll_team_number: number | null;
}

export interface ParentChild {
	first_name: string;
	last_initial: string;
	grade: number | null;
}

export interface ParentRole {
	role: string;
	tier: 'primary' | 'second';
}

export interface ParentMeeting {
	id: string;
	kind: 'friday' | 'saturday';
	meeting_date: string;
	planned_start_at: string;
	planned_end_at: string;
	started_at: string | null;
	ended_at: string | null;
}

export interface ParentAttendance {
	meeting_id: string;
	meeting_date: string;
	kind: 'friday' | 'saturday';
	checked_in_at: string;
}

export interface ParentTask {
	id: string;
	title: string;
	closed_at: string | null;
}

export interface ParentPhoto {
	id: string;
	caption: string | null;
	uploaded_at: string;
	task_title: string;
}

/** First name and last initial only. Nothing else about another child appears. */
export interface ParentRosterEntry {
	first_name: string;
	last_initial: string;
	is_mine: boolean;
}

export interface ParentView {
	server_now: string;
	team: ParentTeam;
	student: ParentChild;
	roles: ParentRole[];
	upcoming_meetings: ParentMeeting[];
	attendance: ParentAttendance[];
	tasks_done: ParentTask[];
	photos: ParentPhoto[];
	roster: ParentRosterEntry[];
}

function obj(v: unknown): Record<string, unknown> | null {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string {
	return typeof v === 'string' ? v : '';
}
function maybeStr(v: unknown): string | null {
	return typeof v === 'string' && v.length > 0 ? v : null;
}
function maybeNum(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function arr(v: unknown): unknown[] {
	return Array.isArray(v) ? v : [];
}
function kind(v: unknown): 'friday' | 'saturday' {
	return v === 'saturday' ? 'saturday' : 'friday';
}

/** Null for anything that is not a parent view: the route turns that into a 404. */
export function parseParentView(raw: unknown): ParentView | null {
	const r = obj(raw);
	const team = r && obj(r.team);
	const student = r && obj(r.student);
	if (!r || !team || !student) return null;
	const first = maybeStr(student.first_name);
	if (!first) return null;

	return {
		server_now: maybeStr(r.server_now) ?? new Date().toISOString(),
		team: {
			name: maybeStr(team.name) ?? 'Team',
			accent: isTeamAccent(team.accent) ? team.accent : null,
			fll_team_number: maybeNum(team.fll_team_number)
		},
		student: {
			first_name: first,
			last_initial: str(student.last_initial),
			grade: maybeNum(student.grade)
		},
		roles: arr(r.roles)
			.map((row): ParentRole | null => {
				const e = obj(row);
				const role = e && maybeStr(e.role);
				if (!e || !role) return null;
				return { role, tier: e.tier === 'second' ? 'second' : 'primary' };
			})
			.filter((row): row is ParentRole => row !== null),
		upcoming_meetings: arr(r.upcoming_meetings)
			.map((row): ParentMeeting | null => {
				const e = obj(row);
				const id = e && maybeStr(e.id);
				if (!e || !id) return null;
				return {
					id,
					kind: kind(e.kind),
					meeting_date: str(e.meeting_date),
					planned_start_at: str(e.planned_start_at),
					planned_end_at: str(e.planned_end_at),
					started_at: maybeStr(e.started_at),
					ended_at: maybeStr(e.ended_at)
				};
			})
			.filter((row): row is ParentMeeting => row !== null),
		attendance: arr(r.attendance)
			.map((row): ParentAttendance | null => {
				const e = obj(row);
				const id = e && maybeStr(e.meeting_id);
				if (!e || !id) return null;
				return {
					meeting_id: id,
					meeting_date: str(e.meeting_date),
					kind: kind(e.kind),
					checked_in_at: str(e.checked_in_at)
				};
			})
			.filter((row): row is ParentAttendance => row !== null),
		tasks_done: arr(r.tasks_done)
			.map((row): ParentTask | null => {
				const e = obj(row);
				const id = e && maybeStr(e.id);
				if (!e || !id) return null;
				return { id, title: str(e.title), closed_at: maybeStr(e.closed_at) };
			})
			.filter((row): row is ParentTask => row !== null),
		photos: arr(r.photos)
			.map((row): ParentPhoto | null => {
				const e = obj(row);
				const id = e && maybeStr(e.id);
				if (!e || !id) return null;
				return {
					id,
					caption: maybeStr(e.caption),
					uploaded_at: str(e.uploaded_at),
					task_title: str(e.task_title)
				};
			})
			.filter((row): row is ParentPhoto => row !== null),
		roster: arr(r.roster)
			.map((row): ParentRosterEntry | null => {
				const e = obj(row);
				const name = e && maybeStr(e.first_name);
				if (!e || !name) return null;
				return { first_name: name, last_initial: str(e.last_initial), is_mine: e.is_mine === true };
			})
			.filter((row): row is ParentRosterEntry => row !== null)
	};
}
