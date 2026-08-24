<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { safeInvalidateAll } from '$lib/student/refresh';
	import { formatClock, phaseClock } from '$lib/console/clock';
	import { watchTables } from '$lib/console/live.svelte';
	import { ROLE_LABEL, TEAM_ROLES, type TeamRole } from '$lib/console/types';
	import { SessionClock } from '$lib/student/clock.svelte';
	import { WriteQueue } from '$lib/student/queue.svelte';
	import { boardEmail, isValidJoinCode, isValidPin, normalizeJoinCode } from '$lib/auth/student-identity';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// --- sign-in (once, at the start of the session) -------------------------
	let code = $state('');
	let pin = $state('');
	let busy = $state(false);
	let message = $state('');

	async function openBoard(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		if (!isValidJoinCode(code)) {
			message = 'A team code is 6 letters and numbers.';
			return;
		}
		if (!isValidPin(pin)) {
			message = 'The board PIN is 6 numbers. Ask a mentor.';
			return;
		}
		busy = true;
		const { error } = await data.supabase.auth.signInWithPassword({
			email: boardEmail(normalizeJoinCode(code)),
			password: pin
		});
		busy = false;
		if (error) {
			message = 'That code and PIN did not open a board. Ask a mentor.';
			pin = '';
			return;
		}
		await invalidate('supabase:auth');
		await safeInvalidateAll();
	}

	// --- the board itself ----------------------------------------------------
	const clock = untrack(() => new SessionClock(data.serverNow));

	onMount(() => {
		const stopClock = clock.start();
		let stopWatch: (() => void) | null = null;
		let release: (() => void) | null = null;

		if (data.board) {
			stopWatch = watchTables(
				data.supabase,
				['meetings', 'meeting_phases', 'tasks', 'blockers', 'attendance'],
				'team-board',
				() => void safeInvalidateAll()
			);
			// NEVER SLEEP INTO A LOGIN SCREEN. The screen lock is what would end
			// this session mid-meeting, so the board holds a wake lock and takes
			// it again every time the tab comes back. A browser that has no Wake
			// Lock API simply does not get this, which is the pre-existing
			// behaviour and not a regression.
			let lock: { release: () => Promise<void> } | null = null;
			const take = async () => {
				try {
					const wl = (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<never> } }).wakeLock;
					if (wl) lock = (await wl.request('screen')) as unknown as { release: () => Promise<void> };
				} catch {
					// A denied wake lock is not worth a message on a wall display.
				}
			};
			const onVisible = () => {
				if (document.visibilityState === 'visible') void take();
			};
			void take();
			document.addEventListener('visibilitychange', onVisible);
			release = () => {
				document.removeEventListener('visibilitychange', onVisible);
				void lock?.release().catch(() => {});
			};
		}

		return () => {
			stopClock();
			stopWatch?.();
			release?.();
		};
	});

	$effect(() => {
		clock.sync(data.serverNow);
	});

	// The board writes through the same queue the phones use, so a task closed
	// on the table survives the wifi dropping exactly as one closed on a phone.
	const queue = untrack(() =>
		data.board ? new WriteQueue(data.supabase, data.board.deviceId, () => void safeInvalidateAll()) : null
	);
	onMount(() => {
		if (!queue) return;
		let stop: (() => void) | null = null;
		void queue.start().then((s) => (stop = s));
		return () => stop?.();
	});

	let phase = $derived(data.meeting?.phase ?? null);
	let pclock = $derived(phaseClock(phase, clock.nowMs));
	let running = $derived(Boolean(data.meeting?.started_at && !data.meeting?.ended_at));
	let hereCount = $derived(data.roster.filter((s) => s.present).length);
	let nameOf = $derived(new Map(data.roster.map((s) => [s.id, `${s.first_name} ${s.last_initial}.`])));

	let byRole = $derived.by(() => {
		const open = data.tasks.filter((t) => t.status !== 'done');
		const groups: { role: TeamRole | null; label: string; who: string | null; tasks: typeof open }[] = [];
		for (const role of TEAM_ROLES) {
			const row = data.roles.find((r) => r.role === role);
			groups.push({
				role,
				label: ROLE_LABEL[role],
				who: row && !row.unfilled ? row.active_name : null,
				tasks: open.filter((t) => t.role === role)
			});
		}
		const loose = open.filter((t) => t.role === null);
		if (loose.length) groups.push({ role: null, label: 'Anyone', who: null, tasks: loose });
		return groups.filter((g) => g.tasks.length > 0 || g.role !== null);
	});

	async function finish(taskId: string) {
		if (!queue) return;
		await queue.enqueue({ kind: 'task_status', taskId, status: 'done' });
		await safeInvalidateAll();
	}
