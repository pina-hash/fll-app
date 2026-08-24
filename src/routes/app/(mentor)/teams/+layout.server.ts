import type { LayoutServerLoad } from './$types';

/**
 * The master half of provisioning's master-detail: every team a mentor can
 * see, live and archived alike, with the roster size the detail pane would
 * otherwise have to ask for again.
 *
 * ARCHIVED TEAMS COME BACK FROM HERE TOO, AND THE SCREEN DECIDES. An archived
 * team is a soft delete (`teams.archived_at`), not a deletion: its roster
 * cards, its match runs and its notebook are all still attached to it, and the
 * one way back is `team_restore`, which needs the team to be listed somewhere
 * before a mentor can tap it. So the load states no `archived_at is null`
 * filter and the list on `/app/teams` puts them behind a filter instead. Every
 * consumer of `teams` here therefore says which half it means: the accent
 * picker asks for live teams only (a colour is unique across LIVE teams), and
 * so does "move a student to another team".
 *
 * The order puts live teams first so the rail does not open on a team nobody
 * is working with, and names inside each half.
 */
export const load: LayoutServerLoad = async ({ locals: { supabase } }) => {
	const [teamsRes, studentsRes] = await Promise.all([
		supabase
			.from('teams')
			.select('id, name, short_name, join_code, accent, fll_team_number, archived_at')
			.order('name'),
		supabase.from('students').select('id, team_id').is('deactivated_at', null)
	]);

	const counts = new Map<string, number>();
	for (const s of studentsRes.data ?? []) {
		counts.set(s.team_id, (counts.get(s.team_id) ?? 0) + 1);
	}

	const teams = (teamsRes.data ?? [])
		.map((t) => ({ ...t, roster_size: counts.get(t.id) ?? 0 }))
		.sort((a, b) => {
			const archived = Number(Boolean(a.archived_at)) - Number(Boolean(b.archived_at));
			return archived !== 0 ? archived : a.name.localeCompare(b.name);
		});

	return {
		teams,
		liveCount: teams.filter((t) => !t.archived_at).length,
		archivedCount: teams.filter((t) => t.archived_at).length,
		teamsError: teamsRes.error?.message ?? null
	};
};
