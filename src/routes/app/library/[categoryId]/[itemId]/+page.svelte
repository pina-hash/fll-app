<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.item.title}</title></svelte:head>

<a class="back" href="/app/library/{data.item.categoryId}">Back</a>
<p class="eyebrow">{data.item.num}</p>
<h1>{data.item.title}</h1>

<div class="card">
	<p>{data.item.lesson}</p>
	{#if data.item.fits}
		<p class="fits"><strong>Fits:</strong> {data.item.fits}</p>
	{/if}
</div>

{#if data.resources.length}
	<div class="links">
		{#each data.resources as res, i (res.id)}
			<a class="btn btn--secondary" href={res.url} target="_blank" rel="noreferrer">
				{res.deeplinkLabel ?? (i === 0 ? 'Go deeper' : 'Also see')}: {res.title}
			</a>
		{/each}
	</div>
{/if}

<div class="card prompt">
	<p class="eyebrow">Think about it</p>
	<p>{data.item.prompt}</p>
</div>

<style>
	.back {
		display: inline-block;
		margin-bottom: var(--space-3);
		color: var(--link);
	}
	h1 {
		margin: var(--space-1) 0 var(--space-4);
	}
	.fits {
		margin-top: var(--space-3);
	}
	.links {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: var(--space-4) 0;
	}
	/* BRASS, THE CALLOUT ACCENT, WHICH WAS SITTING UNUSED. A strategy prompt is
	   content, and the content accents are brass, patina and copper; --accent is
	   the pathway green and its jobs are identity, the one active state and the
	   primary action. This is the pattern the whole bundle is about: a semantic
	   token existed and the green got used because it was the green that was
	   handy. */
	.prompt {
		margin-top: var(--space-4);
		border-color: var(--brass);
	}
</style>
