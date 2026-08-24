<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.category.label}</title></svelte:head>

<a class="back" href="/app/library">Back to the Skill Hub</a>
<p class="eyebrow">{data.category.tagline}</p>
<h1>{data.category.label}</h1>
<p class="muted">{data.category.intro}</p>

<ul class="list">
	{#each data.category.items as item (item.id)}
		<li>
			<a class="card item" href="/app/library/{data.category.id}/{item.id}">
				<span class="item__num muted small">{item.num}</span>
				<span class="item__title">{item.title}</span>
				<span class="item__desc muted small">{item.description}</span>
			</a>
		</li>
	{/each}
</ul>

<style>
	.back {
		display: inline-block;
		margin-bottom: var(--space-3);
		color: var(--link);
	}
	h1 {
		margin: var(--space-1) 0 var(--space-2);
	}
	.list {
		list-style: none;
		margin: var(--space-4) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.item {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		text-align: left;
	}
	.item__num {
		font-family: var(--font-display);
		letter-spacing: var(--track-wide);
	}
	.item__title {
		font-weight: var(--fw-bold);
		font-size: var(--fs-h4);
		color: var(--text-1);
	}
</style>
