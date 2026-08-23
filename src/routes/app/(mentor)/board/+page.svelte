<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import LiveBoard from '$lib/console/LiveBoard.svelte';
	import { BoardFeed } from '$lib/console/live.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The feed owns the socket, the refetches and the server-corrected clock.
	// The board component owns none of that: see LiveBoard.svelte's header.
	// untrack: the feed is constructed once, from the FIRST payload, and owns
	// its own state from then on. Later navigations do not rebuild it.
	const feed = untrack(() => new BoardFeed(data.supabase, data.snapshot, null));
	onMount(() => feed.start());
</script>

<svelte:head><title>Live board</title></svelte:head>

{#if data.loadError && !feed.snapshot}
	<p class="error">The board did not load: {data.loadError}</p>
{/if}
{#if feed.error}
	<p class="notice" role="status">Showing the last good board. {feed.error}</p>
{/if}

{#if feed.snapshot}
	<LiveBoard snapshot={feed.snapshot} nowMs={feed.nowMs} connection={feed.connection} />
{:else if !data.loadError}
	<p class="muted">Loading the board.</p>
{/if}
