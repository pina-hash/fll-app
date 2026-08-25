<script lang="ts" module>
	/** Clip path ids have to be unique per mounted canvas on one page. The
	 *  counter is module-scoped so server and client number them alike. */
	let nextCanvasId = 0;
</script>

<script lang="ts">
	/**
	 * THE MAT, AS A SCHEMATIC. A plain rectangle at the real 45 by 93 inch
	 * proportions with a millimeter coordinate system, origin at the launch
	 * area corner, y up. No mat artwork is drawn, fetched or traced here:
	 * mission models are labeled markers at mentor-recorded positions.
	 *
	 * THE BACKGROUND PICTURE IS PLACED BY ITS CALIBRATION, NEVER STRETCHED.
	 * `photo` carries a short-lived signed URL and the two corners a mentor
	 * tapped; calibrationTransform() lays the picture down so its playing
	 * surface lands exactly on this rectangle, and the clip path cuts off
	 * whatever border walls hang outside. A picture with no calibration is
	 * NOT DRAWN -- there is no fallback transform, because a wrong one is
	 * invisible. The picture is copyrighted (see CLAUDE.md); it reaches this
	 * component as a signed URL and nothing here caches or re-publishes it.
	 *
	 * LEGIBILITY OVER A BUSY DRAWING. A field layout is dense line art, so
	 * with a picture underneath the overlay switches on a contrast layer: a
	 * dimming scrim at the team's own setting, dark casings under the route,
	 * and a dark outline behind every label (`paint-order: stroke`). Without
	 * a picture none of that is drawn, so the plain schematic stays plain.
	 *
	 * THE MAT IS A LIGHT PLATE ON BOTH GROUNDS, AND THAT IS A DECISION.
	 * `data-ground="light"` on the container re-declares the light tokens for
	 * everything inside it, so the mat looks the same whether the app around
	 * it is white or dark. Three reasons, in order of weight:
	 *
	 *   1. THE DIM SLIDER WOULD OTHERWISE MEAN TWO OPPOSITE THINGS. The
	 *      scrim is --surface-0. A real field layout is a LIGHT drawing, so
	 *      on the white ground "dim" means "fade the picture toward white
	 *      until the plan on top reads" -- and it works because the plan is
	 *      dark ink. Let the scrim follow a dark ground and the same slider
	 *      fades a light drawing toward black: at 0% a mentor gets a glaring
	 *      white rectangle in a dim room, at 90% a black one, and somewhere
	 *      in the middle the picture passes through the lightness of the ink
	 *      on top of it and the labels disappear into it. A control that
	 *      makes the thing less readable in the middle of its own range is
	 *      worse than no control.
	 *   2. THE CONTRAST LAYER IS MEASURED ONCE. Label outlines, the route
	 *      casing and the ghost routes are all --surface-0 against --text-1;
	 *      one ground means one set of measurements, over a picture this repo
	 *      cannot see in advance anyway.
	 *   3. THE MAT IS A PICTURE OF A PHYSICAL OBJECT. The real mat is a
	 *      printed light surface on a table under gym lights. The schematic
	 *      is a drawing of that, and MatCalibrator lays the mat back over the
	 *      mentor's own photograph of it. A drawing of a light thing is light.
	 *
	 * WHAT IT COSTS, STATED: on the dark ground the planner is a light
	 * rectangle in dark chrome, which is a brighter screen than the rest of
	 * the app. That is the trade accepted for a slider that means one thing.
	 * The rest of the planner -- toolbar, movement list, mission panel --
	 * follows the ground normally.
	 *
	 * PURE PROPS. This component owns no data and no queue: it reports
	 * gestures up (tap, drag, long-press) and renders what it is handed. The
	 * parent mutates the model live during a drag so the movement list moves
	 * under the finger.
	 *
	 * TOUCH FIRST. Every grabbable thing carries an invisible hit circle
	 * sized to at least 44 screen pixels at the current zoom, because the
	 * fingers doing this are ten years old and the visible dot at mat scale
	 * is tiny. Long-press deletes; a short tap selects; a moved pointer
	 * drags; a drag on open mat pans.
	 */
	import { MAT_HEIGHT_MM, MAT_WIDTH_MM, type PointMm } from './geometry';
	import { calibrationTransform } from './calibration';
	import type { MatPhoto, MissionMarker, WaypointModel } from './types';

	interface Props {
		missions: MissionMarker[];
		waypoints: WaypointModel[];
		ghostRoutes: { id: string; pts: PointMm[] }[];
		robot: { widthMm: number; lengthMm: number };
		/** Where the robot outline sits: usually the selected waypoint. */
		footprint: { x: number; y: number; headingDeg: number } | null;
		launchArea: { w: number; h: number } | null;
		/** Null when there is no picture, or none that has been calibrated. */
		photo: MatPhoto | null;
		showPhoto: boolean;
		editable: boolean;
		/** Mentors may drag mission markers; nobody else may. */
		canPlaceMissions: boolean;
		/** Mission ids in the selected launch, drawn in the team accent. */
		activeMissionIds: Set<string>;
		selectedWaypointId: string | null;
		zoom: number;
		placingMissionCode: string | null;
		onTapMat?: (p: PointMm) => void;
		onTapMission?: (id: string) => void;
		onSelectWaypoint?: (id: string) => void;
		onWaypointDrag?: (id: string, p: PointMm) => void;
		onWaypointDragEnd?: (id: string, from: PointMm) => void;
		onDeleteWaypoint?: (id: string) => void;
		onMissionDrag?: (id: string, p: PointMm) => void;
		onMissionDragEnd?: (id: string, from: PointMm | null) => void;
		onNudgeWaypoint?: (id: string, dxMm: number, dyMm: number) => void;
		/** The signed URL expired or the picture would not load. */
		onPhotoError?: () => void;
	}

	let {
		missions,
		waypoints,
		ghostRoutes,
		robot,
		footprint,
		launchArea,
		photo,
		showPhoto,
		editable,
		canPlaceMissions,
		activeMissionIds,
		selectedWaypointId,
		zoom,
		placingMissionCode,
		onTapMat,
		onTapMission,
		onSelectWaypoint,
		onWaypointDrag,
		onWaypointDragEnd,
		onDeleteWaypoint,
		onMissionDrag,
		onMissionDragEnd,
		onNudgeWaypoint,
		onPhotoError
	}: Props = $props();

	const clipId = `mat-clip-${nextCanvasId++}`;
	/** True when the overlay has a detailed drawing to stay legible against. */
	let overPhoto = $derived(photo !== null && showPhoto);

	// viewBox margins hold the axis ticks and labels.
	const M_LEFT = 170;
	const M_TOP = 60;
	const M_RIGHT = 60;
	const M_BOTTOM = 150;
	const VIEW_W = MAT_WIDTH_MM + M_LEFT + M_RIGHT;
	const VIEW_H = MAT_HEIGHT_MM + M_TOP + M_BOTTOM;

	const X_TICKS = [0, 500, 1000, 1500, 2000, MAT_WIDTH_MM];
	const Y_TICKS = [0, 500, 1000, MAT_HEIGHT_MM];
	const GRID = 250;

	/** Model y is up; svg y is down. */
	const sy = (y: number) => MAT_HEIGHT_MM - y;

	let svgEl: SVGSVGElement | undefined = $state();
	let containerEl: HTMLDivElement | undefined = $state();
	let containerWidth = $state(360);

	/** Screen pixels per mat millimeter at the current zoom. */
	let pxPerMm = $derived((containerWidth * zoom) / VIEW_W);
	/** An invisible hit circle that is always at least ~44px across on screen. */
	let hitR = $derived(Math.max(34, 24 / Math.max(pxPerMm, 0.01)));

	let placedMissions = $derived(missions.filter((m) => m.xMm !== null && m.yMm !== null));

	let routePts = $derived(waypoints.map((w) => ({ x: w.xMm, y: sy(w.yMm) })));
	let routePoints = $derived(routePts.map((p) => `${p.x},${p.y}`).join(' '));

	function clamp(p: PointMm): PointMm {
		return {
			x: Math.round(Math.min(MAT_WIDTH_MM, Math.max(0, p.x))),
			y: Math.round(Math.min(MAT_HEIGHT_MM, Math.max(0, p.y)))
		};
	}

	function clientToMat(e: PointerEvent): PointMm {
		if (!svgEl) return { x: 0, y: 0 };
		const ctm = svgEl.getScreenCTM();
		if (!ctm) return { x: 0, y: 0 };
		const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
		return clamp({ x: pt.x, y: MAT_HEIGHT_MM - pt.y });
	}

	const LONG_PRESS_MS = 550;
	const MOVE_THRESHOLD_PX = 10;

	/** A pointer already lifted (or synthetic) cannot be captured; that is fine. */
	function capture(e: PointerEvent) {
		try {
			svgEl?.setPointerCapture(e.pointerId);
		} catch {
			// The gesture still works; capture only smooths dragging off-element.
		}
	}

	type Drag =
		| {
				kind: 'waypoint' | 'mission';
				id: string;
				from: PointMm | null;
				moved: boolean;
				startX: number;
				startY: number;
				timer: ReturnType<typeof setTimeout> | null;
		  }
		| { kind: 'pan'; moved: boolean; startX: number; startY: number; scrollX: number; scrollY: number }
		| null;

	let drag: Drag = null;

	function clearTimer() {
		if (drag && drag.kind !== 'pan' && drag.timer) {
			clearTimeout(drag.timer);
			drag.timer = null;
		}
	}

	function startWaypointDrag(e: PointerEvent, w: WaypointModel) {
		if (!editable) return;
		e.stopPropagation();
		capture(e);
		const id = w.id;
		drag = {
			kind: 'waypoint',
			id,
			from: { x: w.xMm, y: w.yMm },
			moved: false,
			startX: e.clientX,
			startY: e.clientY,
			timer: setTimeout(() => {
				if (drag && drag.kind === 'waypoint' && drag.id === id && !drag.moved) {
					drag = null;
					onDeleteWaypoint?.(id);
				}
			}, LONG_PRESS_MS)
		};
	}

	function startMissionDrag(e: PointerEvent, m: MissionMarker) {
		e.stopPropagation();
		capture(e);
		drag = {
			kind: 'mission',
			id: m.id,
			from: m.xMm !== null && m.yMm !== null ? { x: m.xMm, y: m.yMm } : null,
			moved: false,
			startX: e.clientX,
			startY: e.clientY,
			timer: null
		};
	}

	function startPan(e: PointerEvent) {
		capture(e);
		drag = {
			kind: 'pan',
			moved: false,
			startX: e.clientX,
			startY: e.clientY,
			scrollX: containerEl?.scrollLeft ?? 0,
			scrollY: containerEl?.scrollTop ?? 0
		};
	}

	function handleMove(e: PointerEvent) {
		if (!drag) return;
		const dx = e.clientX - drag.startX;
		const dy = e.clientY - drag.startY;
		if (!drag.moved && Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) return;
		drag.moved = true;
		if (drag.kind === 'pan') {
			if (containerEl) {
				containerEl.scrollLeft = drag.scrollX - dx;
				containerEl.scrollTop = drag.scrollY - dy;
			}
			return;
		}
		clearTimer();
		const p = clientToMat(e);
		if (drag.kind === 'waypoint') {
			if (editable) onWaypointDrag?.(drag.id, p);
		} else if (canPlaceMissions) {
			onMissionDrag?.(drag.id, p);
		}
	}

	function handleUp(e: PointerEvent) {
		if (!drag) return;
		const d = drag;
		drag = null;
		if (d.kind !== 'pan') clearTimeout(d.timer ?? undefined);
		if (d.kind === 'pan') {
			if (!d.moved) onTapMat?.(clientToMat(e));
			return;
		}
		if (d.kind === 'waypoint') {
			if (d.moved) onWaypointDragEnd?.(d.id, d.from ?? { x: 0, y: 0 });
			else onSelectWaypoint?.(d.id);
			return;
		}
		// mission
		if (d.moved) {
			if (canPlaceMissions) onMissionDragEnd?.(d.id, d.from);
		} else {
			onTapMission?.(d.id);
		}
	}

	function handleCancel() {
		clearTimer();
		drag = null;
	}

	function waypointKeydown(e: KeyboardEvent, w: WaypointModel) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelectWaypoint?.(w.id);
		} else if (editable && (e.key === 'Delete' || e.key === 'Backspace')) {
			e.preventDefault();
			onDeleteWaypoint?.(w.id);
		} else if (editable && e.key.startsWith('Arrow')) {
			e.preventDefault();
			const step = e.shiftKey ? 50 : 10;
			const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
			const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0;
			onNudgeWaypoint?.(w.id, dx, dy);
		}
	}

	function missionKeydown(e: KeyboardEvent, m: MissionMarker) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onTapMission?.(m.id);
		}
	}

	function matKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onTapMat?.({ x: Math.round(MAT_WIDTH_MM / 2), y: Math.round(MAT_HEIGHT_MM / 2) });
		}
	}
