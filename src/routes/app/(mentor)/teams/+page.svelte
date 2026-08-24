<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { ACCENT_LABEL, TEAM_ACCENTS, type TeamAccent } from '$lib/console/types';
	import TeamName from '$lib/team/TeamName.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let name = $state('');
	let number = $state('');
	let accent = $state<TeamAccent | ''>('');
	let busy = $state('');
	let message = $state('');
	let good = $state('');

	let taken = $derived(new Set(data.teams.filter((t) => !t.archived_at).map((t) => t.accent)));

	/**
	 * ARCHIVED TEAMS ARE HERE, BEHIND A FILTER, BECAUSE THERE IS NOWHERE ELSE.
	 * Archiving is a soft delete: the team's roster cards, match runs and
	 * notebook are all still attached to it, and `team_restore` is the one way
	 * back. A screen that only ever listed live teams would make archiving a
	 * one-way door in practice even though the database says otherwise.
	 */
	let showArchived = $state(false);
	let shown = $derived(data.teams.filter((t) => Boolean(t.archived_at) === showArchived));

	async function createTeam(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		good = '';
		if (!name.trim()) {
			message = 'A team needs a name.';
			return;
		}
		busy = 'create';
		const { data: created, error } = await data.supabase.rpc('team_create', {
			p_name: name.trim(),
			p_fll_team_number: number.trim() ? Number(number) : undefined,
			p_accent: accent || undefined
		});
		busy = '';
		if (error) {
			message = error.message;
			return;
		}
		const row = created as { team_id: string } | null;
		name = '';
		number = '';
		accent = '';
		await invalidateAll();
		if (row?.team_id) await goto(`/app/teams/${row.team_id}`);
	}

	/**
	 * A restore can cost the team its colour: the accent is unique across LIVE
	 * teams only, so another team may have taken it while this one was away.
	 * The RPC decides that and says so in `accent_cleared`; this only reports
	 * what it did.
	 */
	async function restoreTeam(teamId: string, label: string) {
		busy = `restore:${teamId}`;
		message = '';
		good = '';
		const { data: result, error } = await data.supabase.rpc('team_restore', { p_team_id: teamId });
		busy = '';
		if (error) {
			message = error.message;
			return;
		}
		const row = result as { name: string; accent_cleared: boolean } | null;
		good = row?.accent_cleared
			? `${row.name} is back on the teams list. Another team took its colour while it was away, so it has none now: pick a new one on the team's page.`
			: `${row?.name ?? label} is back on the teams list.`;
		showArchived = false;
		await invalidateAll();
	}
</script>

<svelte:head><title>Teams</title></svelte:head>

<section class="card">
	<p class="eyebrow">Provisioning</p>
	<h1>Teams, rosters, PINs and roles</h1>
	<p class="muted">
		Pick a team on the left to edit it, add students, hand out seat cards, reset a PIN, set the five roles, or print
		the paper roster card. Everything here is mentor-only.
	</p>
</section>

{#if message}
	<p class="error" role="alert">{message}</p>
{/if}
{#if good}
	<p class="notice" role="status">{good}</p>
{/if}

<section class="card">
	<div class="tl__head">
		<h2>All teams</h2>
		<div class="tl__filter" role="group" aria-label="Which teams to show">
			<button
				class="btn btn--small"
				class:btn--primary={!showArchived}
				class:btn--ghost={showArchived}
				aria-pressed={!showArchived}
				onclick={() => (showArchived = false)}
			>
				Live ({data.liveCount})
			</button>
			<button
				class="btn btn--small"
				class:btn--primary={showArchived}
				class:btn--ghost={!showArchived}
				aria-pressed={showArchived}
				onclick={() => (showArchived = true)}
			>
				Archived ({data.archivedCount})
			</button>
		</div>
	</div>

	{#if data.teamsError}
		<p class="error">{data.teamsError}</p>
	{/if}

	{#if showArchived}
		<p class="muted small">
			An archived team is put away, not deleted: its roster card, its match runs and its notebook are all still
			attached to it. Bringing one back may cost it its colour, because a colour belongs to one live team at a
			time and another team may have taken it in the meantime.
		</p>
	{/if}

	<ul class="tl">
		{#each shown as team (team.id)}
			<li class="tl__row" data-accent={team.accent}>
				<a class="tl__open" href="/app/teams/{team.id}">
					<span class="accent-dot" aria-hidden="true"></span>
					<TeamName name={team.name} shortName={team.short_name} />
				</a>
				<p class="tl__meta muted small">
					{team.roster_size} student{team.roster_size === 1 ? '' : 's'} ·
					<code>{team.join_code}</code>
					{#if team.fll_team_number}· FLL {team.fll_team_number}{/if}
					{#if !team.accent}· no colour yet{/if}
				</p>
				{#if team.archived_at}
					<button
						class="btn btn--secondary btn--small"
						disabled={busy === `restore:${team.id}`}
						onclick={() => restoreTeam(team.id, team.name)}
					>
						Bring it back
					</button>
				{/if}
			</li>
		{:else}
			<li class="muted">
				{showArchived ? 'No archived teams. Nothing has been put away.' : 'No teams yet. Make the first one below.'}
			</li>
		{/each}
	</ul>
</section>

<section class="card">
	<h2>New team</h2>
	<form onsubmit={createTeam}>
		<label class="field">
			<span>Name</span>
			<input class="input" bind:value={name} maxlength="80" required />
		</label>
		<label class="field">
			<span>FLL number (once FIRST assigns one)</span>
			<input class="input" bind:value={number} inputmode="numeric" pattern="[0-9]*" placeholder="optional" />
		</label>
		<label class="field">
			<span>Accent</span>
			<select class="input" bind:value={accent}>
				<option value="">Pick the least used</option>
				{#each TEAM_ACCENTS as option (option)}
					<option value={option}>{ACCENT_LABEL[option]}{taken.has(option) ? ' (in use)' : ''}</option>
				{/each}
			</select>
		</label>
		<p class="muted small">
			The join code is minted for you and is permanent: it is half of every student login on the team. Rotating it
			later rewrites all of them, which the team page will warn you about.
		</p>
		<button class="btn btn--primary" type="submit" disabled={busy === 'create'}>Create team</button>
	</form>
</section>

<style>
	.tl__head {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: var(--space-3);
	}
	.tl__filter {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.tl {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.tl__row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-2);
		align-items: center;
		padding: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-control);
		background: var(--surface-2);
		min-width: 0;
	}
	.tl__open {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		min-width: 0;
		color: var(--text-1);
		text-decoration: none;
		font-size: var(--fs-h3);
	}
	.tl__meta {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	@media (min-width: 48rem) {
		.tl__row {
			grid-template-columns: minmax(0, 16rem) minmax(0, 1fr) auto;
		}
	}
</style>
