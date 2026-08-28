<script lang="ts">
	/**
	 * WHERE THE MAT IS IN THIS PICTURE. NEVER HOW BIG IT IS.
	 *
	 * THE FRICTION THIS SCREEN USED TO CAUSE, AND WHY IT WAS A FAIR
	 * COMPLAINT. Asked to "calibrate the field picture", a mentor reasonably
	 * hears "tell the app how big the mat is" -- and objects, because the mat
	 * is a manufactured object with one published size and nobody at a club
	 * gets to have an opinion about it. They were right. The app has always
	 * known the mat's size (geometry.ts); the only thing it cannot know is
	 * WHERE in a particular JPEG the mat happens to sit. So this screen now
	 * says the size out loud, as a fact it is telling the mentor rather than
	 * a question it is asking them, and everything else follows from that.
	 *
	 * THE COMMON CASE IS ONE TAP, NOT TWO. Most pictures of a mat are already
	 * cropped to the mat. `fullFrameFit` asks whether this picture is even the
	 * right SHAPE to be such a crop, and when it is, the primary action is a
	 * single confirmation: yes, this picture is the mat. Corner tapping stays
	 * one control away and is never taken off the screen, because the shape
	 * test cannot prove a crop, only rule one out. When the shape test fails
	 * the screen leads with corner tapping and says in one sentence why: the
	 * picture looks like it has the table around the mat in it.
	 *
	 * THEN LOOK AT IT BEFORE YOU TRUST IT, ON EITHER PATH. The moment a
	 * calibration exists -- tapped or confirmed -- this screen draws the mat
	 * back onto the picture through the derived transform: the mat outline, a
	 * 250 mm grid, and a ruler in whole feet along both edges. If that grid
	 * does not sit on the mat's own printed features, the calibration is
	 * wrong and it is wrong VISIBLY, here, rather than invisibly on the
	 * planner three weeks later. A wrong transform still fills the rectangle
	 * and still looks like a mat, and nothing downstream can catch it.
	 *
	 * IT IS THE MAT'S CORNERS THAT ARE TAPPED, NOT THE TABLE'S. The mat is a
	 * printed sheet with a printed edge that a mentor can see and hit; the
	 * table's inside corner is a wall meeting a floor. Until this bundle the
	 * screen asked for "the playing surface" and the transform behind it laid
	 * the answer across the whole table, which is 18.1% wider than the mat.
	 *
	 * THE ASPECT NOTE IS NOT AN ERROR MESSAGE, EVEN THOUGH IT USED TO READ AS
	 * ONE. Calibration scales each axis independently (calibration.ts), so a
	 * picture that is not drawn to the mat's true 1.76:1 calibrates correctly
	 * anyway once two corners are tapped. The arithmetic cannot tell that
	 * apart from the one mistake it CAN catch, two corners tapped on the same
	 * side, which also produces an off-ratio rectangle. So a wide gap gets a
	 * note naming both numbers, but the note states the likely benign cause
	 * first and points at the actual check: does the drawn grid sit on the
	 * mat. It never blocks the save button, which is gated on `usable` alone.
	 *
	 * TAPS AND NUMBERS ARE THE SAME STATE. The four percentage fields below
	 * the picture drive and are driven by the taps: they are the keyboard path
	 * to every point, and they let a mentor nudge a corner by a tenth of a
	 * percent instead of trying to hit it again with a thumb.
	 */
	import { MAT_HEIGHT_MM, MAT_WIDTH_MM, matToTable } from './geometry';
	import {
		FULL_FRAME_CALIBRATION,
		MAT_ASPECT,
		calibrationFromCorners,
		fullFrameFit,
		isUsableCalibration,
		matToImage,
		type ImagePoint,
		type MatCalibration
	} from './calibration';
	import { formatLength } from './units';

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

	/** Is this picture even the right shape to be a crop of the mat? */
	let fit = $derived(fullFrameFit(imageW, imageH));

	/**
	 * TWO PATHS, AND THE SCREEN OPENS ON THE ONE THAT IS PROBABLY RIGHT.
	 * 'offer' is the one-tap confirmation and needs a picture that has never
	 * been calibrated AND is the right shape. Everything else -- a mentor
	 * recalibrating, or a picture whose proportions say it has the table in
	 * it -- opens on 'corners'. Switching to 'corners' is always available and
	 * costs no re-upload, which is the whole reason the offer is safe to make.
	 */
	// svelte-ignore state_referenced_locally
	let mode = $state<'offer' | 'corners'>(
		existing === null && fullFrameFit(imageW, imageH).fits ? 'offer' : 'corners'
	);

	/**
	 * In 'offer' mode the candidate IS the full-frame calibration, so the
	 * confirmation overlay below draws the mat onto the picture exactly as it
	 * would after saving. The mentor is judging the real thing, not a promise.
	 */
	let candidate = $derived(
		mode === 'offer' ? FULL_FRAME_CALIBRATION : origin && far ? calibrationFromCorners(origin, far) : null
	);
	let usable = $derived(isUsableCalibration(candidate));

	/** The mat's published size, in the words this screen states it in. */
	const MAT_SIZE = `${formatLength(MAT_WIDTH_MM, 'mm')} by ${formatLength(MAT_HEIGHT_MM, 'mm')}`;
	const MAT_SIZE_IN = `${formatLength(MAT_WIDTH_MM, 'in')} by ${formatLength(MAT_HEIGHT_MM, 'in')}`;

	function useCorners() {
		mode = 'corners';
	}

	/** The picture-space size of one mat millimetre, for the tick weights. */
	let pxPerMm = $derived(
		candidate
			? Math.abs((candidate.far.u - candidate.origin.u) * imageW) / MAT_WIDTH_MM
			: imageW / MAT_WIDTH_MM
	);

	/** The shape the two taps describe, against the mat's own 1.76:1. */
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
	let aspect1 = (n: number) => n.toFixed(2);

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
		'Tap the corner of the MAT on the LAUNCH AREA side. The printed sheet, not the table.',
		'Now tap the corner of the mat diagonally opposite it.',
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
		// In 'offer' mode there is nothing to tap: a stray touch must not drop
		// a mentor into corner tapping with one corner already placed.
		if (mode !== 'corners') return;
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

	/**
	 * THE OVERLAY IS DRAWN IN THE MAT'S OWN MILLIMETRES, 0 to 2000 by 0 to
	 * 1134, because this screen is entirely about the printed sheet. The
	 * transform speaks TABLE millimetres (calibration.ts), so the conversion
	 * happens here, once, at the boundary. Passing mat-local numbers straight
	 * to matToImage put the whole outline one 181 mm strip to the left, which
	 * is precisely the class of mistake this bundle exists to remove; it was
	 * caught by reading the rendered outline out of the live DOM.
	 */
	function onPicture(xMm: number, yMm: number): { x: number; y: number } {
		const p = matToImage(candidate as MatCalibration, matToTable({ x: xMm, y: yMm }));
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
		<h2 class="cal__title">Where is the mat in this picture?</h2>

		<!--
			THE SIZE IS STATED, ON BOTH PATHS, EVERY TIME. It is the sentence
			that stops this screen reading as a question about the mat's
			dimensions, which is what a mentor objected to and was right to.
		-->
		<p class="cal__known">
			The mat is always {MAT_SIZE} ({MAT_SIZE_IN}). The planner already knows that and is
			not asking. All it needs is which part of your picture the mat is.
		</p>

		{#if mode === 'corners'}
			<p class="cal__step">
				{#each INSTRUCTIONS as text, i (i)}
					<span class="cal__step-line" aria-hidden={step !== i + 1} class:cal__step-line--on={step === i + 1}>
						Step {i + 1} of 3. {text}
					</span>
				{/each}
			</p>
			{#if !fit.fits && existing === null}
				<p class="small muted cal__why">
					This picture is {aspect1(fit.aspect)}:1 and the mat is {aspect1(fit.matAspect)}:1, so it
					looks like it includes the table around the mat. Tapping the two corners is the way
					to place it.
				</p>
			{/if}
		{:else}
			<p class="cal__step cal__step--offer">
				This picture is {aspect1(fit.aspect)}:1, and the mat is {aspect1(fit.matAspect)}:1. It looks
				like it is already cropped to the mat. Check the grid below sits on the mat, then say so.
			</p>
		{/if}
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

					<!-- Ruler: a tick every foot along both edges of the mat. Feet
					     because a mentor has a tape measure, not because the mat is
					     specified in them; it is 2000 by 1134 mm and neither edge is
					     a whole number of feet. -->
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
						mat 0, 0
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
						mat {MAT_WIDTH_MM}, {MAT_HEIGHT_MM}
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

	{#if mode === 'corners' && candidate && !usable}
		<p class="notice cal__warn">
			Those two corners are almost on top of each other. Tap corners that are diagonally opposite.
		</p>
	{:else if mode === 'corners' && candidate && aspectOff > 0.08}
		<p class="small muted cal__note">
			Those corners make a {tappedAspect?.toFixed(2)}:1 rectangle; the mat itself is
			{aspect1(MAT_ASPECT)}:1. That is often fine: this picture may simply not be drawn to true
			scale, and each axis above is calibrated on its own. The real check is the grid drawn on the
			picture: if it sits on the mat, save it. If it does not, you likely tapped two corners on the
			same side instead of diagonally opposite ones -- start over and tap the opposite corner.
		</p>
	{:else if usable}
		<p class="small muted cal__ok">
			The mat is {Math.round(Math.abs((candidate?.far.u ?? 0) - (candidate?.origin.u ?? 0)) * imageW)}
			by {Math.round(Math.abs((candidate?.far.v ?? 0) - (candidate?.origin.v ?? 0)) * imageH)} pixels
			of this picture. One tick is one foot; one small square is 250 mm.
		</p>
	{/if}

	{#if message}<p class="small muted">{message}</p>{/if}

	<div class="cal__actions">
		{#if mode === 'offer'}
			<button
				class="btn btn--primary"
				type="button"
				disabled={busy}
				onclick={() => onSave(FULL_FRAME_CALIBRATION)}
			>
				{busy ? 'Saving...' : 'This picture is already cropped to the mat'}
			</button>
			<!-- Never off the screen, and never behind a re-upload: the shape
			     test can rule a crop out, it cannot prove one. -->
			<button class="btn btn--ghost" type="button" onclick={useCorners} disabled={busy}>
				No, let me tap the mat's corners
			</button>
		{:else}
			<button
				class="btn btn--primary"
				type="button"
				disabled={!usable || busy}
				onclick={() => usable && onSave(candidate as MatCalibration)}
			>
				{busy ? 'Saving...' : 'This looks right, save it'}
			</button>
			<button class="btn btn--ghost" type="button" onclick={startOver} disabled={busy}>Start over</button>
		{/if}
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
	/* The size statement and the one-line reason. Both are ordinary body copy
	   in the muted ink: neither is a warning and neither may read as one. */
	.cal__known {
		margin: var(--space-1) 0 0;
		color: var(--text-2);
	}
	.cal__step--offer,
	.cal__why {
		margin: var(--space-1) 0 0;
		color: var(--text-2);
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
		stroke: var(--text-1);
		stroke-width: 4;
		vector-effect: non-scaling-stroke;
	}
	.cal__grid {
		stroke: var(--text-1);
		stroke-width: 1;
		opacity: 0.65;
		vector-effect: non-scaling-stroke;
	}
	.cal__tick {
		stroke: var(--text-2);
		stroke-width: 3;
		vector-effect: non-scaling-stroke;
	}
	.cal__ruler {
		fill: var(--text-1);
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
	/* THE TWO PINS WERE THE SAME COLOUR. --success and --accent are both mint
	   on the dark grounds and both deep green on paper, so "tap this corner,
	   now tap the other one" drew two identical markers on the one screen
	   whose whole job is telling them apart. Ink and copper: plainly two
	   different things, and neither of them is the pathway green. */
	.cal__pin--origin circle,
	.cal__pin--origin line {
		stroke: var(--text-1);
	}
	.cal__pin--origin text {
		fill: var(--text-1);
	}
	.cal__pin--far circle,
	.cal__pin--far line {
		stroke: var(--warning);
	}
	.cal__pin--far text {
		fill: var(--warning);
	}

	.cal__zoom {
		display: flex;
		gap: var(--space-2);
	}
	.cal__zoom--on {
		border-color: var(--text-1);
		color: var(--text-1);
		background: var(--plate);
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
	.cal__ok,
	.cal__note {
		margin: 0;
	}
	.cal__actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
</style>