</script>

<div class="mat" data-ground="light" bind:this={containerEl} bind:clientWidth={containerWidth}>
	<svg
		bind:this={svgEl}
		class:mat--over-photo={overPhoto}
		viewBox="{-M_LEFT} {-M_TOP} {VIEW_W} {VIEW_H}"
		style:width="{zoom * 100}%"
		role="application"
		aria-label="Schematic of the robot game mat"
		onpointermove={handleMove}
		onpointerup={handleUp}
		onpointercancel={handleCancel}
	>
		<!-- The mat rectangle. It is also the tap target for adding waypoints. -->
		<rect
			class="mat__board"
			role="button"
			tabindex="0"
			aria-label={placingMissionCode
				? `Tap where mission ${placingMissionCode} sits on the mat`
				: editable
					? 'The mat. Tap to add a waypoint.'
					: 'The mat'}
			x="0"
			y="0"
			width={MAT_WIDTH_MM}
			height={MAT_HEIGHT_MM}
			onpointerdown={startPan}
			onkeydown={matKeydown}
		/>

		{#if photo && showPhoto}
			<defs>
				<clipPath id={clipId}>
					<rect x="0" y="0" width={MAT_WIDTH_MM} height={MAT_HEIGHT_MM} />
				</clipPath>
			</defs>
			<g clip-path="url(#{clipId})" pointer-events="none">
				<!-- A unit square laid down by the calibration matrix: the two
				     tapped corners land on the two corners of this rectangle,
				     and the border walls are clipped away. -->
				<image
					href={photo.url}
					x="0"
					y="0"
					width="1"
					height="1"
					preserveAspectRatio="none"
					transform={calibrationTransform(photo.calibration)}
					onerror={() => onPhotoError?.()}
				/>
				<!-- The dimming layer: what keeps the plan readable on top. -->
				<rect
					class="mat__scrim"
					x="0"
					y="0"
					width={MAT_WIDTH_MM}
					height={MAT_HEIGHT_MM}
					opacity={Math.min(90, Math.max(0, photo.dimPct)) / 100}
				/>
			</g>
		{/if}

		<!-- Grid, every 250 mm. -->
		<g class="mat__grid" pointer-events="none">
			{#each Array.from({ length: Math.floor(MAT_WIDTH_MM / GRID) }, (_, i) => (i + 1) * GRID) as gx (gx)}
				<line x1={gx} y1="0" x2={gx} y2={MAT_HEIGHT_MM} />
			{/each}
			{#each Array.from({ length: Math.floor(MAT_HEIGHT_MM / GRID) }, (_, i) => (i + 1) * GRID) as gy (gy)}
				<line x1="0" y1={sy(gy)} x2={MAT_WIDTH_MM} y2={sy(gy)} />
			{/each}
		</g>

		{#if launchArea}
			<g pointer-events="none">
				<rect
					class="mat__launch-area"
					x="0"
					y={sy(launchArea.h)}
					width={launchArea.w}
					height={launchArea.h}
				/>
				<text class="mat__launch-label" x={launchArea.w / 2} y={sy(launchArea.h) + 70}>
					LAUNCH AREA
				</text>
			</g>
		{/if}

		<!-- Axes: millimeters from the launch area corner (bottom left). -->
		<g class="mat__axes" pointer-events="none">
			<rect class="mat__frame" x="0" y="0" width={MAT_WIDTH_MM} height={MAT_HEIGHT_MM} />
			{#each X_TICKS as t (t)}
				<line x1={t} y1={MAT_HEIGHT_MM} x2={t} y2={MAT_HEIGHT_MM + 26} />
				<text class="mat__tick" x={t} y={MAT_HEIGHT_MM + 88} text-anchor="middle">{t}</text>
			{/each}
			{#each Y_TICKS as t (t)}
				<line x1="-26" y1={sy(t)} x2="0" y2={sy(t)} />
				<text class="mat__tick" x="-40" y={sy(t) + 16} text-anchor="end">{t}</text>
			{/each}
			<text class="mat__axis-name" x={MAT_WIDTH_MM - 10} y={MAT_HEIGHT_MM + 142} text-anchor="end">
				x in mm from the launch corner
			</text>
			<text class="mat__axis-name" x="-40" y="-20" text-anchor="start">y in mm</text>
		</g>

		<!-- Other launches' routes, ghosted for context. -->
		{#each ghostRoutes as ghost (ghost.id)}
			{#if ghost.pts.length > 1}
				<polyline
					class="mat__ghost"
					points={ghost.pts.map((p) => `${p.x},${sy(p.y)}`).join(' ')}
					pointer-events="none"
				/>
			{/if}
		{/each}

		<!-- Clearance corridor: the path stroked at the robot's real width. -->
		{#if routePts.length > 1}
			<polyline class="mat__corridor" points={routePoints} stroke-width={robot.widthMm} pointer-events="none" />
			{#if overPhoto}
				<polyline class="mat__route-casing" points={routePoints} pointer-events="none" />
			{/if}
			<polyline class="mat__route" points={routePoints} pointer-events="none" />
		{/if}

		<!-- The robot footprint, to scale, oriented along its segment. -->
		{#if footprint}
			<g
				class="mat__robot"
				pointer-events="none"
				transform="translate({footprint.x}, {sy(footprint.y)}) rotate({-footprint.headingDeg})"
			>
				<rect
					x={-robot.lengthMm / 2}
					y={-robot.widthMm / 2}
					width={robot.lengthMm}
					height={robot.widthMm}
					rx="18"
				/>
				<line x1={robot.lengthMm / 2 - 26} y1={-robot.widthMm / 2 + 10} x2={robot.lengthMm / 2 - 26} y2={robot.widthMm / 2 - 10} />
			</g>
		{/if}

		<!-- Mission markers at their mentor-recorded positions. -->
		{#each placedMissions as m (m.id)}
			{@const active = activeMissionIds.has(m.id)}
			<g
				class="mat__mission"
				class:mat__mission--active={active}
				role="button"
				tabindex="0"
				aria-label="Mission {m.code}: {m.name}"
				transform="translate({m.xMm}, {sy(m.yMm ?? 0)})"
				onpointerdown={(e) => startMissionDrag(e, m)}
				onkeydown={(e) => missionKeydown(e, m)}
			>
				<circle class="mat__mission-hit" r={hitR} />
				<circle class="mat__mission-dot" r="44" />
				<text class="mat__mission-code" y="12">{m.code.replace('M0', 'M')}</text>
			</g>
		{/each}

		<!-- Waypoints, numbered in drive order. -->
		{#each waypoints as w, i (w.id)}
			<g
				class="mat__wp"
				class:mat__wp--selected={w.id === selectedWaypointId}
				role="button"
				tabindex="0"
				aria-label="Waypoint {i + 1}"
				transform="translate({w.xMm}, {sy(w.yMm)})"
				onpointerdown={(e) => startWaypointDrag(e, w)}
				onkeydown={(e) => waypointKeydown(e, w)}
			>
				<circle class="mat__wp-hit" r={hitR} />
				<circle class="mat__wp-dot" r="30" />
				<text class="mat__wp-num" y="13">{i + 1}</text>
			</g>
		{/each}
	</svg>
</div>

<style>
	.mat {
		overflow: auto;
		max-height: 72vh;
		border: 1px solid var(--boundary);
		border-radius: var(--radius-card);
		background: var(--surface-0);
	}
	svg {
		display: block;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}

	.mat__board {
		fill: var(--surface-1);
		cursor: crosshair;
	}
	.mat__board:focus-visible {
		outline: none;
		stroke: var(--link);
		stroke-width: 8;
	}
	.mat__frame {
		fill: none;
		stroke: var(--boundary);
		stroke-width: 6;
	}
	.mat__grid line {
		stroke: var(--hairline);
		stroke-width: 2;
		opacity: 0.6;
	}
	.mat__launch-area {
		fill: var(--success-text);
		opacity: 0.08;
		stroke: var(--success);
		stroke-width: 4;
		stroke-dasharray: 24 18;
	}
	.mat__launch-label {
		fill: var(--success-text);
		font-size: 52px;
		font-weight: 700;
		text-anchor: middle;
		opacity: 0.85;
	}
	.mat__axes line {
		stroke: var(--text-faint);
		stroke-width: 4;
	}
	.mat__tick {
		fill: var(--text-muted);
		font-size: 52px;
		font-variant-numeric: tabular-nums;
	}
	.mat__axis-name {
		fill: var(--text-faint);
		font-size: 48px;
	}

	.mat__ghost {
		fill: none;
		stroke: var(--text-faint);
		stroke-width: 10;
		stroke-dasharray: 30 26;
		opacity: 0.45;
	}
	.mat__corridor {
		fill: none;
		stroke: var(--team-accent, var(--link));
		opacity: 0.16;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.mat__route {
		fill: none;
		stroke: var(--team-accent, var(--link));
		stroke-width: 12;
		stroke-linejoin: round;
	}
	.mat__robot rect {
		fill: none;
		stroke: var(--text-1);
		stroke-width: 8;
		opacity: 0.9;
	}
	.mat__robot line {
		stroke: var(--text-1);
		stroke-width: 8;
		opacity: 0.9;
	}

	.mat__mission {
		cursor: pointer;
	}
	.mat__mission:focus-visible {
		outline: none;
	}
	.mat__mission:focus-visible .mat__mission-dot {
		stroke: var(--link);
		stroke-width: 10;
	}
	.mat__mission-hit {
		fill: transparent;
	}
	.mat__mission-dot {
		fill: var(--surface-2);
		stroke: var(--boundary);
		stroke-width: 5;
	}
	.mat__mission--active .mat__mission-dot {
		fill: var(--team-accent-wash, var(--surface-2));
		stroke: var(--team-accent, var(--link));
		stroke-width: 9;
	}
	.mat__mission-code {
		fill: var(--text-1);
		font-size: 40px;
		font-weight: 700;
		text-anchor: middle;
		pointer-events: none;
	}

	.mat__wp {
		cursor: grab;
	}
	.mat__wp:focus-visible {
		outline: none;
	}
	.mat__wp:focus-visible .mat__wp-dot {
		stroke: var(--link);
		stroke-width: 12;
	}
	.mat__wp-hit {
		fill: transparent;
	}
	.mat__wp-dot {
		fill: var(--team-accent, var(--link));
		stroke: var(--surface-0);
		stroke-width: 6;
	}
	.mat__wp--selected .mat__wp-dot {
		stroke: var(--text-1);
		stroke-width: 12;
	}
	.mat__wp-num {
		fill: var(--team-accent-ink, var(--accent-ink));
		font-size: 38px;
		font-weight: 800;
		text-anchor: middle;
		pointer-events: none;
	}

	/* ---------------------------------------------------------------------
	   THE CONTRAST LAYER, ON ONLY WHEN A PICTURE IS UNDERNEATH.
	   A field layout is dense line art in every colour, so nothing on top of
	   it may rely on the ground being an even dark surface. The scrim knocks
	   the whole picture back at the team's own setting; every label gets a
	   dark outline drawn BEHIND its fill (paint-order: stroke); the route
	   gets a casing wider than itself; and the grid, frame and dots come up
	   in weight. With no picture none of this applies and the schematic is
	   exactly as plain as it was.
	   --------------------------------------------------------------------- */
	.mat__scrim {
		fill: var(--surface-0);
	}
	.mat--over-photo .mat__grid line {
		stroke: var(--text-1);
		stroke-width: 3;
		opacity: 0.4;
	}
	.mat--over-photo .mat__frame {
		stroke-width: 10;
	}
	.mat--over-photo text {
		paint-order: stroke fill;
		stroke: var(--surface-0);
		stroke-width: 12;
		stroke-linejoin: round;
	}
	.mat__route-casing {
		fill: none;
		stroke: var(--surface-0);
		stroke-width: 26;
		stroke-linejoin: round;
		opacity: 0.85;
	}
	.mat--over-photo .mat__corridor {
		opacity: 0.28;
	}
	.mat--over-photo .mat__ghost {
		stroke: var(--text-1);
		opacity: 0.6;
	}
	.mat--over-photo .mat__mission-dot {
		stroke-width: 9;
	}
	.mat--over-photo .mat__wp-dot {
		stroke-width: 10;
	}
	.mat--over-photo .mat__robot rect,
	.mat--over-photo .mat__robot line {
		stroke-width: 12;
		opacity: 1;
	}
</style>
