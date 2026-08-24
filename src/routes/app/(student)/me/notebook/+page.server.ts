import { error } from '@sveltejs/kit';
import { loadNotebookData } from '$lib/notebook/data';
import type { PageServerLoad } from './$types';

/**
 * THE ENGINEERING NOTEBOOK, student side. Every teammate can look; which
 * sections this student can EDIT is the database's own answer
 * (notebook_can_edit, fetched per section inside loadNotebookData), so the
 * affordance can never disagree with the enforcement. No team id in the URL:
 * a student writes their own team's notebook and nothing else.
 */
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { student } = await parent();
	if (!student) error(403, 'This screen is for students.');

	return { notebook: await loadNotebookData(supabase, student.teamId) };
};
