import type { PageServerLoad } from './$types';

/**
 * TASK CREATION, ACROSS TEAMS. The four teams largely run the same plan, so
 * the primary action here writes one task set to several teams at once. The
 * list below it is what those writes produced, so a mis-aimed bulk create is
 * visible immediately and deletable.
 */
export const load: PageServerLoad = async ({ locals: { supabase } }) => {
	const [teamsRes, meetingsRes, tasksRes] = await Promise.all([
		supabase.from('teams').select('id, name, accent').is('archived_at', null).order('name'),
		supabase
			.from('meetings')
			.select('id, meeting_date, kind, started_at, ended_at')
			.order('meeting_date', { ascending: false })
			.limit(10),
		supabase
			.from('tasks')
			.select('id, team_id, title, role, status, meeting_id, evidence_required, created_at')
			.order('created_at', { ascending: false })
			.limit(120)
	]);

	return {
		teams: teamsRes.data ?? [],
		meetings: meetingsRes.data ?? [],
		tasks: tasksRes.data ?? [],
		loadError: teamsRes.error?.message ?? tasksRes.error?.message ?? null
	};
};
