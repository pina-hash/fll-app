<script lang="ts">
	/**
	 * A WHEEL, DRAWN BY THIS REPO, AT ITS REAL RELATIVE SIZE.
	 *
	 * A nine-year-old holding a driving base does not measure a tyre, they
	 * recognise it. So the three choices are pictures: the small wheel really is
	 * drawn half the width of the big one, because that ratio is the thing they
	 * are matching against the part in their hand.
	 *
	 * NOT LEGO ARTWORK. No LEGO part render, photograph or building-instruction
	 * image is fetched, mirrored or reproduced anywhere in this repo. This is a
	 * tyre, a rim and a hub drawn from two circles and some spokes, the same way
	 * the route planner's field fixture is drawn rather than cropped.
	 *
	 * NO COLOUR LITERALS. Every stroke and fill is a token, so the wheel
	 * retints with the ground like everything else and
	 * tests/design-tokens.test.ts stays green.
	 */
	interface Props {
		/** The real diameter in millimetres. Sets how big this one is drawn. */
		mm: number;
		/** The largest diameter in the set, so the three share one scale. */
		maxMm: number;
		selected?: boolean;
	}
	let { mm, maxMm, selected = false }: Props = $props();

	/** 46 is the biggest radius that fits the box with room for the ring. */
	const r = $derived(Math.max(12, (mm / maxMm) * 46));
	const rim = $derived(r * 0.62);
	const hub = $derived(r * 0.24);
	const spokes = [0, 60, 120, 180, 240, 300];
</script>

<svg
	class="wp"
	class:wp--on={selected}
	viewBox="0 0 100 100"
	role="presentation"
	aria-hidden="true"
>
	<!-- tyre -->
	<circle class="wp__tyre" cx="50" cy="50" r={r} />
	<!-- tread, a handful of notches rather than a texture -->
	{#each spokes as a (a)}
		<line
			class="wp__tread"
			x1={50 + Math.cos((a * Math.PI) / 180) * (r - 1)}
			y1={50 + Math.sin((a * Math.PI) / 180) * (r - 1)}
			x2={50 + Math.cos((a * Math.PI) / 180) * (rim + 1)}
			y2={50 + Math.sin((a * Math.PI) / 180) * (rim + 1)}
		/>
	{/each}
	<!-- rim -->
	<circle class="wp__rim" cx="50" cy="50" r={rim} />
	<!-- the cross axle hole, which is the bit that makes it read as LEGO -->
	<circle class="wp__hub" cx="50" cy="50" r={hub} />
</svg>

<style>
	.wp {
		display: block;
		width: 100%;
		height: auto;
		max-width: 7rem;
		margin-inline: auto;
	}
	.wp__tyre {
		fill: var(--bg2);
		stroke: var(--boundary);
		stroke-width: 2;
	}
	.wp__tread {
		stroke: var(--boundary);
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	.wp__rim {
		fill: var(--plate);
		stroke: var(--fg-structure);
		stroke-width: 1.5;
	}
	.wp__hub {
		fill: var(--bg0);
		stroke: var(--fg-structure);
		stroke-width: 1.5;
	}
	/* The chosen wheel takes the pathway green, which is the same "this is the
	   one you are on" signal the console's active nav tab uses. */
	.wp--on .wp__tyre {
		stroke: var(--accent-text);
	}
	.wp--on .wp__rim {
		fill: var(--accent-soft);
		stroke: var(--accent-text);
	}
	.wp--on .wp__hub {
		stroke: var(--accent-text);
	}
</style>
