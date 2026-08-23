<script lang="ts">
	/**
	 * THE MAT, AS A SCHEMATIC. A plain rectangle at the real 45 by 93 inch
	 * proportions with a millimeter coordinate system, origin at the launch
	 * area corner, y up. NO official mat artwork is drawn, fetched or traced
	 * here: mission models are labeled markers at mentor-recorded positions,
	 * and the optional background is the club's own photo of its own mat.
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
	import type { MissionMarker, WaypointModel } from './types';

	interface Props {
		missions: MissionMarker[];
		waypoints: WaypointModel[];
		ghostRoutes: { id: string; pts: PointMm[] }[];
		robot: { widthMm: number; lengthMm: number };
		/** Where the robot outline sits: usually the selected waypoint. */
		footprint: { x: number; y: number; headingDeg: number } | null;
		launchArea: { w: number; h: number } | null;
		photoUrl: string | null;
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
	}

	let {
		missions,
		waypoints,
		ghostRoutes,
		robot,
		footprint,
		launchArea,
		photoUrl,
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
		onNudgeWaypoint
	}: Props = $props();

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

<div class="mat" bind:this={containerEl} bind:clientWidth={containerWidth}>
	<svg
		bind:this={svgEl}
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

		{#if photoUrl && showPhoto}
			<image
				href={photoUrl}
				x="0"
				y="0"
				width={MAT_WIDTH_MM}
				height={MAT_HEIGHT_MM}
				preserveAspectRatio="none"
				opacity="0.55"
				pointer-events="none"
			/>
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
		stroke: var(--glow-cyan);
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
		fill: var(--glow-green);
		opacity: 0.08;
		stroke: var(--glow-green);
		stroke-width: 4;
		stroke-dasharray: 24 18;
	}
	.mat__launch-label {
		fill: var(--glow-green);
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
		stroke: var(--team-accent, var(--glow-cyan));
		opacity: 0.16;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.mat__route {
		fill: none;
		stroke: var(--team-accent, var(--glow-cyan));
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
		stroke: var(--glow-cyan);
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
		stroke: var(--team-accent, var(--glow-cyan));
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
		stroke: var(--glow-cyan);
		stroke-width: 12;
	}
	.mat__wp-hit {
		fill: transparent;
	}
	.mat__wp-dot {
		fill: var(--team-accent, var(--glow-cyan));
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
</style>
