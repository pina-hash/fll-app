<script lang="ts">
	/**
	 * EVERY SURFACE IS A BRAND SURFACE. BrandSurface is mounted HERE, at the
	 * root, and not on each page, because the two things it carries are
	 * required on all of them: the verbatim trademark attribution, and a full
	 * official logo whose presence is what makes any supporting mark legal.
	 * A route added next season inherits both without its author knowing the
	 * rules exist. See src/lib/brand/rules.ts.
	 */
	import '../app.css';
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import BrandSurface from '$lib/brand/BrandSurface.svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	onMount(() => {
		const { data: authData } = data.supabase.auth.onAuthStateChange((_event, newSession) => {
			if (newSession?.expires_at !== data.claims?.exp) invalidate('supabase:auth');
		});
		return () => authData.subscription.unsubscribe();
	});

	// The footer's density, never whether it appears. A print route puts it
	// on the sheet; the shared iPad reads it from a metre away.
	let variant = $derived<'app' | 'kiosk' | 'print'>(
		page.url.pathname.endsWith('/print')
			? 'print'
			: page.url.pathname.startsWith('/board')
				? 'kiosk'
				: 'app'
	);
</script>

<svelte:head>
	<title>Bosco Tech FIRST LEGO League Challenge</title>
	<meta
		name="description"
		content="Session tool for the Bosco Tech FIRST LEGO League Challenge teams, BIOGLOW 2026-27."
	/>
</svelte:head>

<!--
	KEYED ON THE PATH, WHICH IS WHAT MAKES "PER SURFACE" TRUE. Both registers
	live in context and are populated during component init: the mark register
	decides whether a supporting mark may appear on THIS screen, and the name
	register decides where the ® lands on THIS screen. Carrying either across
	a client-side navigation would mean the second page a mentor visits shows
	the name with no symbol, and a supporting mark vouched for by a logo that
	is no longer on screen. Remounting per path is the cost of the rule being
	real; the surfaces that own state (the planner, the student runtime) are
	page components and already remount on navigation.
-->
{#key page.url.pathname}
	<BrandSurface {variant}>
		{@render children()}
	</BrandSurface>
{/key}
