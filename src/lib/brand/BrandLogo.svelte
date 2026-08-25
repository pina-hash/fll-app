<script lang="ts">
	/**
	 * AN OFFICIAL MARK, RENDERED EXACTLY AS SUPPLIED, OR NOT AT ALL.
	 *
	 * Every rule this component enforces is quoted in src/lib/brand/rules.ts.
	 * What matters here is that they are ENFORCED and not documented:
	 *
	 *  - The only geometry prop is `height`. Width follows from the supplied
	 *    file's own aspect ratio, so the mark can only ever scale
	 *    proportionally, and `object-fit: contain` means even a container
	 *    narrower than the mark letterboxes it rather than squashing it.
	 *    There is no width, rotation, crop, radius, filter, background or
	 *    colour prop, and no `class` or `style` passthrough: a caller cannot
	 *    reach the image.
	 *  - Below the documented minimum size the mark is REFUSED.
	 *  - A mark that may not stand alone is REFUSED unless a full official
	 *    logo is registered on the same surface.
	 *  - A mark with no supplied file (icon alone, wordmark alone) is always
	 *    refused, because the only way to make one is to crop a supplied file.
	 *  - The clear space is padding computed from the rendered height, so a
	 *    tight parent cannot crop it away.
	 *  - `all: initial` on the image and `--team-accent: initial` on its
	 *    wrapper: a team accent, an inherited colour or a page-level image
	 *    rule cannot reach the mark. A team colour is never part of a mark.
	 *  - THE GROUND SWAPS THE ASSET; IT NEVER STYLES THE MARK. Where the
	 *    official download supplies a reverse file, BOTH supplied files are
	 *    rendered and the ground's own tokens
	 *    (--mark-full-color-display / --mark-reverse-display) show exactly
	 *    one. Where it supplies no reverse file the full-colour mark is given
	 *    a WHITE PLATE (--mark-plate) instead: the background that artwork is
	 *    specified for, rather than the artwork altered to suit a background.
	 *    There is no filter, no invert and no blend anywhere in this file,
	 *    and no prop that could ask for one.
	 *
	 *    THE COST, STATED. Rendering both files means a browser fetches both,
	 *    including the one it is not showing: about 225 KB more across the
	 *    footer's two marks, once, then cached. The alternative was choosing
	 *    the file in JavaScript, which cannot know the ground until after
	 *    hydration and would therefore paint the wrong mark for a frame on
	 *    every dark-ground load. A frame of the wrong FIRST logo is worse
	 *    than a cached PNG.
	 *  - An ANCESTOR's filter, blend mode, opacity or rotation CAN reach it --
	 *    those rasterise the whole subtree and no descendant declaration
	 *    escapes them -- so they are DETECTED instead. The mark walks its own
	 *    ancestors after mounting and refuses if any of them would alter it.
	 *
	 * REFUSAL IS NOT AN EXCEPTION. A violating usage renders NOTHING, logs
	 * the rule and the reason, and (under `vite dev`) leaves a visible note
	 * in its place so the developer who wrote it sees it immediately. It does
	 * not throw: a brand mistake in a footer must not blank a mentor's
	 * console mid-meeting, and a rule enforced by taking the screen down is a
	 * rule someone will route around. The refusal is queryable in the DOM
	 * (`[data-brand-refused]`), which is what the browser proof asserts.
	 */
	import { dev } from '$app/environment';
	import { useBrandRegister } from './context';
	import {
		MARKS,
		ancestorHazard,
		darkGroundStrategy,
		assertMarkAllowed,
		assertMinimumHeight,
		clearSpacePx,
		BrandRuleError,
		type BrandMark
	} from './rules';

	interface Props {
		mark: BrandMark;
		/** Rendered height in CSS pixels. Width follows the supplied file. */
		height: number;
		/** Set only where the same words already sit beside the mark; it
		 *  never adds text TO the mark. */
		decorative?: boolean;
	}

	// THERE IS NO `variant` PROP, DELIBERATELY. The guidelines forbid a
	// dark-background logo on a light background and vice versa, and once the
	// page has two grounds a CALLER cannot know which one its mark will land
	// on: the same footer renders on both, and a mentor can change the answer
	// mid-meeting. So the ground decides, in CSS, and no call site can get it
	// wrong by passing the other one.
	let { mark, height, decorative = false }: Props = $props();

	const register = useBrandRegister();
	// THE INITIAL-VALUE CAPTURE IS THE DESIGN. A mark registers itself once,
	// when the surface is built, so a full logo lower in the tree still counts
	// for a supporting mark higher up. A component whose `mark` prop changed
	// would be a different mark in the same slot, which no call site does.
	// svelte-ignore state_referenced_locally
	const spec = MARKS[mark];

	// A mark with no supplied file is never registered: it does not exist and
	// cannot vouch for anything.
	// svelte-ignore state_referenced_locally
	if (spec.file) {
		register.marks.add(mark);
		if (spec.isFullLogo) register.fullLogos += 1;
	}

	/** The half of the rules answerable before the surface has finished
	 *  rendering: no supplied file, and below the minimum size. */
	let immediate = $derived.by(() => {
		try {
			assertMinimumHeight(mark, height);
			if (!spec.file) assertMarkAllowed(mark, register);
			return null;
		} catch (error) {
			return error instanceof BrandRuleError ? error.message : null;
		}
	});

	/** The standalone rule, which can only be judged once every mark on the
	 *  surface has registered. */
	let standalone = $state<string | null>(null);
	$effect(() => {
		try {
			assertMarkAllowed(mark, register);
			standalone = null;
		} catch (error) {
			standalone = error instanceof BrandRuleError ? error.message : null;
		}
	});

	/**
	 * The ancestor walk. It needs computed styles, so it is client-only: the
	 * server renders the mark and the browser withdraws it if the context
	 * turns out to be hostile. A brand mistake caught one frame late is still
	 * caught; not catching it at all was the alternative.
	 */
	let wrapper = $state<HTMLElement | null>(null);
	let hazard = $state<string | null>(null);
	$effect(() => {
		if (!wrapper) return;
		const found = ancestorHazard(wrapper, (e) => {
			const s = getComputedStyle(e);
			return { filter: s.filter, opacity: s.opacity, blend: s.mixBlendMode, transform: s.transform };
		});
		hazard = found
			? `The ${mark} mark may not be altered, and ${found}. Move the mark outside it. ` +
				`(Branding & Design Guidelines p13: do not rotate or change the color of the logo.)`
			: null;
	});

	let refused = $derived(immediate ?? standalone ?? hazard);
	$effect(() => {
		if (refused) console.error(`[brand] ${refused}`);
	});

	let width = $derived(spec.file ? Math.round((height * spec.width) / spec.height) : 0);
	let pad = $derived(clearSpacePx(height));
	/** No reverse file supplied means the full-colour mark gets the white
	 *  ground it is specified for, on whichever ground the page is. */
	let plated = $derived(darkGroundStrategy(mark) === 'light-plate');
