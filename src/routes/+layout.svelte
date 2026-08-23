<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	onMount(() => {
		const { data: authData } = data.supabase.auth.onAuthStateChange((_event, newSession) => {
			if (newSession?.expires_at !== data.claims?.exp) invalidate('supabase:auth');
		});
		return () => authData.subscription.unsubscribe();
	});
</script>

<svelte:head>
	<title>FLL BIOGLOW</title>
	<meta name="description" content="Bosco Tech FIRST LEGO League, BIOGLOW 2026-27 season." />
</svelte:head>

{@render children()}
