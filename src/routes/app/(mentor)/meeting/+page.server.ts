import type { PageServerLoad } from './$types';

/**
 * MEETING CONTROL. Desktop-first master-detail: the sessions on the left, one
 * session and its phases on the right, selected with `?meeting=<id>`.
 *
 * With no selection the page picks the LIVE meeting (started, not ended, not
 * cancelled). That is the one a mentor means every time they open this screen
 * mid-session, and it means the phase controls cannot be pointed at the wrong
 * meeting by accident.
 *
 * A CANCELLED SESSION IS NEVER THE DEFAULT SELECTION. 0020 taught
 * `_resolve_current_meeting_id()` to skip it, so it is off the live board, off
 * a student's phone and off the board device; landing on one here would be the
 * console quietly disagreeing with every other surface. It stays selectable by
 * id, because restoring it has to be reachable.
 *
 * THE WHOLE SEASON COMES DOWN IN ONE READ. The list used to stop at 20 rows,
 * which is about seven weeks: a mentor in March could not see October at all.
 * A season is dozens of sessions, so 400 is the entire record and then some,
 * and one array answers the list, its filter, its sort, and the season
 * generator's question of which dates already have a session. Sorting and
 * filtering are the browser's job from there: the rows are already in hand,
 * and a round trip per sort would be a round trip for nothing.
 *
 * THE FOUR COUNTS ARE WHAT THE CONFIRMATIONS NAME. `meeting_cancel` and
 * `meeting_recap_regenerate` both return their counts, but a confirmation has
 * to say what it is about to do BEFORE the tap, not after, so they are read
 * here and the RPC's answer is the receipt.
 */
export const load: PageServerLoad = async ({ url, locals: { supabase } }) => {
	const [meetingsRes, templatesRes] = await Promise.all([
		supabase
			.from('meetings')
			.select(
				'id, meeting_date, kind, planned_start_at, planned_end_at, started_at, ended_at, cancelled_at, current_phase_id'
			)
			.order('meeting_date', { ascending: false })
			.order('planned_start_at', { ascending: false })
			.limit(400),
		supabase.from('phase_templates').select('kind, ordinal, name, planned_minutes').order('kind').order('ordinal')
	]);

	const meetings = meetingsRes.data ?? [];
	const asked = url.searchParams.get('meeting');
	const live = meetings.find((m) => m.started_at && !m.ended_at && !m.cancelled_at) ?? null;
	const selected =
		(asked ? meetings.find((m) => m.id === asked) : null) ??
		live ??
		meetings.find((m) => !m.ended_at && !m.cancelled_at) ??
		meetings.find((m) => !m.cancelled_at) ??
		null;

	const phasesRes = selected
		? await supabase
				.from('meeting_phases')
				.select('id, ordinal, name, planned_minutes, started_at, ended_at')
				.eq('meeting_id', selected.id)
				.order('ordinal')
		: { data: [], error: null };

	// Counts, not rows: the screen never shows an attendance mark or a task
	// here, it only has to be able to say how many of each a cancel would take
	// off the board with the session.
	let attendance = 0;
	let tasks = 0;
	let recaps = 0;
	let confirmedRecaps = 0;
	if (selected) {
		const [attendanceRes, tasksRes, recapsRes, confirmedRes] = await Promise.all([
			supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('meeting_id', selected.id),
			supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('meeting_id', selected.id),
			supabase.from('meeting_recaps').select('id', { count: 'exact', head: true }).eq('meeting_id', selected.id),
			supabase
				.from('meeting_recaps')
				.select('id', { count: 'exact', head: true })
				.eq('meeting_id', selected.id)
				.eq('confirmed', true)
		]);
		attendance = attendanceRes.count ?? 0;
		tasks = tasksRes.count ?? 0;
		recaps = recapsRes.count ?? 0;
		confirmedRecaps = confirmedRes.count ?? 0;
	}

	return {
		meetings,
		live,
		selected,
		phases: phasesRes.data ?? [],
		templates: templatesRes.data ?? [],
		counts: { attendance, tasks, recaps, confirmedRecaps },
		loadError: meetingsRes.error?.message ?? null
	};
};
