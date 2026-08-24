import type { PageServerLoad } from './$types';

/**
 * The notebook's team picker: one tile per live team, same shape as the
 * planner's. Sits inside the (mentor) group, so a student never reaches it;
 * the pages below re-ask the database anyway.
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const [teamsRes, recapsRes] = await Promise.all([
		supabase
			.from('teams')
			.select('id, name, accent, fll_team_number')
			.is('archived_at', null)
			.order('name'),
		supabase.from('meeting_recaps').select('team_id, confirmed')
	]);

	const unfinished = new Map<string, number>();
	for (const r of recapsRes.data ?? []) {
		if (!r.confirmed) unfinished.set(r.team_id, (unfinished.get(r.team_id) ?? 0) + 1);
	}

	return {
		teams: (teamsRes.data ?? []).map((t) => ({
			...t,
			unfinishedRecaps: unfinished.get(t.id) ?? 0
		}))
	};
};
