import { error } from '@sveltejs/kit';
import { loadNotebookData } from '$lib/notebook/data';
import type { PageServerLoad } from './$types';

/**
 * The print view of the student's own team notebook. Same loader, flat
 * render; the team row adds the FLL number for the cover.
 */
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
	const { student } = await parent();
	if (!student) error(403, 'This screen is for students.');

	const [notebook, teamRes] = await Promise.all([
		loadNotebookData(supabase, student.teamId),
		supabase.from('teams').select('fll_team_number').eq('id', student.teamId).maybeSingle()
	]);

	return { notebook, fllTeamNumber: teamRes.data?.fll_team_number ?? null };
};
