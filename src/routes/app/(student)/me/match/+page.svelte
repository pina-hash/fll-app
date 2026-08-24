<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import MatchTimer, { type LoggedRun } from '$lib/match/MatchTimer.svelte';
	import { WriteQueue } from '$lib/student/queue.svelte';
	import { safeInvalidateAll } from '$lib/student/refresh';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The same queue every other student write goes through: on disk before the
	// wire, replayed until the server takes it. A run logged in a gym with no
	// signal is the case this exists for.
	const queue = untrack(
		() => new WriteQueue(data.supabase, data.student.studentId, () => void safeInvalidateAll())
	);

	onMount(() => {
		let stop: (() => void) | null = null;
		void queue.start().then((s) => (stop = s));
		return () => stop?.();
	});

	/**
	 * WHAT THIS DEVICE JUST LOGGED, on top of what the server last said. The
	 * run has to appear in the list the instant it is saved, whether or not the
	 * wifi is up, and it must not be undone by a refetch that has not caught up
	 * yet. The overlay clears itself the moment the server's own list contains
	 * the same id.
	 *
	 * The overlay's `points` is the PREVIEW total (rules.ts); the row the
	 * server sends back carries the priced one. They agree because both come
	 * from the same mission list, and the server's wins the moment it arrives.
	 */
	let justLogged = $state<
		{ id: string; started_at: string; points: number; elapsed_s: number; note: string; lines: number; launches: number }[]
	>([]);

	$effect(() => {
		const known = new Set(data.match.history.runs.map((r) => r.id));
		if (justLogged.some((r) => known.has(r.id))) {
			justLogged = justLogged.filter((r) => !known.has(r.id));
		}
	});

	let history = $derived([
		...justLogged.map((r) => ({
			id: r.id,
			started_at: r.started_at,
			elapsed_s: r.elapsed_s,
			points: r.points,
			note: r.note,
			strategy_id: data.match.strategy?.id ?? null,
			strategy_version: data.match.strategy?.version ?? null,
			strategy_label: data.match.strategy?.label ?? null,
			best_so_far: Math.max(r.points, data.match.history.best_points),
			launches_attempted: r.launches,
			lines_scored: r.lines
		})),
		...data.match.history.runs
	]);

	let bestPoints = $derived(
		Math.max(data.match.history.best_points, ...justLogged.map((r) => r.points), 0)
	);

	async function logRun(run: LoggedRun) {
		const runId = crypto.randomUUID();
		// Optimistic, using the preview total the sheet was showing.
		const points = run.lines.reduce((total, line) => {
			const mission = data.match.missions.find((m) => m.id === line.missionId);
			const scoring = mission?.scoring[line.lineIndex];
			return total + (scoring ? scoring.points * line.quantity : 0);
		}, 0);
		justLogged = [
			{
				id: runId,
				started_at: run.startedAt,
				points,
				elapsed_s: run.elapsedS,
				note: run.note,
				lines: run.lines.length,
				launches: run.launches.filter((l) => l.attempted).length
			},
			...justLogged
		];

		await queue.enqueue(
			{
				kind: 'match_run_log',
				runId,
				teamId: data.student.teamId,
				strategyId: data.match.strategy?.id ?? null,
				startedAt: run.startedAt,
				elapsedS: run.elapsedS,
				note: run.note,
				loggedByStudentId: data.student.studentId,
				loggedByMentorId: null,
				launches: run.launches,
				lines: run.lines
			},
			undefined,
			runId
		);
	}

	async function removeRun(runId: string) {
		justLogged = justLogged.filter((r) => r.id !== runId);
		await queue.enqueue({ kind: 'match_run_delete', runId });
	}
</script>

<svelte:head><title>{data.student.teamName} match timer</title></svelte:head>

<MatchTimer
	team={{ name: data.student.teamName, accent: data.student.accent }}
	missions={data.match.missions}
	planLaunches={data.match.planLaunches}
	strategy={data.match.strategy}
	{history}
	{bestPoints}
	connection={queue.connection}
	pendingCount={queue.pendingCount}
	onLog={logRun}
	onDeleteRun={removeRun}
	backHref="/app/me"
/>
