<script lang="ts" module>
	/** Clip path ids have to be unique per mounted canvas on one page. The
	 *  counter is module-scoped so server and client number them alike. */
	let nextCanvasId = 0;
</script>

<script lang="ts">
	/**
	 * THE FIELD, AS A SCHEMATIC: TWO RECTANGLES, NOT ONE.
	 *
	 * The OUTER one is the TABLE inside its border walls, 2362 by 1143 mm.
	 * It is the coordinate system (origin at the launch area corner, y up)
	 * and it is the DRIVABLE region, so it is the tap target: a robot may
	 * stand on bare table beside the mat and a waypoint may go there too.
	 *
	 * The INNER one is the printed MAT, 2000 by 1134 mm, sitting 181 mm in
	 * from each side and flush with the bottom wall. It is drawn as a
	 * distinct sheet, so the two 181 mm strips and the 9 mm top gap READ as
	 * bare table rather than as mat. Everything that belongs to the printed
	 * sheet -- the background picture, the grid, the mission markers -- is
	 * on the mat; everything that belongs to the driving -- the route, the
	 * robot, the axes -- is on the table.
	 *
	 * WHY THAT DISTINCTION IS THE POINT OF THIS COMPONENT. Until this bundle
	 * there was one rectangle and it was the table wearing the mat's name, so
	 * an uploaded picture of the mat was stretched 18.1% along x and 0.8%
	 * along y to fill it. Drawing them as one rectangle is what made that
	 * impossible to see. No mat artwork is drawn, fetched or traced here:
	 * mission models are labeled markers at mentor-recorded positions.
	 *
	 * THE BACKGROUND PICTURE IS PLACED BY ITS CALIBRATION, NEVER STRETCHED.
	 * `photo` carries a short-lived signed URL and the two corners a mentor
	 * tapped on the MAT; calibrationTransform() lays the picture down so
	 * those corners land exactly on the mat rectangle, and the clip path --
	 * the mat, not the table -- cuts off whatever hangs outside. A picture
	 * with no calibration is NOT DRAWN: there is no fallback transform,
	 * because a wrong one is invisible. The picture is copyrighted (see
	 * CLAUDE.md); it reaches this component as a signed URL and nothing here
	 * caches or re-publishes it.
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
	import {
		MAT_HEIGHT_MM,
		MAT_ORIGIN_X_MM,
		MAT_ORIGIN_Y_MM,
		MAT_WIDTH_MM,
		TABLE_HEIGHT_MM,
		TABLE_WIDTH_MM,
		matToTable,
		type PointMm
	} from './geometry';
	import { calibrationTransform } from './calibration';
	import {
		unitWord,
		xAxisTicks,
		xMatTicks,
		yAxisTicks,
		yMatTicks,
		type LengthUnit
	} from './units';
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
		/** The student's preferred length unit; axis labels convert, geometry stays mm. */
		unit?: LengthUnit;
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
		unit = 'cm',
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

	/**
	 * viewBox margins hold the axis ticks and labels. The TABLE series sits
	 * below and to the left; the MAT series is led out into the top and right
	 * margins, which is why those two are wider than a tick needs. Two series
	 * on opposite sides of the drawing cannot collide at any screen width.
	 */
	const M_LEFT = 170;
	const M_TOP = 120;
	const M_RIGHT = 250;
	const M_BOTTOM = 150;
	const VIEW_W = TABLE_WIDTH_MM + M_LEFT + M_RIGHT;
	const VIEW_H = TABLE_HEIGHT_MM + M_TOP + M_BOTTOM;

	/** Where the mat's own rectangle sits in the drawing (svg y is DOWN). */
	const MAT_X = MAT_ORIGIN_X_MM;
	const MAT_RIGHT = MAT_ORIGIN_X_MM + MAT_WIDTH_MM;
	const MAT_TOP_Y = TABLE_HEIGHT_MM - (MAT_ORIGIN_Y_MM + MAT_HEIGHT_MM);

	let xTicks = $derived(xAxisTicks(unit));
	let yTicks = $derived(yAxisTicks(unit));
	let xMat = $derived(xMatTicks(unit));
	let yMat = $derived(yMatTicks(unit));
	const GRID = 250;

	/** Model y is up; svg y is down. The whole TABLE is the drawing. */
	const sy = (y: number) => TABLE_HEIGHT_MM - y;

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

	/**
	 * A gesture is clamped to the TABLE, not to the mat. Unchanged by this
	 * bundle and correct as it stands: the drivable region is the whole table,
	 * and a waypoint on the bare strip beside the mat is a real plan.
	 */
	function clamp(p: PointMm): PointMm {
		return {
			x: Math.round(Math.min(TABLE_WIDTH_MM, Math.max(0, p.x))),
			y: Math.round(Math.min(TABLE_HEIGHT_MM, Math.max(0, p.y)))
		};
	}

	function clientToMat(e: PointerEvent): PointMm {
		if (!svgEl) return { x: 0, y: 0 };
		const ctm = svgEl.getScreenCTM();
		if (!ctm) return { x: 0, y: 0 };
		const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
		return clamp({ x: pt.x, y: TABLE_HEIGHT_MM - pt.y });
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
			const c = matToTable({ x: MAT_WIDTH_MM / 2, y: MAT_HEIGHT_MM / 2 });
			onTapMat?.({ x: Math.round(c.x), y: Math.round(c.y) });
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
		aria-label="Schematic of the robot game table, with the printed mat inside it"
		onpointermove={handleMove}
		onpointerup={handleUp}
		onpointercancel={handleCancel}
	>
		<!-- The TABLE: the drivable region, and the tap target for waypoints. -->
		<rect
			class="mat__board"
			role="button"
			tabindex="0"
			aria-label={placingMissionCode
				? `Tap where mission ${placingMissionCode} sits on the mat`
				: editable
					? 'The table. Tap to add a point to the route.'
					: 'The table'}
			x="0"
			y="0"
			width={TABLE_WIDTH_MM}
			height={TABLE_HEIGHT_MM}
			onpointerdown={startPan}
			onkeydown={matKeydown}
		/>

		<!-- The MAT: the printed sheet, 181 mm in from each side and flush with
		     the bottom wall. Drawn as its own surface so the strips and the top
		     gap read as bare table. It takes no pointer events: the table
		     underneath is the one tap target. -->
		<rect
			class="mat__sheet"
			x={MAT_X}
			y={MAT_TOP_Y}
			width={MAT_WIDTH_MM}
			height={MAT_HEIGHT_MM}
			pointer-events="none"
		/>

		{#if photo && showPhoto}
			<defs>
				<clipPath id={clipId}>
					<rect x={MAT_X} y={MAT_TOP_Y} width={MAT_WIDTH_MM} height={MAT_HEIGHT_MM} />
				</clipPath>
			</defs>
			<g clip-path="url(#{clipId})" pointer-events="none">
				<!-- A unit square laid down by the calibration matrix: the two
				     tapped corners land on the two corners of the MAT, and
				     anything outside the sheet is clipped away. -->
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
					x={MAT_X}
					y={MAT_TOP_Y}
					width={MAT_WIDTH_MM}
					height={MAT_HEIGHT_MM}
					opacity={Math.min(90, Math.max(0, photo.dimPct)) / 100}
				/>
			</g>
		{/if}

		<!-- Grid, every 250 mm, measured from the MAT's own corner: it is a
		     reading of the printed sheet, not of the table. -->
		<g class="mat__grid" pointer-events="none">
			{#each Array.from({ length: Math.ceil(MAT_WIDTH_MM / GRID) - 1 }, (_, i) => (i + 1) * GRID) as gx (gx)}
				<line x1={MAT_X + gx} y1={MAT_TOP_Y} x2={MAT_X + gx} y2={sy(MAT_ORIGIN_Y_MM)} />
			{/each}
			{#each Array.from({ length: Math.ceil(MAT_HEIGHT_MM / GRID) - 1 }, (_, i) => (i + 1) * GRID) as gy (gy)}
				<line x1={MAT_X} y1={sy(MAT_ORIGIN_Y_MM + gy)} x2={MAT_RIGHT} y2={sy(MAT_ORIGIN_Y_MM + gy)} />
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

		<!--
			TWO SERIES, ON OPPOSITE SIDES, EACH NAMING ITS OWN RECTANGLE.
			Bottom and left: the TABLE, which is the coordinate space every
			stored number is in. Top and right: the MAT, led out of the drawing
			so a student can read where the printed sheet starts and how big it
			is without either series ever overlapping the other.
		-->
		<g class="mat__axes" pointer-events="none">
			<rect class="mat__frame" x="0" y="0" width={TABLE_WIDTH_MM} height={TABLE_HEIGHT_MM} />
			<rect
				class="mat__sheet-frame"
				x={MAT_X}
				y={MAT_TOP_Y}
				width={MAT_WIDTH_MM}
				height={MAT_HEIGHT_MM}
			/>
			{#each xTicks as t (t.mm)}
				<line x1={t.mm} y1={TABLE_HEIGHT_MM} x2={t.mm} y2={TABLE_HEIGHT_MM + 26} />
				<text class="mat__tick" x={t.mm} y={TABLE_HEIGHT_MM + 88} text-anchor="middle">{t.label}</text>
			{/each}
			{#each yTicks as t (t.mm)}
				<line x1="-26" y1={sy(t.mm)} x2="0" y2={sy(t.mm)} />
				<text class="mat__tick" x="-40" y={sy(t.mm) + 16} text-anchor="end">{t.label}</text>
			{/each}
			<text class="mat__axis-name" x={TABLE_WIDTH_MM - 10} y={TABLE_HEIGHT_MM + 142} text-anchor="end">
				x in {unitWord(unit)} across the table
			</text>
			<text class="mat__axis-name" x="-40" y={sy(TABLE_HEIGHT_MM) - 20} text-anchor="start">
				y in {unitWord(unit)}
			</text>
		</g>

		<g class="mat__axes mat__axes--sheet" pointer-events="none">
			{#each xMat as t (t.mm)}
				<line x1={t.mm} y1={MAT_TOP_Y} x2={t.mm} y2={-30} />
				<text class="mat__tick" x={t.mm} y={-46} text-anchor="middle">{t.label}</text>
			{/each}
			{#each yMat as t (t.mm)}
				<line x1={MAT_RIGHT} y1={sy(t.mm)} x2={TABLE_WIDTH_MM + 30} y2={sy(t.mm)} />
				<text class="mat__tick" x={TABLE_WIDTH_MM + 46} y={sy(t.mm) + 16} text-anchor="start">{t.label}</text>
			{/each}
			<text class="mat__axis-name" x={MAT_X - 60} y={-46} text-anchor="end">the mat</text>
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
				aria-label="Point {i + 1} of the route"
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

	/* THE TABLE IS THE DARKER SURFACE AND THE MAT IS THE LIGHTER SHEET ON IT.
	   On this light plate --surface-0 and --surface-1 are the SAME colour, so
	   the old board fill (--surface-1) was invisible against the container it
	   sat in and one rectangle was all anybody could have seen even if there
	   had been two. --surface-2 for the table gives the sheet something to be
	   lighter than, and the two 181 mm strips and the 9 mm top gap become the
	   bare table they are. */
	.mat__board {
		fill: var(--surface-2);
		cursor: crosshair;
	}
	.mat__board:focus-visible {
		outline: none;
		stroke: var(--text-1);
		stroke-width: 8;
	}
	.mat__sheet {
		fill: var(--surface-1);
	}
	.mat__frame {
		fill: none;
		stroke: var(--boundary);
		stroke-width: 6;
	}
	/* The printed edge of the sheet. A real edge, so it is --boundary, which
	   clears the 3:1 a boundary is held to against the table and the sheet
	   alike. Lighter than the table frame: the outer wall is the harder line. */
	.mat__sheet-frame {
		fill: none;
		stroke: var(--boundary);
		stroke-width: 4;
	}
	.mat__grid line {
		stroke: var(--hairline);
		stroke-width: 2;
		opacity: 0.6;
	}
	/* Structure, not a status. The mat's real launch areas are red and blue
	   (which is why no team accent may be either); drawing them in the SUCCESS
	   colour said nothing true and put green over a quarter of the mat. */
	.mat__launch-area {
		fill: var(--text-2);
		opacity: 0.08;
		stroke: var(--boundary);
		stroke-width: 4;
		stroke-dasharray: 24 18;
	}
	.mat__launch-label {
		fill: var(--text-2);
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
		stroke: var(--team-accent, var(--text-1));
		opacity: 0.16;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.mat__route {
		fill: none;
		stroke: var(--team-accent, var(--text-1));
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
		stroke: var(--text-1);
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
		stroke: var(--team-accent, var(--text-1));
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
		stroke: var(--text-1);
		stroke-width: 12;
	}
	.mat__wp-hit {
		fill: transparent;
	}
	.mat__wp-dot {
		fill: var(--team-accent, var(--text-1));
		stroke: var(--surface-0);
		stroke-width: 6;
	}
	.mat__wp--selected .mat__wp-dot {
		stroke: var(--text-1);
		stroke-width: 12;
	}
	.mat__wp-num {
		fill: var(--team-accent-ink, var(--surface-0));
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
	.mat--over-photo .mat__sheet-frame {
		stroke-width: 8;
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
	/* FOUND BY THE CONTRAST SWEEP, AND OLDER THAN THIS BUNDLE. The blanket
	   `.mat--over-photo text` rule above puts a --surface-0 halo BEHIND every
	   label so it reads over a busy drawing. That is right for a label sitting
	   on the picture, and wrong for the one label that already sits on an
	   opaque shape of its own: the waypoint number is --team-accent-ink, which
	   is LIGHT on most accents, so a light halo drawn behind a light glyph
	   erased it. Measured on the harness's teal team: 234,230,216 ink on a
	   234,230,216 halo, a ratio of 1.00, at 375 and 1440 on both grounds.
	   The dot is what carries this label's contrast, and over a picture the
	   dot's own casing is already widened above; the number needs no halo and
	   must not have one. The mission code is unaffected and keeps its halo:
	   it is dark ink, so a light halo behind it only helps. */
	.mat--over-photo .mat__wp-num {
		paint-order: normal;
		stroke: none;
	}
	.mat--over-photo .mat__robot rect,
	.mat--over-photo .mat__robot line {
		stroke-width: 12;
		opacity: 1;
	}
</style>
