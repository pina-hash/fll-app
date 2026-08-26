// Reading and writing the two rows a generated project is built from.
//
// 0024 HAS NOT BEEN APPLIED ANYWHERE, so src/lib/supabase/database.types.ts
// does not carry robot_configs or calibrations and cannot until somebody runs
// `supabase gen types typescript --local > src/lib/supabase/database.types.ts`
// against a stack that has them. Until then these four calls go through a
// deliberately untyped handle, in ONE module, with the row shapes stated here
// by hand. When the types are regenerated, delete `untyped` and let the
// generated types type these calls; the shapes below are what they should say.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase/database.types';
import type { Calibration, RobotConfig } from './toolkit.js';

const untyped = (c: SupabaseClient<Database>) => c as unknown as SupabaseClient;

export interface StoredConfig {
	id: string;
	name: string;
	config: RobotConfig;
}

export interface StoredCalibration {
	id: string;
	sensorPort: string;
	white: number;
	black: number;
	venueLabel: string;
	capturedAt: string;
}

export interface CodegenData {
	configs: StoredConfig[];
	calibrations: StoredCalibration[];
	/**
	 * Why there is nothing to show, when the reason is not "nobody has saved
	 * one yet". Null when the read worked. A page that cannot tell those two
	 * apart tells a team their configuration vanished.
	 */
	unavailable: string | null;
}

type Row = Record<string, unknown>;

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number) => {
	const n = typeof v === 'string' ? Number(v) : v;
	return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};

function toConfig(r: Row): StoredConfig {
	return {
		id: str(r.id),
		name: str(r.name, 'Driving base'),
		config: {
			// numeric comes back from PostgREST as a STRING, not a number, and
			// `56` vs `"56"` is the difference between 614 motor degrees and NaN.
			wheelDiameterMm: num(r.wheel_diameter_mm, 56),
			trackWidthMm: num(r.track_width_mm, 112),
			gearRatio: num(r.gear_ratio, 1),
			movementPair: str(r.movement_pair, 'AB'),
			leftMotor: str(r.left_motor, 'A'),
			rightMotor: str(r.right_motor, 'B'),
			attachmentMotors: Array.isArray(r.attachment_motors)
				? r.attachment_motors.filter((x): x is string => typeof x === 'string')
				: [],
			leftColorPort: str(r.left_color_port, 'E'),
			rightColorPort: str(r.right_color_port, 'F'),
			yawAxis: str(r.yaw_axis, 'up') as RobotConfig['yawAxis']
		}
	};
}

function toCalibration(r: Row): StoredCalibration {
	return {
		id: str(r.id),
		sensorPort: str(r.sensor_port),
		white: num(r.white, 100),
		black: num(r.black, 0),
		venueLabel: str(r.venue_label),
		capturedAt: str(r.captured_at)
	};
}

/**
 * Everything the page needs, or the reason it has none of it.
 *
 * The eq(team_id) filters are for the query planner. RLS is what makes another
 * team's rows unreadable, and a denied read is empty rather than an error,
 * which is why `unavailable` reports only a real failure.
 */
export async function loadCodegenData(
	supabase: SupabaseClient<Database>,
	teamId: string
): Promise<CodegenData> {
	const db = untyped(supabase);
	const [configsRes, calRes] = await Promise.all([
		db.from('robot_configs').select('*').eq('team_id', teamId).order('name'),
		db.from('calibrations').select('*').eq('team_id', teamId).order('sensor_port')
	]);

	const err = configsRes.error ?? calRes.error;
	if (err) {
		return {
			configs: [],
			calibrations: [],
			unavailable:
				'The robot_configs and calibrations tables are not in this database yet. ' +
				'supabase/migrations/0024_robot_configs_and_calibrations.sql has been written ' +
				'but not applied. The generator still works; nothing can be saved. ' +
				`(${err.message})`
		};
	}

	return {
		configs: ((configsRes.data ?? []) as Row[]).map(toConfig),
		calibrations: ((calRes.data ?? []) as Row[]).map(toCalibration),
		unavailable: null
	};
}

export interface SaveResult {
	ok: boolean;
	id: string | null;
	error: string | null;
}

/**
 * AN RLS-FILTERED WRITE IS NOT AN ERROR, AND "no error" IS NOT "it landed".
 * Both branches ask for the row back and treat an empty array as a refusal,
 * because a student who is not the Run Captain gets 204 and zero rows, and a
 * page that reports success from `error === null` tells them it saved.
 */
export async function saveConfig(
	supabase: SupabaseClient<Database>,
	teamId: string,
	existingId: string | null,
	name: string,
	config: RobotConfig
): Promise<SaveResult> {
	const db = untyped(supabase);
	const columns = {
		name,
		wheel_diameter_mm: config.wheelDiameterMm,
		track_width_mm: config.trackWidthMm,
		gear_ratio: config.gearRatio,
		movement_pair: config.movementPair,
		left_motor: config.leftMotor,
		right_motor: config.rightMotor,
		attachment_motors: config.attachmentMotors,
		left_color_port: config.leftColorPort,
		right_color_port: config.rightColorPort,
		yaw_axis: config.yawAxis
	};

	// Update and insert are kept apart rather than upserted: the update grant
	// names no id and no team_id, and an upsert would put both in the SET list
	// and be refused with 42501 on a row the caller may legitimately edit.
	const res = existingId
		? await db.from('robot_configs').update(columns).eq('id', existingId).select('id')
		: await db
				.from('robot_configs')
				.insert({ id: crypto.randomUUID(), team_id: teamId, ...columns })
				.select('id');

	if (res.error) return { ok: false, id: null, error: res.error.message };
	const rows = (res.data ?? []) as Row[];
	if (!rows.length) {
		return {
			ok: false,
			id: null,
			error: 'That did not save. Only a mentor or the Run Captain can change the robot.'
		};
	}
	return { ok: true, id: str(rows[0].id), error: null };
}

/**
 * One reading pair, saved against every colour sensor the robot uses.
 *
 * The emitter takes a SINGLE Calibration and bakes one normalisation for both
 * sensors, so offering a separate white and black per port would be a form
 * field that changes nothing in the output. The table is keyed per port
 * because a sensor is what gets calibrated; the page writes the same pair to
 * each port the config names, and says so.
 */
export async function saveCalibration(
	supabase: SupabaseClient<Database>,
	teamId: string,
	ports: string[],
	venueLabel: string,
	cal: Calibration,
	existing: StoredCalibration[]
): Promise<SaveResult> {
	const db = untyped(supabase);
	for (const port of ports) {
		const prior = existing.find((c) => c.sensorPort === port && c.venueLabel === venueLabel);
		const res = prior
			? await db
					.from('calibrations')
					.update({ white: cal.white, black: cal.black })
					.eq('id', prior.id)
					.select('id')
			: await db
					.from('calibrations')
					.insert({
						id: crypto.randomUUID(),
						team_id: teamId,
						sensor_port: port,
						white: cal.white,
						black: cal.black,
						venue_label: venueLabel
					})
					.select('id');

		if (res.error) return { ok: false, id: null, error: res.error.message };
		if (!((res.data ?? []) as Row[]).length) {
			return {
				ok: false,
				id: null,
				error: 'That did not save. Only a mentor or the Run Captain can change the calibration.'
			};
		}
	}
	return { ok: true, id: null, error: null };
}
