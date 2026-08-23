/**
 * The one loader for everything the route planner needs, used by the mentor
 * console page and the student page alike. Every read here is scoped by RLS;
 * the eq(team_id) filters are for the query planner, not for safety
 * (tests/strategy-isolation proves the difference).
 *
 * `canEdit` is answered by the DATABASE (strategy_can_edit, the same function
 * every planner policy calls), so the UI affordance and the enforcement can
 * never drift apart.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import {
	bySortOrder,
	parseScoring,
	type LaunchModel,
	type MatSetupModel,
	type MissionMarker,
	type RobotProfileModel,
	type StrategyModel
} from './types';

export const MAT_PHOTO_PATH = 'mat.jpg';

export interface PlannerData {
	missions: MissionMarker[];
	/** Newest version first; [0] is the working copy. */
	strategies: StrategyModel[];
	robot: RobotProfileModel | null;
	matSetup: MatSetupModel;
	matPhotoUrl: string | null;
	canEdit: boolean;
}

type Client = SupabaseClient<Database>;

export async function fetchStrategies(supabase: Client, teamId: string): Promise<StrategyModel[]> {
	const [strategiesRes, launchesRes, lmRes, wpRes] = await Promise.all([
		supabase.from('strategies').select('id, team_id, version, label').eq('team_id', teamId),
		supabase
			.from('launches')
			.select('id, strategy_id, name, attachment_name, sort_order')
			.eq('team_id', teamId),
		supabase
			.from('launch_missions')
			.select('id, launch_id, mission_id, sort_order, scoring_lines')
			.eq('team_id', teamId),
		supabase.from('waypoints').select('id, launch_id, x_mm, y_mm, sort_order').eq('team_id', teamId)
	]);

	const launchesByStrategy = new Map<string, LaunchModel[]>();
	const launchById = new Map<string, LaunchModel>();
	for (const l of launchesRes.data ?? []) {
		const model: LaunchModel = {
			id: l.id,
			strategyId: l.strategy_id,
			name: l.name,
			attachmentName: l.attachment_name,
			sortOrder: l.sort_order,
			missions: [],
			waypoints: []
		};
		launchById.set(model.id, model);
		const list = launchesByStrategy.get(model.strategyId) ?? [];
		list.push(model);
		launchesByStrategy.set(model.strategyId, list);
	}
	for (const lm of lmRes.data ?? []) {
		launchById.get(lm.launch_id)?.missions.push({
			id: lm.id,
			launchId: lm.launch_id,
			missionId: lm.mission_id,
			sortOrder: lm.sort_order,
			scoringLines: lm.scoring_lines ?? []
		});
	}
	for (const w of wpRes.data ?? []) {
		launchById.get(w.launch_id)?.waypoints.push({
			id: w.id,
			launchId: w.launch_id,
			xMm: w.x_mm,
			yMm: w.y_mm,
			sortOrder: w.sort_order
		});
	}
	for (const l of launchById.values()) {
		l.missions.sort(bySortOrder);
		l.waypoints.sort(bySortOrder);
	}

	return (strategiesRes.data ?? [])
		.map((s) => ({
			id: s.id,
			teamId: s.team_id,
			version: s.version,
			label: s.label,
			launches: (launchesByStrategy.get(s.id) ?? []).sort(bySortOrder)
		}))
		.sort((a, b) => b.version - a.version);
}

export async function fetchMatPhotoUrl(supabase: Client): Promise<string | null> {
	const { data } = await supabase.storage.from('mat').createSignedUrl(MAT_PHOTO_PATH, 60 * 60 * 8);
	return data?.signedUrl ?? null;
}

export async function loadPlannerData(supabase: Client, teamId: string): Promise<PlannerData> {
	const [missionsRes, strategies, robotRes, matRes, canEditRes, matPhotoUrl] = await Promise.all([
		supabase
			.from('missions')
			.select('id, code, name, points_label, scoring, sort_order, position_x_mm, position_y_mm')
			.order('sort_order'),
		fetchStrategies(supabase, teamId),
		supabase
			.from('team_robots')
			.select('id, team_id, width_mm, length_mm, speed_cm_s, dwell_s, between_launches_s')
			.eq('team_id', teamId)
			.maybeSingle(),
		supabase.from('mat_config').select('launch_area_w_mm, launch_area_h_mm').maybeSingle(),
		supabase.rpc('strategy_can_edit', { p_team_id: teamId }),
		fetchMatPhotoUrl(supabase)
	]);

	const missions: MissionMarker[] = (missionsRes.data ?? []).map((m) => ({
		id: m.id,
		code: m.code,
		name: m.name,
		pointsLabel: m.points_label,
		scoring: parseScoring(m.scoring),
		sortOrder: m.sort_order,
		xMm: m.position_x_mm,
		yMm: m.position_y_mm
	}));

	const robot: RobotProfileModel | null = robotRes.data
		? {
				id: robotRes.data.id,
				teamId: robotRes.data.team_id,
				widthMm: robotRes.data.width_mm,
				lengthMm: robotRes.data.length_mm,
				speedCmS: Number(robotRes.data.speed_cm_s),
				dwellS: Number(robotRes.data.dwell_s),
				betweenLaunchesS: Number(robotRes.data.between_launches_s)
			}
		: null;

	const matSetup: MatSetupModel = {
		launchWmm: matRes.data?.launch_area_w_mm ?? null,
		launchHmm: matRes.data?.launch_area_h_mm ?? null
	};

	return { missions, strategies, robot, matSetup, canEdit: canEditRes.data === true, matPhotoUrl };
}
