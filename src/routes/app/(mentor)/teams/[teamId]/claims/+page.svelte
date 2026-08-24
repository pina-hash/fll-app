<script lang="ts">
	/**
	 * SEAT CODES: the console's half of the card a child redeems at /login.
	 *
	 * A SEAT IS A CARD NOW. The join window it replaced was a state a mentor
	 * turned on and the whole room typed itself in through; a seat card is a
	 * THING, which means it can be handed to one child, printed, taken back and
	 * replaced. This screen is the three verbs that follow from that: hand some
	 * out, take one back, replace one.
	 *
	 * THE NUMBERS ARE THE SERVER'S. "Seats left" is the cap minus the roster
	 * minus the cards nobody has spent, and a seat's STATE is a case over two
	 * timestamps. Both live in SQL (0019) and arrive through the load. Nothing
	 * here recounts either: a console that offered a seventh card would be
	 * refused at the login screen with the mentor watching.
	 *
	 * WHAT WAS JUST MINTED IS MARKED, ON SCREEN AND ON PAPER. A mentor issues
	 * three codes in order to print exactly those three and hand them out, so
	 * the run of codes this tab just created is remembered and the sheet can be
	 * narrowed to it. It is per tab and per team, like the PIN register: a
	 * reload forgets it, which is honest, because the codes are still listed.
	 *
	 * VOIDING AND REISSUING BOTH KILL A PRINTED CARD, so both are two taps and
	 * the second tap names the code it takes with it.
	 */
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import FirstName from '$lib/brand/FirstName.svelte';
	import { SEASON } from '$lib/brand/rules';
	import { formatDay, formatTime } from '$lib/console/clock';
	import { watchTables } from '$lib/console/live.svelte';
	import TeamName from '$lib/team/TeamName.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** The load's own row type, taken from it rather than restated here. */
	type Claim = PageData['claims'][number];
	type ClaimState = Claim['state'];
	type SortKey = 'state' | 'code' | 'time';
	type Filter = 'all' | ClaimState;

	const FILTERS: readonly { value: Filter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'open', label: 'Open' },
		{ value: 'claimed', label: 'Claimed' },
		{ value: 'voided', label: 'Voided' }
	];

	const STATE_LABEL: Record<ClaimState, string> = {
		open: 'Open',
		claimed: 'Claimed',
		voided: 'Voided'
	};
	// Open first: the cards a mentor can still act on are the ones they came for.
	const STATE_ORDER: Record<ClaimState, number> = { open: 0, claimed: 1, voided: 2 };

	let busy = $state('');
	let message = $state('');
	let good = $state('');
	let count = $state<number | null>(1);
	let justIssued = $state<string[]>([]);
	let printScope = $state<'all' | 'new'>('all');
	let confirmVoid = $state<string | null>(null);
	let confirmReissue = $state<string | null>(null);
	let filter = $state<Filter>('all');
	let sortKey = $state<SortKey>('time');
	let sortDir = $state<'asc' | 'desc'>('desc');

	/**
	 * A CHILD SPENDING A CARD IS A ROW ON `students`. The mentor stands at the
	 * front and watches the seats fill, so a realtime event schedules a REFETCH
	 * of this load rather than patching a row here: the seat counts and the
	 * state of every code are rules that live in SQL.
	 */
	onMount(() =>
		watchTables(data.supabase, ['students', 'teams'], `console-claims-${data.team.id}`, () =>
			void invalidateAll()
		)
	);

	// The rail switches team under this page without remounting it, so
	// everything that is about ONE team is dropped when the team changes.
	let teamId = $derived(data.team.id);
	$effect(() => {
		if (teamId) {
			justIssued = [];
			printScope = 'all';
			message = '';
			good = '';
			confirmVoid = null;
			confirmReissue = null;
		}
	});

	let seatsKnown = $derived(data.rosterState !== null);
	let seatsLeft = $derived(data.rosterState?.seats_left ?? 0);
	let sizeCap = $derived(data.rosterState?.size_cap ?? 0);
	let rosterSize = $derived(data.rosterState?.roster_size ?? 0);
	let claimsOpen = $derived(data.rosterState?.claims_open ?? 0);
	let wanted = $derived(Math.min(Math.max(1, Math.floor(count ?? 1)), Math.max(1, seatsLeft)));

	const isNew = (id: string) => justIssued.includes(id);

	let counts = $derived({
		all: data.claims.length,
		open: data.claims.filter((c) => c.state === 'open').length,
		claimed: data.claims.filter((c) => c.state === 'claimed').length,
		voided: data.claims.filter((c) => c.state === 'voided').length
	});

	/** The latest thing that happened to a seat, which is what "time" sorts on. */
	function eventAt(row: Claim): number {
		const iso = row.voided_at ?? row.claimed_at ?? row.created_at;
		const t = iso ? Date.parse(iso) : NaN;
		return Number.isFinite(t) ? t : 0;
	}

	function eventLabel(row: Claim): string {
		const iso = row.voided_at ?? row.claimed_at ?? row.created_at;
		if (!iso) return '';
		const verb = row.state === 'voided' ? 'Voided' : row.state === 'claimed' ? 'Taken' : 'Made';
		return `${verb} ${formatDay(iso)}, ${formatTime(iso)}`;
	}

	function whoLabel(row: Claim): string {
		if (row.state !== 'claimed') return '';
		if (!row.first_name) return 'Someone on this team';
		return `${row.first_name}${row.last_initial ? ` ${row.last_initial}.` : ''}`;
	}

	let shown = $derived.by(() => {
		const rows = data.claims.filter((c) => filter === 'all' || c.state === filter);
		const dir = sortDir === 'asc' ? 1 : -1;
		return rows.slice().sort((a, b) => {
			let n = 0;
			if (sortKey === 'code') n = a.code.localeCompare(b.code);
			else if (sortKey === 'state') n = STATE_ORDER[a.state] - STATE_ORDER[b.state];
			else n = eventAt(a) - eventAt(b);
			// A stable tie-break, so two seats never swap places between renders.
			return n !== 0 ? n * dir : a.code.localeCompare(b.code);
		});
	});

	let openClaims = $derived(
		data.claims.filter((c) => c.state === 'open').sort((a, b) => eventAt(b) - eventAt(a))
	);
	let sheet = $derived(
		printScope === 'new' ? openClaims.filter((c) => justIssued.includes(c.claim_id)) : openClaims
	);

	function sortBy(key: SortKey) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
			return;
		}
		sortKey = key;
		// Newest first reads as "what just happened"; the other two read as a list.
		sortDir = key === 'time' ? 'desc' : 'asc';
	}
	const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
		sortKey !== key ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';
	const sortMark = (key: SortKey) => (sortKey !== key ? '' : sortDir === 'asc' ? ' ↑' : ' ↓');

	// --- reading what an RPC handed back ------------------------------------
	function obj(v: unknown): Record<string, unknown> | null {
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	}
	function idAt(payload: unknown, key: string): string | null {
		const o = obj(payload);
		const v = o?.[key];
		return typeof v === 'string' && v.length > 0 ? v : null;
	}
	function issuedIds(payload: unknown): string[] {
		const o = obj(payload);
		const rows = o && Array.isArray(o.codes) ? o.codes : [];
		return rows
			.map((row) => idAt(row, 'claim_id'))
			.filter((id): id is string => id !== null);
	}

	/**
	 * ONE WAY IN AND OUT OF EVERY RPC. An error from this schema is already a
	 * sentence in the mentor's own terms, so it is shown VERBATIM and nothing
	 * is written over it. A call that comes back with no error and nothing in
	 * it is a refusal too, not a success: "no error" is not "it landed".
	 */
	async function call(key: string, run: () => Promise<{ data: unknown; error: { message: string } | null }>) {
		busy = key;
		message = '';
		good = '';
		const { data: payload, error } = await run();
		busy = '';
		if (error) {
			message = error.message;
			return null;
		}
		if (payload === null || payload === undefined) {
			message = 'The seat codes did not change. Reload the page and try again.';
			return null;
		}
		return payload;
	}

	async function issue(event: SubmitEvent) {
		event.preventDefault();
		const n = wanted;
		const payload = await call('issue', async () =>
			data.supabase.rpc('team_claim_codes_issue', { p_team_id: data.team.id, p_count: n })
		);
		if (payload === null) return;
		const ids = issuedIds(payload);
		if (ids.length === 0) {
			message = 'No seat codes were made. Reload the page and try again.';
			return;
		}
		justIssued = [...justIssued, ...ids];
		printScope = 'new';
		count = 1;
		good =
			ids.length === 1
				? '1 new seat code. It is marked below and on the card sheet: print it and hand it to one child.'
				: `${ids.length} new seat codes. They are marked below and on the card sheet: print them and hand one to each child.`;
		await invalidateAll();
	}

	async function voidCode(row: Claim) {
		if (confirmVoid !== row.claim_id) {
			confirmVoid = row.claim_id;
			confirmReissue = null;
			return;
		}
		confirmVoid = null;
		const payload = await call(`void:${row.claim_id}`, async () =>
			data.supabase.rpc('team_claim_code_void', { p_claim_id: row.claim_id })
		);
		if (payload === null) return;
		if (!idAt(payload, 'claim_id')) {
			message = `${row.code} was not voided. Reload the page and try again.`;
			return;
		}
		justIssued = justIssued.filter((id) => id !== row.claim_id);
		good = `${row.code} is dead. That card no longer works and the seat is back.`;
		await invalidateAll();
	}

	async function reissue(row: Claim) {
		if (confirmReissue !== row.claim_id) {
			confirmReissue = row.claim_id;
			confirmVoid = null;
			return;
		}
		confirmReissue = null;
		const payload = await call(`reissue:${row.claim_id}`, async () =>
			data.supabase.rpc('team_claim_code_reissue', { p_claim_id: row.claim_id })
		);
		if (payload === null) return;
		const minted = idAt(payload, 'claim_id');
		if (!minted) {
			message = `${row.code} was not replaced. Reload the page and try again.`;
			return;
		}
		justIssued = [...justIssued.filter((id) => id !== row.claim_id), minted];
		printScope = 'new';
		good = `${row.code} is dead and a new code has taken its place. It is marked below: print it and swap the card.`;
		await invalidateAll();
	}
