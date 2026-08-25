<script lang="ts">
	/**
	 * TWO TAPS, THEN LOOK AT IT BEFORE YOU TRUST IT.
	 *
	 * A mentor taps the corner of the PLAYING SURFACE nearest the launch area,
	 * then the corner diagonally opposite. Those two points are the whole
	 * calibration (src/lib/planner/calibration.ts). The moment both exist this
	 * screen draws the mat back onto the picture through the derived
	 * transform: the surface outline, a 250 mm grid, and a ruler in whole feet
	 * along both edges. If that grid does not sit on the mat's own printed
	 * features, the calibration is wrong and it is wrong VISIBLY, here, rather
	 * than invisibly on the planner three weeks later.
	 *
	 * WHY THE CONFIRMATION IS THE POINT. A wrong transform still fills the
	 * rectangle and still looks like a mat. Nothing downstream can catch it.
	 * So the only defence is showing a mentor a drawing whose correctness they
	 * can judge against the thing in front of them, before it is saved.
	 *
	 * THE ASPECT CHECK. Two corners on the SAME side of the mat produce a
	 * rectangle of the wrong shape, and that is the one mis-tap arithmetic can
	 * notice on its own: the surface is 2.07:1, so a wildly different ratio
	 * gets a warning naming the number. It warns and does not block, because a
	 * picture taken slightly off square is still worth calibrating.
	 *
	 * TAPS AND NUMBERS ARE THE SAME STATE. The four percentage fields below
	 * the picture drive and are driven by the taps: they are the keyboard path
	 * to every point, and they let a mentor nudge a corner by a tenth of a
	 * percent instead of trying to hit it again with a thumb.
	 */
	import { MAT_HEIGHT_MM, MAT_WIDTH_MM } from './geometry';
	import {
		calibrationFromCorners,
		isUsableCalibration,
		matToImage,
		type ImagePoint,
		type MatCalibration
	} from './calibration';

	interface Props {
		/** A short-lived signed URL. The picture is copyrighted; see CLAUDE.md. */
		url: string;
		imageW: number;
		imageH: number;
		/** The calibration being replaced, if the mentor is recalibrating. */
		existing: MatCalibration | null;
		busy?: boolean;
		message?: string;
		onSave: (cal: MatCalibration) => void;
		onCancel: () => void;
		onImageError?: () => void;
	}

	let { url, imageW, imageH, existing, busy = false, message = '', onSave, onCancel, onImageError }: Props =
		$props();

	// svelte-ignore state_referenced_locally
	let origin = $state<ImagePoint | null>(existing ? { ...existing.origin } : null);
	// svelte-ignore state_referenced_locally
	let far = $state<ImagePoint | null>(existing ? { ...existing.far } : null);
	let zoom = $state(1);

	let svgEl: SVGSVGElement | undefined = $state();
	let containerEl: HTMLDivElement | undefined = $state();

	let candidate = $derived(origin && far ? calibrationFromCorners(origin, far) : null);
	let usable = $derived(isUsableCalibration(candidate));

	/** The picture-space size of one mat millimetre, for the tick weights. */
	let pxPerMm = $derived(
		candidate
			? Math.abs((candidate.far.u - candidate.origin.u) * imageW) / MAT_WIDTH_MM
			: imageW / MAT_WIDTH_MM
	);

	/** The shape the two taps describe, against the mat's own 2.07:1. */
	const MAT_ASPECT = MAT_WIDTH_MM / MAT_HEIGHT_MM;
	let tappedAspect = $derived(
		candidate
			? Math.abs((candidate.far.u - candidate.origin.u) * imageW) /
				Math.max(1e-6, Math.abs((candidate.far.v - candidate.origin.v) * imageH))
			: null
	);
	let aspectOff = $derived(
		tappedAspect === null ? 0 : Math.abs(tappedAspect - MAT_ASPECT) / MAT_ASPECT
	);

	let step = $derived(!origin ? 1 : !far ? 2 : 3);

	/**
	 * THE INSTRUCTION AREA IS AS TALL AS ITS LONGEST LINE, AT EVERY WIDTH.
	 * All three sentences are stacked in ONE grid cell and only the current
	 * one is visible, so the box never changes height as the step advances.
	 * Measured before this was done: on a narrow column step 1 wrapped to
	 * four lines and step 2 to two, which slid the picture 48 px UP between
	 * tap one and tap two -- so the second corner landed where the mentor was
	 * no longer aiming. A min-height cannot fix that, because the wrap point
	 * depends on the width.
	 */
	const INSTRUCTIONS = [
		'Tap the corner of the playing surface on the LAUNCH AREA side. That corner is 0, 0.',
		'Now tap the corner diagonally opposite it.',
		'Check the grid sits on the mat. Move a corner with the fields below, or start over.'
	];

	function pointFromEvent(e: PointerEvent): ImagePoint | null {
		if (!svgEl) return null;
		const ctm = svgEl.getScreenCTM();
		if (!ctm) return null;
		const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
		return {
			u: Math.min(1, Math.max(0, pt.x / imageW)),
			v: Math.min(1, Math.max(0, pt.y / imageH))
		};
	}

	function tap(e: PointerEvent) {
		const p = pointFromEvent(e);
		if (!p) return;
		if (!origin) origin = p;
		else if (!far) far = p;
		else {
			// Both placed: a tap moves whichever corner is nearer, so a mentor
			// fixes one bad tap without redoing the other.
			const dOrigin = Math.hypot(p.u - origin.u, p.v - origin.v);
			const dFar = Math.hypot(p.u - far.u, p.v - far.v);
			if (dOrigin <= dFar) origin = p;
			else far = p;
		}
	}

	function startOver() {
		origin = null;
		far = null;
	}

	/** The four percentage fields. Percent because a mentor reads percent. */
	function setField(which: 'origin' | 'far', axis: 'u' | 'v', value: number) {
		const frac = Math.min(1, Math.max(0, value / 100));
		const target = which === 'origin' ? origin : far;
		const next = { u: target?.u ?? 0, v: target?.v ?? 0, [axis]: frac } as ImagePoint;
		if (which === 'origin') origin = next;
		else far = next;
	}

	const pct = (n: number | undefined) => (n === undefined ? '' : Math.round(n * 1000) / 10);

	/** The mat drawn back onto the picture: the confirmation. */
	const GRID_MM = 250;
	const FOOT_MM = 304.8;

	function onPicture(xMm: number, yMm: number): { x: number; y: number } {
		const p = matToImage(candidate as MatCalibration, { x: xMm, y: yMm });
		return { x: p.u * imageW, y: p.v * imageH };
	}

	function line(x1: number, y1: number, x2: number, y2: number) {
		const a = onPicture(x1, y1);
		const b = onPicture(x2, y2);
		return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
	}

	let gridX = $derived(
		candidate
			? Array.from({ length: Math.floor(MAT_WIDTH_MM / GRID_MM) }, (_, i) => (i + 1) * GRID_MM)
			: []
	);
	let gridY = $derived(
		candidate
			? Array.from({ length: Math.floor(MAT_HEIGHT_MM / GRID_MM) }, (_, i) => (i + 1) * GRID_MM)
			: []
	);
	let feetX = $derived(
		candidate
			? Array.from({ length: Math.floor(MAT_WIDTH_MM / FOOT_MM) + 1 }, (_, i) => i * FOOT_MM)
			: []
	);
	let feetY = $derived(
		candidate
			? Array.from({ length: Math.floor(MAT_HEIGHT_MM / FOOT_MM) + 1 }, (_, i) => i * FOOT_MM)
			: []
	);
	let outline = $derived(
		candidate
			? [
					onPicture(0, 0),
					onPicture(MAT_WIDTH_MM, 0),
					onPicture(MAT_WIDTH_MM, MAT_HEIGHT_MM),
					onPicture(0, MAT_HEIGHT_MM)
				]
					.map((p) => `${p.x},${p.y}`)
					.join(' ')
			: ''
	);
