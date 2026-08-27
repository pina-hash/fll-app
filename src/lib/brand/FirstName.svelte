<script lang="ts">
	/**
	 * THE NAMES IN RUNNING TEXT, SET THE WAY THE GUIDELINES SET THEM, AND
	 * NOWHERE ELSE IN THE APP.
	 *
	 *   FIRST is always ALL CAPITALS and ITALIC, with no periods between the
	 *   letters. [Branding & Design Guidelines p8; IP policy III.A.5]
	 *   LEGO is always ALL CAPITALS and NEVER italic. [FLL guidelines p9;
	 *   IP policy III.A.6]
	 *   A superscript registered symbol goes on the FIRST use of each name in
	 *   a document, "both in heading/title and in body copy", after FIRST and
	 *   after LEGO, and not afterwards. [BG p8, p20; FLL p9; IP III.A.4]
	 *   Never plural, never possessive. [BG p8; IP III.A Don't 1]
	 *
	 * FIRST USE IS COUNTED PER SURFACE, in context, so the ® lands on the
	 * first occurrence a reader meets on that screen and on no other. A
	 * component that renders the name twice gets it once, which is the rule.
	 *
	 * THE WORDMARK IS NOT USED HERE. "The FIRST wordmark should NOT be used
	 * as a word in body copy/text. Text would be set in the same font as body
	 * copy and italics." [BG p10] So this renders TEXT in the surrounding
	 * face, never an image.
	 *
	 * FIRST IS NOT BOLDED unless the whole phrase is. [BG p8] Nothing here
	 * sets a weight; the name inherits whatever the heading or paragraph
	 * around it already is.
	 */
	import { claimFirstUse, useNameRegister } from './context';
	import { SEASON } from './rules';

	interface Props {
		/**
		 * 'first'      -> FIRST
		 * 'fll'        -> FIRST LEGO League
		 * 'challenge'  -> FIRST LEGO League Challenge
		 * 'season'     -> FIRST LEGO League Challenge BIOGLOW
		 * 'first-season' -> FIRST CANOPY
		 */
		name?: 'first' | 'fll' | 'challenge' | 'season' | 'first-season';
	}

	let { name = 'first' }: Props = $props();

	const reg = useNameRegister();
	// Claimed once, during init, so the first occurrence in DOM order wins and
	// a re-render does not move the symbol to a later sentence. The
	// initial-value capture is the point, not an oversight.
	// svelte-ignore state_referenced_locally
	const firstMark = claimFirstUse(reg, 'FIRST');
	// svelte-ignore state_referenced_locally
	const legoMark = name === 'first' || name === 'first-season' ? false : claimFirstUse(reg, 'LEGO');
</script>

<!--
	EVERY SPACE BETWEEN TWO NAMES IS AN EXPLICIT {' '}, AND THAT IS NOT A STYLE
	CHOICE. Svelte trims whitespace at the START of an {#if} block's content, so
	the newline-and-tabs that used to sit there vanished at compile time and the
	rendered text read "FIRSTLEGO League" and "LeagueChallenge". The source
	looked correct, the DOM did not, and the marks are governed by guidelines
	that are not negotiable: FIRST and LEGO are separate names and Challenge is
	a separate word. An {' '} expression is emitted verbatim and cannot be
	trimmed, so the spacing no longer depends on how the file happens to be
	indented. tests/brand-rules.test.ts asserts the RENDERED text, not this
	markup.
-->
<span class="n"
	><span class="mark"><i class="first">FIRST</i>{#if firstMark}<sup>®</sup>{/if}</span
	>{#if name !== 'first' && name !== 'first-season'}{' '}<span class="mark"
			><span class="lego">LEGO</span>{#if legoMark}<sup>®</sup>{/if}</span
		>{' '}League{#if name === 'challenge' || name === 'season'}{' '}Challenge{/if}{#if name === 'season'}{' '}<span
			class="mark">{SEASON.challenge}<sup>™</sup></span
		>{/if}{/if}{#if name === 'first-season'}{' '}<span class="mark"
			>{SEASON.first}<sup>™</sup></span
		>{/if}</span
>

<style>
	/* The name sits in the surrounding face at the surrounding size, which is
	   what both the brand guidelines and the IP policy ask for: setting it
	   differently would create the appearance of a new logo. */
	.n {
		font: inherit;
	}
	/* A MARK IS UNBREAKABLE; THE SENTENCE AROUND IT IS NOT. The whole name used
	   to be one `white-space: nowrap` run, which made "FIRST LEGO League
	   Challenge BIOGLOW(tm)" a single 338px word: on the notebook print sheet at
	   a 375px viewport it hung 11px off the page, carrying the trademark symbol
	   out of view with it. What the guidelines protect is each MARK, not the
	   line it sits on, so the nowrap moved inward: FIRST and its ®, LEGO and
	   its ®, and a season name and its ™ each stay whole, and the line may
	   break at the ordinary spaces between them. */
	.mark {
		white-space: nowrap;
	}
	.first {
		font-style: italic;
		text-transform: uppercase;
	}
	/* LEGO is capitals and NOT italic, even inside an italic paragraph. */
	.lego {
		font-style: normal;
		text-transform: uppercase;
	}
	sup {
		font-size: 0.6em;
		line-height: 0;
		vertical-align: super;
	}
</style>
