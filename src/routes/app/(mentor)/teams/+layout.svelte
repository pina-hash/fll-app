<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

	let current = $derived(page.params.teamId ?? null);
</script>

<div class="prov">
	<aside class="prov__rail card">
		<h2>Teams</h2>
		{#if data.teamsError}
			<p class="error">{data.teamsError}</p>
		{/if}
		<ul class="trail">
			{#each data.teams as team (team.id)}
				<li>
					<a
						class="trail__item"
						class:trail__item--on={current === team.id}
						data-accent={team.accent}
						href="/app/teams/{team.id}"
					>
						<span class="accent-dot" aria-hidden="true"></span>
						<span class="trail__name">{team.name}</span>
						<span class="muted small">
							{team.roster_size} student{team.roster_size === 1 ? '' : 's'} · <code>{team.join_code}</code>
							{#if team.archived_at}· archived{/if}
						</span>
					</a>
				</li>
			{:else}
				<li class="muted">No teams yet.</li>
			{/each}
		</ul>
		<p class="muted small"><a href="/app/teams">New team, and what this screen is for</a></p>
	</aside>

	<section class="prov__detail">
		{@render children()}
	</section>
</div>

<style>
	.prov {
		display: grid;
		gap: var(--space-4);
	}
	.trail {
		list-style: none;
		margin: 0 0 var(--space-3);
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.trail__item {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-areas: 'dot name' 'dot meta';
		align-items: center;
		column-gap: var(--space-2);
		min-height: 2.75rem;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-2);
		color: var(--text-1);
		text-decoration: none;
	}
	.trail__item :global(.accent-dot) {
		grid-area: dot;
	}
	.trail__name {
		grid-area: name;
		font-weight: var(--fw-bold);
	}
	.trail__item :global(.small) {
		grid-area: meta;
	}
	.trail__item--on {
		border-color: var(--team-accent);
		background: var(--team-accent-wash);
	}

	.prov__detail {
		display: grid;
		gap: var(--space-4);
		align-content: start;
		min-width: 0;
	}
	/* A grid item defaults to min-width: auto, which lets a wide child (the
	   roster table, which has its own min-width so the columns stay readable)
	   push the whole track past the viewport instead of scrolling inside its
	   own wrapper. Every level from the track down to the card has to say 0. */
	.prov__detail > :global(*) {
		min-width: 0;
	}

	@media (min-width: 60rem) {
		.prov {
			grid-template-columns: 20rem minmax(0, 1fr);
			align-items: start;
		}
	}
</style>
