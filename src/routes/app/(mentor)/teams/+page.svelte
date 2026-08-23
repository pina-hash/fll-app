<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { ACCENT_LABEL, TEAM_ACCENTS, type TeamAccent } from '$lib/console/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let name = $state('');
	let number = $state('');
	let accent = $state<TeamAccent | ''>('');
	let busy = $state(false);
	let message = $state('');

	let taken = $derived(new Set(data.teams.filter((t) => !t.archived_at).map((t) => t.accent)));

	async function createTeam(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		if (!name.trim()) {
			message = 'A team needs a name.';
			return;
		}
		busy = true;
		const { data: created, error } = await data.supabase.rpc('team_create', {
			p_name: name.trim(),
			p_fll_team_number: number.trim() ? Number(number) : undefined,
			p_accent: accent || undefined
		});
		busy = false;
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
</script>

<svelte:head><title>Teams</title></svelte:head>

<section class="card">
	<p class="eyebrow">Provisioning</p>
	<h1>Teams, rosters, PINs and roles</h1>
	<p class="muted">
		Pick a team on the left to edit it, add students, reset a PIN, set the five roles, or print the paper roster card.
		Everything here is mentor-only.
	</p>
</section>

<section class="card">
	<h2>New team</h2>
	{#if message}
		<p class="error" role="alert">{message}</p>
	{/if}
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
		<button class="btn btn--primary" type="submit" disabled={busy}>Create team</button>
	</form>
</section>
