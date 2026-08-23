import type { PageServerLoad } from './$types';

/**
 * MEETING CONTROL. Desktop-first master-detail: the sessions on the left, one
 * session and its phases on the right, selected with `?meeting=<id>`.
 *
 * With no selection the page picks the LIVE meeting (started, not ended). That
 * is the one a mentor means every time they open this screen mid-session, and
 * it means the phase controls cannot be pointed at the wrong meeting by
 * accident.
 */
export const load: PageServerLoad = async ({ url, locals: { supabase } }) => {
	const [meetingsRes, templatesRes] = await Promise.all([
		supabase
			.from('meetings')
			.select('id, meeting_date, kind, planned_start_at, planned_end_at, started_at, ended_at, current_phase_id')
			.order('meeting_date', { ascending: false })
			.order('planned_start_at', { ascending: false })
			.limit(20),
		supabase.from('phase_templates').select('kind, ordinal, name, planned_minutes').order('kind').order('ordinal')
	]);

	const meetings = meetingsRes.data ?? [];
	const asked = url.searchParams.get('meeting');
	const live = meetings.find((m) => m.started_at && !m.ended_at) ?? null;
	const selected =
		(asked ? meetings.find((m) => m.id === asked) : null) ??
		live ??
		meetings.find((m) => !m.ended_at) ??
		meetings[0] ??
		null;

	const phasesRes = selected
		? await supabase
				.from('meeting_phases')
				.select('id, ordinal, name, planned_minutes, started_at, ended_at')
				.eq('meeting_id', selected.id)
				.order('ordinal')
		: { data: [], error: null };

	return {
		meetings,
		live,
		selected,
		phases: phasesRes.data ?? [],
		templates: templatesRes.data ?? [],
		loadError: meetingsRes.error?.message ?? null
	};
};
