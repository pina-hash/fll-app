<script lang="ts">
	/**
	 * THE ROUTE PLANNER. A team's strategy on the mat and, beside it, the
	 * numbers that strategy turns into: turn N degrees, drive N centimeters.
	 * The drawing is the input; the movement list is the output.
	 *
	 * PURE PROPS, LOCAL MODEL. Nothing here touches Supabase or the queue:
	 * the page above owns both and receives every durable edit through
	 * `onPersist`, one queued op per gesture. The component's own model is
	 * the truth for the session (this surface is local-first; a refetch mid
	 * drag would clobber the plan under a child's finger), and the dev
	 * harness mounts THIS component with fixtures and a persist log.
	 *
	 * WHO EDITS. `canEdit` is the database's own answer (strategy_can_edit);
	 * here it only shows or hides affordances. The enforcement is RLS.
	 */
	import {
		MATCH_SECONDS,
		formatSeconds,
		inLaunchArea,
		launchSeconds,
		plannedPoints,
		routeMoves,
		strategySeconds,
		totalDriveCm,
		type PointMm
	} from './geometry';
	import {
		bySortOrder,
		defaultRobotProfile,
		type LaunchMissionModel,
		type LaunchModel,
		type MatImageModel,
		type MatPhoto,
		type MatSetupModel,
		type MissionMarker,
		type RobotProfileModel,
		type StrategyModel,
		type WaypointModel
	} from './types';
	import type { MatCalibration } from './calibration';
	import { plannerDelete, plannerInsert, plannerUpdate, type PlannerOp } from './ops';
	import type { ConnectionState } from '$lib/student/queue.svelte';
	import MatCanvas from './MatCanvas.svelte';
	import MatCalibrator from './MatCalibrator.svelte';
	import MoveList from './MoveList.svelte';

	interface SnapshotResult {
		ok: boolean;
		message?: string;
		strategies?: StrategyModel[];
	}

	interface PictureResult {
		ok: boolean;
		message: string;
		image: MatImageModel | null;
	}

	interface Props {
		team: { id: string; name: string };
		isMentor: boolean;
		canEdit: boolean;
		missions: MissionMarker[];
		strategies: StrategyModel[];
		robot: RobotProfileModel | null;
		matSetup: MatSetupModel;
		/** The team's field picture, its calibration and a signed URL. */
		matImage?: MatImageModel | null;
		connection?: ConnectionState;
		pendingCount?: number;
		failed?: { id: string; message: string }[];
		onPersist?: (op: PlannerOp) => void;
		onSnapshot?: (label: string) => Promise<SnapshotResult>;
		/** All four are online-only mentor actions; each answers with the
		 *  reloaded row so this component never rebuilds one by hand. */
		onUploadPicture?: (file: File) => Promise<PictureResult>;
		onSaveCalibration?: (cal: MatCalibration) => Promise<PictureResult>;
		onRemovePicture?: () => Promise<PictureResult>;
		/** Persists the team's dim setting. Mentors only; see dimChanged(). */
		onSaveDim?: (pct: number) => void;
		/** A fresh signed URL when the short-lived one has expired. */
		onRefreshPictureUrl?: () => Promise<string | null>;
		onDismissFailure?: (id: string) => void;
	}

	let {
		team,
		isMentor,
		canEdit,
		missions,
		strategies,
		robot,
		matSetup,
		matImage = null,
		connection = 'online',
		pendingCount = 0,
		failed = [],
		onPersist,
		onSnapshot,
		onUploadPicture,
		onSaveCalibration,
		onRemovePicture,
		onSaveDim,
		onRefreshPictureUrl,
		onDismissFailure
	}: Props = $props();

	// ---- the local model: initialized once from props ON PURPOSE, then
	// owned here. This surface is local-first; later prop changes (a load
	// re-run) must not rebuild the plan under an editing child, so the
	// initial-value captures below are the design, not an accident.
	// svelte-ignore state_referenced_locally
	let model = $state({
		strategies: structuredClone(strategies),
		missions: structuredClone(missions),
		robot: robot ? structuredClone(robot) : defaultRobotProfile(team.id),
		matSetup: structuredClone(matSetup)
	});

	// svelte-ignore state_referenced_locally
	let selectedVersionId = $state(strategies[0]?.id ?? '');
	// svelte-ignore state_referenced_locally
	let selectedLaunchId = $state<string | null>(strategies[0]?.launches[0]?.id ?? null);
	let selectedWaypointId = $state<string | null>(null);
	let placingMissionId = $state<string | null>(null);
	let confirmDeleteLaunchId = $state<string | null>(null);
	let zoom = $state(1);
	let showPhoto = $state(true);
	// svelte-ignore state_referenced_locally
	let picture = $state<MatImageModel | null>(matImage ? { ...matImage } : null);
	// The dim setting is applied LOCALLY the instant it moves, and persisted
	// only for a mentor: the row is mentor-writable (0017), so a student
	// dragging the slider adjusts their own screen for the session rather
	// than being told a write failed.
	// svelte-ignore state_referenced_locally
	let dimPct = $state(matImage?.dimPct ?? 40);
	let pictureMsg = $state('');
	let pictureBusy = $state(false);
	let calibrating = $state(false);
	let snapshotOpen = $state(false);
	let snapshotBusy = $state(false);
	let snapshotMsg = $state('');
	let versionLabel = $state('');

	// ---- derived views -----------------------------------------------------
	let working = $derived(model.strategies[0] ?? null);
	let viewing = $derived(model.strategies.find((s) => s.id === selectedVersionId) ?? working);
	let editable = $derived(canEdit && viewing !== null && viewing === working);
	let launches = $derived(viewing ? [...viewing.launches].sort(bySortOrder) : []);
	let launch = $derived(launches.find((l) => l.id === selectedLaunchId) ?? launches[0] ?? null);
	let sortedWaypoints = $derived(launch ? [...launch.waypoints].sort(bySortOrder) : []);
	let moves = $derived(routeMoves(sortedWaypoints.map((w) => ({ x: w.xMm, y: w.yMm }))));
	let missionById = $derived(new Map(model.missions.map((m) => [m.id, m])));
	let launchAreaRect = $derived(
		model.matSetup.launchWmm && model.matSetup.launchHmm
			? { w: model.matSetup.launchWmm, h: model.matSetup.launchHmm }
			: null
	);
	let placingMission = $derived(
		placingMissionId ? (missionById.get(placingMissionId) ?? null) : null
	);

	/**
	 * THE PICTURE IS DRAWN ONLY WHEN IT HAS A URL AND A CALIBRATION. There is
	 * no fallback transform: an uncalibrated picture is left off the mat
	 * entirely, because a guessed one is wrong invisibly.
	 */
	let photo = $derived<MatPhoto | null>(
		picture && picture.url && picture.calibration
			? { url: picture.url, calibration: picture.calibration, dimPct }
			: null
	);
	let pictureNeedsCalibrating = $derived(picture !== null && picture.calibration === null);

	function statsFor(l: LaunchModel) {
		const pts = [...l.waypoints].sort(bySortOrder).map((w) => ({ x: w.xMm, y: w.yMm }));
		const mv = routeMoves(pts);
		const drive = totalDriveCm(mv);
		const seconds = launchSeconds(drive, l.missions.length, model.robot.speedCmS, model.robot.dwellS);
		const points = l.missions.reduce(
			(sum, lm) => sum + plannedPoints(missionById.get(lm.missionId)?.scoring ?? [], lm.scoringLines),
			0
		);
		const la = launchAreaRect;
		const returnsToBase =
			la && pts.length >= 2
				? inLaunchArea(pts[0], la.w, la.h) && inLaunchArea(pts[pts.length - 1], la.w, la.h)
				: null;
		return { drive, seconds, points, returnsToBase };
	}

	let launchStats = $derived(launches.map((l) => ({ launch: l, ...statsFor(l) })));
	let totalSeconds = $derived(
		strategySeconds(
			launchStats.map((s) => s.seconds),
			model.robot.betweenLaunchesS
		)
	);
	let totalPoints = $derived(launchStats.reduce((sum, s) => sum + s.points, 0));
	let fits = $derived(totalSeconds <= MATCH_SECONDS);

	let ghostRoutes = $derived(
		launches
			.filter((l) => l !== launch)
			.map((l) => ({
				id: l.id,
				pts: [...l.waypoints].sort(bySortOrder).map((w) => ({ x: w.xMm, y: w.yMm }))
			}))
	);
	let activeMissionIds = $derived(new Set(launch?.missions.map((lm) => lm.missionId) ?? []));

	let footprint = $derived.by(() => {
		if (sortedWaypoints.length === 0) return null;
		const selIdx = selectedWaypointId
			? sortedWaypoints.findIndex((w) => w.id === selectedWaypointId)
			: -1;
		const i = selIdx >= 0 ? selIdx : sortedWaypoints.length - 1;
		const w = sortedWaypoints[i];
		const heading =
			moves.length === 0 ? 0 : i === 0 ? moves[0].headingDeg : (moves[i - 1]?.headingDeg ?? 0);
		return { x: w.xMm, y: w.yMm, headingDeg: heading };
	});

	// ---- persistence and undo ---------------------------------------------
	function persist(op: PlannerOp) {
		onPersist?.(op);
	}

	type Change =
		| { type: 'wp_add'; launchId: string; wp: WaypointModel }
		| { type: 'wp_delete'; launchId: string; wp: WaypointModel }
		| { type: 'wp_move'; launchId: string; id: string; to: PointMm; from: PointMm }
		| { type: 'lm_add'; launchId: string; lm: LaunchMissionModel }
		| { type: 'lm_remove'; launchId: string; lm: LaunchMissionModel }
		| { type: 'lm_lines'; launchId: string; id: string; lines: number[]; prev: number[] }
		| { type: 'mission_move'; id: string; to: PointMm | null; from: PointMm | null };

	let undoStack = $state<Change[]>([]);

	function findLaunchIn(strategy: StrategyModel | null, id: string): LaunchModel | null {
		return strategy?.launches.find((l) => l.id === id) ?? null;
	}

	/** Applies a change to the model, persists it, and returns its inverse. */
	function apply(change: Change, push = true): void {
		let inverse: Change | null = null;
		if (change.type === 'wp_add') {
			const l = findLaunchIn(working, change.launchId);
			if (!l) return;
			if (!l.waypoints.some((w) => w.id === change.wp.id)) l.waypoints.push({ ...change.wp });
			persist(
				plannerInsert('waypoints', {
					id: change.wp.id,
					launch_id: change.launchId,
					team_id: team.id,
					x_mm: change.wp.xMm,
					y_mm: change.wp.yMm,
					sort_order: change.wp.sortOrder
				})
			);
			inverse = { type: 'wp_delete', launchId: change.launchId, wp: { ...change.wp } };
		} else if (change.type === 'wp_delete') {
			const l = findLaunchIn(working, change.launchId);
			if (!l) return;
			l.waypoints = l.waypoints.filter((w) => w.id !== change.wp.id);
			if (selectedWaypointId === change.wp.id) selectedWaypointId = null;
			persist(plannerDelete('waypoints', change.wp.id));
			inverse = { type: 'wp_add', launchId: change.launchId, wp: { ...change.wp } };
		} else if (change.type === 'wp_move') {
			const l = findLaunchIn(working, change.launchId);
			const w = l?.waypoints.find((x) => x.id === change.id);
			if (!w) return;
			w.xMm = change.to.x;
			w.yMm = change.to.y;
			persist(plannerUpdate('waypoints', change.id, { x_mm: change.to.x, y_mm: change.to.y }));
			inverse = { type: 'wp_move', launchId: change.launchId, id: change.id, to: change.from, from: change.to };
		} else if (change.type === 'lm_add') {
			const l = findLaunchIn(working, change.launchId);
			if (!l) return;
			if (!l.missions.some((m) => m.id === change.lm.id || m.missionId === change.lm.missionId)) {
				l.missions.push({ ...change.lm });
			}
			persist(
				plannerInsert('launch_missions', {
					id: change.lm.id,
					launch_id: change.launchId,
					team_id: team.id,
					mission_id: change.lm.missionId,
					sort_order: change.lm.sortOrder,
					scoring_lines: change.lm.scoringLines
				})
			);
			inverse = { type: 'lm_remove', launchId: change.launchId, lm: { ...change.lm } };
		} else if (change.type === 'lm_remove') {
			const l = findLaunchIn(working, change.launchId);
			if (!l) return;
			l.missions = l.missions.filter((m) => m.id !== change.lm.id);
			persist(plannerDelete('launch_missions', change.lm.id));
			inverse = { type: 'lm_add', launchId: change.launchId, lm: { ...change.lm } };
		} else if (change.type === 'lm_lines') {
			const l = findLaunchIn(working, change.launchId);
			const lm = l?.missions.find((m) => m.id === change.id);
			if (!lm) return;
			lm.scoringLines = [...change.lines];
			persist(plannerUpdate('launch_missions', change.id, { scoring_lines: change.lines }));
			inverse = {
				type: 'lm_lines',
				launchId: change.launchId,
				id: change.id,
				lines: change.prev,
				prev: change.lines
			};
		} else if (change.type === 'mission_move') {
			const m = model.missions.find((x) => x.id === change.id);
			if (!m) return;
			m.xMm = change.to?.x ?? null;
			m.yMm = change.to?.y ?? null;
			persist({
				kind: 'mission_position',
				missionId: change.id,
				xMm: change.to?.x ?? null,
				yMm: change.to?.y ?? null
			});
			inverse = { type: 'mission_move', id: change.id, to: change.from, from: change.to };
		}
		if (push && inverse) undoStack = [...undoStack.slice(-99), inverse];
	}

	function undo() {
		const change = undoStack[undoStack.length - 1];
		if (!change || !editable) return;
		undoStack = undoStack.slice(0, -1);
		apply(change, false);
	}

	// ---- mat gestures ------------------------------------------------------
	function nextSort(items: { sortOrder: number }[]): number {
		return items.reduce((max, x) => Math.max(max, x.sortOrder), 0) + 1;
	}

	function tapMat(p: PointMm) {
		if (placingMissionId && isMentor) {
			const m = missionById.get(placingMissionId);
			apply({
				type: 'mission_move',
				id: placingMissionId,
				to: p,
				from: m && m.xMm !== null && m.yMm !== null ? { x: m.xMm, y: m.yMm } : null
			});
			placingMissionId = null;
			return;
		}
		if (!editable || !launch) return;
		apply({
			type: 'wp_add',
			launchId: launch.id,
			wp: {
				id: crypto.randomUUID(),
				launchId: launch.id,
				xMm: p.x,
				yMm: p.y,
				sortOrder: nextSort(launch.waypoints)
			}
		});
	}

	function tapMission(missionId: string) {
		if (!editable || !launch) return;
		const existing = launch.missions.find((lm) => lm.missionId === missionId);
		if (existing) {
			apply({ type: 'lm_remove', launchId: launch.id, lm: { ...existing } });
			return;
		}
		const mission = missionById.get(missionId);
		apply({
			type: 'lm_add',
			launchId: launch.id,
			lm: {
				id: crypto.randomUUID(),
				launchId: launch.id,
				missionId,
				sortOrder: nextSort(launch.missions),
				scoringLines: (mission?.scoring ?? []).map((_, i) => i)
			}
		});
	}

	function waypointDrag(id: string, p: PointMm) {
		const w = launch?.waypoints.find((x) => x.id === id);
		if (!w) return;
		w.xMm = p.x;
		w.yMm = p.y;
	}

	function waypointDragEnd(id: string, from: PointMm) {
		const w = launch?.waypoints.find((x) => x.id === id);
		if (!w || !launch) return;
		apply({
			type: 'wp_move',
			launchId: launch.id,
			id,
			to: { x: w.xMm, y: w.yMm },
			from
		});
	}

	function nudgeWaypoint(id: string, dx: number, dy: number) {
		const w = launch?.waypoints.find((x) => x.id === id);
		if (!w || !launch) return;
		const from = { x: w.xMm, y: w.yMm };
		apply({
			type: 'wp_move',
			launchId: launch.id,
			id,
			to: {
				x: Math.min(2362, Math.max(0, w.xMm + dx)),
				y: Math.min(1143, Math.max(0, w.yMm + dy))
			},
			from
		});
	}

	function deleteWaypoint(id: string) {
		const w = launch?.waypoints.find((x) => x.id === id);
		if (!w || !launch) return;
		apply({ type: 'wp_delete', launchId: launch.id, wp: { ...w } });
	}

	function missionDrag(id: string, p: PointMm) {
		const m = model.missions.find((x) => x.id === id);
		if (!m) return;
		m.xMm = p.x;
		m.yMm = p.y;
	}

	function missionDragEnd(id: string, from: PointMm | null) {
		const m = model.missions.find((x) => x.id === id);
		if (!m || m.xMm === null || m.yMm === null) return;
		apply({ type: 'mission_move', id, to: { x: m.xMm, y: m.yMm }, from });
	}

	// ---- launches ----------------------------------------------------------
	function startPlan() {
		if (!canEdit) return;
		const sid = crypto.randomUUID();
		const lid = crypto.randomUUID();
		persist(plannerInsert('strategies', { id: sid, team_id: team.id, version: 1 }));
		persist(
			plannerInsert('launches', {
				id: lid,
				strategy_id: sid,
				team_id: team.id,
				name: 'Launch 1',
				sort_order: 1
			})
		);
		const strategy: StrategyModel = {
			id: sid,
			teamId: team.id,
			version: 1,
			label: null,
			launches: [
				{
					id: lid,
					strategyId: sid,
					name: 'Launch 1',
					attachmentName: '',
					sortOrder: 1,
					missions: [],
					waypoints: []
				}
			]
		};
		model.strategies = [strategy];
		selectedVersionId = sid;
		selectedLaunchId = lid;
	}

	function addLaunch() {
		if (!editable || !working) return;
		const lid = crypto.randomUUID();
		const sortOrder = nextSort(working.launches);
		const name = `Launch ${working.launches.length + 1}`;
		persist(
			plannerInsert('launches', {
				id: lid,
				strategy_id: working.id,
				team_id: team.id,
				name,
				sort_order: sortOrder
			})
		);
		working.launches.push({
			id: lid,
			strategyId: working.id,
			name,
			attachmentName: '',
			sortOrder,
			missions: [],
			waypoints: []
		});
		selectedLaunchId = lid;
	}

	function renameLaunch(l: LaunchModel, name: string) {
		if (!editable || l.name === name) return;
		l.name = name;
		persist(plannerUpdate('launches', l.id, { name }));
	}

	function setAttachment(l: LaunchModel, attachment: string) {
		if (!editable || l.attachmentName === attachment) return;
		l.attachmentName = attachment;
		persist(plannerUpdate('launches', l.id, { attachment_name: attachment }));
	}

	function moveLaunch(l: LaunchModel, dir: -1 | 1) {
		if (!editable) return;
		const list = launches;
		const i = list.findIndex((x) => x.id === l.id);
		const other = list[i + dir];
		if (!other) return;
		const a = l.sortOrder;
		l.sortOrder = other.sortOrder;
		other.sortOrder = a;
		// Two equal sort orders would make the swap a no-op visually; nudge apart.
		if (l.sortOrder === other.sortOrder) l.sortOrder = other.sortOrder + (dir === -1 ? -1 : 1);
		persist(plannerUpdate('launches', l.id, { sort_order: l.sortOrder }));
		persist(plannerUpdate('launches', other.id, { sort_order: other.sortOrder }));
	}

	function deleteLaunch(l: LaunchModel) {
		if (!editable || !working) return;
		if (confirmDeleteLaunchId !== l.id) {
			confirmDeleteLaunchId = l.id;
			return;
		}
		confirmDeleteLaunchId = null;
		working.launches = working.launches.filter((x) => x.id !== l.id);
		persist(plannerDelete('launches', l.id));
		undoStack = undoStack.filter((c) => !('launchId' in c) || c.launchId !== l.id);
		if (selectedLaunchId === l.id) selectedLaunchId = working.launches[0]?.id ?? null;
	}

	function setScoringLine(l: LaunchModel, lm: LaunchMissionModel, index: number, on: boolean) {
		if (!editable) return;
		const prev = [...lm.scoringLines];
		const set = new Set(prev);
		if (on) set.add(index);
		else set.delete(index);
		apply({
			type: 'lm_lines',
			launchId: l.id,
			id: lm.id,
			lines: [...set].sort((a, b) => a - b),
			prev
		});
	}

	function moveLaunchMission(l: LaunchModel, lm: LaunchMissionModel, dir: -1 | 1) {
		if (!editable) return;
		const list = [...l.missions].sort(bySortOrder);
		const i = list.findIndex((x) => x.id === lm.id);
		const other = list[i + dir];
		if (!other) return;
		const a = lm.sortOrder;
		lm.sortOrder = other.sortOrder;
		other.sortOrder = a;
		if (lm.sortOrder === other.sortOrder) lm.sortOrder = other.sortOrder + (dir === -1 ? -1 : 1);
		persist(plannerUpdate('launch_missions', lm.id, { sort_order: lm.sortOrder }));
		persist(plannerUpdate('launch_missions', other.id, { sort_order: other.sortOrder }));
	}

	// ---- robot and mat settings -------------------------------------------
	const clampNum = (v: number, lo: number, hi: number) =>
		Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

	function persistRobot() {
		const r = model.robot;
		r.widthMm = Math.round(clampNum(r.widthMm, 1, 1143));
		r.lengthMm = Math.round(clampNum(r.lengthMm, 1, 1143));
		r.speedCmS = clampNum(r.speedCmS, 1, 200);
		r.dwellS = clampNum(r.dwellS, 0, 60);
		r.betweenLaunchesS = clampNum(r.betweenLaunchesS, 0, 60);
		persist({
			kind: 'robot_profile',
			teamId: team.id,
			row: {
				id: r.id,
				team_id: r.teamId,
				width_mm: r.widthMm,
				length_mm: r.lengthMm,
				speed_cm_s: r.speedCmS,
				dwell_s: r.dwellS,
				between_launches_s: r.betweenLaunchesS
			}
		});
	}

	function persistMatSetup() {
		const w = model.matSetup.launchWmm;
		const h = model.matSetup.launchHmm;
		const wv = w ? Math.round(clampNum(w, 1, 2362)) : null;
		const hv = h ? Math.round(clampNum(h, 1, 1143)) : null;
		model.matSetup.launchWmm = wv;
		model.matSetup.launchHmm = hv;
		persist({ kind: 'mat_setup', patch: { launch_area_w_mm: wv, launch_area_h_mm: hv } });
	}

	function takePictureResult(res: { ok: boolean; message: string; image: MatImageModel | null }) {
		pictureMsg = res.message;
		picture = res.image ? { ...res.image } : null;
		if (res.image) dimPct = res.image.dimPct;
		if (picture?.calibration) showPhoto = true;
	}

	async function uploadPicture(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !onUploadPicture || pictureBusy) return;
		pictureBusy = true;
		pictureMsg = 'Saving the picture...';
		takePictureResult(await onUploadPicture(file));
		pictureBusy = false;
		// A new picture has no calibration yet, and an uncalibrated picture is
		// never drawn, so go straight to the two taps rather than leaving a
		// mentor looking at an unchanged mat wondering what happened.
		if (pictureNeedsCalibrating) calibrating = true;
	}

	async function saveCalibration(cal: MatCalibration) {
		if (!onSaveCalibration || pictureBusy) return;
		pictureBusy = true;
		takePictureResult(await onSaveCalibration(cal));
		pictureBusy = false;
		if (picture?.calibration) calibrating = false;
	}

	async function removePicture() {
		if (!onRemovePicture || pictureBusy) return;
		pictureBusy = true;
		calibrating = false;
		takePictureResult(await onRemovePicture());
		pictureBusy = false;
	}

	function dimChanged() {
		if (isMentor) onSaveDim?.(dimPct);
	}

	/**
	 * The signed URL is short lived (ten minutes: the picture is copyrighted).
	 * A draw that fails is almost always an expiry, so ask for a fresh one
	 * ONCE and let a second failure stand rather than looping.
	 */
	let urlRetried = false;
	async function pictureFailedToLoad() {
		if (urlRetried || !onRefreshPictureUrl || !picture) return;
		urlRetried = true;
		const url = await onRefreshPictureUrl();
		if (url && picture) picture = { ...picture, url };
	}

	async function saveVersion() {
		if (!onSnapshot || snapshotBusy) return;
		snapshotBusy = true;
		snapshotMsg = '';
		const res = await onSnapshot(versionLabel.trim());
		snapshotBusy = false;
		if (res.ok && res.strategies) {
			model.strategies = structuredClone(res.strategies);
			selectedVersionId = model.strategies[0]?.id ?? '';
			selectedLaunchId = model.strategies[0]?.launches[0]?.id ?? null;
			undoStack = [];
			versionLabel = '';
			snapshotOpen = false;
		} else {
			snapshotMsg = res.message ?? 'Saving the version did not work. Try again when online.';
		}
	}

	function versionName(s: StrategyModel): string {
		const tag = s.label ? ` "${s.label}"` : '';
		return s === working ? `v${s.version} (working copy)${tag}` : `v${s.version}${tag}`;
	}

	let statusText = $derived(
		connection === 'offline'
			? pendingCount > 0
				? `Offline. ${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} kept on this device.`
				: 'Offline. Your plan is safe on this device.'
			: pendingCount > 0
				? 'Saving...'
				: 'Saved'
	);
