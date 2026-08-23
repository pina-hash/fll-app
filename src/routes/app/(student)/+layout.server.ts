import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/**
 * THE STUDENT RUNTIME IS FOR STUDENTS. A mentor who lands here is sent to
 * their own console rather than refused, because that is a wrong turn and not
 * an intrusion; a board device is refused, because a shared iPad on the table
 * must never be able to act as a named person.
 *
 * This is the OUTER boundary. The inner one is the database: every table the
 * runtime reads is scoped by RLS to `current_student_team_id()`, so a student
 * who defeats this guard still cannot see another team's work.
 */
export const load: LayoutServerLoad = async ({ locals: { principal } }) => {
	if (principal?.kind === 'mentor') redirect(303, '/app/board');
	if (!principal || principal.kind !== 'student') {
		error(403, 'This screen is for students.');
	}
	return { student: principal };
};
