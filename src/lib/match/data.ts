/**
 * Everything the mat screen needs, for one team, in one place.
 *
 * TWO CALLERS, ONE LOAD. The student's own phone (/app/me/match) and the team
 * board iPad (/board/match) show the same screen and read the same rows, and
 * the RLS on all of it (0015) admits the team's students, the team's board and
 * every mentor with the same policy. Writing the load twice would be two
 * chances to filter it differently.
 *
 * The history and the trendline are NOT assembled here: match_run_history is
 * one RPC because the running best is a rule, and a rule lives in SQL.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import { parseRunHistory, toMatchMissions, type RunHistory } from './types';
import type { MatchMission } from './rules';

export interface MatchData {
	missions: MatchMission[];
	history: RunHistory;
	/** The team's working strategy version, if it has one. */
	strategy: { id: string; version: number; label: string | null } | null;
	planLaunches: { id: string; name: string }[];
	/** Only set when something the screen needs could not be read. */
	loadError: string | null;
}

export async function loadMatchData(
	supabase: SupabaseClient<Database>,
	teamId: string
): Promise<MatchData> {
	const [missionsRes, historyRes, strategyRes] = await Promise.all([
		supabase.from('missions').select('id, code, name, points_label, scoring').order('sort_order'),
		supabase.rpc('match_run_history', { p_team_id: teamId }),
		supabase
			.from('strategies')
			.select('id, version, label')
			.eq('team_id', teamId)
			.order('version', { ascending: false })
			.limit(1)
			.maybeSingle()
	]);

	const strategy = strategyRes.data ?? null;
	const launchesRes = strategy
		? await supabase
				.from('launches')
				.select('id, name, sort_order')
				.eq('strategy_id', strategy.id)
				.order('sort_order')
		: { data: [] as { id: string; name: string; sort_order: number }[], error: null };

	return {
		missions: toMatchMissions(missionsRes.data),
		history: parseRunHistory(historyRes.data, teamId),
		strategy,
		planLaunches: (launchesRes.data ?? []).map((l, i) => ({
			id: l.id,
			name: l.name || `Launch ${i + 1}`
		})),
		loadError: missionsRes.error?.message ?? historyRes.error?.message ?? null
	};
}