</script>

<div class="rp">
	<div class="rp__toolbar">
		{#if model.strategies.length > 0}
			<label class="rp__version">
				<span class="eyebrow">Version</span>
				<select class="input rp__version-select" bind:value={selectedVersionId}>
					{#each model.strategies as s (s.id)}
						<option value={s.id}>{versionName(s)}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if editable}
			<button class="btn btn--ghost" type="button" onclick={undo} disabled={undoStack.length === 0}>
				Undo
			</button>
			{#if onSnapshot}
				<button class="btn btn--secondary" type="button" onclick={() => (snapshotOpen = !snapshotOpen)}>
					Save a version
				</button>
			{/if}
		{/if}
		<span
			class="rp__status"
			class:rp__status--offline={connection === 'offline'}
			role="status"
		>
			{statusText}
		</span>
	</div>

	{#if snapshotOpen && editable}
		<div class="rp__snapshot card">
			<label class="field">
				<span>Name this version (what makes it this plan?)</span>
				<input class="input" bind:value={versionLabel} maxlength="120" placeholder="two launch plan" />
			</label>
			<div class="rp__snapshot-actions">
				<button class="btn btn--primary" type="button" onclick={saveVersion} disabled={snapshotBusy}>
					{snapshotBusy ? 'Saving...' : 'Save version'}
				</button>
				<button class="btn btn--ghost" type="button" onclick={() => (snapshotOpen = false)}>Cancel</button>
			</div>
			{#if snapshotMsg}<p class="error">{snapshotMsg}</p>{/if}
		</div>
	{/if}

	{#if failed.length > 0}
		<div class="rp__failed" role="alert">
			{#each failed as f (f.id)}
				<div class="rp__failed-row">
					<span>{f.message}</span>
					<button class="btn btn--ghost btn--small" type="button" onclick={() => onDismissFailure?.(f.id)}>
						OK
					</button>
				</div>
			{/each}
		</div>
	{/if}

	{#if viewing && !editable && canEdit}
		<p class="notice">You are looking at an old version. Pick the working copy to edit.</p>
	{:else if viewing && !canEdit}
		<p class="rp__viewonly">Only the Run Captain and mentors can change the plan. You can look all you want.</p>
	{/if}

	{#if !viewing}
		<div class="card rp__empty">
			{#if canEdit}
				<p>No plan yet. Start one and tap the mat to draw your first route.</p>
				<button class="btn btn--primary rp__start" type="button" onclick={startPlan}>
					Start our strategy
				</button>
			{:else}
				<p>No plan yet. The Run Captain or a mentor starts it.</p>
			{/if}
		</div>
	{:else}
		<div class="rp__grid">
			<section class="rp__mat-col">
				{#if placingMission}
					<p class="notice rp__placing">
						Tap the mat where {placingMission.code} ({placingMission.name}) sits.
						<button class="btn btn--ghost btn--small" type="button" onclick={() => (placingMissionId = null)}>
							Cancel
						</button>
					</p>
				{/if}

				{#if calibrating && picture && picture.url}
					<MatCalibrator
						url={picture.url}
						imageW={picture.imageW}
						imageH={picture.imageH}
						existing={picture.calibration}
						busy={pictureBusy}
						message={pictureMsg}
						onSave={saveCalibration}
						onCancel={() => (calibrating = false)}
						onImageError={pictureFailedToLoad}
					/>
				{:else}
				<MatCanvas
					missions={model.missions}
					waypoints={sortedWaypoints}
					{ghostRoutes}
					robot={{ widthMm: model.robot.widthMm, lengthMm: model.robot.lengthMm }}
					{footprint}
					launchArea={launchAreaRect}
					{photo}
					{showPhoto}
					{editable}
					canPlaceMissions={isMentor}
					{activeMissionIds}
					{selectedWaypointId}
					{zoom}
					placingMissionCode={placingMission?.code ?? null}
					onTapMat={tapMat}
					onTapMission={tapMission}
					onSelectWaypoint={(id) => (selectedWaypointId = selectedWaypointId === id ? null : id)}
					onWaypointDrag={waypointDrag}
					onWaypointDragEnd={waypointDragEnd}
					onDeleteWaypoint={deleteWaypoint}
					onMissionDrag={missionDrag}
					onMissionDragEnd={missionDragEnd}
					onNudgeWaypoint={nudgeWaypoint}
					onPhotoError={pictureFailedToLoad}
				/>
				{/if}

				<div class="rp__mat-controls">
					<div class="rp__zoom" role="group" aria-label="Zoom">
						{#each [1, 2, 3] as z (z)}
							<button
								class="btn btn--ghost btn--small"
								class:rp__zoom--on={zoom === z}
								type="button"
								onclick={() => (zoom = z)}
							>
								{z}x
							</button>
						{/each}
					</div>
					{#if photo}
						<label class="rp__photo-toggle">
							<input type="checkbox" bind:checked={showPhoto} />
							<span>Show the field picture</span>
						</label>
						{#if showPhoto}
							<label class="rp__dim">
								<span class="small muted">Dim it</span>
								<input
									type="range"
									min="0"
									max="90"
									step="5"
									aria-label="Dim the field picture"
									bind:value={dimPct}
									onchange={dimChanged}
								/>
								<span class="small muted rp__dim-value">{dimPct}%</span>
							</label>
						{/if}
					{:else if pictureNeedsCalibrating && isMentor}
						<p class="small rp__uncalibrated">
							The field picture is not calibrated, so it is not shown.
						</p>
					{/if}
					{#if editable}
						<p class="rp__hint small muted">
							Tap the mat to add a waypoint. Drag to move it. Hold your finger on one to delete it.
						</p>
					{/if}
				</div>

				<!-- Missions: tap to put one in the selected launch. -->
				<div class="rp__missions" role="group" aria-label="Missions">
					{#each model.missions as m (m.id)}
						{@const inLaunch = activeMissionIds.has(m.id)}
						{@const placed = m.xMm !== null && m.yMm !== null}
						<div class="rp__mission-chip" class:rp__mission-chip--on={inLaunch}>
							<button
								class="rp__mission-btn"
								type="button"
								disabled={!editable}
								onclick={() => tapMission(m.id)}
								aria-pressed={inLaunch}
							>
								<strong>{m.code}</strong>
								<span class="rp__mission-name">{m.name}</span>
								<span class="rp__mission-pts">{m.pointsLabel}</span>
							</button>
							{#if isMentor && !placed}
								<button
									class="btn btn--ghost btn--small rp__place-btn"
									type="button"
									onclick={() => (placingMissionId = m.id)}
								>
									Place on mat
								</button>
							{/if}
						</div>
					{/each}
				</div>

				<!-- The match clock check. -->
				<div class="rp__time card">
					<div class="rp__time-bar" aria-hidden="true">
						{#each launchStats as s, i (s.launch.id)}
							<div
								class="rp__time-seg"
								style:width="{Math.min(100, (s.seconds / MATCH_SECONDS) * 100)}%"
								style:opacity={0.55 + 0.45 * ((i + 1) / launchStats.length)}
							></div>
							{#if i < launchStats.length - 1 && model.robot.betweenLaunchesS > 0}
								<div
									class="rp__time-gap"
									style:width="{Math.min(100, (model.robot.betweenLaunchesS / MATCH_SECONDS) * 100)}%"
								></div>
							{/if}
						{/each}
					</div>
					<p class="rp__time-text" class:error={!fits}>
						{#if launchStats.length === 0}
							Add a launch to see the match clock.
						{:else if fits}
							{formatSeconds(totalSeconds)} of {formatSeconds(MATCH_SECONDS)}. Fits with
							{formatSeconds(MATCH_SECONDS - totalSeconds)} to spare.
						{:else}
							Does not fit: {formatSeconds(totalSeconds)} of {formatSeconds(MATCH_SECONDS)}. Cut
							{formatSeconds(totalSeconds - MATCH_SECONDS)} somewhere.
						{/if}
					</p>
					<p class="rp__points">Planned points: <strong>{totalPoints}</strong></p>
				</div>
			</section>

			<aside class="rp__side">
				<section class="card rp__panel">
					<h2 class="rp__h2">Launches</h2>
					<div class="rp__launches">
						{#each launchStats as s, i (s.launch.id)}
							{@const l = s.launch}
							{@const isSel = launch?.id === l.id}
							<div class="rp__launch" class:rp__launch--on={isSel}>
								<button
									class="rp__launch-head"
									type="button"
									onclick={() => {
										selectedLaunchId = l.id;
										selectedWaypointId = null;
									}}
									aria-pressed={isSel}
								>
									<span class="rp__launch-num">{i + 1}</span>
									<span class="rp__launch-name">{l.name || `Launch ${i + 1}`}</span>
									<span class="rp__launch-stats">
										{formatSeconds(s.seconds)} · {s.points} pts
									</span>
								</button>
								{#if isSel}
									<div class="rp__launch-body">
										{#if editable}
											<label class="field">
												<span>Launch name</span>
												<input
													class="input"
													value={l.name}
													maxlength="120"
													onchange={(e) => renameLaunch(l, (e.currentTarget as HTMLInputElement).value)}
												/>
											</label>
											<label class="field">
												<span>Attachment</span>
												<input
													class="input"
													value={l.attachmentName}
													maxlength="120"
													placeholder="what is on the robot?"
													onchange={(e) => setAttachment(l, (e.currentTarget as HTMLInputElement).value)}
												/>
											</label>
										{:else if l.attachmentName}
											<p class="small muted">Attachment: {l.attachmentName}</p>
										{/if}

										<p class="small muted">
											Drives {Math.round(s.drive)} cm. {l.missions.length}
											{l.missions.length === 1 ? 'mission' : 'missions'}.
										</p>
										{#if s.returnsToBase === false}
											<p class="notice rp__warn">
												This route does not start and end in the launch area.
											</p>
										{/if}

										{#each [...l.missions].sort(bySortOrder) as lm (lm.id)}
											{@const mission = missionById.get(lm.missionId)}
											{#if mission}
												<details class="rp__lm">
													<summary>
														<strong>{mission.code}</strong>
														{mission.name} ·
														{plannedPoints(mission.scoring, lm.scoringLines)} pts
													</summary>
													<div class="rp__lm-body">
														{#each mission.scoring as line, li (li)}
															<label class="rp__line">
																<input
																	type="checkbox"
																	disabled={!editable}
																	checked={lm.scoringLines.includes(li)}
																	onchange={(e) =>
																		setScoringLine(l, lm, li, (e.currentTarget as HTMLInputElement).checked)}
																/>
																<span>{line.label} ({line.points})</span>
															</label>
														{/each}
														{#if editable}
															<div class="rp__lm-actions">
																<button class="btn btn--ghost btn--small" type="button" onclick={() => moveLaunchMission(l, lm, -1)}>Earlier</button>
																<button class="btn btn--ghost btn--small" type="button" onclick={() => moveLaunchMission(l, lm, 1)}>Later</button>
																<button
																	class="btn btn--ghost btn--small"
																	type="button"
																	onclick={() => apply({ type: 'lm_remove', launchId: l.id, lm: { ...lm } })}
																>
																	Take out
																</button>
															</div>
														{/if}
													</div>
												</details>
											{/if}
										{/each}

										{#if editable}
											<div class="rp__launch-actions">
												<button class="btn btn--ghost btn--small" type="button" onclick={() => moveLaunch(l, -1)}>Move up</button>
												<button class="btn btn--ghost btn--small" type="button" onclick={() => moveLaunch(l, 1)}>Move down</button>
												<button
													class="btn btn--ghost btn--small rp__delete"
													type="button"
													onclick={() => deleteLaunch(l)}
												>
													{confirmDeleteLaunchId === l.id ? 'Tap again to delete' : 'Delete launch'}
												</button>
											</div>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
					{#if editable}
						<button class="btn btn--secondary rp__add-launch" type="button" onclick={addLaunch}>
							Add a launch
						</button>
					{/if}
				</section>

				<section class="card rp__panel">
					<h2 class="rp__h2">
						Robot moves{launch && launches.length > 1 ? `: ${launch.name}` : ''}
					</h2>
					<MoveList {moves} {editable} />
				</section>

				<details class="card rp__panel rp__settings">
					<summary class="rp__h2">Our robot</summary>
					<div class="rp__settings-grid">
						<label class="field">
							<span>Width (mm)</span>
							<input class="input" type="number" min="1" max="1143" disabled={!editable}
								bind:value={model.robot.widthMm} onchange={persistRobot} />
						</label>
						<label class="field">
							<span>Length (mm)</span>
							<input class="input" type="number" min="1" max="1143" disabled={!editable}
								bind:value={model.robot.lengthMm} onchange={persistRobot} />
						</label>
						<label class="field">
							<span>Speed (cm per second)</span>
							<input class="input" type="number" min="1" max="200" disabled={!editable}
								bind:value={model.robot.speedCmS} onchange={persistRobot} />
						</label>
						<label class="field">
							<span>Seconds at each mission</span>
							<input class="input" type="number" min="0" max="60" disabled={!editable}
								bind:value={model.robot.dwellS} onchange={persistRobot} />
						</label>
						<label class="field">
							<span>Seconds between launches</span>
							<input class="input" type="number" min="0" max="60" disabled={!editable}
								bind:value={model.robot.betweenLaunchesS} onchange={persistRobot} />
						</label>
					</div>
				</details>

				{#if isMentor}
					<details class="card rp__panel rp__settings">
						<summary class="rp__h2">Mat setup (mentor)</summary>
						<div class="rp__settings-grid">
							<label class="field">
								<span>Launch area width (mm)</span>
								<input class="input" type="number" min="1" max="2362"
									bind:value={model.matSetup.launchWmm} onchange={persistMatSetup} />
							</label>
							<label class="field">
								<span>Launch area height (mm)</span>
								<input class="input" type="number" min="1" max="1143"
									bind:value={model.matSetup.launchHmm} onchange={persistMatSetup} />
							</label>
						</div>
						{#if onUploadPicture}
							<div class="rp__picture">
								<label class="field">
									<span>Field picture (the whole layout, walls and all)</span>
									<input
										class="input rp__file"
										type="file"
										accept="image/*"
										disabled={pictureBusy}
										onchange={uploadPicture}
									/>
								</label>
								<p class="small muted">
									It is not cropped and it is not stretched: you tap two corners and the
									planner works out the rest. The picture stays private to this team.
								</p>

								{#if picture}
									{#if picture.calibration}
										<p class="small muted">
											Calibrated. {picture.imageW} by {picture.imageH} pixels.
										</p>
									{:else}
										<p class="notice rp__uncalibrated-notice">
											This picture has no calibration yet, so it is not shown on the mat.
										</p>
									{/if}
									<div class="rp__picture-actions">
										<button
											class="btn btn--ghost btn--small"
											type="button"
											disabled={pictureBusy || !picture.url}
											onclick={() => (calibrating = true)}
										>
											{picture.calibration ? 'Calibrate again' : 'Calibrate now'}
										</button>
										<button
											class="btn btn--ghost btn--small"
											type="button"
											disabled={pictureBusy}
											onclick={removePicture}
										>
											Remove the picture
										</button>
									</div>
								{/if}
								{#if pictureMsg}<p class="small muted">{pictureMsg}</p>{/if}
							</div>
						{/if}
					</details>
				{/if}
			</aside>
		</div>
	{/if}
</div>

<style>
	.rp {
		display: grid;
		gap: var(--space-4);
	}

	.rp__toolbar {
		display: flex;
		align-items: end;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.rp__version {
		display: grid;
		gap: var(--space-1);
	}
	.rp__version-select {
		min-width: 14rem;
	}
	.rp__status {
		margin-left: auto;
		align-self: center;
		color: var(--text-muted);
		font-size: var(--fs-small);
	}
	.rp__status--offline {
		color: var(--warning);
		font-weight: var(--fw-semibold);
	}

	.rp__snapshot-actions {
		display: flex;
		gap: var(--space-3);
	}

	.rp__failed {
		display: grid;
		gap: var(--space-2);
	}
	.rp__failed-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--danger);
		border-radius: var(--radius-control);
		color: var(--danger);
	}

	.rp__viewonly {
		color: var(--text-muted);
		margin: 0;
	}

	.rp__empty {
		display: grid;
		gap: var(--space-3);
		justify-items: start;
	}
	.rp__start {
		min-height: 3.5rem;
		font-size: var(--fs-h3);
	}

	.rp__grid {
		display: grid;
		gap: var(--space-4);
		grid-template-columns: minmax(0, 1fr);
	}
	@media (min-width: 64rem) {
		.rp__grid {
			grid-template-columns: minmax(0, 1fr) 26rem;
			align-items: start;
		}
	}

	.rp__mat-col {
		display: grid;
		gap: var(--space-3);
		min-width: 0;
	}
	.rp__placing {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
	}

	.rp__mat-controls {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.rp__zoom {
		display: flex;
		gap: var(--space-1);
	}
	.rp__zoom--on {
		color: var(--glow-green);
		border-color: var(--boundary);
		background: var(--surface-2);
	}
	.rp__dim {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.rp__dim input[type='range'] {
		width: 8rem;
	}
	.rp__dim-value {
		font-variant-numeric: tabular-nums;
		min-width: 2.5rem;
	}
	.rp__uncalibrated {
		color: var(--amber);
		margin: 0;
	}
	.rp__uncalibrated-notice {
		color: var(--amber);
		border-color: var(--amber);
	}
	.rp__picture {
		display: grid;
		gap: var(--space-2);
	}
	.rp__picture-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.rp__photo-toggle {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
	}
	.rp__photo-toggle input {
		width: 1.4rem;
		height: 1.4rem;
	}
	.rp__hint {
		margin: 0;
	}

	.rp__missions {
		display: flex;
		gap: var(--space-2);
		overflow-x: auto;
		padding-bottom: var(--space-2);
	}
	.rp__mission-chip {
		flex: none;
		display: grid;
		gap: var(--space-1);
		width: 11rem;
	}
	.rp__mission-btn {
		display: grid;
		gap: 2px;
		text-align: left;
		min-height: 4rem;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-tile);
		border: 1px solid var(--boundary);
		background: var(--surface-2);
		color: var(--text-body);
		font: inherit;
		cursor: pointer;
	}
	.rp__mission-btn:disabled {
		cursor: default;
		opacity: 0.8;
	}
	.rp__mission-chip--on .rp__mission-btn {
		border-color: var(--team-accent, var(--glow-cyan));
		background: var(--team-accent-wash, var(--surface-2));
	}
	.rp__mission-name {
		font-size: var(--fs-small);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rp__mission-pts {
		font-size: var(--fs-small);
		color: var(--text-muted);
	}
	.rp__place-btn {
		justify-self: start;
	}

	.rp__time {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-4);
	}
	.rp__time-bar {
		display: flex;
		height: 1.4rem;
		border-radius: var(--radius-control);
		background: var(--surface-0);
		border: 1px solid var(--boundary);
		overflow: hidden;
	}
	.rp__time-seg {
		background: var(--team-accent, var(--glow-cyan));
		min-width: 2px;
	}
	.rp__time-gap {
		background: var(--text-faint);
	}
	.rp__time-text {
		margin: 0;
		font-weight: var(--fw-semibold);
	}
	.rp__points {
		margin: 0;
		color: var(--text-muted);
	}
	.rp__points strong {
		color: var(--text-1);
		font-size: var(--fs-h3);
	}

	.rp__side {
		display: grid;
		gap: var(--space-4);
		min-width: 0;
	}
	.rp__panel {
		padding: var(--space-4);
	}
	.rp__h2 {
		font-size: var(--fs-h3);
		margin: 0 0 var(--space-3);
	}
	.rp__settings summary {
		cursor: pointer;
		min-height: 2.75rem;
		display: flex;
		align-items: center;
	}

	.rp__launches {
		display: grid;
		gap: var(--space-2);
	}
	.rp__launch {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-control);
		overflow: hidden;
	}
	.rp__launch--on {
		border-color: var(--team-accent, var(--glow-cyan));
	}
	.rp__launch-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-height: 3.5rem;
		padding: var(--space-2) var(--space-3);
		background: var(--surface-2);
		border: 0;
		color: var(--text-body);
		font: inherit;
		cursor: pointer;
		text-align: left;
	}
	.rp__launch-num {
		flex: none;
		width: 2rem;
		height: 2rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: var(--team-accent, var(--glow-cyan));
		color: var(--team-accent-ink, var(--accent-ink));
		font-weight: var(--fw-black);
	}
	.rp__launch-name {
		font-weight: var(--fw-bold);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rp__launch-stats {
		flex: none;
		color: var(--text-muted);
		font-size: var(--fs-small);
		font-variant-numeric: tabular-nums;
	}
	.rp__launch-body {
		padding: var(--space-3);
		display: grid;
		gap: var(--space-2);
	}
	.rp__warn {
		text-align: left;
		margin: 0;
	}
	.rp__launch-actions,
	.rp__lm-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.rp__delete {
		color: var(--danger);
	}
	.rp__add-launch {
		margin-top: var(--space-3);
		width: 100%;
	}

	.rp__lm {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-control);
		padding: var(--space-2) var(--space-3);
	}
	.rp__lm summary {
		cursor: pointer;
		min-height: 2.5rem;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-wrap: wrap;
	}
	.rp__lm-body {
		display: grid;
		gap: var(--space-2);
		padding-top: var(--space-2);
	}
	.rp__line {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.5rem;
	}
	.rp__line input {
		width: 1.4rem;
		height: 1.4rem;
		flex: none;
	}

	.rp__settings-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
		gap: var(--space-2) var(--space-3);
		padding-top: var(--space-2);
	}
	.rp__file {
		padding-top: var(--space-2);
	}
</style>
