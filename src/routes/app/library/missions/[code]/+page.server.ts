import { error, fail } from '@sveltejs/kit';
import { missionContent } from '$lib/content/missions';
import type { Actions, PageServerLoad } from './$types';

/**
 * A mission's strategy note is TEAM-scoped (team_mission_notes), not
 * device-scoped the way fll-camp kept it. A student always edits their own
 * team's note. A mentor manages all four teams and is not standing at one
 * team's table while browsing the Hub, so the page adds a `?team=` selector
 * for them, backed by the same team list the console's Teams pane already
 * shows.
 */
export const load: PageServerLoad = async ({ params, url, locals: { supabase, principal } }) => {
	const content = missionContent(params.code);
	if (!content) error(404, 'No such mission.');

	const missionRes = await supabase
		.from('missions')
		.select('id, code, name, points_label, scoring, position_x_mm, position_y_mm')
		.eq('code', params.code)
		.maybeSingle();

	if (!missionRes.data) error(404, 'No such mission.');
	const mission = missionRes.data;

	const teamId =
		principal?.kind === 'student' ? principal.teamId : (url.searchParams.get('team') ?? null);

	const [teamsRes, noteRes] = await Promise.all([
		principal?.kind === 'mentor'
			? supabase.from('teams').select('id, name').order('name')
			: Promise.resolve({ data: null, error: null }),
		teamId
			? supabase
					.from('team_mission_notes')
					.select('note')
					.eq('team_id', teamId)
					.eq('mission_id', mission.id)
					.maybeSingle()
			: Promise.resolve({ data: null, error: null })
	]);

	return {
		mission,
		content,
		teams: teamsRes.data ?? [],
		selectedTeamId: teamId,
		note: noteRes.data?.note ?? ''
	};
};

export const actions: Actions = {
	saveNote: async ({ request, params, locals: { supabase } }) => {
		const form = await request.formData();
		const teamId = String(form.get('teamId') ?? '');
		const note = String(form.get('note') ?? '');

		if (!teamId) return fail(400, { message: 'No team selected.' });

		const missionRes = await supabase
			.from('missions')
			.select('id')
			.eq('code', params.code)
			.maybeSingle();
		if (!missionRes.data) return fail(404, { message: 'No such mission.' });

		// UPDATE-then-INSERT, not upsert: the update grant on this table covers
		// only `note` (see 0011's migration), and PostgREST's upsert sets every
		// column in the payload on conflict, including team_id/mission_id/id,
		// which would fail the column-privilege check before RLS is even asked.
		const updateRes = await supabase
			.from('team_mission_notes')
			.update({ note })
			.eq('team_id', teamId)
			.eq('mission_id', missionRes.data.id)
			.select('note');

		if (updateRes.error) return fail(403, { message: updateRes.error.message });

		if (!updateRes.data?.length) {
			const insertRes = await supabase
				.from('team_mission_notes')
				.insert({ id: crypto.randomUUID(), team_id: teamId, mission_id: missionRes.data.id, note })
				.select('note');
			if (insertRes.error || !insertRes.data?.length) {
				return fail(403, { message: insertRes.error?.message ?? 'The note did not save.' });
			}
		}

		return { saved: true };
	}
};
