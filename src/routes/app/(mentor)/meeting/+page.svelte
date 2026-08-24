<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import {
		SEASON_TZ,
		formatClock,
		formatDay,
		formatTime,
		phaseClock,
		seasonInstant,
		seasonToday
	} from '$lib/console/clock';
	import { watchTables } from '$lib/console/live.svelte';
	import type { MeetingKind } from '$lib/console/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type MeetingRow = PageData['meetings'][number];
	type MeetingState = 'upcoming' | 'live' | 'ended' | 'cancelled';

	let busy = $state('');
	let message = $state('');
	let good = $state('');

	// ONE CONFIRM AT A TIME, KEYED BY WHAT IT IS ABOUT TO DO. Every second tap
	// on this screen goes through this string: 'cancel', 'reopen', 'redraft',
	// 'advance', `phase-del:<id>`. Opening one closes the last, so a mentor can
	// never be looking at two armed confirmations at once.
	let confirming = $state('');

	function arm(key: string) {
		confirming = key;
		message = '';
		good = '';
	}

	// The clock ticks locally; every mutation goes through the server and comes
	// back through invalidateAll, so the displayed times are always the
	// server's.
	let nowMs = $state(Date.now());

	onMount(() => {
		const tick = setInterval(() => (nowMs = Date.now()), 1000);
		// A phase advanced on another device has to land here too: this screen is
		// as likely to be the second tab as the first.
		const stop = watchTables(data.supabase, ['meetings', 'meeting_phases'], 'console-meeting', () => invalidateAll());
		return () => {
			clearInterval(tick);
			stop();
		};
	});

	let selected = $derived(data.selected);
	let cancelled = $derived(Boolean(selected?.cancelled_at));
	let ended = $derived(Boolean(selected?.ended_at));
	let running = $derived(Boolean(selected?.started_at && !selected?.ended_at && !selected?.cancelled_at));
	let currentPhase = $derived(data.phases.find((p) => p.id === selected?.current_phase_id) ?? null);
	let clock = $derived(
		currentPhase
			? phaseClock(
					{
						id: currentPhase.id,
						ordinal: currentPhase.ordinal,
						name: currentPhase.name,
						planned_minutes: currentPhase.planned_minutes,
						started_at: currentPhase.started_at,
						ended_at: currentPhase.ended_at
					},
					nowMs
				)
			: null
	);
	let isLastPhase = $derived(
		Boolean(currentPhase) && currentPhase!.ordinal >= Math.max(...data.phases.map((p) => p.ordinal), 0)
	);

	function kindLabel(kind: MeetingKind): string {
		return kind === 'saturday' ? 'Saturday' : 'Friday';
	}

	function stateOf(m: MeetingRow): MeetingState {
		if (m.cancelled_at) return 'cancelled';
		if (m.ended_at) return 'ended';
		if (m.started_at) return 'live';
		return 'upcoming';
	}

	function count(n: number, one: string, many: string): string {
		return `${n} ${n === 1 ? one : many}`;
	}

	// --- reading an RPC's receipt -------------------------------------------
	// The RPCs answer in jsonb, which arrives as Json. These two read one field
	// out of it without pretending to know the whole shape.
	function numberIn(payload: unknown, key: string): number {
		if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
			const value = (payload as Record<string, unknown>)[key];
			if (typeof value === 'number') return value;
		}
		return 0;
	}

	function textIn(payload: unknown, key: string): string {
		if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
			const value = (payload as Record<string, unknown>)[key];
			if (typeof value === 'string') return value;
		}
		return '';
	}

	/**
	 * Every RPC on this screen. An error from one of these is ALREADY a sentence
	 * in a mentor's own terms (the schema raises no ERRCODE and names no table),
	 * so it is shown word for word.
	 */
	async function callRpc(
		key: string,
		run: () => Promise<{ data: unknown; error: { message: string } | null }>
	): Promise<{ ok: boolean; payload: unknown }> {
		busy = key;
		message = '';
		good = '';
		const { data: payload, error } = await run();
		busy = '';
		if (error) {
			message = error.message;
			return { ok: false, payload: null };
		}
		await invalidateAll();
		return { ok: true, payload };
	}

	/**
	 * Every direct table write on this screen.
	 *
	 * AN RLS-FILTERED WRITE COMES BACK 204 WITH NO ERROR AND NO ROWS. Asking for
	 * the rows back is what tells a refusal apart from a success, and an empty
	 * array is a refusal, never a shrug. The two sentences are ours because a
	 * PostgREST error is not written for a mentor to read.
	 */
	async function write(
		key: string,
		refused: string,
		failed: string,
		run: () => Promise<{ data: unknown[] | null; error: { message: string } | null }>
	): Promise<boolean> {
		busy = key;
		message = '';
		good = '';
		const { data: rows, error } = await run();
		busy = '';
		if (error) {
			message = failed;
			return false;
		}
		if (!rows || rows.length === 0) {
			message = refused;
			return false;
		}
		await invalidateAll();
		return true;
	}

	// --- the list: filter and sort ------------------------------------------
	// Both are the browser's job: the load already handed over the whole season.
	let filter = $state<'all' | MeetingState>('all');
	let sortKey = $state<'date' | 'kind' | 'state'>('date');
	let sortDesc = $state(true);

	const STATE_ORDER: Record<MeetingState, number> = { live: 0, upcoming: 1, ended: 2, cancelled: 3 };

	let visible = $derived.by(() => {
		const rows = data.meetings.filter((m) => filter === 'all' || stateOf(m) === filter);
		const direction = sortDesc ? -1 : 1;
		return [...rows].sort((a, b) => {
			let d = 0;
			if (sortKey === 'kind') d = a.kind.localeCompare(b.kind);
			else if (sortKey === 'state') d = STATE_ORDER[stateOf(a)] - STATE_ORDER[stateOf(b)];
			if (d === 0) {
				d = a.meeting_date.localeCompare(b.meeting_date) || a.planned_start_at.localeCompare(b.planned_start_at);
			}
			return d * direction;
		});
	});

	let directionLabel = $derived(
		sortKey === 'date'
			? sortDesc
				? 'Newest first'
				: 'Oldest first'
			: sortKey === 'kind'
				? sortDesc
					? 'Saturday first'
					: 'Friday first'
				: sortDesc
					? 'Cancelled first'
					: 'Live first'
	);

	// --- the create form -----------------------------------------------------
	let kind = $state<MeetingKind>('friday');
	let date = $state(seasonToday(Date.now()));
	let startTime = $state('16:30');

	// The season's standing times; a mentor can still override before creating.
	$effect(() => {
		startTime = kind === 'saturday' ? '09:00' : '16:30';
	});

	let templateFor = $derived(data.templates.filter((t) => t.kind === kind));
	let templateMinutes = $derived(templateFor.reduce((sum, t) => sum + t.planned_minutes, 0));

	function createMeeting(event: SubmitEvent) {
		event.preventDefault();
		const startsAt = seasonInstant(date, startTime);
		if (!startsAt) {
			message = 'That date and time did not make sense.';
			return;
		}
		return callRpc('create', async () =>
			data.supabase.rpc('meeting_create', {
				p_kind: kind,
				p_meeting_date: date,
				p_planned_start_at: startsAt
			})
		);
	}

	// --- running a session ---------------------------------------------------
	function start(id: string) {
		return callRpc('start', async () => data.supabase.rpc('meeting_start', { p_meeting_id: id }));
	}

	async function advance(id: string) {
		if (confirming !== 'advance') {
			arm('advance');
			return;
		}
		confirming = '';
		await callRpc('advance', async () => data.supabase.rpc('meeting_advance_phase', { p_meeting_id: id }));
	}

	function end(id: string) {
		return callRpc('end', async () => data.supabase.rpc('meeting_end', { p_meeting_id: id }));
	}

	// --- cancel, restore, reopen --------------------------------------------
	let cancelKeeps = $derived.by(() => {
		const bits: string[] = [];
		if (data.counts.attendance > 0) {
			bits.push(
				`${count(data.counts.attendance, 'person is', 'people are')} marked present at this session`
			);
		}
		if (data.counts.tasks > 0) bits.push(`${count(data.counts.tasks, 'task', 'tasks')} belong to it`);
		if (data.counts.recaps > 0) bits.push(`${count(data.counts.recaps, 'recap', 'recaps')} were drafted from it`);
		if (bits.length === 0) return 'Nothing is attached to this session yet.';
		if (bits.length === 1) return `${bits[0]}.`;
		return `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}.`;
	});

	async function cancelMeeting(id: string) {
		if (confirming !== 'cancel') {
			arm('cancel');
			return;
		}
		confirming = '';
		const { ok, payload } = await callRpc('cancel', async () =>
			data.supabase.rpc('meeting_cancel', { p_meeting_id: id })
		);
		if (!ok) return;
		good = `Cancelled and hidden. Still here: ${count(numberIn(payload, 'attendance_kept'), 'attendance mark', 'attendance marks')}, ${count(numberIn(payload, 'tasks_kept'), 'task', 'tasks')} and ${count(numberIn(payload, 'recaps_kept'), 'recap', 'recaps')}.`;
	}

	async function restoreMeeting(id: string) {
		const { ok } = await callRpc('restore', async () => data.supabase.rpc('meeting_restore', { p_meeting_id: id }));
		if (ok) good = 'That session is back on the board.';
	}

	async function reopenMeeting(id: string) {
		if (confirming !== 'reopen') {
			arm('reopen');
			return;
		}
		confirming = '';
		const { ok, payload } = await callRpc('reopen', async () =>
			data.supabase.rpc('meeting_reopen', { p_meeting_id: id })
		);
		if (!ok) return;
		const phase = textIn(payload, 'current_phase_name');
		good = phase ? `Open again, running ${phase}.` : 'Open again.';
	}

	// --- redrafting the recaps ----------------------------------------------
	let redraftPromise = $derived(
		data.counts.confirmedRecaps > 0
			? `${count(data.counts.confirmedRecaps, 'recap is', 'recaps are')} confirmed and will be left exactly as they are.`
			: 'No recap has been confirmed yet, so every one of them is a draft and every one will be written again.'
	);

	async function redraftRecaps(id: string) {
		if (confirming !== 'redraft') {
			arm('redraft');
			return;
		}
		confirming = '';
		const { ok, payload } = await callRpc('redraft', async () =>
			data.supabase.rpc('meeting_recap_regenerate', { p_meeting_id: id })
		);
		if (!ok) return;
		good = `Drafted ${count(numberIn(payload, 'recaps_drafted'), 'recap', 'recaps')} again. Left ${count(numberIn(payload, 'confirmed_kept'), 'confirmed one', 'confirmed ones')} alone.`;
	}

	// --- editing the session --------------------------------------------------
	// A <input type="time"> wants the wall clock IN THE SEASON'S ZONE, which is
	// what the mentor typed when the session was made. Reading the instant back
	// in the browser's zone would show 7:30 to somebody on a laptop still set to
	// Eastern, and then save that as the new time.
	const FIELD_PARTS = new Intl.DateTimeFormat('en-CA', {
		timeZone: SEASON_TZ,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	});

	function seasonTimeField(iso: string | null): string {
		if (!iso) return '';
		const t = Date.parse(iso);
		if (!Number.isFinite(t)) return '';
		const parts = Object.fromEntries(FIELD_PARTS.formatToParts(t).map((p) => [p.type, p.value]));
		// Some engines print midnight as 24 under hour12: false.
		const hour = String(Number(parts.hour) % 24).padStart(2, '0');
		return `${hour}:${parts.minute}`;
	}

	let editId = $state('');
	let editDate = $state('');
	let editKind = $state<MeetingKind>('friday');
	let editStart = $state('');
	let editEnd = $state('');

	// The draft follows the selection, and nothing else: a refused save leaves
	// what the mentor typed on the screen to be fixed, not thrown away.
	$effect(() => {
		const m = data.selected;
		if (!m) return;
		if (untrack(() => editId) === m.id) return;
		editId = m.id;
		editDate = m.meeting_date;
		editKind = m.kind;
		editStart = seasonTimeField(m.planned_start_at);
		editEnd = seasonTimeField(m.planned_end_at);
	});

	// A session that has not started is entirely editable. One that has started
	// is history except for its end: a session that ran long is a real thing
	// and the planned window should be able to say so.
	let editableWindow = $derived(!cancelled);
	let editableRest = $derived(!cancelled && !selected?.started_at);
	let editNote = $derived(
		cancelled
			? 'This session is cancelled. Bring it back before changing anything about it.'
			: selected?.started_at
				? 'This session has already started, so its date, its kind and its start time are what happened. The end time can still be moved for a session that ran long.'
				: 'Nothing has happened yet, so all of it can change.'
	);

	async function saveMeeting(event: SubmitEvent) {
		event.preventDefault();
		const m = selected;
		if (!m) return;
		if (!editableWindow) {
			message = 'This session is cancelled. Bring it back first.';
			return;
		}

		const day = editableRest ? editDate : m.meeting_date;
		const startsAt = editableRest ? seasonInstant(day, editStart) : m.planned_start_at;
		const endsAt = seasonInstant(day, editEnd);
		if (!startsAt || !endsAt) {
			message = 'That date and time did not make sense.';
			return;
		}
		if (Date.parse(endsAt) <= Date.parse(startsAt)) {
			message = 'A session ends after it starts. Pick a later end time.';
			return;
		}

		const patch: {
			meeting_date?: string;
			kind?: MeetingKind;
			planned_start_at?: string;
			planned_end_at: string;
		} = editableRest
			? { meeting_date: day, kind: editKind, planned_start_at: startsAt, planned_end_at: endsAt }
			: { planned_end_at: endsAt };

		const saved = await write(
			'edit',
			'That change was refused. Only a mentor can move a session, and a signed-out tab is no longer one.',
			'That change did not save. Check the date and the two times and try again.',
			async () => {
				const res = await data.supabase.from('meetings').update(patch).eq('id', m.id).select('id');
				return { data: res.data, error: res.error };
			}
		);
		if (saved) good = 'Saved.';
	}

	// --- phases ---------------------------------------------------------------
	let editingPhase = $state('');
	let phaseName = $state('');
	let phaseMinutes = $state<number | null>(10);
	let newPhaseName = $state('');
	let newPhaseMinutes = $state<number | null>(10);

	let nextOrdinal = $derived(Math.max(0, ...data.phases.map((p) => p.ordinal)) + 1);
	let canEditPhases = $derived(Boolean(selected) && !cancelled && !ended);

	function openPhase(id: string, name: string, minutes: number) {
		editingPhase = id;
		phaseName = name;
		phaseMinutes = minutes;
		confirming = '';
		message = '';
		good = '';
	}

	function phaseFieldsOk(name: string, minutes: number | null): string {
		if (name.trim().length === 0) return 'A phase needs a name.';
		if (name.trim().length > 60) return 'A phase name fits in 60 characters.';
		if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return 'A phase needs a length in minutes.';
		if (minutes < 1 || minutes > 600) return 'A phase runs between 1 and 600 minutes.';
		return '';
	}

	async function savePhase(event: SubmitEvent) {
		event.preventDefault();
		const problem = phaseFieldsOk(phaseName, phaseMinutes);
		if (problem) {
			message = problem;
			return;
		}
		const id = editingPhase;
		const saved = await write(
			`phase:${id}`,
			'That phase was not changed. Only a mentor can edit the plan.',
			'That phase did not save. Try the name and the minutes again.',
			async () => {
				const res = await data.supabase
					.from('meeting_phases')
					.update({ name: phaseName.trim(), planned_minutes: phaseMinutes as number })
					.eq('id', id)
					.select('id');
				return { data: res.data, error: res.error };
			}
		);
		if (saved) {
			editingPhase = '';
			good = 'Phase saved.';
		}
	}

	async function addPhase(event: SubmitEvent) {
		event.preventDefault();
		const m = selected;
		if (!m) return;
		const problem = phaseFieldsOk(newPhaseName, newPhaseMinutes);
		if (problem) {
			message = problem;
			return;
		}
		// The new phase goes on the END, at the next free ordinal.
		// meeting_advance_phase asks for the next ordinal GREATER than the
		// current one, not for the one exactly after it, so a gap left by a
		// deleted phase is harmless and this never has to renumber anything.
		const added = await write(
			'phase-add',
			'That phase was not added. Only a mentor can add one.',
			'That phase did not save. Try the name and the minutes again.',
			async () => {
				const res = await data.supabase
					.from('meeting_phases')
					.insert({
						meeting_id: m.id,
						ordinal: nextOrdinal,
						name: newPhaseName.trim(),
						planned_minutes: newPhaseMinutes as number
					})
					.select('id');
				return { data: res.data, error: res.error };
			}
		);
		if (added) {
			good = `Added ${newPhaseName.trim()} at the end.`;
			newPhaseName = '';
			newPhaseMinutes = 10;
		}
	}

	async function deletePhase(id: string, name: string) {
		if (confirming !== `phase-del:${id}`) {
			arm(`phase-del:${id}`);
			return;
		}
		confirming = '';
		const removed = await write(
			`phase-del:${id}`,
			'That phase is still there. Only a mentor can remove one.',
			'That phase did not come off the plan. Try again.',
			async () => {
				const res = await data.supabase.from('meeting_phases').delete().eq('id', id).select('id');
				return { data: res.data, error: res.error };
			}
		);
		if (removed) good = `${name} is off the plan.`;
	}

	async function movePhase(id: string, direction: -1 | 1) {
		await callRpc(`phase-move:${id}`, async () =>
			data.supabase.rpc('meeting_phase_reorder', { p_phase_id: id, p_direction: direction })
		);
	}

	function neighbour(ordinal: number, direction: -1 | 1) {
		return data.phases.find((p) => p.ordinal === ordinal + direction) ?? null;
	}

	// --- building the season --------------------------------------------------
	// The club's standing times, the ones in the handbook: Friday 4:30-6:00 and
	// Saturday 9:00-11:00. They are passed to meeting_create explicitly so the
	// planned window is the real one rather than the sum of the template's
	// minutes.
	const STANDING = {
		friday: { start: '16:30', end: '18:00' },
		saturday: { start: '09:00', end: '11:00' }
	} as const;

	const DAY_MS = 86_400_000;
	const SEASON_MAX = 120;

	/**
	 * Every Friday and Saturday between two calendar dates, inclusive.
	 *
	 * The walk is UTC arithmetic on purpose and it is NOT a timezone bug: a
	 * meeting_date is a plain calendar date with no zone in it, and stepping a
	 * day at UTC midnight never crosses a daylight-saving boundary. The zone
	 * work happens later, in seasonInstant, which is the one place that knows
	 * what 16:30 in Los Angeles means.
	 */
	function seasonDates(from: string, to: string): { date: string; kind: MeetingKind }[] {
		const start = Date.parse(`${from}T00:00:00Z`);
		const end = Date.parse(`${to}T00:00:00Z`);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
		const out: { date: string; kind: MeetingKind }[] = [];
		for (let ms = start; ms <= end; ms += DAY_MS) {
			const weekday = new Date(ms).getUTCDay();
			if (weekday === 5) out.push({ date: new Date(ms).toISOString().slice(0, 10), kind: 'friday' });
			else if (weekday === 6) out.push({ date: new Date(ms).toISOString().slice(0, 10), kind: 'saturday' });
		}
		return out;
	}

	let seasonFrom = $state(seasonToday(Date.now()));
	let seasonTo = $state('');

	let seasonPlan = $derived.by(() => {
		const wanted = seasonFrom && seasonTo ? seasonDates(seasonFrom, seasonTo) : [];
		const taken = new Set(data.meetings.map((m) => m.meeting_date));
		const todo = wanted.filter((w) => !taken.has(w.date));
		return {
			wanted,
			todo,
			skipped: wanted.length - todo.length,
			fridays: wanted.filter((w) => w.kind === 'friday').length,
			saturdays: wanted.filter((w) => w.kind === 'saturday').length
		};
	});

	/**
	 * ONE RPC PER SESSION, IN ORDER, STOPPING AT THE FIRST REFUSAL. meeting_create
	 * makes one meeting and stamps its phases from the template; there is no bulk
	 * form of it, and inventing one in the browser would be a second copy of that
	 * rule. So this loops, counts, and stops the moment the database says no,
	 * with what it said. A run that stops halfway leaves the sessions it already
	 * made, which is why it reports the number rather than pretending it is all
	 * or nothing.
	 */
	async function createSeason(event: SubmitEvent) {
		event.preventDefault();
		message = '';
		good = '';
		const plan = seasonPlan;
		if (plan.wanted.length === 0) {
			message = 'Pick a first and a last date, with the last one on or after the first. There are no Fridays or Saturdays in that range.';
			return;
		}
		if (plan.todo.length > SEASON_MAX) {
			message = `That range would make ${plan.todo.length} sessions. Build the season a few months at a time.`;
			return;
		}
		if (plan.todo.length === 0) {
			good = `Every one of those ${plan.wanted.length} dates already has a session. Nothing to make.`;
			return;
		}

		busy = 'season';
		let made = 0;
		let stopped = false;
		for (const slot of plan.todo) {
			const times = STANDING[slot.kind];
			const startsAt = seasonInstant(slot.date, times.start);
			const endsAt = seasonInstant(slot.date, times.end);
			if (!startsAt || !endsAt) {
				message = `${slot.date} did not make sense as a date.`;
				stopped = true;
				break;
			}
			const { error } = await data.supabase.rpc('meeting_create', {
				p_kind: slot.kind,
				p_meeting_date: slot.date,
				p_planned_start_at: startsAt,
				p_planned_end_at: endsAt
			});
			if (error) {
				message = error.message;
				stopped = true;
				break;
			}
			made += 1;
		}
		busy = '';

		const skippedPart =
			plan.skipped > 0 ? ` Skipped ${count(plan.skipped, 'date that already had one', 'dates that already had one')}.` : '';
		good = stopped
			? `Made ${made} of ${plan.todo.length} and stopped.${skippedPart}`
			: `Made ${count(made, 'session', 'sessions')}.${skippedPart}`;
		await invalidateAll();
	}
