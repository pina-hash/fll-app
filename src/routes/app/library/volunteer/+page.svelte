<script lang="ts">
	import { MISSION_CONTENT } from '$lib/content/missions';
	import {
		VOLUNTEER_SHEETS,
		TEAM_CHECK,
		MISSION_RULEBOOK_PAGE,
		RULEBOOK_MAP_PAGE,
		RULEBOOK_URL,
		RULEBOOK_INTERACTIVE_URL,
		CHALLENGE_UPDATES_URL,
		rulebookLink
	} from '$lib/content/volunteer';

	// The two-minute team check is a working tool, not a record: ticks live on
	// this device for this visit and are gone on reload, so a volunteer can run
	// it on the next team from a clean slate. Nothing about it is saved.
	let ticked = $state<Record<string, boolean>>({});
	let done = $derived(TEAM_CHECK.filter((c) => ticked[c.id]).length);

	function reset() {
		ticked = {};
	}
</script>

<svelte:head><title>Volunteer Guide</title></svelte:head>

<a class="back" href="/app/library">Back to the Skill Hub</a>
<p class="eyebrow">Volunteers</p>
<h1>Volunteer Guide</h1>
<p class="lead">
	Teams that stick to the printed sheets make steady progress. Teams that drift off them stop
	writing things down, get confused, and fall apart. Your job is to keep every team on the sheets.
</p>

<section>
	<h2>The three sheets</h2>
	<p class="muted small">Tap a sheet to see what a good one looks like and what to ask.</p>
	{#each VOLUNTEER_SHEETS as sheet (sheet.id)}
		<details class="card sheet">
			<summary>
				<span class="sheet__name">{sheet.name}</span>
				<span class="muted small">{sheet.when}</span>
			</summary>
			<p>{sheet.purpose}</p>
			<h3>Look for</h3>
			<ul>
				{#each sheet.lookFor as line}<li>{line}</li>{/each}
			</ul>
			<h3>Ask the team</h3>
			<ul>
				{#each sheet.ask as line}<li>{line}</li>{/each}
			</ul>
		</details>
	{/each}
</section>

<section>
	<h2>Two-minute team check</h2>
	<p class="muted small">Tap each one the team is doing. Anything left open is where to help.</p>
	<ul class="check">
		{#each TEAM_CHECK as item (item.id)}
			<li>
				<label>
					<input type="checkbox" bind:checked={ticked[item.id]} />
					<span>{item.text}</span>
				</label>
			</li>
		{/each}
	</ul>
	<p class="count">
		<strong>{done} of {TEAM_CHECK.length}</strong>
		{#if done === TEAM_CHECK.length}
			- this team is on track.
		{:else}
			- start with the first one left open.
		{/if}
	</p>
	<button class="btn" type="button" onclick={reset}>Clear for the next team</button>
</section>

<section>
	<h2>Missions</h2>
	<p class="muted small">
		A student asks how a mission works? Open the official rulebook at that mission. The summary
		in the app is a quick reminder, not the official wording.
	</p>
	<div class="official">
		<a class="btn btn--primary" href={RULEBOOK_URL} target="_blank" rel="noopener noreferrer">
			Official rulebook
		</a>
		<a class="btn" href={rulebookLink(RULEBOOK_MAP_PAGE)} target="_blank" rel="noopener noreferrer">
			Mat map (page {RULEBOOK_MAP_PAGE})
		</a>
		<a class="btn" href={RULEBOOK_INTERACTIVE_URL} target="_blank" rel="noopener noreferrer">
			Interactive rulebook
		</a>
	</div>
	<p class="warn small">
		The
		<a href={CHALLENGE_UPDATES_URL} target="_blank" rel="noopener noreferrer">Challenge Updates</a>
		override the rulebook, and FIRST changes them during the season. If a rule looks different
		from the rulebook, check the updates.
	</p>
	<ul class="missions">
		{#each MISSION_CONTENT as m (m.code)}
			{@const page = MISSION_RULEBOOK_PAGE[m.code]}
			<li class="mission">
				<span class="mission__num">{m.code.slice(1)}</span>
				<span class="mission__title">{m.title}</span>
				<a class="mission__link" href={`/app/library/missions/${m.code}`}>Summary</a>
				{#if page}
					<a
						class="mission__link mission__link--official"
						href={rulebookLink(page)}
						target="_blank"
						rel="noopener noreferrer"
					>
						Rulebook p{page}
					</a>
				{/if}
			</li>
		{/each}
	</ul>
</section>

<style>
	.back {
		display: inline-block;
		margin-bottom: var(--space-3);
		color: var(--link);
	}
	h1 {
		margin: var(--space-1) 0 var(--space-3);
	}
	h2 {
		margin: var(--space-6) 0 var(--space-1);
	}
	h3 {
		margin: var(--space-3) 0 var(--space-1);
		font-size: var(--fs-body);
	}
	.lead {
		margin: 0;
	}
	.sheet {
		margin-top: var(--space-3);
	}
	.sheet summary {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-height: 44px;
		cursor: pointer;
	}
	.sheet__name {
		font-weight: var(--fw-bold);
		color: var(--text-1);
	}
	.sheet ul {
		margin: 0;
		padding-left: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.check {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.check label {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--boundary);
		border-radius: var(--radius-control);
	}
	.check input {
		width: 1.5rem;
		height: 1.5rem;
		flex: 0 0 auto;
	}
	.count {
		margin: var(--space-3) 0;
	}
	.official {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-3) 0;
	}
	.warn {
		color: var(--warning);
	}
	.missions {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.mission {
		display: grid;
		grid-template-columns: 2.25rem minmax(0, 1fr) auto auto;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--boundary);
		border-radius: var(--radius-control);
	}
	.mission__num {
		font-family: var(--font-display);
		font-weight: var(--fw-bold);
		color: var(--text-1);
	}
	.mission__title {
		font-weight: var(--fw-bold);
		color: var(--text-1);
	}
	.mission__link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0 var(--space-2);
		color: var(--link);
		white-space: nowrap;
	}
	.mission__link--official {
		font-weight: var(--fw-bold);
	}
	@media (max-width: 26rem) {
		.mission {
			grid-template-columns: 2.25rem minmax(0, 1fr);
		}
		.mission__link {
			grid-column: 2;
			justify-content: flex-start;
		}
	}
</style>
