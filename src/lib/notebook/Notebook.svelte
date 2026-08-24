<script lang="ts">
	/**
	 * THE ENGINEERING NOTEBOOK, the pure component: four judged sections plus
	 * the session recap stream, rendered from props and persisted through
	 * `onPersist` (the write queue in the app, a visible log in the dev
	 * harness).
	 *
	 * LOCAL-FIRST LIKE THE PLANNER: the model here is the session's truth.
	 * Every save lands in the local $state immediately and goes to the queue;
	 * there is no realtime on these tables, so nothing can clobber a child's
	 * sentence mid-word.
	 *
	 * THE AFFORDANCE NEVER LIES: `canEdit` comes from notebook_can_edit, the
	 * same function every policy calls, so a button shown here is a write the
	 * database will accept.
	 */
	import {
		FAILED_ENCOURAGEMENT,
		NOTEBOOK_SECTIONS,
		OFFICIAL_DOC_NOTE,
		OUTCOME_LABEL,
		RECAP_HINT,
		RECAP_PROMPT,
		type NotebookSectionId
	} from '$lib/content/notebook';
	import { ROLE_SHORT, type ResolvedRole } from '$lib/console/types';
	import type { ConnectionState } from '$lib/student/queue.svelte';
	import {
		notebookDelete,
		notebookInsert,
		notebookRestore,
		notebookUpdate,
		recapUpdate,
		type NotebookOp
	} from './ops';
	import { bySortThenCreated } from './types';
	import type {
		MeetingRecapModel,
		NotebookEntryModel,
		NotebookOutcome,
		SeasonPhoto,
		SeasonStats
	} from './types';

	interface Props {
		team: { id: string; name: string };
		isMentor: boolean;
		myStudentId: string | null;
		canEdit: Record<NotebookSectionId, boolean>;
		entries: NotebookEntryModel[];
		recaps: MeetingRecapModel[];
		stats: SeasonStats | null;
		roles: ResolvedRole[];
		studentNames: Record<string, string>;
		photos: SeasonPhoto[];
		photoUrls: Record<string, string>;
		connection: ConnectionState;
		pendingCount: number;
		failed: { id: string; message: string }[];
		printHref: string;
		libraryHref?: string;
		onPersist: (op: NotebookOp) => void;
		onDismissFailure: (id: string) => void;
	}

	let {
		team,
		isMentor,
		myStudentId,
		canEdit,
		entries: initialEntries,
		recaps: initialRecaps,
		stats,
		roles,
		studentNames,
		photos,
		photoUrls,
		connection,
		pendingCount,
		failed,
		printHref,
		libraryHref = '/app/library/documents',
		onPersist,
		onDismissFailure
	}: Props = $props();

	// The local model is the session's truth from the first payload onward.
	// svelte-ignore state_referenced_locally
	let model = $state<NotebookEntryModel[]>([...initialEntries]);
	// svelte-ignore state_referenced_locally
	let recapModel = $state<MeetingRecapModel[]>(initialRecaps.map((r) => ({ ...r })));

	type Tab = NotebookSectionId | 'sessions';
	let tab = $state<Tab>('robot_design');

	interface Composer {
		entryId: string | null;
		section: NotebookSectionId;
		mode: 'try' | 'answer' | 'note';
		promptKey: string;
		title: string;
		body: string;
		changeNote: string;
		outcome: NotebookOutcome | null;
		evidenceId: string | null;
	}
	let composer = $state<Composer | null>(null);
	let pickingPhoto = $state(false);
	let confirmingDelete = $state<string | null>(null);

	/**
	 * THE TEN SECOND UNDO. Deleting a page is a soft delete (0020), so the
	 * words are still in the database and putting them back is one RPC. The
	 * line below is what a child sees for ten seconds; after that an adult
	 * uses the bin on the mentor page, which is why the undo is allowed to be
	 * this short. The whole entry is kept here, not just its id, so the local
	 * model can be repaired without a refetch (this surface is local-first and
	 * has to work with the wifi down).
	 */
	const UNDO_MS = 10_000;
	let undo = $state<{ entry: NotebookEntryModel } | null>(null);

	// One timer per offer, torn down when the offer changes AND on unmount, so
	// a child who taps Delete and walks to another tab leaves nothing running.
	$effect(() => {
		const offer = undo;
		if (!offer) return;
		const timer = setTimeout(() => {
			if (undo?.entry.id === offer.entry.id) undo = null;
		}, UNDO_MS);
		return () => clearTimeout(timer);
	});

	/** Recap summaries being typed, keyed by recap id. */
	let recapDrafts = $state<Record<string, string>>({});

	const photoById = $derived(new Map(photos.map((p) => [p.id, p])));

	const CONNECTION_LABEL: Record<ConnectionState, string> = {
		online: 'Saved',
		syncing: 'Saving',
		offline: 'Saved on this device'
	};

	function authorName(entry: NotebookEntryModel): string {
		if (entry.authoredByStudentId) return studentNames[entry.authoredByStudentId] ?? 'A teammate';
		return 'Mentor';
	}

	function holdersFor(section: NotebookSectionId): string[] {
		const def = NOTEBOOK_SECTIONS.find((s) => s.id === section);
		const wanted = new Set(['notebook_values_lead', ...(def?.contributorRoles ?? [])]);
		const out: string[] = [];
		for (const r of roles) {
			if (!wanted.has(r.role)) continue;
			const who = r.active_name ?? r.primary_name ?? r.second_name;
			out.push(who ? `${ROLE_SHORT[r.role]}: ${who}` : `${ROLE_SHORT[r.role]}: nobody yet`);
		}
		return out;
	}

	function tries(): NotebookEntryModel[] {
		return model.filter((e) => e.section === 'robot_design' && e.outcome !== null);
	}
	function answers(section: NotebookSectionId, promptKey: string): NotebookEntryModel[] {
		return model.filter((e) => e.section === section && e.promptKey === promptKey && e.outcome === null);
	}
	function freeNotes(section: NotebookSectionId): NotebookEntryModel[] {
		return model.filter((e) => e.section === section && e.promptKey === '' && e.outcome === null);
	}

	function openComposer(section: NotebookSectionId, mode: Composer['mode'], promptKey = '', entry?: NotebookEntryModel) {
		composer = {
			entryId: entry?.id ?? null,
			section,
			mode,
			promptKey: entry?.promptKey ?? promptKey,
			title: entry?.title ?? '',
			body: entry?.body ?? '',
			changeNote: entry?.changeNote ?? '',
			outcome: entry?.outcome ?? (mode === 'try' ? null : null),
			evidenceId: entry?.evidenceId ?? null
		};
		pickingPhoto = false;
	}

	function composerReady(c: Composer): boolean {
		if (c.mode === 'try') return c.title.trim().length > 0 && c.outcome !== null;
		return c.body.trim().length > 0 || c.title.trim().length > 0;
	}

	function saveComposer() {
		const c = composer;
		if (!c || !composerReady(c)) return;
		if (c.entryId) {
			const patch = {
				title: c.title,
				body: c.body,
				change_note: c.changeNote,
				outcome: c.outcome,
				evidence_id: c.evidenceId
			};
			onPersist(notebookUpdate(c.entryId, patch));
			model = model.map((e) =>
				e.id === c.entryId
					? { ...e, title: c.title, body: c.body, changeNote: c.changeNote, outcome: c.outcome, evidenceId: c.evidenceId }
					: e
			);
		} else {
			const id = crypto.randomUUID();
			onPersist(
				notebookInsert({
					id,
					team_id: team.id,
					section: c.section,
					prompt_key: c.promptKey,
					title: c.title,
					body: c.body,
					change_note: c.changeNote,
					outcome: c.outcome,
					evidence_id: c.evidenceId,
					authored_by_student_id: myStudentId,
					sort_order: model.filter((e) => e.section === c.section).length
				})
			);
			model = [
				...model,
				{
					id,
					teamId: team.id,
					section: c.section,
					promptKey: c.promptKey,
					title: c.title,
					body: c.body,
					outcome: c.outcome,
					changeNote: c.changeNote,
					evidenceId: c.evidenceId,
					authoredByStudentId: myStudentId,
					sortOrder: model.filter((e) => e.section === c.section).length,
					createdAt: new Date().toISOString()
				}
			];
		}
		composer = null;
	}

	function deleteEntry(entry: NotebookEntryModel) {
		if (confirmingDelete !== entry.id) {
			confirmingDelete = entry.id;
			return;
		}
		confirmingDelete = null;
		onPersist(notebookDelete(entry.id));
		model = model.filter((e) => e.id !== entry.id);
		if (composer?.entryId === entry.id) composer = null;
		undo = { entry: { ...entry } };
	}

	function putItBack() {
		const offer = undo;
		if (!offer) return;
		undo = null;
		onPersist(notebookRestore(offer.entry.id));
		model = [...model.filter((e) => e.id !== offer.entry.id), offer.entry].sort(bySortThenCreated);
	}

	function recapSummaryValue(r: MeetingRecapModel): string {
		return recapDrafts[r.id] ?? r.summary;
	}

	function saveRecapSummary(r: MeetingRecapModel) {
		const text = recapDrafts[r.id];
		if (text === undefined || text === r.summary) return;
		onPersist(recapUpdate(r.id, { summary: text }));
		recapModel = recapModel.map((x) => (x.id === r.id ? { ...x, summary: text } : x));
		const { [r.id]: _saved, ...rest } = recapDrafts;
		recapDrafts = rest;
	}

	function toggleRecapConfirmed(r: MeetingRecapModel) {
		// An unsaved summary rides along with the confirmation.
		const text = recapDrafts[r.id];
		const next = !r.confirmed;
		onPersist(recapUpdate(r.id, { confirmed: next, ...(text !== undefined ? { summary: text } : {}) }));
		recapModel = recapModel.map((x) =>
			x.id === r.id
				? {
						...x,
						confirmed: next,
						confirmedAt: next ? new Date().toISOString() : null,
						confirmedByStudentId: next ? myStudentId : null,
						...(text !== undefined ? { summary: text } : {})
					}
				: x
		);
		if (text !== undefined) {
			const { [r.id]: _saved, ...rest } = recapDrafts;
			recapDrafts = rest;
		}
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
		return `${day}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
	}

	const unfinishedRecaps = $derived(recapModel.filter((r) => !r.confirmed).length);
</script>

<div class="nb">
	<header class="nb__bar">
		<div class="nb__status" data-state={connection}>
			<span class="nb__dot" aria-hidden="true"></span>
			<span>{CONNECTION_LABEL[connection]}{pendingCount > 0 ? ` (${pendingCount} waiting)` : ''}</span>
		</div>
		<a class="btn btn--secondary nb__print" href={printHref}>Print it</a>
	</header>

	{#each failed as f (f.id)}
		<div class="nb__failed" role="alert">
			<span>{f.message}</span>
			<button class="btn btn--ghost btn--small" type="button" onclick={() => onDismissFailure(f.id)}>OK</button>
		</div>
	{/each}

	{#if undo}
		<div class="nb__undo" role="status">
			<span>Deleted{undo.entry.title ? ` "${undo.entry.title}"` : ' that page'}.</span>
			<button class="btn btn--secondary nb__undobtn" type="button" onclick={putItBack}>Put it back</button>
		</div>
	{/if}

	<nav class="nb__tabs" aria-label="Notebook sections">
		{#each NOTEBOOK_SECTIONS as s (s.id)}
			<button
				class="nb__tab"
				class:nb__tab--on={tab === s.id}
				type="button"
				onclick={() => {
					tab = s.id;
					composer = null;
				}}
			>
				{s.short}
			</button>
		{/each}
		<button
			class="nb__tab"
			class:nb__tab--on={tab === 'sessions'}
			type="button"
			onclick={() => {
				tab = 'sessions';
				composer = null;
			}}
		>
			Sessions
			{#if unfinishedRecaps > 0}<span class="nb__badge">{unfinishedRecaps}</span>{/if}
		</button>
	</nav>

	{#each NOTEBOOK_SECTIONS as def (def.id)}
		{#if tab === def.id}
			<section class="nb__section" aria-label={def.title}>
				<div class="card nb__intro">
					<h2 class="nb__h">{def.title}</h2>
					<p class="nb__lede">{def.lede}</p>
					<p class="nb__judge">{def.judgeNote}</p>
					<div class="nb__holders">
						{#each holdersFor(def.id) as h (h)}
							<span class="nb__chip">{h}</span>
						{/each}
					</div>
					{#if !canEdit[def.id] && !isMentor}
						<p class="nb__readonly">You can read this part. Your team's leads write here.</p>
					{/if}
				</div>

				{#if def.id === 'robot_design'}
					<div class="nb__block">
						<h3 class="nb__h3">Our tries</h3>
						<p class="nb__hint">{FAILED_ENCOURAGEMENT}</p>
						{#each tries() as e (e.id)}
							<article class="card nb__entry" data-outcome={e.outcome}>
								<div class="nb__entryhead">
									<span class="nb__outcome" data-outcome={e.outcome}>{e.outcome ? OUTCOME_LABEL[e.outcome] : ''}</span>
									<span class="nb__byline">{authorName(e)}</span>
								</div>
								<h4 class="nb__entrytitle">{e.title}</h4>
								{#if e.body}<p class="nb__body">{e.body}</p>{/if}
								{#if e.changeNote}
									<p class="nb__change"><strong>What we changed next:</strong> {e.changeNote}</p>
								{/if}
								{#if photoUrlForEntry(e)}
									<img class="nb__photo" src={photoUrlForEntry(e)} alt={e.title || 'Team photo'} />
								{/if}
								{#if canEdit[def.id]}
									<div class="nb__entryactions">
										<button class="btn btn--ghost btn--small" type="button" onclick={() => openComposer(def.id, 'try', '', e)}>Edit</button>
										<button class="btn btn--ghost btn--small nb__delete" type="button" onclick={() => deleteEntry(e)}>
											{confirmingDelete === e.id ? 'Really delete?' : 'Delete'}
										</button>
									</div>
								{/if}
							</article>
						{/each}
						{#if tries().length === 0}
							<p class="nb__empty">No tries written down yet.</p>
						{/if}
						{#if canEdit[def.id]}
							<button class="btn btn--primary nb__add" type="button" onclick={() => openComposer(def.id, 'try')}>
								Add a try
							</button>
						{/if}
					</div>
				{/if}

				{#each def.prompts as prompt (prompt.key)}
					<div class="nb__block">
						<h3 class="nb__h3">{prompt.label}</h3>
						<p class="nb__hint">{prompt.hint}</p>
						{#each answers(def.id, prompt.key) as e (e.id)}
							<article class="card nb__entry">
								<div class="nb__entryhead">
									<span class="nb__byline">{authorName(e)}</span>
								</div>
								{#if e.title}<h4 class="nb__entrytitle">{e.title}</h4>{/if}
								<p class="nb__body">{e.body}</p>
								{#if photoUrlForEntry(e)}
									<img class="nb__photo" src={photoUrlForEntry(e)} alt={e.title || 'Team photo'} />
								{/if}
								{#if canEdit[def.id]}
									<div class="nb__entryactions">
										<button class="btn btn--ghost btn--small" type="button" onclick={() => openComposer(def.id, 'answer', prompt.key, e)}>Edit</button>
										<button class="btn btn--ghost btn--small nb__delete" type="button" onclick={() => deleteEntry(e)}>
											{confirmingDelete === e.id ? 'Really delete?' : 'Delete'}
										</button>
									</div>
								{/if}
							</article>
						{/each}
						{#if canEdit[def.id]}
							<button class="btn btn--secondary nb__add" type="button" onclick={() => openComposer(def.id, 'answer', prompt.key)}>
								{answers(def.id, prompt.key).length > 0 ? 'Add another answer' : 'Answer this'}
							</button>
						{/if}
					</div>
				{/each}

				<div class="nb__block">
					<h3 class="nb__h3">Extra notes</h3>
					{#each freeNotes(def.id) as e (e.id)}
						<article class="card nb__entry">
							<div class="nb__entryhead">
								<span class="nb__byline">{authorName(e)}</span>
							</div>
							{#if e.title}<h4 class="nb__entrytitle">{e.title}</h4>{/if}
							<p class="nb__body">{e.body}</p>
							{#if photoUrlForEntry(e)}
								<img class="nb__photo" src={photoUrlForEntry(e)} alt={e.title || 'Team photo'} />
							{/if}
							{#if canEdit[def.id]}
								<div class="nb__entryactions">
									<button class="btn btn--ghost btn--small" type="button" onclick={() => openComposer(def.id, 'note', '', e)}>Edit</button>
									<button class="btn btn--ghost btn--small nb__delete" type="button" onclick={() => deleteEntry(e)}>
										{confirmingDelete === e.id ? 'Really delete?' : 'Delete'}
									</button>
								</div>
							{/if}
						</article>
					{/each}
					{#if canEdit[def.id]}
						<button class="btn btn--secondary nb__add" type="button" onclick={() => openComposer(def.id, 'note')}>
							Add a note
						</button>
					{/if}
				</div>

				{#if def.id === 'season_summary' && stats}
					<div class="nb__block">
						<h3 class="nb__h3">Our season in numbers</h3>
						<div class="nb__stats">
							<div class="nb__stat"><span class="nb__statn">{stats.meetingsHeld}</span><span>{stats.meetingsHeld === 1 ? 'meeting' : 'meetings'}</span></div>
							<div class="nb__stat"><span class="nb__statn">{stats.tasksClosed}</span><span>{stats.tasksClosed === 1 ? 'task finished' : 'tasks finished'}</span></div>
							<div class="nb__stat"><span class="nb__statn">{stats.photos}</span><span>{stats.photos === 1 ? 'photo taken' : 'photos taken'}</span></div>
							<div class="nb__stat"><span class="nb__statn">{stats.runs}</span><span>{stats.runs === 1 ? 'practice run' : 'practice runs'}</span></div>
							<div class="nb__stat"><span class="nb__statn">{stats.bestPoints}</span><span>best score</span></div>
							<div class="nb__stat"><span class="nb__statn">{stats.blockersResolved}</span><span>{stats.blockersResolved === 1 ? 'problem solved' : 'problems solved'}</span></div>
						</div>
						<p class="nb__hint">
							{stats.recapsConfirmed} of {stats.recapsTotal} session recaps finished. They live in the Sessions tab.
						</p>
					</div>
				{/if}
			</section>
		{/if}
	{/each}

	{#if tab === 'sessions'}
		<section class="nb__section" aria-label="Session recaps">
			<div class="card nb__intro">
				<h2 class="nb__h">Sessions</h2>
				<p class="nb__lede">After every meeting, the app writes down what happened. Check it, add your words, and tap Finish.</p>
				{#if unfinishedRecaps > 0}
					<p class="nb__judge">{unfinishedRecaps} recap{unfinishedRecaps === 1 ? '' : 's'} still need{unfinishedRecaps === 1 ? 's' : ''} a check.</p>
				{/if}
			</div>

			{#if recapModel.length === 0}
				<p class="nb__empty">No sessions recorded yet. The first recap appears at the Close of your next meeting.</p>
			{/if}

			{#each recapModel as r (r.id)}
				<article class="card nb__recap" class:nb__recap--draft={!r.confirmed}>
					<div class="nb__recaphead">
						<h3 class="nb__h3">{meetingLabel(r)}</h3>
						{#if r.confirmed}
							<span class="nb__done">Finished</span>
						{:else}
							<span class="nb__todo">Not finished</span>
						{/if}
					</div>

					{#if r.facts}
						<ul class="nb__facts">
							{#if r.facts.present.length > 0}
								<li><strong>Here:</strong> {r.facts.present.join(', ')} ({r.facts.present.length} of {r.facts.rosterSize})</li>
							{/if}
							{#if r.facts.tasksClosed.length > 0}
								<li><strong>Finished:</strong> {r.facts.tasksClosed.map((t) => t.title).join('; ')}</li>
							{/if}
							{#if r.facts.blockersRaised.length > 0}
								<li><strong>Got stuck on:</strong> {r.facts.blockersRaised.map((b) => b.note).join('; ')}</li>
							{/if}
							{#if r.facts.blockersResolved.length > 0}
								<li><strong>Got unstuck:</strong> {r.facts.blockersResolved.map((b) => b.note).join('; ')}</li>
							{/if}
							{#if r.facts.runsCount > 0}
								<li><strong>Practice runs:</strong> {r.facts.runsCount}, best {r.facts.runsBest} points</li>
							{/if}
							{#if r.facts.strategyVersions.length > 0}
								<li><strong>Plan saved:</strong> {r.facts.strategyVersions.map((v) => `v${v.version}${v.label ? ` (${v.label})` : ''}`).join(', ')}</li>
							{/if}
						</ul>
						{#if r.facts.photos.length > 0}
							<div class="nb__recapphotos">
								{#each r.facts.photos as p (p.storagePath)}
									{#if photoUrls[p.storagePath]}
										<figure class="nb__fig">
											<img class="nb__photo" src={photoUrls[p.storagePath]} alt={p.caption ?? p.taskTitle} />
											{#if p.caption}<figcaption class="nb__cap">{p.caption}</figcaption>{/if}
										</figure>
									{/if}
								{/each}
							</div>
						{/if}
					{/if}

					{#if canEdit.season_summary}
						<label class="field nb__field">
							<span>{RECAP_PROMPT}</span>
							<textarea
								class="input nb__text"
								rows="3"
								placeholder={RECAP_HINT}
								value={recapSummaryValue(r)}
								oninput={(ev) => (recapDrafts = { ...recapDrafts, [r.id]: ev.currentTarget.value })}
							></textarea>
						</label>
						<div class="nb__entryactions">
							{#if recapDrafts[r.id] !== undefined && recapDrafts[r.id] !== r.summary}
								<button class="btn btn--secondary" type="button" onclick={() => saveRecapSummary(r)}>Save words</button>
							{/if}
							<button class="btn {r.confirmed ? 'btn--ghost' : 'btn--primary'}" type="button" onclick={() => toggleRecapConfirmed(r)}>
								{r.confirmed ? 'Reopen' : 'Finish this recap'}
							</button>
						</div>
					{:else if r.summary}
						<p class="nb__body nb__summary">{r.summary}</p>
					{/if}
					{#if !canEdit.season_summary && !r.summary}
						<p class="nb__hint">The Notebook Lead adds the team's words here.</p>
					{/if}
				</article>
			{/each}
		</section>
	{/if}

	{#if composer}
		<div class="nb__composer card">
			<h3 class="nb__h3">
				{composer.entryId ? 'Edit' : composer.mode === 'try' ? 'Add a try' : composer.mode === 'note' ? 'Add a note' : 'Your answer'}
			</h3>
			{#if composer.mode === 'try'}
				<label class="field nb__field">
					<span>What did you try?</span>
					<input class="input" type="text" maxlength="200" bind:value={composer.title} />
				</label>
				<fieldset class="nb__outcomes">
					<legend class="nb__legend">What happened?</legend>
					{#each Object.entries(OUTCOME_LABEL) as [value, label] (value)}
						<button
							class="nb__outcomebtn"
							class:nb__outcomebtn--on={composer.outcome === value}
							data-outcome={value}
							type="button"
							onclick={() => {
								if (composer) composer.outcome = value as NotebookOutcome;
							}}
						>
							{label}
						</button>
					{/each}
				</fieldset>
				{#if composer.outcome === 'failed'}
					<p class="nb__hint">{FAILED_ENCOURAGEMENT}</p>
				{/if}
				<label class="field nb__field">
					<span>Tell us more.</span>
					<textarea class="input nb__text" rows="3" maxlength="8000" bind:value={composer.body}></textarea>
				</label>
				<label class="field nb__field">
					<span>What did you change next, and why?</span>
					<textarea class="input nb__text" rows="3" maxlength="2000" bind:value={composer.changeNote}></textarea>
				</label>
			{:else}
				{#if composer.mode === 'note'}
					<label class="field nb__field">
						<span>A short title.</span>
						<input class="input" type="text" maxlength="200" bind:value={composer.title} />
					</label>
				{/if}
				<label class="field nb__field">
					<span>Write it here.</span>
					<textarea class="input nb__text" rows="5" maxlength="8000" bind:value={composer.body}></textarea>
				</label>
			{/if}

			<div class="nb__photorow">
				{#if composer.evidenceId && photoById.get(composer.evidenceId)}
					{#if photoUrls[photoById.get(composer.evidenceId)!.storagePath]}
						<img class="nb__thumb" src={photoUrls[photoById.get(composer.evidenceId)!.storagePath]} alt="Chosen for this entry" />
					{/if}
					<button class="btn btn--ghost btn--small" type="button" onclick={() => { if (composer) composer.evidenceId = null; }}>
						Remove photo
					</button>
				{:else if photos.length > 0}
					<button class="btn btn--ghost btn--small" type="button" onclick={() => (pickingPhoto = !pickingPhoto)}>
						{pickingPhoto ? 'Never mind' : 'Add a photo from our season'}
					</button>
				{/if}
			</div>
			{#if pickingPhoto}
				<div class="nb__picker">
					{#each photos as p (p.id)}
						{#if photoUrls[p.storagePath]}
							<button
								class="nb__pick"
								type="button"
								onclick={() => {
									if (composer) composer.evidenceId = p.id;
									pickingPhoto = false;
								}}
							>
								<img class="nb__thumb" src={photoUrls[p.storagePath]} alt={p.caption ?? 'Team photo'} />
							</button>
						{/if}
					{/each}
				</div>
			{/if}

			<div class="nb__entryactions">
				<button class="btn btn--primary" type="button" disabled={!composerReady(composer)} onclick={saveComposer}>Save</button>
				<button class="btn btn--ghost" type="button" onclick={() => (composer = null)}>Cancel</button>
			</div>
		</div>
	{/if}

	<p class="nb__official">{OFFICIAL_DOC_NOTE} <a class="nb__officiallink" href={libraryHref}>Open the Library</a></p>
</div>

<style>
	.nb {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.nb__bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.nb__status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-2);
		font-size: var(--fs-small);
	}
	.nb__dot {
		width: 0.65rem;
		height: 0.65rem;
		border-radius: 50%;
		background: var(--success);
	}
	.nb__status[data-state='offline'] .nb__dot {
		background: var(--warning);
	}
	.nb__status[data-state='syncing'] .nb__dot {
		background: var(--link);
	}
	.nb__failed {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--danger);
		border-radius: var(--radius-control);
		color: var(--danger-text);
	}

	.nb__undo {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--boundary);
		border-radius: var(--radius-control);
		background: var(--surface-2);
	}
	.nb__undobtn {
		min-height: 2.75rem;
	}

	.nb__tabs {
		display: flex;
		gap: var(--space-2);
		overflow-x: auto;
		padding-bottom: var(--space-1);
	}
	.nb__tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-weight: var(--fw-bold);
		white-space: nowrap;
		cursor: pointer;
	}
	.nb__tab--on {
		color: var(--team-accent-ink, var(--success-text));
		background: var(--team-accent-wash, transparent);
		border-color: var(--team-accent, var(--success));
	}
	.nb__badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.4rem;
		height: 1.4rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--warning);
		color: var(--surface-0);
		font-size: var(--fs-small);
		font-weight: var(--fw-black);
	}

	.nb__section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}
	.nb__intro {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.nb__h {
		margin: 0;
		font-size: var(--fs-h2);
		color: var(--team-accent-ink, var(--text-1));
	}
	.nb__h3 {
		margin: 0;
		font-size: var(--fs-h3);
	}
	.nb__lede {
		margin: 0;
		color: var(--text-1);
	}
	.nb__judge {
		margin: 0;
		color: var(--warning);
	}
	.nb__holders {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.nb__chip {
		padding: 0.2rem var(--space-2);
		border: 1px solid var(--hairline);
		border-radius: 999px;
		color: var(--text-2);
		font-size: var(--fs-small);
	}
	.nb__readonly {
		margin: 0;
		color: var(--text-2);
	}

	.nb__block {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.nb__hint {
		margin: 0;
		color: var(--text-2);
	}
	.nb__empty {
		margin: 0;
		color: var(--text-3);
	}
	.nb__entry {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.nb__entry[data-outcome='failed'] {
		border-left: 4px solid var(--warning);
	}
	.nb__entry[data-outcome='worked'] {
		border-left: 4px solid var(--success);
	}
	.nb__entry[data-outcome='mixed'] {
		border-left: 4px solid var(--link);
	}
	.nb__entryhead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.nb__outcome {
		font-weight: var(--fw-black);
	}
	.nb__outcome[data-outcome='failed'] {
		color: var(--warning);
	}
	.nb__outcome[data-outcome='worked'] {
		color: var(--success-text);
	}
	.nb__outcome[data-outcome='mixed'] {
		color: var(--link);
	}
	.nb__byline {
		color: var(--text-3);
		font-size: var(--fs-small);
	}
	.nb__entrytitle {
		margin: 0;
		font-size: var(--fs-body);
	}
	.nb__body {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.nb__change {
		margin: 0;
		color: var(--text-2);
	}
	.nb__photo {
		max-width: 100%;
		max-height: 16rem;
		border-radius: var(--radius-control);
		object-fit: contain;
		align-self: flex-start;
	}
	.nb__entryactions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.nb__delete {
		color: var(--danger-text);
	}
	/* Student-facing slabs: a control they are meant to tap is 56px tall. */
	.nb__add {
		min-height: 3.5rem;
		align-self: stretch;
	}

	.nb__stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
		gap: var(--space-2);
	}
	.nb__stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		padding: var(--space-3);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-control);
		color: var(--text-2);
		text-align: center;
	}
	.nb__statn {
		font-family: var(--font-display);
		font-size: var(--fs-h2);
		font-weight: var(--fw-black);
		color: var(--team-accent-ink, var(--text-1));
	}

	.nb__recap {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.nb__recap--draft {
		border-color: var(--warning);
	}
	.nb__recaphead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.nb__done {
		color: var(--success-text);
		font-weight: var(--fw-black);
	}
	.nb__todo {
		color: var(--warning);
		font-weight: var(--fw-black);
	}
	.nb__facts {
		margin: 0;
		padding-left: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.nb__facts li {
		overflow-wrap: anywhere;
	}
	.nb__recapphotos {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.nb__fig {
		margin: 0;
		max-width: 12rem;
	}
	.nb__cap {
		color: var(--text-2);
		font-size: var(--fs-small);
	}
	.nb__summary {
		border-left: 3px solid var(--team-accent, var(--boundary));
		padding-left: var(--space-3);
	}

	.nb__composer {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		border-color: var(--team-accent, var(--boundary));
	}
	.nb__field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.nb__text {
		resize: vertical;
		min-height: 3.5rem;
	}
	.nb__outcomes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		border: 0;
		margin: 0;
		padding: 0;
	}
	.nb__legend {
		padding: 0;
		margin-bottom: var(--space-1);
		font-weight: var(--fw-bold);
	}
	.nb__outcomebtn {
		flex: 1 1 8rem;
		min-height: 3.5rem;
		border-radius: var(--radius-control);
		border: 2px solid var(--boundary);
		background: transparent;
		color: var(--text-1);
		font: inherit;
		font-weight: var(--fw-bold);
		cursor: pointer;
	}
	.nb__outcomebtn--on[data-outcome='worked'] {
		border-color: var(--success);
		color: var(--success-text);
	}
	.nb__outcomebtn--on[data-outcome='failed'] {
		border-color: var(--warning);
		color: var(--warning);
	}
	.nb__outcomebtn--on[data-outcome='mixed'] {
		border-color: var(--link);
		color: var(--link);
	}

	.nb__photorow {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.nb__thumb {
		width: 4.5rem;
		height: 4.5rem;
		object-fit: cover;
		border-radius: var(--radius-control);
	}
	.nb__picker {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.nb__pick {
		padding: 0;
		border: 2px solid var(--boundary);
		border-radius: var(--radius-control);
		background: transparent;
		cursor: pointer;
		min-width: 2.75rem;
		min-height: 2.75rem;
	}

	.nb__official {
		margin: 0;
		color: var(--text-3);
		font-size: var(--fs-small);
	}
	.nb__officiallink {
		color: var(--link);
	}
</style>