</script>

<svelte:head><title>Meeting control</title></svelte:head>

<div class="mc">
	<aside class="mc__list card">
		<h2>Sessions</h2>

		<div class="mc__controls">
			<label class="field">
				<span>Show</span>
				<select class="input" bind:value={filter}>
					<option value="all">All sessions</option>
					<option value="upcoming">Upcoming</option>
					<option value="live">Live</option>
					<option value="ended">Ended</option>
					<option value="cancelled">Cancelled</option>
				</select>
			</label>
			<label class="field">
				<span>Sort by</span>
				<select class="input" bind:value={sortKey}>
					<option value="date">Date</option>
					<option value="kind">Friday or Saturday</option>
					<option value="state">State</option>
				</select>
			</label>
			<button class="btn btn--ghost btn--small" type="button" onclick={() => (sortDesc = !sortDesc)}>
				{directionLabel}
			</button>
		</div>

		<p class="muted small">
			{visible.length} of {count(data.meetings.length, 'session', 'sessions')}.
		</p>

		{#if visible.length === 0}
			<p class="muted">Nothing matches that filter.</p>
		{:else}
			<ul class="mlist">
				{#each visible as m (m.id)}
					<li>
						<a
							class="mlist__item"
							class:mlist__item--on={selected?.id === m.id}
							data-status={stateOf(m)}
							href="/app/meeting?meeting={m.id}"
						>
							<span class="mlist__day">{formatDay(m.meeting_date)}</span>
							<span class="muted small">
								{kindLabel(m.kind)} · {formatTime(m.planned_start_at)}
							</span>
							<span class="mlist__status">{stateOf(m)}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		<h2 class="mc__newhead">New session</h2>
		<form onsubmit={createMeeting}>
			<label class="field">
				<span>Kind</span>
				<select class="input" bind:value={kind}>
					<option value="friday">Friday</option>
					<option value="saturday">Saturday</option>
				</select>
			</label>
			<label class="field">
				<span>Date</span>
				<input class="input" type="date" bind:value={date} required />
			</label>
			<label class="field">
				<span>Starts</span>
				<input class="input" type="time" bind:value={startTime} required />
			</label>
			<p class="muted small">
				{templateFor.length} phases from the {kind} template, {templateMinutes} minutes:
				{templateFor.map((t) => `${t.name} ${t.planned_minutes}`).join(', ')}.
			</p>
			<button class="btn btn--secondary" type="submit" disabled={busy === 'create'}>Create session</button>
		</form>

		<h2 class="mc__newhead">Build the season</h2>
		<p class="muted small">
			Every Friday (4:30-6:00) and Saturday (9:00-11:00) between two dates, in one go. A date that already has a
			session is left alone.
		</p>
		<form onsubmit={createSeason}>
			<label class="field">
				<span>First date</span>
				<input class="input" type="date" bind:value={seasonFrom} required />
			</label>
			<label class="field">
				<span>Last date</span>
				<input class="input" type="date" bind:value={seasonTo} required />
			</label>
			<p class="muted small">
				{#if seasonPlan.wanted.length === 0}
					Pick both dates to see what that would make.
				{:else}
					{count(seasonPlan.fridays, 'Friday', 'Fridays')} and {count(
						seasonPlan.saturdays,
						'Saturday',
						'Saturdays'
					)} in that range. {seasonPlan.todo.length} to make, {seasonPlan.skipped} already there.
				{/if}
			</p>
			<button class="btn btn--secondary" type="submit" disabled={busy === 'season' || seasonPlan.todo.length === 0}>
				{busy === 'season' ? 'Making them...' : 'Create these sessions'}
			</button>
		</form>
	</aside>

	<section class="mc__detail">
		{#if message}
			<p class="error" role="alert">{message}</p>
		{/if}
		{#if good}
			<p class="notice" role="status">{good}</p>
		{/if}
		{#if data.loadError}
			<p class="error">{data.loadError}</p>
		{/if}

		{#if !selected}
			<div class="card"><p class="muted">Create a session to run one.</p></div>
		{:else}
			<div class="card mc__now" data-state={running ? 'running' : cancelled ? 'cancelled' : 'idle'}>
				<p class="eyebrow">{formatDay(selected.meeting_date)} · {kindLabel(selected.kind)}</p>

				{#if cancelled}
					<h1>Cancelled</h1>
					<p class="muted">
						This session is off the live board, off the team boards and off every student's phone. Nothing about it
						was deleted: {cancelKeeps}
					</p>
					<button class="btn btn--primary" disabled={busy === 'restore'} onclick={() => restoreMeeting(selected.id)}>
						Bring it back
					</button>
				{:else if !selected.started_at}
					<h1>Not started</h1>
					<p class="muted">
						Planned {formatTime(selected.planned_start_at)} to {formatTime(selected.planned_end_at)}.
					</p>
					<button class="btn btn--primary" disabled={busy === 'start'} onclick={() => start(selected.id)}>
						Start session
					</button>
				{:else if selected.ended_at}
					<h1>Ended</h1>
					<p class="muted">
						Ran {formatTime(selected.started_at)} to {formatTime(selected.ended_at)}.
					</p>
					<div class="mc__actions">
						{#if confirming === 'reopen'}
							<button class="btn btn--primary" disabled={busy === 'reopen'} onclick={() => reopenMeeting(selected.id)}>
								Yes, open it again
							</button>
							<button class="btn btn--ghost" onclick={() => (confirming = '')}>Leave it ended</button>
						{:else}
							<button class="btn btn--secondary" onclick={() => reopenMeeting(selected.id)}>Reopen session</button>
						{/if}
					</div>
					<p class="muted small">
						Reopening clears the end time and puts the last phase that ran back in charge, still running, so the
						session picks up where it stopped. The recaps that were drafted at the end are left alone.
					</p>
				{:else if currentPhase && clock}
					<h1 class="mc__phase">{currentPhase.name}</h1>
					<p class="muted small">Phase {currentPhase.ordinal} of {data.phases.length}</p>
					<p class="mc__clock" class:mc__clock--over={clock.overrun}>{formatClock(clock.remainingMs)}</p>
					<p class="muted small">
						{#if clock.overrun}
							Over by {formatClock(clock.remainingMs).slice(1)} of {currentPhase.planned_minutes} planned minutes.
							Nothing advances on its own.
						{:else}
							{currentPhase.planned_minutes} minutes planned, started {formatTime(currentPhase.started_at)}.
						{/if}
					</p>
					<div class="mc__actions">
						{#if isLastPhase}
							<button class="btn btn--primary" disabled={busy === 'end'} onclick={() => end(selected.id)}>
								End session
							</button>
							<p class="muted small">That was the last phase.</p>
						{:else if confirming === 'advance'}
							<button class="btn btn--primary" disabled={busy === 'advance'} onclick={() => advance(selected.id)}>
								Yes, move to the next phase
							</button>
							<button class="btn btn--ghost" onclick={() => (confirming = '')}>Stay here</button>
						{:else}
							<button class="btn btn--primary" onclick={() => advance(selected.id)}>Advance phase</button>
							<button class="btn btn--ghost" disabled={busy === 'end'} onclick={() => end(selected.id)}>
								End session
							</button>
						{/if}
					</div>
				{:else}
					<h1>Running</h1>
					<p class="muted">This session has no current phase.</p>
					<button class="btn btn--ghost" disabled={busy === 'end'} onclick={() => end(selected.id)}>
						End session
					</button>
				{/if}
			</div>

			{#if !cancelled}
				<div class="card">
					<h2>Cancel this session</h2>
					<p class="muted">
						{cancelKeeps} Cancelling hides it from the live board, the team boards and the students. Nothing is deleted.
					</p>
					<div class="mc__actions">
						{#if confirming === 'cancel'}
							<button class="btn btn--danger" disabled={busy === 'cancel'} onclick={() => cancelMeeting(selected.id)}>
								Yes, cancel this session
							</button>
							<button class="btn btn--ghost" onclick={() => (confirming = '')}>Keep it</button>
						{:else}
							<button class="btn btn--danger" onclick={() => cancelMeeting(selected.id)}>Cancel session</button>
						{/if}
					</div>
					<p class="muted small">
						There is no delete here, on purpose. Attendance is the register of who was in the room, and a session
						that never happened must not be able to erase one that did. Cancel hides, and bringing it back is one
						tap.
					</p>
				</div>
			{/if}

			<div class="card">
				<h2>Session details</h2>
				<p class="muted small">{editNote}</p>
				<form onsubmit={saveMeeting}>
					<div class="grid2">
						<label class="field">
							<span>Date</span>
							<input class="input" type="date" bind:value={editDate} disabled={!editableRest} required />
						</label>
						<label class="field">
							<span>Kind</span>
							<select class="input" bind:value={editKind} disabled={!editableRest}>
								<option value="friday">Friday</option>
								<option value="saturday">Saturday</option>
							</select>
						</label>
						<label class="field">
							<span>Planned start</span>
							<input class="input" type="time" bind:value={editStart} disabled={!editableRest} required />
						</label>
						<label class="field">
							<span>Planned end</span>
							<input class="input" type="time" bind:value={editEnd} disabled={!editableWindow} required />
						</label>
					</div>
					<button class="btn btn--secondary" type="submit" disabled={busy === 'edit' || !editableWindow}>
						Save details
					</button>
				</form>
			</div>

			<div class="card">
				<h2>Phases</h2>
				{#if cancelled}
					<p class="muted small">This session is cancelled, so its plan is frozen. Bring it back to change it.</p>
				{:else if ended}
					<p class="muted small">
						This session has ended, so its phases are the record of what happened. Reopen it to change the plan.
					</p>
				{/if}
				<ol class="phases">
					{#each data.phases as phase (phase.id)}
						<li
							class="phase"
							class:phase--now={phase.id === selected.current_phase_id}
							class:phase--done={Boolean(phase.ended_at)}
						>
							{#if editingPhase === phase.id}
								<form class="phase__edit" onsubmit={savePhase}>
									<label class="field">
										<span>Name</span>
										<input class="input" bind:value={phaseName} maxlength="60" required />
									</label>
									<label class="field">
										<span>Planned minutes</span>
										<input class="input" type="number" min="1" max="600" bind:value={phaseMinutes} required />
									</label>
									<div class="phase__tools">
										<button class="btn btn--secondary btn--small" type="submit" disabled={busy === `phase:${phase.id}`}>
											Save phase
										</button>
										<button class="btn btn--ghost btn--small" type="button" onclick={() => (editingPhase = '')}>
											Cancel
										</button>
									</div>
								</form>
							{:else}
								<span class="phase__name">{phase.ordinal}. {phase.name}</span>
								<span class="muted small">{phase.planned_minutes} min planned</span>
								<span class="muted small">
									{#if phase.started_at && phase.ended_at}
										{formatTime(phase.started_at)} to {formatTime(phase.ended_at)}
									{:else if phase.started_at}
										started {formatTime(phase.started_at)}
									{:else}
										not run
									{/if}
								</span>

								{#if canEditPhases}
									{#if phase.started_at}
										<span class="muted small phase__why">
											This phase has already run, so it cannot be moved or taken off the plan. Its name and its
											planned length can still be corrected.
										</span>
										<div class="phase__tools">
											<button
												class="btn btn--ghost btn--small"
												onclick={() => openPhase(phase.id, phase.name, phase.planned_minutes)}
											>
												Edit
											</button>
										</div>
									{:else if confirming === `phase-del:${phase.id}`}
										<span class="phase__why">
											Take {phase.name} off the plan? It has not run, so nothing that happened is lost, and the
											phases after it keep their order.
										</span>
										<div class="phase__tools">
											<button
												class="btn btn--danger btn--small"
												disabled={busy === `phase-del:${phase.id}`}
												onclick={() => deletePhase(phase.id, phase.name)}
											>
												Yes, remove it
											</button>
											<button class="btn btn--ghost btn--small" onclick={() => (confirming = '')}>Keep it</button>
										</div>
									{:else}
										<div class="phase__tools">
											<button
												class="btn btn--ghost btn--small"
												onclick={() => openPhase(phase.id, phase.name, phase.planned_minutes)}
											>
												Edit
											</button>
											<button
												class="btn btn--ghost btn--small"
												disabled={busy === `phase-move:${phase.id}` ||
													!neighbour(phase.ordinal, -1) ||
													Boolean(neighbour(phase.ordinal, -1)?.started_at)}
												onclick={() => movePhase(phase.id, -1)}
											>
												Move up
											</button>
											<button
												class="btn btn--ghost btn--small"
												disabled={busy === `phase-move:${phase.id}` ||
													!neighbour(phase.ordinal, 1) ||
													Boolean(neighbour(phase.ordinal, 1)?.started_at)}
												onclick={() => movePhase(phase.id, 1)}
											>
												Move down
											</button>
											<button class="btn btn--danger btn--small" onclick={() => deletePhase(phase.id, phase.name)}>
												Remove
											</button>
										</div>
									{/if}
								{/if}
							{/if}
						</li>
					{/each}
				</ol>

				{#if canEditPhases}
					<form class="phase__add" onsubmit={addPhase}>
						<h3>Add a phase</h3>
						<p class="muted small">
							It goes on the end, as phase {nextOrdinal}. Move it up from there if it belongs earlier.
						</p>
						<div class="grid2">
							<label class="field">
								<span>Name</span>
								<input class="input" bind:value={newPhaseName} maxlength="60" placeholder="Extra build time" />
							</label>
							<label class="field">
								<span>Planned minutes</span>
								<input class="input" type="number" min="1" max="600" bind:value={newPhaseMinutes} />
							</label>
						</div>
						<button class="btn btn--secondary" type="submit" disabled={busy === 'phase-add'}>Add phase</button>
					</form>
				{/if}
			</div>

			{#if ended && !cancelled}
				<div class="card">
					<h2>Recaps</h2>
					<p class="muted">
						{count(data.counts.recaps, 'recap was', 'recaps were')} drafted when this session ended, one per team.
						{redraftPromise}
					</p>
					<div class="mc__actions">
						{#if confirming === 'redraft'}
							<button class="btn btn--danger" disabled={busy === 'redraft'} onclick={() => redraftRecaps(selected.id)}>
								Yes, draft them again
							</button>
							<button class="btn btn--ghost" onclick={() => (confirming = '')}>Leave them</button>
						{:else}
							<button class="btn btn--secondary" onclick={() => redraftRecaps(selected.id)}>Redraft the recaps</button>
						{/if}
					</div>
					<p class="muted small">
						Redrafting reads what the session actually did and writes the unconfirmed drafts again. A recap a team has
						confirmed is their own word and is never overwritten.
					</p>
				</div>
			{/if}
		{/if}
	</section>
</div>

<style>
	.mc {
		display: grid;
		gap: var(--space-4);
	}
	.mc__newhead {
		margin-top: var(--space-5);
	}
	.mc__controls {
		display: grid;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.mlist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.mlist__item {
		display: grid;
		gap: 0.125rem;
		min-height: 2.75rem;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-2);
		color: var(--text-1);
		text-decoration: none;
	}
	.mlist__item--on {
		border-color: var(--boundary);
		background: var(--surface-1);
	}
	.mlist__day {
		font-weight: var(--fw-bold);
	}
	.mlist__status {
		font-size: var(--fs-label);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-3);
	}
	.mlist__item[data-status='live'] {
		border-color: var(--success);
	}
	.mlist__item[data-status='live'] .mlist__status {
		color: var(--success-text);
	}
	/* A cancelled session is still on the list, and has to be unmistakable at a
	   glance: a struck-through day and a dashed edge, so a mentor scanning for
	   "the Friday one" cannot pick it up by accident. */
	.mlist__item[data-status='cancelled'] {
		border-style: dashed;
	}
	.mlist__item[data-status='cancelled'] .mlist__day {
		text-decoration: line-through;
		color: var(--text-3);
	}
	.mlist__item[data-status='cancelled'] .mlist__status {
		color: var(--danger-text);
	}

	.mc__detail {
		display: grid;
		gap: var(--space-4);
		align-content: start;
	}
	.mc__now[data-state='running'] {
		border-color: var(--success);
	}
	.mc__now[data-state='cancelled'] {
		border-style: dashed;
	}
	.mc__phase {
		margin-bottom: 0;
	}
	.mc__clock {
		font-family: var(--font-mono);
		font-size: var(--fs-hero);
		font-weight: var(--fw-bold);
		font-variant-numeric: tabular-nums;
		color: var(--success-text);
		margin: var(--space-2) 0;
		line-height: 1;
	}
	.mc__clock--over {
		color: var(--warning);
	}
	.mc__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}

	.grid2 {
		display: grid;
		gap: 0 var(--space-3);
	}

	.phases {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.phase {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: baseline;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--hairline);
		background: var(--surface-2);
	}
	.phase__name {
		font-weight: var(--fw-bold);
		flex: 1 1 10rem;
	}
	.phase--now {
		border-color: var(--success);
	}
	.phase--now .phase__name {
		color: var(--success-text);
	}
	.phase--done .phase__name {
		color: var(--text-3);
	}
	.phase__why {
		flex: 1 1 100%;
	}
	.phase__tools {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		flex: 1 1 100%;
	}
	.phase__edit {
		flex: 1 1 100%;
	}
	.phase__add {
		margin-top: var(--space-4);
	}

	/* Desktop-first master-detail; the single column above is the phone
	   fallback, which still has to be correct. */
	@media (min-width: 60rem) {
		.mc {
			grid-template-columns: 22rem minmax(0, 1fr);
			align-items: start;
		}
		.grid2 {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.phase__tools {
			flex: 0 0 auto;
		}
	}
</style>
