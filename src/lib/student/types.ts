/**
 * The shapes the student runtime reads.
 *
 * Almost nothing new is defined here: the meeting and phase come from the same
 * parsers the mentor console uses, and WHO IS IN A ROLE comes from
 * `team_resolve_roles` (0009) exactly as it does on the live board. `myRole`
 * below is a projection of that answer onto one student, not a second copy of
 * the rule.
 */
import { parseMeeting, type BoardMeeting, type ResolvedRole, type TeamRole } from '$lib/console/types';
import type { TaskStatus } from '$lib/console/types';

export interface MeetingNow {
	server_now: string;
	meeting: BoardMeeting | null;
}

export function parseMeetingNow(raw: unknown): MeetingNow | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	return {
		server_now: typeof r.server_now === 'string' ? r.server_now : new Date().toISOString(),
		meeting: parseMeeting(r.meeting)
	};
}

/**
 * One student's answer to "what am I doing right now".
 *
 * `covering` is the field this whole screen exists for. A kid who is the
 * second and does not know the primary is out will not do the job, so the
 * screen has to say it in words rather than imply it from a tier label.
 */
export interface MyRole {
	role: TeamRole;
	/** How they hold it TODAY: primary, or second because the primary is out. */
	tier: 'primary' | 'second';
	covering: boolean;
	/** Who the primary is, so a covering student knows whose seat they are in. */
	primaryName: string | null;
}

/**
 * Projects `team_resolve_roles` onto one student. Returns null when the
 * student holds no role today, which is a real state and not an error.
 */
export function myRoleFrom(rows: ResolvedRole[], studentId: string): MyRole | null {
	// The seat they are ACTIVELY holding wins: that is the resolver's answer.
	const active = rows.find((r) => r.active_student_id === studentId);
	if (active && active.active_tier) {
		return {
			role: active.role,
			tier: active.active_tier,
			covering: active.active_tier === 'second',
			primaryName: active.primary_name
		};
	}
	// Not active in any seat, but they may still be assigned to one (they have
	// not checked in, or the primary is here and they are the second).
	const assignedPrimary = rows.find((r) => r.primary_student_id === studentId);
	if (assignedPrimary) {
		return {
			role: assignedPrimary.role,
			tier: 'primary',
			covering: false,
			primaryName: assignedPrimary.primary_name
		};
	}
	const assignedSecond = rows.find((r) => r.second_student_id === studentId);
	if (assignedSecond) {
		return {
			role: assignedSecond.role,
			tier: 'second',
			covering: false,
			primaryName: assignedSecond.primary_name
		};
	}
	return null;
}

export interface StudentTask {
	id: string;
	title: string;
	detail: string | null;
	role: TeamRole | null;
	status: TaskStatus;
	assigned_student_id: string | null;
	evidence_required: boolean;
	evidence_count: number;
}

export interface RosterMember {
	id: string;
	first_name: string;
	last_initial: string;
	present: boolean;
}

/** The three taps offered before the keyboard, so a kid who will not type still raises the flag. */
export const STUCK_REASONS = [
	'A piece keeps falling off',
	'The code is not doing what we want',
	'We do not know what to do next'
] as const;
