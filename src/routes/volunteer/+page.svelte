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

	// Find a mission by number or by any part of its name. "7", "07" and
	// "fungus" all land on the same card.
	let query = $state('');
	let shown = $derived.by(() => {
		const q = query.trim().toLowerCase().replace(/^0+(?=\d)/, '');
		if (!q) return MISSION_CONTENT;
		return MISSION_CONTENT.filter(
			(m) =>
				String(Number(m.code.slice(1))) === q ||
				m.code.slice(1).startsWith(q) ||
				m.title.toLowerCase().includes(q)
		);
	});
</script>

<svelte:head><title>Volunteer Guide</title></svelte:head>
<div class="wrap">

<p class="eyebrow">Volunteers</p>
<h1>Volunteer Guide</h1>
<p class="lead">
	Teams that stick to the printed sheets make steady progress. Teams that drift off them stop
	writing things down, get confused, and fall apart. Your job is to keep every team on the sheets.
</p>

<nav class="jump" aria-label="Jump to">
	<a class="jump__tile" href="#missions">
		<span class="jump__big">A student asked about a mission</span>
		<span class="jump__small">Find it, open the official rules</span>
	</a>
	<a class="jump__tile" href="#check">
		<span class="jump__big">Check on a team</span>
		<span class="jump__small">Seven yes or no questions</span>
	</a>
	<a class="jump__tile" href="#sheets">
		<span class="jump__big">What should a sheet look like?</span>
		<span class="jump__small">Game Plan, Iteration Log, More Rounds</span>
	</a>
</nav>

<section id="sheets">
	<h2>The three sheets</h2>
	<p class="muted small">Tap a sheet to see what a good one looks like and what to ask.</p>
	{#each VOLUNTEER_SHEETS as sheet (sheet.id)}
		<details class="card sheet">
			<summary>
				<span class="sheet__head">
					<span class="sheet__name">{sheet.name}</span>
					<span class="sheet__chev" aria-hidden="true"></span>
				</span>
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

<section id="check">
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
	<p class="count" aria-live="polite">
		<strong>{done} of {TEAM_CHECK.length}</strong>
		{#if done === TEAM_CHECK.length}
			- this team is on track.
		{:else}
			- start with the first one left open.
		{/if}
	</p>
	<button class="btn btn--secondary" type="button" onclick={reset}>Clear for the next team</button>
</section>

<section id="missions">
	<h2>Missions</h2>
	<p class="muted small">
		A student asks how a mission works? Open the official rules at that mission.
	</p>
	<div class="official">
		<a class="btn btn--primary" href={RULEBOOK_URL} target="_blank" rel="noopener noreferrer">
			Official rulebook
		</a>
		<a class="btn btn--secondary" href={rulebookLink(RULEBOOK_MAP_PAGE)} target="_blank" rel="noopener noreferrer">
			Mat map (page {RULEBOOK_MAP_PAGE})
		</a>
		<a class="btn btn--secondary" href={RULEBOOK_INTERACTIVE_URL} target="_blank" rel="noopener noreferrer">
			Interactive rulebook
		</a>
	</div>
	<p class="warn small">
		The
		<a href={CHALLENGE_UPDATES_URL} target="_blank" rel="noopener noreferrer">Challenge Updates</a>
		override the rulebook, and FIRST changes them during the season. If a rule looks different
		from the rulebook, check the updates.
	</p>
	<label class="search">
		<span class="search__label">Find a mission</span>
		<input
			type="search"
			inputmode="search"
			placeholder="Type a number or a name, like 7 or fungus"
			bind:value={query}
			autocomplete="off"
		/>
	</label>
	{#if shown.length === 0}
		<p class="muted">No mission matches "{query}". Clear the box to see all 15.</p>
	{/if}
	<ul class="missions">
		{#each shown as m (m.code)}
			{@const page = MISSION_RULEBOOK_PAGE[m.code]}
			<li class="mission">
				<span class="mission__num">{m.code.slice(1)}</span>
				<span class="mission__title">{m.title}</span>
				<span class="mission__links">
				{#if page}
					<a
						class="btn btn--primary mission__link"
						href={rulebookLink(page)}
						target="_blank"
						rel="noopener noreferrer"
					>
						Official rules, p{page}
					</a>
				{/if}
				</span>
			</li>
		{/each}
	</ul>
</section>

</div>

<style>
	.wrap {
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--space-4);
	}
	.unused {
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
		grid-template-columns: 2.25rem minmax(0, 1fr);
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3);
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
	.mission__links {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-2);
	}
	.mission__link {
		text-decoration: none;
		min-height: 44px;
		justify-content: center;
		text-align: center;
		white-space: nowrap;
	}
	.official {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
		margin: var(--space-3) 0;
	}
	.official :global(.btn--primary) {
		grid-column: 1 / -1;
	}
	.official :global(.btn) {
		text-decoration: none;
		min-height: 44px;
		justify-content: center;
		text-align: center;
	}
	.sheet summary {
		list-style: none;
	}
	.sheet summary::-webkit-details-marker {
		display: none;
	}
	.sheet__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.sheet__chev {
		width: 0.6rem;
		height: 0.6rem;
		border-right: 2px solid var(--text-2);
		border-bottom: 2px solid var(--text-2);
		transform: rotate(45deg);
		transition: transform 0.15s;
	}
	.sheet[open] .sheet__chev {
		transform: rotate(-135deg);
	}
	section {
		scroll-margin-top: var(--space-4);
	}
	.jump {
		display: grid;
		gap: var(--space-2);
		margin: var(--space-4) 0 0;
	}
	.jump__tile {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 64px;
		justify-content: center;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--boundary);
		border-radius: var(--radius-control);
		background: var(--surface-2);
		text-decoration: none;
	}
	.jump__big {
		font-weight: var(--fw-bold);
		color: var(--text-1);
		font-size: var(--fs-body);
	}
	.jump__small {
		color: var(--text-2);
		font-size: 0.875rem;
	}
	.search {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-top: var(--space-3);
	}
	.search__label {
		font-weight: var(--fw-bold);
		color: var(--text-1);
	}
	.search input {
		min-height: 48px;
		padding: 0 var(--space-3);
		font: inherit;
		border: 1px solid var(--boundary);
		border-radius: var(--radius-control);
		background: var(--surface-2);
		color: var(--text-1);
	}
	.count {
		position: sticky;
		bottom: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--surface-2);
		border: 1px solid var(--boundary);
		border-radius: var(--radius-control);
	}
	.mission__num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-ink);
	}
</style>
