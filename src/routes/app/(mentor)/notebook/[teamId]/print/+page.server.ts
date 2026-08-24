import { error } from '@sveltejs/kit';
import { loadNotebookData } from '$lib/notebook/data';
import type { PageServerLoad } from './$types';

/** The print view of one team's notebook, mentor side. */
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const [teamRes, notebook] = await Promise.all([
		supabase
			.from('teams')
			.select('id, name, fll_team_number')
			.eq('id', params.teamId)
			.maybeSingle(),
		loadNotebookData(supabase, params.teamId)
	]);

	if (!teamRes.data) error(404, 'No such team.');

	return { team: teamRes.data, notebook };
};
