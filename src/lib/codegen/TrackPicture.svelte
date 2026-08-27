<script lang="ts">
	/**
	 * WHAT "WHEEL TO WHEEL" MEANS, DRAWN, BECAUSE HALF OF THEM WILL MEASURE THE
	 * WRONG THING WITHOUT A PICTURE.
	 *
	 * The three wrong answers are all reasonable: outside edge to outside edge,
	 * inside edge to inside edge, and the width of the whole chassis. The right
	 * answer is the middle of one tyre to the middle of the other, so the arrow
	 * starts and ends on a marked centre line and the wheels are drawn from
	 * above with the robot between them.
	 *
	 * Drawn by this repo, tokens only, like WheelPicture beside it.
	 */
	interface Props {
		/** What the number currently says, in the unit on screen. */
		label: string;
	}
	let { label }: Props = $props();
</script>

<figure class="tp">
	<svg class="tp__svg" viewBox="0 0 220 120" role="img" aria-label="Measure from the middle of one wheel to the middle of the other">
		<!-- chassis, seen from above -->
		<rect class="tp__body" x="58" y="30" width="104" height="60" rx="6" />
		<!-- four wheels -->
		<rect class="tp__wheel" x="34" y="26" width="20" height="30" rx="4" />
		<rect class="tp__wheel" x="166" y="26" width="20" height="30" rx="4" />
		<rect class="tp__wheel tp__wheel--idle" x="34" y="66" width="20" height="26" rx="4" />
		<rect class="tp__wheel tp__wheel--idle" x="166" y="66" width="20" height="26" rx="4" />

		<!-- the two centre lines the arrow runs between -->
		<line class="tp__centre" x1="44" y1="14" x2="44" y2="100" />
		<line class="tp__centre" x1="176" y1="14" x2="176" y2="100" />

		<!-- the measurement itself -->
		<line class="tp__arrow" x1="44" y1="18" x2="176" y2="18" marker-start="url(#tp-a)" marker-end="url(#tp-b)" />
		<defs>
			<marker id="tp-a" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
				<path class="tp__head" d="M8,1 L2,4 L8,7 Z" />
			</marker>
			<marker id="tp-b" markerWidth="8" markerHeight="8" refX="2" refY="4" orient="auto">
				<path class="tp__head" d="M0,1 L6,4 L0,7 Z" />
			</marker>
		</defs>
		<text class="tp__label" x="110" y="112" text-anchor="middle">{label}</text>
	</svg>
	<figcaption class="tp__cap">
		Middle of one driving wheel to the middle of the other. Not the outside edges, and not the
		width of the robot.
	</figcaption>
</figure>

<style>
	.tp {
		margin: 0 0 var(--space-3);
	}
	.tp__svg {
		display: block;
		width: 100%;
		max-width: 22rem;
		height: auto;
		margin-inline: auto;
	}
	.tp__body {
		fill: var(--bg2);
		stroke: var(--boundary);
		stroke-width: 2;
	}
	.tp__wheel {
		fill: var(--plate);
		stroke: var(--accent-text);
		stroke-width: 2;
	}
	.tp__wheel--idle {
		stroke: var(--fg-structure);
	}
	.tp__centre {
		stroke: var(--accent-text);
		stroke-width: 1.5;
		stroke-dasharray: 4 3;
	}
	.tp__arrow {
		stroke: var(--accent-text);
		stroke-width: 2.5;
	}
	.tp__head {
		fill: var(--accent-text);
	}
	.tp__label {
		fill: var(--fg);
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: var(--fw-bold);
	}
	.tp__cap {
		margin: var(--space-2) 0 0;
		font-size: var(--fs-small);
		color: var(--text-muted);
		text-align: center;
	}
</style>
