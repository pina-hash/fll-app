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
import { isUsableCalibration, type MatCalibration } from './calibration';
import {
	bySortOrder,
	parseScoring,
	type LaunchModel,
	type MatImageModel,
	type MatSetupModel,
	type MissionMarker,
	type RobotProfileModel,
	type StrategyModel
} from './types';

/**
 * THE FIELD PICTURE IS PER TEAM AND PRIVATE. The path mirrors 0017's
 * GENERATED storage_path column exactly; the database is the authority and
 * this is the client's copy of the same sentence, the way
 * student-identity.ts mirrors _student_email. The storage read policy scopes
 * on the second folder segment, so the shape of this string is load-bearing.
 */
export function matImagePath(teamId: string): string {
	return `teams/${teamId}/field`;
}

/**
 * TEN MINUTES. The picture is copyrighted: a URL that leaks is a URL that
 * works, so it stops working quickly. The browser keeps a picture it has
 * already decoded, so an expiry mid-session costs nothing until a reload,
 * and the planner asks for a fresh URL when a draw actually fails.
 */
export const MAT_IMAGE_URL_TTL_S = 600;

export interface PlannerData {
	missions: MissionMarker[];
	/** Newest version first; [0] is the working copy. */
	strategies: StrategyModel[];
	robot: RobotProfileModel | null;
	matSetup: MatSetupModel;
	matImage: MatImageModel | null;
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

/** A short-lived signed URL for this team's picture, or null if there is none. */
export async function signMatImageUrl(supabase: Client, teamId: string): Promise<string | null> {
	const { data } = await supabase.storage
		.from('mat')
		.createSignedUrl(matImagePath(teamId), MAT_IMAGE_URL_TTL_S);
	return data?.signedUrl ?? null;
}

/**
 * The team's field picture and its calibration. A row whose calibration
 * cannot be inverted comes back with `calibration: null`, which the canvas
 * reads as "do not draw it": a stored pair that somehow slipped past 0017's
 * checks still never becomes a wrong transform on screen.
 */
export async function fetchMatImage(supabase: Client, teamId: string): Promise<MatImageModel | null> {
	const { data } = await supabase
		.from('mat_images')
		.select('id, team_id, storage_path, image_w, image_h, origin_u, origin_v, far_u, far_v, dim_pct')
		.eq('team_id', teamId)
		.maybeSingle();
	if (!data) return null;

	const candidate: MatCalibration = {
		origin: { u: data.origin_u ?? Number.NaN, v: data.origin_v ?? Number.NaN },
		far: { u: data.far_u ?? Number.NaN, v: data.far_v ?? Number.NaN }
	};
	return {
		id: data.id,
		teamId: data.team_id,
		storagePath: data.storage_path ?? matImagePath(teamId),
		imageW: data.image_w,
		imageH: data.image_h,
		calibration: isUsableCalibration(candidate) ? candidate : null,
		dimPct: data.dim_pct,
		url: await signMatImageUrl(supabase, teamId)
	};
}

export async function loadPlannerData(supabase: Client, teamId: string): Promise<PlannerData> {
	const [missionsRes, strategies, robotRes, matRes, canEditRes, matImage] = await Promise.all([
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
		fetchMatImage(supabase, teamId)
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

	return { missions, strategies, robot, matSetup, canEdit: canEditRes.data === true, matImage };
}
