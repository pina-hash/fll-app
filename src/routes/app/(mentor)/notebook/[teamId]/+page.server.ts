import { error } from '@sveltejs/kit';
import { loadNotebookData } from '$lib/notebook/data';
import type { PageServerLoad } from './$types';

/**
 * One team's notebook, mentor side. The (mentor) group's layout already
 * answered 403 to anyone who is not a mentor; RLS repeats the answer for
 * every row underneath.
 */
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const [teamRes, teamsRes, notebook] = await Promise.all([
		supabase
			.from('teams')
			.select('id, name, accent, fll_team_number, archived_at')
			.eq('id', params.teamId)
			.maybeSingle(),
		supabase.from('teams').select('id, name, accent').is('archived_at', null).order('name'),
		loadNotebookData(supabase, params.teamId)
	]);

	if (!teamRes.data) error(404, 'No such team.');

	return { team: teamRes.data, teams: teamsRes.data ?? [], notebook };
};
