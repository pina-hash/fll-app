<script lang="ts">
	import { babySharksCourses, coursePageUrl } from '$lib/content/babySharks';
	import { BABY_SHARKS_FEEDBACK_URL } from '$lib/content/resources';
	import {
		FIRST_ATTRIBUTION,
		SEASON_DOCS_SOURCE_URL,
		SEASON_DOC_GROUPS,
		SEASON_DOC_TIER1
	} from '$lib/content/seasonDocs';

	let openGroups = $state(new Set<string>());
	function toggleGroup(id: string) {
		const next = new Set(openGroups);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		openGroups = next;
	}

	const courses = babySharksCourses();
	let openCourse = $state<string | null>(null);
</script>

<svelte:head><title>Official Season Documents</title></svelte:head>

<a class="back" href="/app/library">Back to the Skill Hub</a>
<p class="eyebrow">BIOGLOW 2026-27 · Founders Edition, Grades 4-8 Challenge</p>
<h1>Official Season Documents</h1>
<p class="muted">
	The real FIRST publications for this season, linked directly. We never download, mirror, or
	reproduce these; every link below goes to the official host.
</p>

<h2>Have these ready</h2>
<ul class="doc-list">
	{#each SEASON_DOC_TIER1 as doc (doc.id)}
		<li class="card" class:warn={Boolean(doc.warn)}>
			<a href={doc.url} target="_blank" rel="noreferrer">{doc.title}</a>
			<span class="kind muted small">{doc.kind}</span>
			{#if doc.note}<p class="muted small">{doc.note}</p>{/if}
			{#if doc.warn}<p class="warn-text">{doc.warn}</p>{/if}
		</li>
	{/each}
</ul>

<h2>Everything else</h2>
{#each SEASON_DOC_GROUPS as group (group.id)}
	<div class="group">
		<button type="button" class="group__toggle" onclick={() => toggleGroup(group.id)}>
			{openGroups.has(group.id) ? '▾' : '▸'}
			{group.label}
		</button>
		{#if openGroups.has(group.id)}
			{#if group.note}<p class="muted small">{group.note}</p>{/if}
			<ul class="doc-list">
				{#each group.docs as doc (doc.id)}
					<li class="card">
						<a href={doc.url} target="_blank" rel="noreferrer">{doc.title}</a>
						<span class="kind muted small">{doc.kind}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/each}

<p class="muted small">
	Looking for something not listed?
	<a href={SEASON_DOCS_SOURCE_URL} target="_blank" rel="noreferrer">Browse the FIRST season materials index</a>.
</p>
<p class="muted small attribution">{FIRST_ATTRIBUTION}</p>

<h2>Baby Sharks courses</h2>
<p class="muted">
	Free SPIKE Prime PDF courses shared directly by FTC Team 33574. The FLL Coding Course is season
	content; the other two are optional extras and are labeled as such below.
</p>
{#each courses as course (course.id)}
	<div class="card course">
		<div class="course__head">
			<span class="course__badge" class:course__badge--optional={course.badge !== 'Season course'}>
				{course.badge}
			</span>
			<a href={course.url} target="_blank" rel="noreferrer">{course.title}</a>
		</div>
		<p class="muted small">{course.blurb}</p>
		<button type="button" class="btn btn--secondary btn--small" onclick={() => (openCourse = openCourse === course.id ? null : course.id)}>
			{openCourse === course.id ? 'Hide lessons' : 'Show lessons'}
		</button>
		{#if openCourse === course.id}
			<ol class="lesson-list">
				{#each course.index as lesson (lesson.num)}
					<li>
						<a href={coursePageUrl(course.url, lesson.page)} target="_blank" rel="noreferrer">
							{lesson.num}. {lesson.title}
						</a>
						<span class="muted small">p. {lesson.page}</span>
						{#if lesson.note}<p class="muted small">{lesson.note}</p>{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</div>
{/each}
<p class="muted small">
	Feedback on the Baby Sharks courses? <a href={BABY_SHARKS_FEEDBACK_URL} target="_blank" rel="noreferrer">Send it here</a>.
</p>

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
	.doc-list {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.doc-list li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
	}
	.warn {
		border-color: var(--amber);
	}
	.warn-text {
		flex-basis: 100%;
		color: var(--amber);
	}
	.kind {
		text-transform: uppercase;
	}
	.group {
		margin-top: var(--space-3);
	}
	.group__toggle {
		width: 100%;
		text-align: left;
		min-height: 44px;
		font-weight: var(--fw-bold);
		background: none;
		border: none;
		color: var(--text-1);
	}
	.attribution {
		margin-top: var(--space-4);
	}
	.course {
		margin-top: var(--space-3);
	}
	.course__head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.course__badge {
		font-size: var(--fs-caption);
		padding: 0.15rem var(--space-2);
		border-radius: var(--radius-pill, 999px);
		background: var(--surface-2);
		color: var(--glow-green);
	}
	.course__badge--optional {
		color: var(--amber);
	}
	.lesson-list {
		margin: var(--space-3) 0 0;
		padding-left: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
</style>