</script>

<svelte:head><title>{data.board ? `${data.board.teamName} board` : 'Team board'}</title></svelte:head>

{#if !data.board}
	<main class="open">
		<h1 class="open__title">Team board</h1>
		<p class="open__sub">Set this iPad up once. It stays on all session.</p>
		{#if message}<p class="error" role="alert">{message}</p>{/if}
		<form class="open__form" onsubmit={openBoard}>
			<label class="field">
				<span>Team code</span>
				<input
					class="input open__code"
					bind:value={code}
					autocomplete="off"
					autocapitalize="characters"
					maxlength="6"
					placeholder="ABC234"
				/>
			</label>
			<label class="field">
				<span>Board PIN (from a mentor)</span>
				<input class="input open__code" bind:value={pin} inputmode="numeric" maxlength="6" type="password" />
			</label>
			<button class="open__btn" type="submit" disabled={busy}>{busy ? 'Opening' : 'Open the board'}</button>
		</form>
		<p class="muted small open__hint">
			A mentor turns this on from the team page in the console, then reads you the PIN.
		</p>
	</main>
{:else}
	<main class="bd" data-accent={data.board.accent}>
		<header class="bd__head">
			<div>
				<p class="bd__team">{data.board.teamName}</p>
				<p class="bd__here">{hereCount} of {data.roster.length} here</p>
			</div>
			<div class="bd__phase">
				{#if !data.meeting || !running}
					<p class="bd__phasename">No meeting</p>
				{:else}
					<p class="bd__phasename">{phase?.name ?? 'Session'}</p>
					{#if pclock}
						<p class="bd__clock" class:bd__clock--over={pclock.overrun}>{formatClock(pclock.remainingMs)}</p>
					{/if}
				{/if}
			</div>
			<a class="bd__match" href="/board/match">Match timer</a>
		</header>

		<section class="bd__roster" aria-label="Who is here">
			{#each data.roster as person (person.id)}
				<span class="bp" class:bp--here={person.present}>{person.first_name} {person.last_initial}.</span>
			{/each}
		</section>

		<section class="bd__cols">
			{#each byRole as group (group.label)}
				<div class="bcol">
					<h2 class="bcol__head">
						{group.label}
						<span class="bcol__who">{group.who ?? 'nobody in this seat'}</span>
					</h2>
					{#if group.tasks.length === 0}
						<p class="bcol__none">All done</p>
					{:else}
						<ul class="bcol__list">
							{#each group.tasks as task (task.id)}
								<li class="btask">
									<span class="btask__title">{task.title}</span>
									{#if task.assigned_student_id}
										<span class="btask__who">{nameOf.get(task.assigned_student_id) ?? 'claimed'}</span>
									{/if}
									<button
										class="btask__done"
										disabled={task.evidence_required}
										onclick={() => finish(task.id)}
										title={task.evidence_required ? 'This one needs a photo, so finish it on a phone.' : ''}
									>
										{task.evidence_required ? 'Needs a photo' : 'Done'}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		</section>

		<footer class="bd__foot">
			<span class="bd__net" data-state={queue?.connection ?? 'online'}>
				{queue?.connection === 'offline' ? 'No wifi' : 'Saved'}{#if (queue?.pendingCount ?? 0) > 0}
					&nbsp;{queue?.pendingCount}{/if}
			</span>
			<span class="muted small">Team code {data.board.joinCode}</span>
		</footer>
	</main>
{/if}

<style>
	/* --- the one-time sign-in --------------------------------------------- */
	.open {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		padding: var(--space-5);
		text-align: center;
	}
	.open__title {
		margin: 0;
		font-size: var(--fs-hero);
		color: var(--success-text);
	}
	.open__sub {
		margin: 0;
		color: var(--text-2);
		font-size: var(--fs-h3);
	}
	.open__form {
		width: min(100%, 22rem);
		margin-top: var(--space-4);
		text-align: left;
	}
	.open__code {
		font-family: var(--font-mono);
		font-size: var(--fs-h1);
		letter-spacing: var(--track-wide);
		text-align: center;
		text-transform: uppercase;
	}
	.open__btn {
		width: 100%;
		min-height: 4rem;
		margin-top: var(--space-3);
		border-radius: var(--radius-card);
		border: none;
		background: var(--accent);
		color: var(--accent-ink);
		font-family: var(--font-display);
		font-size: var(--fs-h1);
		font-weight: var(--fw-black);
		cursor: pointer;
	}
	.open__hint {
		max-width: 24rem;
	}

	/* --- the board. LANDSCAPE IPAD ON A TABLE, read from a metre away. ----- */
	.bd {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background:
			radial-gradient(100% 60% at 50% 0%, var(--team-accent-wash), transparent 70%),
			var(--surface-0);
	}
	.bd__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.bd__team {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(2rem, 5vw, 3.25rem);
		font-weight: var(--fw-black);
		color: var(--team-accent);
		line-height: 1;
	}
	.bd__here {
		margin: var(--space-1) 0 0;
		font-size: clamp(1.1rem, 2vw, 1.6rem);
		color: var(--text-2);
	}
	.bd__phase {
		text-align: right;
	}
	.bd__phasename {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1.4rem, 3vw, 2.25rem);
		font-weight: var(--fw-bold);
	}
	.bd__clock {
		margin: 0;
		font-family: var(--font-mono);
		font-size: clamp(2.5rem, 7vw, 5rem);
		font-weight: var(--fw-bold);
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: var(--success-text);
	}
	.bd__clock--over {
		color: var(--warning);
	}

	.bd__roster {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.bp {
		padding: 0.35rem 0.9rem;
		border-radius: 999px;
		border: 2px solid var(--hairline);
		color: var(--text-3);
		font-size: clamp(1rem, 1.8vw, 1.4rem);
		font-weight: var(--fw-semibold);
	}
	.bp--here {
		border-color: var(--team-accent);
		color: var(--team-accent);
	}

	.bd__cols {
		flex: 1;
		display: grid;
		gap: var(--space-3);
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		align-content: start;
	}
	.bcol {
		padding: var(--space-3);
		border-radius: var(--radius-card);
		background: var(--surface-1);
		border: 1px solid var(--boundary);
		min-width: 0;
	}
	.bcol__head {
		margin: 0 0 var(--space-2);
		font-size: clamp(1.1rem, 1.8vw, 1.5rem);
		display: grid;
		gap: 0.1rem;
	}
	.bcol__who {
		font-size: var(--fs-small);
		font-weight: var(--fw-regular);
		color: var(--text-3);
	}
	.bcol__none {
		margin: 0;
		color: var(--text-3);
	}
	.bcol__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.btask {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-control);
		background: var(--surface-2);
		border: 1px solid var(--hairline);
	}
	.btask__title {
		font-size: clamp(1.05rem, 1.6vw, 1.35rem);
		font-weight: var(--fw-bold);
	}
	.btask__who {
		font-size: var(--fs-small);
		color: var(--text-3);
	}
	.btask__done {
		min-height: 3.5rem;
		border-radius: var(--radius-control);
		border: none;
		background: var(--success);
		color: var(--accent-ink);
		font: inherit;
		font-size: clamp(1rem, 1.6vw, 1.3rem);
		font-weight: var(--fw-black);
		cursor: pointer;
	}
	.btask__done:disabled {
		background: var(--surface-1);
		border: 2px solid var(--warning);
		color: var(--warning);
		cursor: default;
	}

	.bd__foot {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
		border-top: 1px solid var(--hairline);
		padding-top: var(--space-2);
	}
	.bd__net {
		font-weight: var(--fw-bold);
		color: var(--success-text);
	}
	.bd__net[data-state='offline'] {
		color: var(--danger-text);
	}
	.bd__net[data-state='syncing'] {
		color: var(--warning);
	}
	/* The mat is across the room from the board; this is the one link a child
	   walking past taps. Sized to be hit while holding a robot. */
	.bd__match {
		display: inline-flex;
		align-items: center;
		min-height: 3.5rem;
		padding: 0 var(--space-4);
		border-radius: var(--radius-tile);
		border: 2px solid var(--team-accent);
		color: var(--team-accent);
		text-decoration: none;
		font-family: var(--font-display);
		font-size: clamp(1rem, 2vw, 1.5rem);
		font-weight: var(--fw-black);
	}
</style>
