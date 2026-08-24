<script lang="ts">
	/**
	 * THE NOTEBOOK A TEAM HANDS TO A JUDGE. One flat document: cover, the four
	 * judged sections, then the session log. NOTHING IS HIDDEN IN THE BASE
	 * STATE -- no tabs, no collapse, no hover -- so what the screen shows is
	 * what the printer gets, and the @media print rules only tune page breaks
	 * and chrome. The PDF path is the browser's own Print > Save as PDF, which
	 * every judging-room laptop already has.
	 *
	 * PAPER IS LIGHT. The app is dark for tablets in a lit room; a printed
	 * page is ink on white, so this component paints its own paper palette
	 * inline and does not consume the dark theme.
	 */
	import {
		NOTEBOOK_SECTIONS,
		OUTCOME_LABEL,
		type NotebookSectionId
	} from '$lib/content/notebook';
	import { ROLE_LABEL, type ResolvedRole } from '$lib/console/types';
	import type { MeetingRecapModel, NotebookEntryModel, SeasonPhoto, SeasonStats } from './types';

	interface Props {
		team: { name: string; fllTeamNumber: number | null };
		entries: NotebookEntryModel[];
		recaps: MeetingRecapModel[];
		stats: SeasonStats | null;
		roles: ResolvedRole[];
		studentNames: Record<string, string>;
		photos: SeasonPhoto[];
		photoUrls: Record<string, string>;
		backHref: string;
	}

	let { team, entries, recaps, stats, roles, studentNames, photos, photoUrls, backHref }: Props = $props();

	const photoById = $derived(new Map(photos.map((p) => [p.id, p])));

	function tries(): NotebookEntryModel[] {
		return entries.filter((e) => e.section === 'robot_design' && e.outcome !== null);
	}
	function answers(section: NotebookSectionId, promptKey: string): NotebookEntryModel[] {
		return entries.filter((e) => e.section === section && e.promptKey === promptKey && e.outcome === null);
	}
	function freeNotes(section: NotebookSectionId): NotebookEntryModel[] {
		return entries.filter((e) => e.section === section && e.promptKey === '' && e.outcome === null);
	}
	function authorName(e: NotebookEntryModel): string {
		return e.authoredByStudentId ? (studentNames[e.authoredByStudentId] ?? 'A teammate') : 'Mentor';
	}
	function photoUrlForEntry(e: NotebookEntryModel): string | null {
		if (!e.evidenceId) return null;
		const p = photoById.get(e.evidenceId);
		return p ? (photoUrls[p.storagePath] ?? null) : null;
	}
	function meetingLabel(r: MeetingRecapModel): string {
		const day = r.meetingKind === 'saturday' ? 'Saturday' : 'Friday';
		if (!r.meetingDate) return day;
		const d = new Date(`${r.meetingDate}T12:00:00`);
		return `${day}, ${d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
	}

	/** Oldest first: the season reads forward on paper. */
	const orderedRecaps = $derived([...recaps].reverse());
</script>

<div class="np">
	<div class="np__toolbar">
		<a class="np__toolbtn" href={backHref}>Back to the notebook</a>
		<button class="np__toolbtn np__toolbtn--go" type="button" onclick={() => window.print()}>
			Print, or save as PDF
		</button>
	</div>

	<article class="np__paper">
		<header class="np__cover">
			<p class="np__season">FIRST LEGO League Challenge · BIOGLOW 2026-27</p>
			<h1 class="np__title">{team.name}</h1>
			{#if team.fllTeamNumber}<p class="np__number">Team {team.fllTeamNumber}</p>{/if}
			<p class="np__doctype">Engineering Notebook</p>

			<div class="np__roster">
				<h2 class="np__h2">Our team</h2>
				<ul class="np__roles">
					{#each roles as r (r.role)}
						<li>
							<strong>{ROLE_LABEL[r.role]}:</strong>
							{r.primary_name ?? 'open seat'}{r.second_name ? ` (backup: ${r.second_name})` : ''}
						</li>
					{/each}
				</ul>
			</div>

			{#if stats}
				<div class="np__stats">
					<div class="np__stat"><span class="np__statn">{stats.meetingsHeld}</span> {stats.meetingsHeld === 1 ? 'meeting' : 'meetings'}</div>
					<div class="np__stat"><span class="np__statn">{stats.tasksClosed}</span> {stats.tasksClosed === 1 ? 'task finished' : 'tasks finished'}</div>
					<div class="np__stat"><span class="np__statn">{stats.photos}</span> {stats.photos === 1 ? 'photo' : 'photos'}</div>
					<div class="np__stat"><span class="np__statn">{stats.runs}</span> {stats.runs === 1 ? 'practice run' : 'practice runs'}</div>
					<div class="np__stat"><span class="np__statn">{stats.bestPoints}</span> best score</div>
					<div class="np__stat"><span class="np__statn">{stats.blockersResolved}</span> {stats.blockersResolved === 1 ? 'problem solved' : 'problems solved'}</div>
				</div>
			{/if}
		</header>

		{#each NOTEBOOK_SECTIONS as def (def.id)}
			<section class="np__section">
				<h2 class="np__h2 np__sectiontitle">{def.title}</h2>

				{#if def.id === 'robot_design'}
					<h3 class="np__h3">The story of our tries</h3>
					{#if tries().length === 0}
						<p class="np__quiet">No tries written down yet.</p>
					{/if}
					{#each tries() as e (e.id)}
						<div class="np__entry np__try" data-outcome={e.outcome}>
							<p class="np__tryhead">
								<span class="np__outcome" data-outcome={e.outcome}>{e.outcome ? OUTCOME_LABEL[e.outcome] : ''}</span>
								<span class="np__byline">{authorName(e)}</span>
							</p>
							<h4 class="np__h4">We tried: {e.title}</h4>
							{#if e.body}<p class="np__body">{e.body}</p>{/if}
							{#if e.changeNote}<p class="np__body"><strong>What we changed next:</strong> {e.changeNote}</p>{/if}
							{#if photoUrlForEntry(e)}
								<img class="np__photo" src={photoUrlForEntry(e)} alt={e.title || 'Team photo'} />
							{/if}
						</div>
					{/each}
				{/if}

				{#each def.prompts as prompt (prompt.key)}
					{#if answers(def.id, prompt.key).length > 0}
						<h3 class="np__h3">{prompt.label}</h3>
						{#each answers(def.id, prompt.key) as e (e.id)}
							<div class="np__entry">
								{#if e.title}<h4 class="np__h4">{e.title}</h4>{/if}
								<p class="np__body">{e.body}</p>
								{#if photoUrlForEntry(e)}
									<img class="np__photo" src={photoUrlForEntry(e)} alt={e.title || 'Team photo'} />
								{/if}
								<p class="np__byline">{authorName(e)}</p>
							</div>
						{/each}
					{/if}
				{/each}

				{#if freeNotes(def.id).length > 0}
					<h3 class="np__h3">More from our team</h3>
					{#each freeNotes(def.id) as e (e.id)}
						<div class="np__entry">
							{#if e.title}<h4 class="np__h4">{e.title}</h4>{/if}
							<p class="np__body">{e.body}</p>
							{#if photoUrlForEntry(e)}
								<img class="np__photo" src={photoUrlForEntry(e)} alt={e.title || 'Team photo'} />
							{/if}
							<p class="np__byline">{authorName(e)}</p>
						</div>
					{/each}
				{/if}

				{#if def.id === 'season_summary' && stats}
					<p class="np__quiet">
						{stats.recapsConfirmed} of {stats.recapsTotal} session recaps confirmed. The full session log follows.
					</p>
				{/if}
			</section>
		{/each}

		<section class="np__section">
			<h2 class="np__h2 np__sectiontitle">Session log</h2>
			{#if orderedRecaps.length === 0}
				<p class="np__quiet">No sessions recorded yet.</p>
			{/if}
			{#each orderedRecaps as r (r.id)}
				<div class="np__recap">
					<h3 class="np__h3">
						{meetingLabel(r)}
						{#if !r.confirmed}<span class="np__draftmark">Draft, not confirmed</span>{/if}
					</h3>
					{#if r.summary}<p class="np__body np__recapwords">{r.summary}</p>{/if}
					{#if r.facts}
						<ul class="np__facts">
							{#if r.facts.present.length > 0}
								<li>Here: {r.facts.present.join(', ')} ({r.facts.present.length} of {r.facts.rosterSize})</li>
							{/if}
							{#if r.facts.tasksClosed.length > 0}
								<li>Finished: {r.facts.tasksClosed.map((t) => t.title).join('; ')}</li>
							{/if}
							{#if r.facts.blockersRaised.length > 0}
								<li>Got stuck on: {r.facts.blockersRaised.map((b) => b.note).join('; ')}</li>
							{/if}
							{#if r.facts.blockersResolved.length > 0}
								<li>Got unstuck: {r.facts.blockersResolved.map((b) => b.note).join('; ')}</li>
							{/if}
							{#if r.facts.runsCount > 0}
								<li>Practice runs: {r.facts.runsCount}, best {r.facts.runsBest} points</li>
							{/if}
							{#if r.facts.strategyVersions.length > 0}
								<li>Robot plan saved: {r.facts.strategyVersions.map((v) => `v${v.version}${v.label ? ` (${v.label})` : ''}`).join(', ')}</li>
							{/if}
						</ul>
						{#if r.facts.photos.length > 0}
							<div class="np__recapphotos">
								{#each r.facts.photos as p (p.storagePath)}
									{#if photoUrls[p.storagePath]}
										<figure class="np__fig">
											<img class="np__photo" src={photoUrls[p.storagePath]} alt={p.caption ?? p.taskTitle} />
											<figcaption class="np__cap">{p.caption ?? p.taskTitle}</figcaption>
										</figure>
									{/if}
								{/each}
							</div>
						{/if}
					{/if}
				</div>
			{/each}
		</section>

		<footer class="np__foot">
			Written by the students of {team.name}. Assembled from our season records by our team app.
		</footer>
	</article>
</div>

<style>
	/* Screen: a paper preview on the app's dark ground. Print: just the paper. */
	.np {
		min-height: 100dvh;
		background: var(--surface-0, #0b1016);
		padding: var(--space-4, 1rem);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3, 0.75rem);
	}
	.np__toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3, 0.75rem);
		width: 100%;
		max-width: 52rem;
	}
	.np__toolbtn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.75rem;
		padding: 0 var(--space-4, 1rem);
		border-radius: var(--radius-control, 0.5rem);
		border: 2px solid var(--boundary, #3a4656);
		background: transparent;
		color: var(--text-1, #e8eef5);
		font: inherit;
		font-weight: 700;
		text-decoration: none;
		cursor: pointer;
	}
	.np__toolbtn--go {
		border-color: var(--glow-green, #7dff9a);
		color: var(--glow-green, #7dff9a);
	}

	.np__paper {
		width: 100%;
		max-width: 52rem;
		background: #ffffff;
		color: #1a2330;
		border-radius: 6px;
		padding: clamp(1.25rem, 4vw, 3rem);
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 1.05rem;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}

	.np__cover {
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		border-bottom: 3px solid #1a2330;
		padding-bottom: 1.5rem;
		margin-bottom: 1.5rem;
	}
	.np__season {
		margin: 0;
		font-size: 0.9rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #4a5768;
	}
	.np__title {
		margin: 0;
		font-size: 2.4rem;
		line-height: 1.1;
	}
	.np__number {
		margin: 0;
		color: #4a5768;
	}
	.np__doctype {
		margin: 0;
		font-size: 1.3rem;
		font-style: italic;
	}
	.np__roster {
		text-align: left;
		margin-top: 0.75rem;
	}
	.np__roles {
		margin: 0.4rem 0 0;
		padding-left: 1.3rem;
	}
	.np__stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-content: center;
		margin-top: 0.75rem;
	}
	.np__stat {
		border: 1px solid #c6cdd6;
		border-radius: 6px;
		padding: 0.4rem 0.7rem;
		font-size: 0.9rem;
		color: #4a5768;
	}
	.np__statn {
		font-weight: 700;
		font-size: 1.1rem;
		color: #1a2330;
	}

	.np__section {
		margin-bottom: 1.75rem;
	}
	.np__h2 {
		margin: 0 0 0.5rem;
		font-size: 1.6rem;
	}
	.np__sectiontitle {
		border-bottom: 2px solid #1a2330;
		padding-bottom: 0.25rem;
	}
	.np__h3 {
		margin: 1.1rem 0 0.35rem;
		font-size: 1.15rem;
	}
	.np__h4 {
		margin: 0 0 0.25rem;
		font-size: 1.05rem;
	}
	.np__quiet {
		margin: 0.25rem 0;
		color: #4a5768;
		font-style: italic;
	}
	.np__entry {
		margin: 0.5rem 0 0.9rem;
		padding-left: 0.85rem;
		border-left: 3px solid #c6cdd6;
	}
	.np__try[data-outcome='failed'] {
		border-left-color: #b4690e;
	}
	.np__try[data-outcome='worked'] {
		border-left-color: #1e7d3c;
	}
	.np__try[data-outcome='mixed'] {
		border-left-color: #17667d;
	}
	.np__tryhead {
		margin: 0 0 0.2rem;
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.np__outcome {
		font-weight: 700;
		text-transform: uppercase;
		font-size: 0.85rem;
		letter-spacing: 0.05em;
	}
	.np__outcome[data-outcome='failed'] {
		color: #b4690e;
	}
	.np__outcome[data-outcome='worked'] {
		color: #1e7d3c;
	}
	.np__outcome[data-outcome='mixed'] {
		color: #17667d;
	}
	.np__body {
		margin: 0.25rem 0;
		white-space: pre-wrap;
	}
	.np__byline {
		margin: 0.15rem 0 0;
		font-size: 0.85rem;
		color: #4a5768;
	}
	/* Photos at a size a judge can actually read. */
	.np__photo {
		display: block;
		max-width: min(100%, 24rem);
		max-height: 18rem;
		object-fit: contain;
		margin: 0.5rem 0;
		border: 1px solid #c6cdd6;
		border-radius: 4px;
	}

	.np__recap {
		margin-bottom: 1.1rem;
	}
	.np__draftmark {
		margin-left: 0.6rem;
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #b4690e;
		border: 1px solid #b4690e;
		border-radius: 4px;
		padding: 0.05rem 0.35rem;
		vertical-align: middle;
	}
	.np__recapwords {
		font-style: italic;
	}
	.np__facts {
		margin: 0.25rem 0;
		padding-left: 1.3rem;
	}
	.np__recapphotos {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}
	.np__fig {
		margin: 0;
		max-width: 14rem;
	}
	.np__fig .np__photo {
		max-width: 100%;
		max-height: 11rem;
		margin: 0.25rem 0;
	}
	.np__cap {
		font-size: 0.85rem;
		color: #4a5768;
	}

	.np__foot {
		margin-top: 2rem;
		padding-top: 0.75rem;
		border-top: 1px solid #c6cdd6;
		font-size: 0.9rem;
		color: #4a5768;
		text-align: center;
	}

	@media print {
		/* The app's dark ground must not print as a border around the paper:
		   html and body both paint one, and color-scheme: dark makes the
		   browser paint the page canvas itself near-black. */
		:global(html) {
			color-scheme: light;
		}
		:global(html),
		:global(body) {
			background: #ffffff;
		}
		.np {
			background: #ffffff;
			padding: 0;
		}
		.np__toolbar {
			display: none;
		}
		.np__paper {
			max-width: none;
			border-radius: 0;
			padding: 0;
		}
		.np__section {
			break-inside: auto;
		}
		.np__sectiontitle {
			break-after: avoid;
		}
		.np__entry,
		.np__recap,
		.np__fig {
			break-inside: avoid;
		}
		.np__cover {
			break-after: page;
		}
	}
</style>
