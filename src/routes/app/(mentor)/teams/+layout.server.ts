import type { LayoutServerLoad } from './$types';

/**
 * The master half of provisioning's master-detail: every live team, with the
 * roster size the detail pane would otherwise have to ask for again.
 */
export const load: LayoutServerLoad = async ({ locals: { supabase } }) => {
	const [teamsRes, studentsRes] = await Promise.all([
		supabase
			.from('teams')
			.select('id, name, join_code, accent, fll_team_number, archived_at')
			.order('name'),
		supabase.from('students').select('id, team_id').is('deactivated_at', null)
	]);

	const counts = new Map<string, number>();
	for (const s of studentsRes.data ?? []) {
		counts.set(s.team_id, (counts.get(s.team_id) ?? 0) + 1);
	}

	return {
		teams: (teamsRes.data ?? []).map((t) => ({ ...t, roster_size: counts.get(t.id) ?? 0 })),
		teamsError: teamsRes.error?.message ?? null
	};
};
