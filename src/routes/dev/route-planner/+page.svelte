<script lang="ts">
	/**
	 * Fixtures for the real RoutePlanner component. Mission positions here are
	 * HARNESS FIXTURES ONLY, spread across the mat so dragging and clearance
	 * are exercisable; the real positions come from the rulebook, entered by a
	 * mentor, and live in the missions table.
	 *
	 * The persist log at the bottom is the harness's reason to exist: every op
	 * the component would have queued is appended there, so a tap on the mat
	 * observably becomes a `planner_insert waypoints` line. That is the
	 * sentinel round trip.
	 *
	 * THE FIELD PICTURE FIXTURE IS THIS REPO'S OWN DRAWING, and it has to be.
	 * The real one is FIRST and LEGO copyrighted, gitignored, and reaches the
	 * app only through a mentor's upload into the private bucket -- it can
	 * never be a fixture here. So the harness draws a stand-in with the SAME
	 * awkward property: a playing surface inset inside a border of walls, at a
	 * picture aspect that is nothing like the mat's. Calibrated to the inset
	 * rectangle, the schematic's grid and frame must land exactly on it; that
	 * is a calibration a person can check by looking, without any artwork
	 * that is not ours.
	 */
	import RoutePlanner from '$lib/planner/RoutePlanner.svelte';
	import type { PlannerOp } from '$lib/planner/ops';
	import type { MissionMarker, StrategyModel } from '$lib/planner/types';
	import type { ConnectionState } from '$lib/student/queue.svelte';
	import { SEASON_MISSIONS } from '$lib/content/example-strategy';

	type Scenario = 'captain' | 'viewer' | 'mentor';
	let scenario = $state<Scenario>('captain');
	/** 'fixture' is a mid-season team; 'none' is the first screen ever. */
	let plan = $state<'fixture' | 'none'>('fixture');
	/** 'fresh' is a mat nobody has set up: no dots, no Base, no robot row. */
	let matReady = $state<'ready' | 'fresh'>('ready');
	let connection = $state<ConnectionState>('online');
	let log = $state<string[]>([]);

	function record(op: PlannerOp) {
		const detail =
			op.kind === 'planner_insert' || op.kind === 'planner_update' || op.kind === 'planner_delete'
				? `${op.kind} ${op.table}`
				: op.kind;
		log = [...log, `${log.length + 1}. ${detail}`];
	}

	/**
	 * The real 15 codes, names and scoring come from the season content module
	 * (the same source the example plan renders from); positions here are
	 * HARNESS FIXTURES (see the header). M13 to M15 stay unplaced so the
	 * mentor "Place on mat" affordance is exercisable in the ready state.
	 */
	const FIXTURE_POSITIONS: Record<string, { x: number; y: number }> = {
		M01: { x: 420, y: 980 },
		M02: { x: 760, y: 860 },
		M03: { x: 1080, y: 1010 },
		M04: { x: 1420, y: 900 },
		M05: { x: 1760, y: 1020 },
		M06: { x: 2080, y: 880 },
		M07: { x: 2140, y: 560 },
		M08: { x: 1840, y: 420 },
		M09: { x: 1500, y: 520 },
		M10: { x: 1160, y: 400 },
		M11: { x: 860, y: 520 },
		M12: { x: 560, y: 380 }
	};

	const MISSIONS: MissionMarker[] = SEASON_MISSIONS.map((m) => ({
		id: `fixture-${m.code}`,
		code: m.code,
		name: m.name,
		pointsLabel: m.pointsLabel,
		scoring: m.scoring,
		sortOrder: m.sortOrder,
		xMm: FIXTURE_POSITIONS[m.code]?.x ?? null,
		yMm: FIXTURE_POSITIONS[m.code]?.y ?? null
	}));

	/** The first Friday: nobody has placed a dot on this team's mat yet. */
	const FRESH_MISSIONS: MissionMarker[] = MISSIONS.map((m) => ({ ...m, xMm: null, yMm: null }));

	const wp = (launchId: string, x: number, y: number, sortOrder: number) => ({
		id: `fixture-wp-${launchId}-${sortOrder}`,
		launchId,
		xMm: x,
		yMm: y,
		sortOrder
	});

	const STRATEGIES: StrategyModel[] = [
		{
			id: 'fixture-strategy-v2',
			teamId: 'fixture-team',
			version: 2,
			label: null,
			launches: [
				{
					id: 'fx-l1',
					strategyId: 'fixture-strategy-v2',
					name: 'Opening run',
					attachmentName: 'Box pusher',
					sortOrder: 1,
					missions: [
						{ id: 'fx-l1-m01', launchId: 'fx-l1', missionId: 'fixture-M01', sortOrder: 1, scoringLines: [0, 1] },
						{ id: 'fx-l1-m03', launchId: 'fx-l1', missionId: 'fixture-M03', sortOrder: 2, scoringLines: [0] }
					],
					waypoints: [
						wp('fx-l1', 180, 220, 1),
						wp('fx-l1', 420, 820, 2),
						wp('fx-l1', 1080, 860, 3),
						wp('fx-l1', 420, 420, 4),
						wp('fx-l1', 180, 220, 5)
					]
				},
				{
					id: 'fx-l2',
					strategyId: 'fixture-strategy-v2',
					name: 'Far side sweep',
					attachmentName: 'Hook arm',
					sortOrder: 2,
					missions: [
						{ id: 'fx-l2-m08', launchId: 'fx-l2', missionId: 'fixture-M08', sortOrder: 1, scoringLines: [0] },
						{ id: 'fx-l2-m05', launchId: 'fx-l2', missionId: 'fixture-M05', sortOrder: 2, scoringLines: [1] }
					],
					waypoints: [
						wp('fx-l2', 200, 200, 1),
						wp('fx-l2', 1500, 300, 2),
						wp('fx-l2', 1840, 560, 3),
						wp('fx-l2', 1760, 900, 4),
						wp('fx-l2', 300, 300, 5)
					]
				}
			]
		},
		{
			id: 'fixture-strategy-v1',
			teamId: 'fixture-team',
			version: 1,
			label: 'first idea',
			launches: [
				{
					id: 'fx-old-l1',
					strategyId: 'fixture-strategy-v1',
					name: 'One big run',
					attachmentName: '',
					sortOrder: 1,
					missions: [],
					waypoints: [wp('fx-old-l1', 200, 200, 1), wp('fx-old-l1', 1200, 700, 2)]
				}
			]
		}
	];

	const ROBOT = {
		id: 'fixture-robot',
		teamId: 'fixture-team',
		widthMm: 170,
		lengthMm: 210,
		speedCmS: 30,
		dwellS: 5,
		betweenLaunchesS: 8
	};

	const MAT_SETUP = { launchWmm: 480, launchHmm: 950 };

	// ---- the field picture stand-in ---------------------------------------
	// 1200 by 700 (1.71:1, close to the real layout's 1.75:1) with the
	// playing surface as a 2.067:1 rectangle inset inside a wall border.
	const PIC_W = 1200;
	const PIC_H = 700;
	// The inset surface: x 84..1116 (1032 wide), y 100..599 (499 tall).
	const SURF = { x: 84, y: 100, w: 1032, h: 499 };
	const FIXTURE_CAL = {
		origin: { u: SURF.x / PIC_W, v: (SURF.y + SURF.h) / PIC_H },
		far: { u: (SURF.x + SURF.w) / PIC_W, v: SURF.y / PIC_H }
	};

	/**
	 * A BUSY *LIGHT* DRAWING, so the contrast layer has the real thing to
	 * survive. It is drawn by this repo and is not a crop, a trace or a
	 * recolouring of anyone's mat artwork; see CLAUDE.md, "The field picture".
	 *
	 * IT USED TO BE DARK, AND THAT MADE THE HARNESS TEST THE EASY CASE. A
	 * real FIRST field layout is printed line art on a light ground: pale
	 * surface, coloured mission models, dark labels. A dark fixture let every
	 * light-coloured overlay sit on it comfortably and hid the case the
	 * contrast layer exists for -- and once the app had a dark ground it
	 * would also have hidden the reason the mat is a light plate. So the
	 * fixture is light now, dense, and mid-tone in places, which is what an
	 * overlay actually has to beat.
	 */
	function fixturePicture(picW: number, picH: number, surf: { x: number; y: number; w: number; h: number }): string {
		const hatch: string[] = [];
		for (let i = 0; i <= surf.w; i += 43) {
			hatch.push(
				`<line x1="${surf.x + i}" y1="${surf.y}" x2="${surf.x + i + 60}" y2="${surf.y + surf.h}" stroke="#3aa0d8" stroke-width="2" opacity="0.55"/>`
			);
		}
		for (let i = 0; i <= surf.h; i += 41) {
			hatch.push(
				`<line x1="${surf.x}" y1="${surf.y + i}" x2="${surf.x + surf.w}" y2="${surf.y + i - 40}" stroke="#e06666" stroke-width="2" opacity="0.5"/>`
			);
		}
		const svg =
			`<svg xmlns="http://www.w3.org/2000/svg" width="${picW}" height="${picH}" viewBox="0 0 ${picW} ${picH}">` +
			`<rect width="${picW}" height="${picH}" fill="#e9e4dc"/>` +
			`<rect x="30" y="46" width="${picW - 60}" height="${picH - 92}" fill="#d6cec3" stroke="#6f665c" stroke-width="10"/>` +
			`<text x="${picW / 2}" y="30" fill="#3d3830" font-size="24" text-anchor="middle">border wall (NOT the playing surface)</text>` +
			`<rect x="${surf.x}" y="${surf.y}" width="${surf.w}" height="${surf.h}" fill="#f4f1ea"/>` +
			hatch.join('') +
			`<rect x="${surf.x}" y="${surf.y}" width="${surf.w}" height="${surf.h}" fill="none" stroke="#c8a415" stroke-width="4"/>` +
			`<circle cx="${surf.x}" cy="${surf.y + surf.h}" r="14" fill="#1f7a3d"/>` +
			`<circle cx="${surf.x + surf.w}" cy="${surf.y}" r="14" fill="#6b3fbf"/>` +
			`<text x="${surf.x + surf.w / 2}" y="${surf.y + surf.h / 2}" fill="#3d3830" font-size="34" text-anchor="middle">playing surface</text>` +
			`</svg>`;
		return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
	}

	const FIXTURE_IMAGE = {
		id: 'fixture-mat-image',
		teamId: 'fixture-team',
		storagePath: 'teams/fixture-team/field',
		imageW: PIC_W,
		imageH: PIC_H,
		calibration: FIXTURE_CAL,
		dimPct: 40,
		url: fixturePicture(PIC_W, PIC_H, SURF)
	};

	/**
	 * A SECOND FIXTURE, DELIBERATELY NOT DRAWN TO SCALE. The official FLL
	 * engineering notebook path-planning diagram is the whole field but
	 * measures nearer 1.75:1, not the mat's own 2.07:1 -- and a mentor
	 * calibrating one for real hit the aspect note reading as an error over
	 * exactly this, because the check that catches a genuine mis-tap cannot
	 * tell it apart from a legitimate picture. This fixture's playing surface
	 * is 980 by 560, a clean 1.75:1, so tapping its real corners exercises
	 * the note the way the false positive did, and confirms it neither
	 * blocks the save nor reads as one.
	 */
	const PIC_W_NONSCALE = 1200;
	const PIC_H_NONSCALE = 800;
	const SURF_NONSCALE = { x: 90, y: 110, w: 980, h: 560 };
	const FIXTURE_IMAGE_NONSCALE = {
		id: 'fixture-mat-image-nonscale',
		teamId: 'fixture-team',
		storagePath: 'teams/fixture-team/field',
		imageW: PIC_W_NONSCALE,
		imageH: PIC_H_NONSCALE,
		calibration: null,
		dimPct: 40,
		url: fixturePicture(PIC_W_NONSCALE, PIC_H_NONSCALE, SURF_NONSCALE)
	};

	type Picture = 'none' | 'uncalibrated' | 'uncalibrated-nonscale' | 'calibrated';
	let pictureMode = $state<Picture>('none');
	let matImage = $derived(
		pictureMode === 'none'
			? null
			: pictureMode === 'uncalibrated'
				? { ...FIXTURE_IMAGE, calibration: null }
				: pictureMode === 'uncalibrated-nonscale'
					? FIXTURE_IMAGE_NONSCALE
					: FIXTURE_IMAGE
	);
