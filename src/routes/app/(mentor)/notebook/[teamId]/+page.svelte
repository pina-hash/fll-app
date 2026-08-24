<script lang="ts">
	import NotebookPage from '$lib/notebook/NotebookPage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The (mentor) layout guarantees this, but the type union does not know it.
	let mentorId = $derived(data.principal.kind === 'mentor' ? data.principal.mentorId : '');
</script>

<svelte:head><title>{data.team.name} notebook</title></svelte:head>

<div class="mnb" data-accent={data.team.accent}>
	<div class="mnb__head">
		<h1 class="mnb__title">Engineering notebook</h1>
		<nav class="mnb__teams" aria-label="Teams">
			{#each data.teams as t (t.id)}
				<a
					class="mnb__team"
					class:mnb__team--on={t.id === data.team.id}
					data-accent={t.accent}
					href="/app/notebook/{t.id}"
				>
					{t.name}
				</a>
			{/each}
		</nav>
	</div>

	{#key data.team.id}
		<NotebookPage
			supabase={data.supabase}
			ownerId={mentorId}
			team={{ id: data.team.id, name: data.team.name }}
			isMentor={true}
			myStudentId={null}
			data={data.notebook}
			printHref="/app/notebook/{data.team.id}/print"
		/>
	{/key}
</div>

<style>
	.mnb {
		display: grid;
		gap: var(--space-4);
		min-width: 0;
	}
	.mnb__head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.mnb__title {
		margin: 0;
		font-size: var(--fs-h2);
	}
	.mnb__teams {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.mnb__team {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		color: var(--text-2);
		text-decoration: none;
		font-weight: var(--fw-bold);
	}
	.mnb__team--on {
		color: var(--team-accent-ink, var(--text-1));
		border-color: var(--team-accent, var(--boundary));
		background: var(--team-accent-wash, transparent);
	}
</style>
