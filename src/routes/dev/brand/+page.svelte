<script lang="ts">
	/**
	 * EVERY LOGO RULE, ATTEMPTED AND REFUSED, IN THE REAL COMPONENT.
	 *
	 * Each block below asks the REAL BrandLogo for a usage the guidelines
	 * forbid, and shows the legal usage beside it. A refused mark renders
	 * nothing and leaves `[data-brand-refused]` in the DOM, which is what the
	 * browser check queries; a legal one renders an `<img>`. So "refused" and
	 * "allowed" are both observable, and neither is a claim.
	 *
	 * THE ISOLATED SURFACE MATTERS. The standalone rule is about what is on
	 * the SAME surface, and this page sits inside the app's own BrandSurface,
	 * which already carries two full logos in the footer. To attempt the
	 * violation honestly the page has to provide its OWN empty register --
	 * which is what `isolate` does below. That is not a trick to make the
	 * refusal happen; it is the only way to represent "a surface with no full
	 * logo on it" from inside a surface that has one.
	 */
	import BrandLogo from '$lib/brand/BrandLogo.svelte';
	import FirstName from '$lib/brand/FirstName.svelte';
	import { MARKS, TRADEMARK_ATTRIBUTION, type BrandMark } from '$lib/brand/rules';
	import Isolate from './Isolate.svelte';

	let violate = $state(false);

	const FULL: BrandMark[] = [
		'first-horizontal',
		'first-vertical',
		'fll-challenge-horizontal-stacked',
		'fll-challenge-horizontal',
		'fll-challenge-vertical-icon'
	];
</script>

<svelte:head><title>dev: brand</title></svelte:head>

<div class="h">
	<header class="h__bar">
		<strong>brand harness</strong>
		<label>
			<input type="checkbox" bind:checked={violate} data-testid="violate" />
			attempt the violating usages
		</label>
	</header>

	<section class="h__block">
		<h2>1. Every full official logo, at its documented minimum</h2>
		<p class="small muted">
			Each is rendered at exactly its minimum digital height. Nothing is recoloured, cropped or
			boxed; the padding around each is its own clear space.
		</p>
		<div class="h__row" data-testid="full-logos">
			{#each FULL as mark (mark)}
				<figure class="h__item">
					<BrandLogo {mark} height={MARKS[mark].minHeightPx} />
					<figcaption class="small muted">{mark} at {MARKS[mark].minHeightPx}px</figcaption>
				</figure>
			{/each}
		</div>
	</section>

	<section class="h__block">
		<h2>2. The icon alone and the wordmark alone</h2>
		<p class="small muted">
			No such file is supplied by FIRST, and making one means cropping a supplied logo. Both are
			refused whatever else is on the surface, which the block on the right shows: there are two
			full logos in this page's footer and they still do not license a crop.
		</p>
		{#if violate}
			<div class="h__row" data-testid="supporting-alone">
				<figure class="h__item">
					<BrandLogo mark="first-icon" height={64} />
					<figcaption class="small muted">first-icon</figcaption>
				</figure>
				<figure class="h__item">
					<BrandLogo mark="first-wordmark" height={64} />
					<figcaption class="small muted">first-wordmark</figcaption>
				</figure>
			</div>
		{:else}
			<p class="small muted">Turn on the checkbox above to attempt it.</p>
		{/if}
	</section>

	<section class="h__block">
		<h2>3. A supporting lockup with no full logo on the surface</h2>
		<p class="small muted">
			The FIRST LEGO League Challenge VERTICAL lockup "may only be used if the FIRST logo appears
			with it, in close proximity". Both blocks below are the same component with the same props;
			the only difference is what else is on their surface.
		</p>
		{#if violate}
			<div class="h__pair">
				<div>
					<p class="eyebrow">Alone on its surface: refused</p>
					<Isolate>
						<div data-testid="vertical-alone">
							<BrandLogo mark="fll-challenge-vertical" height={80} />
						</div>
					</Isolate>
				</div>
				<div>
					<p class="eyebrow">Beside a full logo: allowed</p>
					<Isolate>
						<div data-testid="vertical-with-logo">
							<BrandLogo mark="first-horizontal" height={40} />
							<BrandLogo mark="fll-challenge-vertical" height={80} />
						</div>
					</Isolate>
				</div>
			</div>
		{:else}
			<p class="small muted">Turn on the checkbox above to attempt it.</p>
		{/if}
	</section>

	<section class="h__block">
		<h2>4. Below the documented minimum size</h2>
		<p class="small muted">
			The FIRST horizontal logo's digital minimum is 30px. 29px is refused; 30px is not.
		</p>
		{#if violate}
			<div class="h__row">
				<figure class="h__item" data-testid="too-small">
					<BrandLogo mark="first-horizontal" height={29} />
					<figcaption class="small muted">29px</figcaption>
				</figure>
				<figure class="h__item" data-testid="just-big-enough">
					<BrandLogo mark="first-horizontal" height={30} />
					<figcaption class="small muted">30px</figcaption>
				</figure>
			</div>
		{:else}
			<p class="small muted">Turn on the checkbox above to attempt it.</p>
		{/if}
	</section>

	<section class="h__block">
		<h2>5. A team accent cannot reach a mark</h2>
		<p class="small muted">
			The wrapper below sets a team accent and a filter on everything inside it. The mark ignores
			both: `all: initial` on the image and the accent variables reset on its wrapper.
		</p>
		<div class="h__hostile" data-accent="magenta" data-testid="hostile">
			<BrandLogo mark="first-horizontal" height={40} />
		</div>
	</section>

	<section class="h__block">
		<h2>6. The names in running text</h2>
		<p data-testid="names">
			This paragraph says <FirstName /> once, then <FirstName /> again, then
			<FirstName name="challenge" /> and <FirstName name="season" />. The registered symbol lands
			on the first use of each name on this surface and nowhere else.
		</p>
		<p class="small muted" data-testid="attribution">{TRADEMARK_ATTRIBUTION}</p>
	</section>
</div>

<style>
	.h {
		padding: var(--space-4);
		display: grid;
		gap: var(--space-5);
		align-content: start;
	}
	.h__bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
		padding: var(--space-2) var(--space-3);
		border: 1px dashed var(--boundary);
		border-radius: var(--radius-control);
		color: var(--text-2);
	}
	.h__block {
		display: grid;
		gap: var(--space-2);
	}
	.h__block h2 {
		margin: 0;
		font-size: var(--fs-h3);
	}
	.h__row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-5);
	}
	.h__item {
		margin: 0;
		display: grid;
		gap: var(--space-1);
		justify-items: start;
	}
	.h__pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: var(--space-4);
	}
	/* Deliberately hostile: a coloured ground, an inherited filter and a
	   border radius, none of which may reach the mark. */
	.h__hostile {
		display: inline-flex;
		padding: var(--space-3);
		background: var(--team-accent);
		border-radius: var(--radius-card);
		filter: hue-rotate(90deg);
	}
</style>