</script>

<svelte:head><title>dev: route planner</title></svelte:head>

<div class="harness" data-accent="teal">
	<header class="harness__bar">
		<strong>route planner harness</strong>
		<label>
			scenario
			<select bind:value={scenario}>
				<option value="captain">run captain (edits)</option>
				<option value="viewer">teammate (view only)</option>
				<option value="mentor">mentor</option>
			</select>
		</label>
		<label>
			plan
			<select bind:value={plan}>
				<option value="fixture">two launches</option>
				<option value="none">no plan yet</option>
			</select>
		</label>
		<label>
			mat setup
			<select bind:value={matReady}>
				<option value="ready">dots and Base set</option>
				<option value="fresh">nothing set up</option>
			</select>
		</label>
		<label>
			connection
			<select bind:value={connection}>
				<option value="online">online</option>
				<option value="syncing">syncing</option>
				<option value="offline">offline</option>
			</select>
		</label>
		<label>
			field picture
			<select bind:value={pictureMode}>
				<option value="none">none</option>
				<option value="uncalibrated">uploaded, not calibrated</option>
				<option value="uncalibrated-nonscale">uploaded, not drawn to scale (1.75:1)</option>
				<option value="calibrated">calibrated</option>
			</select>
		</label>
		<button type="button" onclick={() => (log = [])}>clear log</button>
	</header>

	{#key `${scenario}-${plan}-${matReady}-${pictureMode}`}
		<RoutePlanner
			team={{ id: 'fixture-team', name: 'Blue Team' }}
			isMentor={scenario === 'mentor'}
			canEdit={scenario === 'captain' || scenario === 'mentor'}
			missions={matReady === 'fresh' ? FRESH_MISSIONS : MISSIONS}
			strategies={plan === 'none' ? [] : STRATEGIES}
			robot={matReady === 'fresh' ? null : ROBOT}
			matSetup={matReady === 'fresh' ? { launchWmm: null, launchHmm: null } : MAT_SETUP}
			{matImage}
			{connection}
			pendingCount={connection === 'offline' ? 3 : 0}
			failed={[]}
			exampleHref="#example-not-wired-in-the-harness"
			onPersist={record}
			onUploadPicture={scenario === 'mentor'
				? async () => ({ ok: true, message: 'harness: nothing is uploaded here.', image: matImage })
				: undefined}
			onSaveCalibration={scenario === 'mentor'
				? async (cal) => {
						log = [...log, `${log.length + 1}. calibration ${JSON.stringify(cal)}`];
						return { ok: true, message: 'harness: calibration logged, not stored.', image: matImage };
					}
				: undefined}
		/>
	{/key}

	<section class="harness__log">
		<h2>persist log</h2>
		<ol data-testid="persist-log">
			{#each log as line, i (i)}
				<li>{line}</li>
			{:else}
				<li class="harness__none">nothing persisted yet</li>
			{/each}
		</ol>
	</section>
</div>

<style>
	.harness {
		min-height: 100dvh;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-4);
		align-content: start;
	}
	.harness__bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
		padding: var(--space-2) var(--space-3);
		border: 1px dashed var(--boundary);
		border-radius: var(--radius-control);
		color: var(--text-muted);
	}
	.harness__bar select,
	.harness__bar button {
		font: inherit;
		min-height: 2.25rem;
	}
	.harness__log h2 {
		font-size: var(--fs-h3);
		margin: 0 0 var(--space-2);
	}
	.harness__log ol {
		margin: 0;
		padding-left: var(--space-5);
		font-family: var(--font-mono);
		font-size: var(--fs-small);
	}
	.harness__none {
		list-style: none;
		color: var(--text-faint);
	}
</style>
