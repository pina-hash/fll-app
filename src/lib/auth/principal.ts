/**
 * Who a session is, in this app's terms. One round trip (`auth_whoami`, 0004)
 * answers it for both populations; the shape is parsed defensively and any
 * error answers null, which every guard treats as "no access". Failing closed
 * on a transient error costs a retry; failing open costs a student another
 * team's board.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import { isTeamAccent, type TeamAccent } from '$lib/console/types';

export interface MentorPrincipal {
	kind: 'mentor';
	mentorId: string;
	displayName: string;
	email: string;
	isAdmin: boolean;
}

export interface StudentPrincipal {
	kind: 'student';
	studentId: string;
	firstName: string;
	lastInitial: string;
	slug: string;
	grade: number | null;
	teamId: string;
	teamName: string;
	joinCode: string;
	/** The team's glow accent, for theming the student runtime. */
	accent: TeamAccent | null;
}

/**
 * The shared iPad on the table. It is a DEVICE, not a person: it has a team
 * and nothing else, which is exactly what 0010's policies grant it.
 */
export interface BoardPrincipal {
	kind: 'board';
	deviceId: string;
	teamId: string;
	teamName: string;
	joinCode: string;
	accent: TeamAccent | null;
}

export type Principal = MentorPrincipal | StudentPrincipal | BoardPrincipal;

function str(v: unknown): string | null {
	return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Parses the jsonb `auth_whoami` returns. Anything malformed is null. */
export function parsePrincipal(raw: unknown): Principal | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (r.kind === 'mentor') {
		const mentorId = str(r.mentor_id);
		const displayName = str(r.display_name);
		const email = str(r.email);
		if (!mentorId || !displayName || !email) return null;
		return { kind: 'mentor', mentorId, displayName, email, isAdmin: r.is_admin === true };
	}
	if (r.kind === 'student') {
		const studentId = str(r.student_id);
		const firstName = str(r.first_name);
		const lastInitial = str(r.last_initial);
		const slug = str(r.slug);
		const teamId = str(r.team_id);
		const teamName = str(r.team_name);
		const joinCode = str(r.join_code);
		if (!studentId || !firstName || !lastInitial || !slug || !teamId || !teamName || !joinCode) return null;
		return {
			kind: 'student',
			studentId,
			firstName,
			lastInitial,
			slug,
			grade: typeof r.grade === 'number' ? r.grade : null,
			teamId,
			teamName,
			joinCode,
			// An accent this code does not recognise reads as NO colour rather
			// than rejecting the principal: a missing colour is a blemish, a
			// null principal is a student locked out of their own board. Null
			// is also the real state before a team has chosen (0018).
			accent: isTeamAccent(r.accent) ? r.accent : null
		};
	}
	if (r.kind === 'board') {
		const deviceId = str(r.device_id);
		const teamId = str(r.team_id);
		const teamName = str(r.team_name);
		const joinCode = str(r.join_code);
		if (!deviceId || !teamId || !teamName || !joinCode) return null;
		return {
			kind: 'board',
			deviceId,
			teamId,
			teamName,
			joinCode,
			accent: isTeamAccent(r.accent) ? r.accent : null
		};
	}
	return null;
}

/** Asks the database who the session is. Null on any error. */
export async function fetchPrincipal(supabase: SupabaseClient<Database>): Promise<Principal | null> {
	const { data, error } = await supabase.rpc('auth_whoami');
	if (error) return null;
	return parsePrincipal(data);
}
