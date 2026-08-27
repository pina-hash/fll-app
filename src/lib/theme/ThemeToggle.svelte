<script lang="ts">
	/**
	 * THE THREE-STATE GROUND CONTROL.
	 *
	 * A radio group, not a two-state switch: "follow my device" is a real
	 * third answer and a switch cannot express it. Every option is a 44px
	 * target, and every option is NAMED -- the selected one is never signalled
	 * by colour alone, because the same reasoning that gives a team accent a
	 * name in the picker applies here.
	 *
	 * THE SELECTED APPEARANCE COMES FROM CSS, NOT FROM STATE, AND THAT IS THE
	 * POINT. src/app.html stamps data-theme-pref on <html> before first paint,
	 * so the attribute selectors below already have the right answer in the
	 * very first frame -- on the server-rendered HTML, before hydration. If
	 * the highlight were driven by component state it would render "Auto" on
	 * the server and correct itself a frame later, which is a flash of the
	 * wrong control to go with the ground we just stopped flashing.
	 *
	 * `aria-checked` cannot be set by CSS, so it is the one thing that lands
	 * on hydration rather than on paint.
	 */
	import { onMount } from 'svelte';
	import { theme } from './theme.svelte';
	import { THEME_LABELS, THEME_PREFERENCES, THEME_SHORT_LABELS } from './theme';

	let state = theme();
	onMount(() => state.start());
</script>

<div class="tt" role="radiogroup" aria-label="Screen colours">
	{#each THEME_PREFERENCES as preference (preference)}
		<button
			type="button"
			class="tt__opt"
			data-pref={preference}
			role="radio"
			aria-checked={state.preference === preference}
			title={THEME_LABELS[preference]}
			onclick={() => state.set(preference)}
		>
			{THEME_SHORT_LABELS[preference]}
		</button>
	{/each}
</div>

<style>
	.tt {
		display: inline-flex;
		align-items: stretch;
		gap: 0;
		border: 1px solid var(--boundary);
		border-radius: var(--radius-control);
		background: var(--surface-1);
		overflow: hidden;
	}
	.tt__opt {
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border: 0;
		border-left: 1px solid var(--hairline);
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-size: var(--fs-small);
		font-weight: var(--fw-semibold);
		cursor: pointer;
	}
	.tt__opt:first-child {
		border-left: 0;
	}
	.tt__opt:hover {
		color: var(--text-1);
	}

	/* The selected option, decided by the attribute the boot script wrote.
	   Colour is not the only signal: the option is also the only one set in
	   bold and the only one carrying aria-checked.

	   IT IS THE PICKED TREATMENT, NOT THE PATHWAY GREEN. A chosen ground is a
	   state, and the app has exactly one green active state: the console's nav
	   pill. This control sits in the footer of EVERY surface, so a green here
	   was a second one on every screen in the app at once. */
	:global(:root[data-theme-pref='system']) .tt__opt[data-pref='system'],
	:global(:root[data-theme-pref='light']) .tt__opt[data-pref='light'],
	:global(:root[data-theme-pref='dark']) .tt__opt[data-pref='dark'] {
		background: var(--plate);
		color: var(--text-1);
		font-weight: var(--fw-bold);
	}

	/* No JavaScript, no attribute, no app -- but the control should still not
	   look like nothing is selected, and the app's own ground is what the page
	   will be. */
	:global(:root:not([data-theme-pref])) .tt__opt[data-pref='system'] {
		background: var(--plate);
		color: var(--text-1);
		font-weight: var(--fw-bold);
	}

	/* A sheet of paper has one ground. The control is not part of it. */
	@media print {
		.tt {
			display: none;
		}
	}
</style>
