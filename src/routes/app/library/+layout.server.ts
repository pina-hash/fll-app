import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/**
 * THE SKILL HUB IS FOR MENTORS AND STUDENTS, NOT BOARD DEVICES. It is not
 * gated by role, phase, or check-in -- a student can look something up at any
 * time, including outside a meeting -- but a board device is a shared iPad on
 * the table, not a person, and has no reason to browse it.
 */
export const load: LayoutServerLoad = async ({ locals: { principal } }) => {
	if (!principal || principal.kind === 'board') {
		error(403, 'The Skill Hub is for mentors and students.');
	}
	return { libraryPrincipal: principal };
};
