import { error } from '@sveltejs/kit';
import { loadNotebookData } from '$lib/notebook/data';
import { parseNotebookBin } from '$lib/notebook/types';
import type { PageServerLoad } from './$types';

/**
 * One team's notebook, mentor side. The (mentor) group's layout already
 * answered 403 to anyone who is not a mentor; RLS repeats the answer for
 * every row underneath.
 *
 * THE BIN IS LOADED HERE AND NOWHERE ELSE. `notebook_bin` (0020) answers
 * mentors only, and the ten-second undo a child gets is gone long before an
 * adult hears "I deleted the wrong page". This is the second half of that
 * pair, and it is deliberately not on the student page.
 */
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const [teamRes, teamsRes, notebook, binRes] = await Promise.all([
		supabase
			.from('teams')
			.select('id, name, accent, fll_team_number, archived_at')
			.eq('id', params.teamId)
			.maybeSingle(),
		supabase.from('teams').select('id, name, accent').is('archived_at', null).order('name'),
		loadNotebookData(supabase, params.teamId),
		supabase.rpc('notebook_bin', { p_team_id: params.teamId })
	]);

	if (!teamRes.data) error(404, 'No such team.');

	return {
		team: teamRes.data,
		teams: teamsRes.data ?? [],
		notebook,
		bin: parseNotebookBin(binRes.data)
	};
};
