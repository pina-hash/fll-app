<script lang="ts">
	/**
	 * ONE SURFACE. Wraps a whole screen, provides the two per-surface
	 * registers, and renders the footer that every surface has to carry.
	 *
	 * WHY IT WRAPS EVERYTHING. The trademark attribution goes in the footer
	 * of every surface, and the standalone rule needs a full official logo on
	 * every surface that shows a supporting mark. Putting both in one
	 * component and mounting it in the ROOT layout means neither can be
	 * forgotten on a new page: a route added next season inherits both
	 * without its author knowing the rules exist.
	 *
	 * `variant` only changes the footer's density, never whether it appears.
	 *   'app'   the console and the student runtime
	 *   'kiosk' the shared board device, read from a metre away
	 *   'print' a sheet of paper; the footer prints with it
	 */
	import { provideBrandRegister, provideNameRegister } from './context';
	import BrandFooter from './BrandFooter.svelte';

	interface Props {
		variant?: 'app' | 'kiosk' | 'print';
		children: import('svelte').Snippet;
	}

	let { variant = 'app', children }: Props = $props();

	provideBrandRegister();
	provideNameRegister();
</script>

<div class="surface">
	<div class="surface__body">
		{@render children()}
	</div>
	<BrandFooter {variant} />
</div>

<style>
	.surface {
		min-height: 100dvh;
		display: grid;
		grid-template-rows: 1fr auto;
	}
	.surface__body {
		min-width: 0;
	}
</style>