</script>

<!--
	THE SAME LIGHT PLATE AS THE MAT, FOR THE SAME REASON. This screen draws
	the mat's outline, a 250 mm grid and a tick every foot over a mentor's
	photograph of a light printed surface, and asks them to confirm it lines
	up. The overlay's contrast is measured against that light picture; letting
	the ground move it would change what a mentor is being asked to confirm.
	See MatCanvas.svelte for the argument in full.
-->
<div class="cal" data-ground="light">
	<div class="cal__head">
		<h2 class="cal__title">Calibrate the field picture</h2>
		<p class="cal__step">
			{#each INSTRUCTIONS as text, i (i)}
				<span class="cal__step-line" aria-hidden={step !== i + 1} class:cal__step-line--on={step === i + 1}>
					Step {i + 1} of 3. {text}
				</span>
			{/each}
		</p>
	</div>

	<div class="cal__stage" bind:this={containerEl}>
		<svg
			bind:this={svgEl}
			viewBox="0 0 {imageW} {imageH}"
			style:width="{zoom * 100}%"
			role="presentation"
			onpointerdown={tap}
		>
			<image
				href={url}
				x="0"
				y="0"
				width={imageW}
				height={imageH}
				onerror={() => onImageError?.()}
			/>

			{#if candidate}
				<g class="cal__overlay" pointer-events="none">
					<!-- The playing surface, as the calibration understands it. -->
					<polygon class="cal__outline" points={outline} />

					<!-- 250 mm grid: the fine confirmation. -->
					{#each gridX as gx (gx)}
						{@const l = line(gx, 0, gx, MAT_HEIGHT_MM)}
						<line class="cal__grid" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
					{/each}
					{#each gridY as gy (gy)}
						{@const l = line(0, gy, MAT_WIDTH_MM, gy)}
						<line class="cal__grid" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
					{/each}

					<!-- Ruler: a tick every foot along both edges, labelled in
					     inches, because the mat is specified as 93 by 45 inches. -->
					{#each feetX as fx, i (fx)}
						{@const l = line(fx, 0, fx, Math.min(MAT_HEIGHT_MM, 90))}
						<line class="cal__tick" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
						{@const t = onPicture(fx, 150)}
						<text class="cal__ruler" x={t.x} y={t.y} font-size={Math.max(9, pxPerMm * 90)}>
							{i * 12}"
						</text>
					{/each}
					{#each feetY as fy, i (fy)}
						{@const l = line(0, fy, Math.min(MAT_WIDTH_MM, 90), fy)}
						<line class="cal__tick" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
						{#if i > 0}
							{@const t = onPicture(160, fy)}
							<text class="cal__ruler" x={t.x} y={t.y} font-size={Math.max(9, pxPerMm * 90)}>
								{i * 12}"
							</text>
						{/if}
					{/each}
				</g>
			{/if}

			<!-- The two taps themselves, on top of everything. -->
			{#if origin}
				{@const r = Math.max(8, pxPerMm * 60)}
				<g class="cal__pin cal__pin--origin" pointer-events="none">
					<circle cx={origin.u * imageW} cy={origin.v * imageH} r={r} />
					<line
						x1={origin.u * imageW - r * 1.6}
						y1={origin.v * imageH}
						x2={origin.u * imageW + r * 1.6}
						y2={origin.v * imageH}
					/>
					<line
						x1={origin.u * imageW}
						y1={origin.v * imageH - r * 1.6}
						x2={origin.u * imageW}
						y2={origin.v * imageH + r * 1.6}
					/>
					<text x={origin.u * imageW + r * 2} y={origin.v * imageH} font-size={Math.max(10, pxPerMm * 110)}>
						0, 0
					</text>
				</g>
			{/if}
			{#if far}
				{@const r = Math.max(8, pxPerMm * 60)}
				<g class="cal__pin cal__pin--far" pointer-events="none">
					<circle cx={far.u * imageW} cy={far.v * imageH} r={r} />
					<line
						x1={far.u * imageW - r * 1.6}
						y1={far.v * imageH}
						x2={far.u * imageW + r * 1.6}
						y2={far.v * imageH}
					/>
					<line
						x1={far.u * imageW}
						y1={far.v * imageH - r * 1.6}
						x2={far.u * imageW}
						y2={far.v * imageH + r * 1.6}
					/>
					<text x={far.u * imageW - r * 2} y={far.v * imageH} text-anchor="end" font-size={Math.max(10, pxPerMm * 110)}>
						{MAT_WIDTH_MM}, {MAT_HEIGHT_MM}
					</text>
				</g>
			{/if}
		</svg>
	</div>

	<div class="cal__zoom" role="group" aria-label="Zoom the picture">
		{#each [1, 2, 3, 4] as z (z)}
			<button
				class="btn btn--ghost btn--small"
				class:cal__zoom--on={zoom === z}
				type="button"
				onclick={() => (zoom = z)}
			>
				{z}x
			</button>
		{/each}
	</div>

	<!-- The keyboard path to every point, and the way to nudge one. -->
	<fieldset class="cal__fields">
		<legend class="eyebrow">Corner positions (percent of the picture)</legend>
		<div class="cal__grid-fields">
			<label class="field">
				<span>Launch corner, across</span>
				<input
					class="input"
					type="number"
					min="0"
					max="100"
					step="0.1"
					value={pct(origin?.u)}
					oninput={(e) => setField('origin', 'u', Number(e.currentTarget.value))}
				/>
			</label>
			<label class="field">
				<span>Launch corner, down</span>
				<input
					class="input"
					type="number"
					min="0"
					max="100"
					step="0.1"
					value={pct(origin?.v)}
					oninput={(e) => setField('origin', 'v', Number(e.currentTarget.value))}
				/>
			</label>
			<label class="field">
				<span>Opposite corner, across</span>
				<input
					class="input"
					type="number"
					min="0"
					max="100"
					step="0.1"
					value={pct(far?.u)}
					oninput={(e) => setField('far', 'u', Number(e.currentTarget.value))}
				/>
			</label>
			<label class="field">
				<span>Opposite corner, down</span>
				<input
					class="input"
					type="number"
					min="0"
					max="100"
					step="0.1"
					value={pct(far?.v)}
					oninput={(e) => setField('far', 'v', Number(e.currentTarget.value))}
				/>
			</label>
		</div>
	</fieldset>

	{#if candidate && !usable}
		<p class="notice cal__warn">
			Those two corners are almost on top of each other. Tap corners that are diagonally opposite.
		</p>
	{:else if candidate && aspectOff > 0.08}
		<p class="notice cal__warn">
			Those corners make a {tappedAspect?.toFixed(2)}:1 rectangle, but the playing surface is
			{MAT_ASPECT.toFixed(2)}:1. Check you tapped corners that are diagonally opposite, not two on
			the same side.
		</p>
	{:else if usable}
		<p class="small muted cal__ok">
			The playing surface is {Math.round(Math.abs((candidate?.far.u ?? 0) - (candidate?.origin.u ?? 0)) * imageW)}
			by {Math.round(Math.abs((candidate?.far.v ?? 0) - (candidate?.origin.v ?? 0)) * imageH)} pixels
			of this picture. One tick is one foot; one small square is 250 mm.
		</p>
	{/if}

	{#if message}<p class="small muted">{message}</p>{/if}

	<div class="cal__actions">
		<button
			class="btn btn--primary"
			type="button"
			disabled={!usable || busy}
			onclick={() => usable && onSave(candidate as MatCalibration)}
		>
			{busy ? 'Saving...' : 'This looks right, save it'}
		</button>
		<button class="btn btn--ghost" type="button" onclick={startOver} disabled={busy}>Start over</button>
		<button class="btn btn--ghost" type="button" onclick={onCancel} disabled={busy}>Cancel</button>
	</div>
</div>

<style>
	.cal {
		display: grid;
		gap: var(--space-3);
	}
	.cal__title {
		margin: 0;
		font-size: var(--fs-h3);
	}
	/* One grid cell holding all three sentences: the box is always as tall as
	   the longest of them, at whatever width the column happens to be. See
	   INSTRUCTIONS in the script for what this is protecting. */
	.cal__step {
		display: grid;
		margin: var(--space-1) 0 0;
		color: var(--text-2);
	}
	.cal__step-line {
		grid-area: 1 / 1;
		visibility: hidden;
	}
	.cal__step-line--on {
		visibility: visible;
	}
	.cal__stage {
		overflow: auto;
		max-height: 62vh;
		border: 1px solid var(--boundary);
		border-radius: var(--radius-card);
		background: var(--surface-0);
	}
	.cal__stage svg {
		display: block;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		cursor: crosshair;
	}

	.cal__outline {
		fill: none;
		stroke: var(--success);
		stroke-width: 4;
		vector-effect: non-scaling-stroke;
	}
	.cal__grid {
		stroke: var(--link);
		stroke-width: 1;
		opacity: 0.65;
		vector-effect: non-scaling-stroke;
	}
	.cal__tick {
		stroke: var(--success);
		stroke-width: 3;
		vector-effect: non-scaling-stroke;
	}
	.cal__ruler {
		fill: var(--success-text);
		font-weight: var(--fw-bold);
		paint-order: stroke fill;
		stroke: var(--surface-0);
		stroke-width: 4;
		stroke-linejoin: round;
	}

	.cal__pin circle {
		fill: none;
		stroke-width: 3;
		vector-effect: non-scaling-stroke;
	}
	.cal__pin line {
		stroke-width: 3;
		vector-effect: non-scaling-stroke;
	}
	.cal__pin text {
		font-weight: var(--fw-black);
		paint-order: stroke fill;
		stroke: var(--surface-0);
		stroke-width: 5;
		stroke-linejoin: round;
		dominant-baseline: middle;
	}
	.cal__pin--origin circle,
	.cal__pin--origin line {
		stroke: var(--success);
	}
	.cal__pin--origin text {
		fill: var(--success-text);
	}
	.cal__pin--far circle,
	.cal__pin--far line {
		stroke: var(--accent);
	}
	.cal__pin--far text {
		fill: var(--accent);
	}

	.cal__zoom {
		display: flex;
		gap: var(--space-2);
	}
	.cal__zoom--on {
		border-color: var(--link);
		color: var(--link);
	}

	.cal__fields {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-card);
		padding: var(--space-3);
		margin: 0;
	}
	.cal__grid-fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: var(--space-3);
	}
	.cal__warn {
		color: var(--warning);
		border-color: var(--warning);
	}
	.cal__ok {
		margin: 0;
	}
	.cal__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
</style>
