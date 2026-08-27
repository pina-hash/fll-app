<script lang="ts">
	import CodegenPage from '$lib/codegen/CodegenPage.svelte';
	import { supabaseCodegenSave } from '$lib/codegen/storage';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * The mentor surface's payload. The ONLY difference from the student's is
	 * this: the team came out of the URL instead of out of the session, and the
	 * transport is closed over that team rather than over
	 * current_student_team_id(). Same component, same markup, same checks.
	 *
	 * The transport is rebuilt per team so the one on screen can only ever write
	 * to the team on screen. `{#key}` below remounts the form for the same
	 * reason: a half-filled robot for Team 1 must not survive a click to Team 2.
	 */
	const save = $derived(supabaseCodegenSave(data.supabase, data.team.id));
</script>

<svelte:head><title>{data.team.name} robot code</title></svelte:head>

<div class="mc" data-accent={data.team.accent}>
	<div class="mc__head">
		<h1 class="mc__title">Robot code</h1>
		<nav class="mc__teams" aria-label="Teams">
			{#each data.teams as t (t.id)}
				<a
					class="mc__team"
					class:mc__team--on={t.id === data.team.id}
					data-accent={t.accent}
					href="/app/codegen/{t.id}"
				>
					{t.name}
				</a>
			{/each}
		</nav>
	</div>

	{#key data.team.id}
		<CodegenPage
			{save}
			team={{ id: data.team.id, name: data.team.name, accent: data.team.accent }}
			data={data.codegen}
			backHref="/app/codegen"
		/>
	{/key}
</div>

<style>
	.mc {
		display: grid;
		gap: var(--space-4);
	}
	.mc__head {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.mc__title {
		margin: 0;
		font-size: var(--fs-h2);
	}
	.mc__teams {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.mc__team {
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
	.mc__team--on {
		color: var(--team-accent);
		border-color: var(--team-accent);
		background: var(--team-accent-wash);
	}
</style>
