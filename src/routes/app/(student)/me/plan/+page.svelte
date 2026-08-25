<script lang="ts">
	import PlannerPage from '$lib/planner/PlannerPage.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.student.teamName} robot plan</title></svelte:head>

<div class="pp" data-accent={data.student.accent}>
	<header class="pp__top">
		<a class="pp__back" href="/app/me">Back</a>
		<span class="pp__team">Robot plan</span>
	</header>

	<PlannerPage
		supabase={data.supabase}
		ownerId={data.student.studentId}
		team={{ id: data.student.teamId, name: data.student.teamName }}
		isMentor={false}
		data={data.planner}
		exampleHref="/app/me/plan/example"
	/>
</div>

<style>
	.pp {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-3) var(--space-6);
		background:
			radial-gradient(120% 60% at 50% 0%, var(--team-accent-wash), transparent 70%),
			var(--surface-0);
	}
	.pp__top {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.pp__back {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		border: 2px solid var(--boundary);
		color: var(--text-1);
		text-decoration: none;
		font-weight: var(--fw-bold);
	}
	.pp__team {
		font-family: var(--font-display);
		font-size: var(--fs-h2);
		font-weight: var(--fw-black);
		color: var(--team-accent);
	}
</style>