</script>

<svelte:head><title>{data.team.name} seat codes</title></svelte:head>

<div class="seats" data-accent={data.team.accent}>
	{#if message}
		<p class="error noprint" role="alert">{message}</p>
	{/if}
	{#if good}
		<p class="notice noprint" role="status">{good}</p>
	{/if}
	{#if data.claimsError}
		<p class="error noprint" role="alert">{data.claimsError}</p>
	{/if}

	<section class="card noprint">
		<h1>Seat codes</h1>
		<p class="muted">
			A seat code is a one-time card. A child types it at
			<span class="url">{data.loginAddress}</span>, types their name and picks a PIN, and they are on
			{data.team.name}. A code is spent the moment it is used. It is not a PIN: it lets one child take
			one seat, once, and it is worth nothing afterwards.
		</p>

		{#if seatsKnown}
			<p class="muted small">
				{rosterSize} of {sizeCap} seats are filled, {claimsOpen} more are spoken for by cards nobody has
				spent yet, so {seatsLeft} {seatsLeft === 1 ? 'is' : 'are'} left.
			</p>
		{:else}
			<p class="muted small">The seat count for this team could not be read, so no new codes can be made here.</p>
		{/if}

		{#if seatsKnown && seatsLeft > 0}
			<form class="seats__issue" onsubmit={issue}>
				<label class="field seats__count">
					<span>Hand out how many seats</span>
					<input
						class="input"
						type="number"
						inputmode="numeric"
						min="1"
						max={seatsLeft}
						bind:value={count}
						disabled={busy === 'issue'}
					/>
				</label>
				<button class="btn btn--primary" type="submit" disabled={busy === 'issue'}>
					Make {wanted} seat code{wanted === 1 ? '' : 's'}
				</button>
			</form>
			<p class="muted small">
				{seatsLeft} is the most this team can take: six students per team, and a card nobody has spent
				holds a seat the same way a student does.
			</p>
		{:else if seatsKnown}
			<p class="seats__full">
				{data.team.name} has no seats left. {rosterSize} of {sizeCap} are filled and {claimsOpen}
				{claimsOpen === 1 ? 'card is' : 'cards are'} out there unspent. Void a card you have not handed out, or
				deactivate a student on the team page, and the seat comes back here.
			</p>
		{/if}

		<p class="muted small">
			<a href="/app/teams/{data.team.id}">Back to team</a> ·
			<a href="/app/teams/{data.team.id}/card">Roster card</a> ·
			<a href="/app/teams/{data.team.id}/parents">Parent cards</a>
		</p>
	</section>

	<section class="card noprint">
		<h2>Every seat on this team</h2>

		<div class="seats__bar">
			<div class="chips" role="group" aria-label="Show which seats">
				{#each FILTERS as f (f.value)}
					<button
						type="button"
						class="btn btn--small"
						class:btn--secondary={filter === f.value}
						class:btn--ghost={filter !== f.value}
						aria-pressed={filter === f.value}
						onclick={() => (filter = f.value)}
					>
						{f.label} ({counts[f.value]})
					</button>
				{/each}
			</div>
		</div>

		<div class="tablewrap">
			<table class="table">
				<thead>
					<tr>
						<th scope="col" aria-sort={ariaSort('code')}>
							<button type="button" class="sortbtn" onclick={() => sortBy('code')}>
								Seat code<span aria-hidden="true">{sortMark('code')}</span>
							</button>
						</th>
						<th scope="col" aria-sort={ariaSort('state')}>
							<button type="button" class="sortbtn" onclick={() => sortBy('state')}>
								State<span aria-hidden="true">{sortMark('state')}</span>
							</button>
						</th>
						<th scope="col" aria-sort={ariaSort('time')}>
							<button type="button" class="sortbtn" onclick={() => sortBy('time')}>
								When<span aria-hidden="true">{sortMark('time')}</span>
							</button>
						</th>
						<th scope="col">Who took it</th>
						<th scope="col">Card</th>
					</tr>
				</thead>
				<tbody>
					{#each shown as row (row.claim_id)}
						<tr class:row--off={row.state !== 'open'} class:row--new={isNew(row.claim_id)}>
							<th scope="row">
								<span class="seatcode" class:seatcode--dead={row.state === 'voided'}>{row.code}</span>
								{#if isNew(row.claim_id)}<span class="tag">New</span>{/if}
							</th>
							<td><span class="state state--{row.state}">{STATE_LABEL[row.state]}</span></td>
							<td class="small">{eventLabel(row)}</td>
							<td>{whoLabel(row)}</td>
							<td class="rowacts">
								{#if row.state === 'open'}
									<button
										type="button"
										class="btn btn--small btn--danger"
										disabled={busy !== ''}
										onclick={() => voidCode(row)}
									>
										Void
									</button>
									<button
										type="button"
										class="btn btn--small btn--ghost"
										disabled={busy !== ''}
										onclick={() => reissue(row)}
									>
										Reissue
									</button>
								{:else if row.state === 'voided'}
									<button
										type="button"
										class="btn btn--small btn--ghost"
										disabled={busy !== ''}
										onclick={() => reissue(row)}
									>
										Reissue
									</button>
								{:else}
									<span class="muted small">Seat taken.</span>
								{/if}
							</td>
						</tr>
						{#if confirmVoid === row.claim_id}
							<tr class="confirmrow">
								<td colspan="5">
									<p class="confirm__q">
										Void {row.code}? The card with {row.code} printed on it stops working the moment you tap
										yes. Nobody can spend it, and the seat comes back to {data.team.name}. If that card is
										already in a child's hand, they will need a new one.
									</p>
									<div class="confirm__acts">
										<button
											type="button"
											class="btn btn--small btn--danger"
											disabled={busy !== ''}
											onclick={() => voidCode(row)}
										>
											Yes, void {row.code}
										</button>
										<button type="button" class="btn btn--small btn--ghost" onclick={() => (confirmVoid = null)}>
											Keep {row.code}
										</button>
									</div>
								</td>
							</tr>
						{/if}
						{#if confirmReissue === row.claim_id}
							<tr class="confirmrow">
								<td colspan="5">
									<p class="confirm__q">
										{#if row.state === 'voided'}
											{row.code} is already dead. Reissuing puts a brand new code in its place for the same
											seat, and you print and hand out that one.
										{:else}
											Replace {row.code}? {row.code} stops working the moment you tap yes and a brand new code
											takes its place. The card you printed with {row.code} on it is rubbish from then on:
											print the new one and swap it.
										{/if}
									</p>
									<div class="confirm__acts">
										<button
											type="button"
											class="btn btn--small btn--secondary"
											disabled={busy !== ''}
											onclick={() => reissue(row)}
										>
											Yes, replace {row.code}
										</button>
										<button
											type="button"
											class="btn btn--small btn--ghost"
											onclick={() => (confirmReissue = null)}
										>
											Keep {row.code}
										</button>
									</div>
								</td>
							</tr>
						{/if}
					{:else}
						<tr>
							<td colspan="5" class="muted">
								{#if data.claims.length === 0}
									No seat codes for this team yet. Make some above.
								{:else}
									No {filter} seat codes. Try "All".
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="card noprint">
		<h2>Cards to cut up</h2>
		<p class="muted">
			One card per open seat, below. Print the sheet, cut along the dashed lines, and hand one card to each
			child. A claimed or voided code is not on the sheet: there is nothing left to hand out.
		</p>
		<div class="seats__bar">
			<button class="btn btn--primary" onclick={() => window.print()} disabled={sheet.length === 0}>
				Print {sheet.length} card{sheet.length === 1 ? '' : 's'}
			</button>
			{#if justIssued.length > 0}
				<div class="chips" role="group" aria-label="Which cards to print">
					<button
						type="button"
						class="btn btn--small"
						class:btn--secondary={printScope === 'new'}
						class:btn--ghost={printScope !== 'new'}
						aria-pressed={printScope === 'new'}
						onclick={() => (printScope = 'new')}
					>
						Just the new ones
					</button>
					<button
						type="button"
						class="btn btn--small"
						class:btn--secondary={printScope === 'all'}
						class:btn--ghost={printScope !== 'all'}
						aria-pressed={printScope === 'all'}
						onclick={() => (printScope = 'all')}
					>
						All {openClaims.length} open seat{openClaims.length === 1 ? '' : 's'}
					</button>
				</div>
			{/if}
		</div>
		<p class="muted small">
			The sheet shows exactly what will print, and the page footer prints with it.
		</p>
	</section>

	<div class="sheet">
		{#each sheet as row (row.claim_id)}
			<article class="seatcard" class:seatcard--new={isNew(row.claim_id)}>
				<p class="seatcard__eyebrow">Bosco Tech &middot; <FirstName name="season" /> &middot; {SEASON.years}</p>
				<div class="seatcard__team">
					<TeamName name={data.team.name} shortName={data.team.short_name} />
				</div>
				{#if isNew(row.claim_id)}<p class="tag tag--card noprint">New</p>{/if}

				<p class="seatcard__label">Your seat code</p>
				<p class="seatcard__code">{row.code}</p>

				<ol class="seatcard__steps">
					<li>Open <span class="url">{data.loginAddress}</span></li>
					<li>Type this code.</li>
					<li>Type your name.</li>
					<li>Pick a PIN. It is 6 numbers. Pick one you will remember.</li>
				</ol>
				<p class="seatcard__note">This card works one time, for one person. Keep it until you are signed in.</p>
			</article>
		{:else}
			<p class="muted noprint">
				{#if openClaims.length === 0}
					No open seats, so there is nothing to print. Make a seat code above.
				{:else}
					Nothing new to print. Switch to "All {openClaims.length} open seats" to print the rest.
				{/if}
			</p>
		{/each}
	</div>
</div>

<style>
	/* The one column is minmax(0, 1fr) and not `auto`: the seat table below is
	   deliberately wider than a phone and scrolls inside its own wrapper, and a
	   content-sized track would hand that width to the whole page instead. */
	.seats {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		min-width: 0;
	}
	.seats__issue {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--space-3);
		margin: var(--space-3) 0 var(--space-2);
	}
	.seats__count {
		margin-bottom: 0;
		max-width: 11rem;
	}
	.seats__full {
		margin: var(--space-3) 0;
		padding: var(--space-3);
		border: 1px solid var(--boundary);
		border-left: 4px solid var(--warning);
		border-radius: var(--radius-control);
		background: var(--surface-2);
		color: var(--text-1);
	}
	.seats__bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin: var(--space-3) 0;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.url {
		font-family: var(--font-mono);
		overflow-wrap: anywhere;
	}

	/* --- the list ---------------------------------------------------------- */
	/* A deliberately wide table scrolls inside its own wrapper; the page never
	   scrolls sideways at 375px. */
	.tablewrap {
		overflow-x: auto;
	}
	.table {
		width: 100%;
		border-collapse: collapse;
		min-width: 44rem;
	}
	.table th,
	.table td {
		text-align: left;
		padding: var(--space-2);
		border-bottom: 1px solid var(--hairline);
		vertical-align: middle;
	}
	.table thead th {
		padding: 0 0 var(--space-1);
	}
	.row--off th,
	.row--off td {
		color: var(--text-3);
	}
	.row--new th,
	.row--new td {
		background: var(--team-accent-wash);
	}
	.row--new th {
		box-shadow: inset 4px 0 0 var(--team-accent);
	}

	/* A sort control is a desktop affordance in a dense header row, so it takes
	   the same deal .btn--small takes: full 44px back under a finger. */
	.sortbtn {
		display: inline-flex;
		align-items: center;
		min-height: 2.25rem;
		padding: 0 var(--space-2);
		margin-left: calc(var(--space-2) * -1);
		border: 0;
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--text-3);
		font: inherit;
		font-size: var(--fs-label);
		font-weight: var(--fw-bold);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		cursor: pointer;
	}
	.sortbtn:hover {
		color: var(--text-1);
	}
	@media (pointer: coarse) {
		.sortbtn {
			min-height: 2.75rem;
		}
	}

	.seatcode {
		font-family: var(--font-mono);
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
		letter-spacing: var(--track-wide);
	}
	.seatcode--dead {
		text-decoration: line-through;
	}
	.tag {
		display: inline-block;
		margin: 0 0 0 var(--space-2);
		padding: 0.1rem var(--space-2);
		border-radius: var(--radius-control);
		background: var(--team-accent);
		color: var(--team-accent-ink);
		font-size: var(--fs-label);
		font-weight: var(--fw-bold);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
	}
	.tag--card {
		justify-self: start;
		margin: 0 0 var(--space-2);
	}
	.state {
		font-weight: var(--fw-bold);
	}
	.state--open {
		color: var(--text-1);
	}
	.state--claimed {
		color: var(--success-text);
	}
	.state--voided {
		color: var(--text-3);
		font-weight: var(--fw-regular);
	}
	.rowacts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.confirmrow td {
		background: var(--surface-2);
	}
	.confirm__q {
		margin: 0 0 var(--space-2);
		max-width: 46rem;
	}
	.confirm__acts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	/* --- the cards --------------------------------------------------------- */
	.sheet {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
		gap: var(--space-3);
	}
	.seatcard {
		display: grid;
		align-content: start;
		gap: var(--space-1);
		padding: var(--space-4);
		border: 2px dashed var(--boundary);
		border-radius: var(--radius-card);
		background: var(--surface-0);
		min-width: 0;
		break-inside: avoid;
	}
	.seatcard--new {
		border-style: solid;
		border-color: var(--team-accent);
	}
	.seatcard__eyebrow {
		margin: 0;
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.seatcard__team {
		font-family: var(--font-display);
		font-size: var(--fs-h2);
		line-height: var(--lh-tight);
		color: var(--team-accent);
		margin-bottom: var(--space-2);
	}
	.seatcard__label {
		margin: 0;
		font-size: var(--fs-label);
		font-weight: var(--fw-bold);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.seatcard__code {
		margin: 0 0 var(--space-2);
		font-family: var(--font-mono);
		font-size: var(--fs-h1);
		font-weight: var(--fw-bold);
		letter-spacing: var(--track-wide);
		color: var(--team-accent);
		overflow-wrap: anywhere;
	}
	.seatcard__steps {
		margin: 0 0 var(--space-2);
		padding-left: 1.2em;
		display: grid;
		gap: var(--space-1);
	}
	.seatcard__steps li {
		overflow-wrap: anywhere;
	}
	.seatcard__note {
		margin: 0;
		font-size: var(--fs-small);
		color: var(--text-2);
	}

	/* PAPER. The console chrome and every control go; the sheet and the brand
	   footer under it stay, because the footer is where this surface carries
	   the trademark attribution and the marks. Colours stay tokens: the ground
	   is already the brand's white and the ink is already FIRST black. */
	@media print {
		:global(.shell__bar),
		:global(.shell__nav),
		:global(.prov__rail),
		.noprint {
			display: none !important;
		}
		:global(.shell__main) {
			padding: 0;
			max-width: none;
		}
		:global(.prov) {
			display: block;
		}
		.seats {
			gap: 0;
		}
		.sheet {
			grid-template-columns: 1fr 1fr;
			gap: var(--space-2);
		}
		.seatcard {
			border: 2px dashed var(--boundary);
			border-radius: 0;
			padding: var(--space-3);
			background: var(--surface-0);
			color: var(--text-1);
		}
		.seatcard__team,
		.seatcard__code {
			color: var(--text-1);
		}
	}
</style>