</script>

{#if refused}
	<!-- The mark is not rendered. In dev the reason is on the page; in
	     production only the attribute and the console error remain, so a
	     test can still see the refusal without a mentor seeing a stack. -->
	<span class="refused" data-brand-refused={mark} data-brand-reason={refused}>
		{#if dev}<span class="refused__note">Brand rule: {refused}</span>{/if}
	</span>
{:else}
	<!-- The wrapper exists ONLY to hold the clear space, and on the dark
	     ground the white plate for a mark with no reverse file. No border, no
	     radius, no shadow: a containing shape around a mark is forbidden, and
	     the plate is a background rather than a shape. --team-accent is reset
	     so a team colour cannot leak in. -->
	<span
		bind:this={wrapper}
		class="mark"
		class:mark--plated={plated}
		role={decorative ? undefined : 'img'}
		aria-label={decorative ? undefined : spec.alt}
		aria-hidden={decorative ? 'true' : undefined}
		style:padding="{pad}px"
		style:--team-accent="initial"
		style:--team-accent-wash="initial"
		style:--team-accent-ink="initial"
	>
		<!-- THE NAME IS ON THE WRAPPER, NOT ON EITHER IMAGE. Only one of the
		     two supplied files is displayed at a time, and a display:none
		     image's alt text is announced by nothing, so putting the name on
		     an image would mean the mark had no accessible name on one of the
		     two grounds. The wrapper is role="img" with the label instead, and
		     both files are decorative. -->
		<img
			class="mark__img mark__img--full-color"
			src={spec.file}
			alt=""
			aria-hidden="true"
			decoding="async"
			style:height="{height}px"
			style:width="{width}px"
			style:max-width="100%"
			style:object-fit="contain"
		/>
		{#if spec.reverseFile}
			<!-- The supplied reverse file. Exactly one of the two is displayed,
			     by the ground's own tokens; the other is not styled, it is
			     simply not displayed. -->
			<img
				class="mark__img mark__img--reverse"
				src={spec.reverseFile}
				alt=""
				aria-hidden="true"
				decoding="async"
				style:height="{height}px"
				style:width="{width}px"
				style:max-width="100%"
				style:object-fit="contain"
			/>
		{/if}
	</span>
{/if}

<style>
	.mark {
		display: inline-flex;
		background: none;
		border: 0;
		border-radius: 0;
		box-shadow: none;
		filter: none;
		line-height: 0;
	}
	/* THE LIGHT PLATE. Only for a mark the download supplies in full colour
	   with no reverse version, and only on a ground that needs one:
	   --mark-plate is `transparent` on the light ground, so this declaration
	   does nothing there. It is square, has no border, no radius and no
	   shadow, and the wrapper's padding is the mark's full clear space, so
	   the white extends past the clear space on every side and the mark sits
	   in a plain field rather than inside a shape. */
	.mark--plated {
		background: var(--mark-plate);
	}
	.mark img {
		/* Reset everything a page-level rule could have done to an image, so
		   the mark is used exactly as supplied. The size comes back as an
		   inline style above, which outranks this. */
		all: initial;
		display: block;
	}
	/* WHICH SUPPLIED FILE THIS GROUND SHOWS. Two declarations, no filter, no
	   colour: the value of each token is `block` on one ground and `none` on
	   the other, and a [data-ground='light'] subtree or a printed sheet gets
	   the light answer by inheriting it, with nothing here to say so. */
	.mark .mark__img--full-color {
		display: var(--mark-full-color-display);
	}
	.mark .mark__img--reverse {
		display: var(--mark-reverse-display);
	}
	/* A PLATED MARK HAS NO SECOND FILE TO SWAP TO, so it must not be hidden
	   by the token that hides the full-colour file on the dark ground: the
	   plate under it IS how it reaches that ground. Without this the three
	   lockups with no reverse version would simply vanish in dark mode. */
	.mark--plated .mark__img--full-color {
		display: block;
	}
	.refused {
		display: inline-block;
	}
	/* The dev-only note carries its OWN ground. A refusal appears wherever a
	   mark was going to appear, which is by definition a place this component
	   knows nothing about -- a team-accented panel, a filled header, a
	   deliberately hostile block on the brand harness. Inheriting the
	   background meant the explanation of the refusal was sometimes
	   unreadable, which was measured at 1.11 on the harness. */
	.refused__note {
		display: inline-block;
		padding: var(--space-1) var(--space-2);
		border: 1px dashed var(--danger-text);
		border-radius: var(--radius-control);
		background: var(--danger-wash);
		color: var(--danger-text);
		font-size: var(--fs-label);
		font-weight: var(--fw-bold);
	}
</style>
