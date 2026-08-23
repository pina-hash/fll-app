<script lang="ts">
	import { MEDIA_ITEMS, MEDIA_SERIES, MEDIA_TOPICS } from '$lib/content/media';
	import { ATTRIBUTION, RESOURCES, TOPICS, resourcesForTopic } from '$lib/content/resources';

	let activeTopics = $state(new Set(MEDIA_TOPICS.map((t) => t.key)));

	function toggle(key: string) {
		const next = new Set(activeTopics);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		activeTopics = next;
	}

	let visible = $derived(MEDIA_ITEMS.filter((item) => item.topics.some((t) => activeTopics.has(t))));

	// Series entries render as one numbered group, in step order, never mixed
	// with a topic's ungrouped items.
	let seriesIds = $derived([...new Set(visible.map((i) => i.series).filter((s): s is string => Boolean(s)))]);
	let ungrouped = $derived(visible.filter((i) => !i.series));
</script>

<svelte:head><title>Video & Resource Library</title></svelte:head>

<a class="back" href="/app/library">Back to the Skill Hub</a>
<p class="eyebrow">Watch and read</p>
<h1>Video & Resource Library</h1>
<p class="muted">
	A jump-off list of videos and guides from outside this app. Filter by topic, then tap anything to
	open it.
</p>

<div class="chips">
	{#each MEDIA_TOPICS as topic (topic.key)}
		<button
			type="button"
			class="chip"
			class:chip--on={activeTopics.has(topic.key)}
			onclick={() => toggle(topic.key)}
		>
			{topic.label}
		</button>
	{/each}
</div>

{#each seriesIds as seriesId (seriesId)}
	{@const series = MEDIA_SERIES[seriesId]}
	<div class="series card">
		<p class="eyebrow">{series?.label ?? seriesId}</p>
		{#if series?.note}<p class="muted small">{series.note}</p>{/if}
		<ol class="media-list">
			{#each visible
				.filter((i) => i.series === seriesId)
				.sort((a, b) => (a.step ?? 0) - (b.step ?? 0)) as item (item.id)}
				<li>
					<a href={item.url} target="_blank" rel="noreferrer">
						<span class="marker">{item.kind === 'video' ? '▶' : 'Guide'}</span>
						{item.title}
					</a>
				</li>
			{/each}
		</ol>
	</div>
{/each}

<ul class="media-list media-list--flat">
	{#each ungrouped as item (item.id)}
		<li class="card">
			<a href={item.url} target="_blank" rel="noreferrer">
				<span class="marker">{item.kind === 'video' ? '▶' : 'Guide'}</span>
				{item.title}
			</a>
			{#if item.subtitle}<p class="muted small">{item.subtitle}</p>{/if}
			<p class="muted small">{item.source}</p>
		</li>
	{/each}
</ul>

<h2>Browse by topic</h2>
{#each TOPICS as topic (topic.key)}
	{@const resources = resourcesForTopic(topic.key)}
	{#if resources.length}
		<div class="topic-band">
			<h3>{topic.label}</h3>
			<ul class="media-list media-list--flat">
				{#each resources as res (res.id)}
					<li class="card">
						<a href={res.url} target="_blank" rel="noreferrer">{res.title}</a>
						<p class="muted small">{res.blurb} · {res.source}</p>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
{/each}

<div class="more">
	<a href={RESOURCES['prime-index'].url} target="_blank" rel="noreferrer">{RESOURCES['prime-index'].title}</a>
	<a href={RESOURCES['fllt-index'].url} target="_blank" rel="noreferrer">{RESOURCES['fllt-index'].title}</a>
</div>

<p class="muted small attribution">{ATTRIBUTION}</p>

<style>
	.back {
		display: inline-block;
		margin-bottom: var(--space-3);
		color: var(--glow-cyan);
	}
	h1 {
		margin: var(--space-1) 0 var(--space-2);
	}
	h2 {
		margin-top: var(--space-6);
	}
	h3 {
		margin-bottom: var(--space-2);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-4) 0;
	}
	.chip {
		min-height: 44px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		background: var(--surface-1);
		color: var(--text-2);
	}
	.chip--on {
		color: var(--glow-green);
		border-color: var(--glow-green);
		background: var(--surface-2);
	}
	.series {
		margin-bottom: var(--space-4);
	}
	.media-list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.media-list--flat {
		margin-top: var(--space-4);
	}
	.marker {
		display: inline-block;
		margin-right: var(--space-2);
		color: var(--glow-green);
		font-weight: var(--fw-bold);
	}
	.topic-band {
		margin-top: var(--space-5);
	}
	.more {
		display: flex;
		gap: var(--space-4);
		margin-top: var(--space-5);
	}
	.attribution {
		margin-top: var(--space-6);
	}
</style>
