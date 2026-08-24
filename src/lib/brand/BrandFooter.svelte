<script lang="ts">
	/**
	 * THE FOOTER EVERY SURFACE CARRIES. Three jobs, all of them required:
	 *
	 *  1. THE TRADEMARK ATTRIBUTION, VERBATIM. Quoted word for word from the
	 *     Policy on the Use of FIRST Trademarks and Copyrighted Materials,
	 *     section IV.A, naming FIRST and the LEGO Group. It lives in
	 *     rules.ts as a single exported string so no surface can paraphrase
	 *     it and the test can compare against the source.
	 *
	 *  2. A FULL OFFICIAL LOGO ON EVERY SURFACE. The FIRST horizontal logo
	 *     and the FIRST LEGO League Challenge horizontal stacked lockup, both
	 *     in their original designed configuration, both above their minimum
	 *     digital sizes (30px and 45px). Their presence here is what makes
	 *     any supporting mark elsewhere on the surface legal, and it is why
	 *     BrandSurface mounts this on every screen rather than leaving it to
	 *     whoever writes the next page.
	 *
	 *     They are separated by the thin gray rule the FIRST LEGO League
	 *     lockup guidelines prescribe for a paired FIRST logo and division
	 *     lockup (p13), in the brand's own gray, and each mark carries its
	 *     own clear space from BrandLogo.
	 *
	 *  3. TEAM IDENTIFICATION IN CONJUNCTION WITH THE MARKS. The permitted
	 *     use for a registered team (Branding & Design Guidelines p32)
	 *     requires that "team identification (team name/number) appears in
	 *     conjunction with the logo(s) or program name(s)". The club line
	 *     below is that identification and is not optional.
	 *
	 * NOTHING IS ADDED TO THE MARKS THEMSELVES. The words sit in their own
	 * block, outside every mark's clear space, and no mark has a caption, a
	 * border, a background or a shape around it.
	 */
	import BrandLogo from './BrandLogo.svelte';
	import FirstName from './FirstName.svelte';
	import { SEASON, TRADEMARK_ATTRIBUTION } from './rules';

	interface Props {
		variant?: 'app' | 'kiosk' | 'print';
	}

	let { variant = 'app' }: Props = $props();

	// Above every documented minimum: FIRST horizontal 30px, FLL Challenge
	// horizontal stacked 45px. The kiosk is read from a metre away.
	let firstHeight = $derived(variant === 'kiosk' ? 44 : 34);
	let challengeHeight = $derived(variant === 'kiosk' ? 60 : 48);
</script>

<footer class="bf" class:bf--kiosk={variant === 'kiosk'} class:bf--print={variant === 'print'}>
	<div class="bf__marks">
		<BrandLogo mark="first-horizontal" height={firstHeight} />
		<hr class="brand-rule bf__rule" />
		<BrandLogo mark="fll-challenge-horizontal-stacked" height={challengeHeight} />
	</div>

	<div class="bf__words">
		<p class="bf__team">
			Bosco Tech Robotics, Teams 1 to 4 &middot;
			<FirstName name="season" /> &middot; <FirstName name="first-season" /> &middot; {SEASON.years}
		</p>
		<p class="bf__tm">{TRADEMARK_ATTRIBUTION}</p>
	</div>
</footer>

<style>
	.bf {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4) var(--space-5);
		padding: var(--space-5) var(--space-4);
		margin-top: var(--space-6);
		border-top: 1px solid var(--hairline);
		background: var(--surface-0);
	}
	.bf__marks {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex: none;
	}
	/* The thin gray rule between a FIRST logo and a division lockup, its
	   height matched to the taller of the two marks it separates. */
	.bf__rule {
		align-self: stretch;
		width: 0;
		border-top: 0;
		border-left: 1px solid var(--rule-gray);
		margin: var(--space-1) 0;
	}
	.bf__words {
		flex: 1 1 18rem;
		min-width: 0;
	}
	.bf__team {
		margin: 0 0 var(--space-1);
		font-size: var(--fs-small);
		color: var(--text-2);
	}
	.bf__tm {
		margin: 0;
		font-size: var(--fs-label);
		line-height: 1.45;
		color: var(--text-3);
	}

	.bf--kiosk {
		padding: var(--space-4);
		margin-top: var(--space-4);
	}

	/* On paper the footer is part of the sheet: it prints, it is black on
	   white, and the marks keep their full-colour versions. */
	@media print {
		.bf {
			margin-top: var(--space-4);
			padding: var(--space-3) 0 0;
			background: #ffffff;
			break-inside: avoid;
		}
		.bf__tm,
		.bf__team {
			color: #231f20;
		}
	}
	.bf--print {
		border-top: 1px solid var(--rule-gray);
	}

	@media (max-width: 30rem) {
		.bf {
			padding: var(--space-4) var(--space-3);
			gap: var(--space-3);
		}
	}
</style>
