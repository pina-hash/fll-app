<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import MatchTimer, { type LoggedRun } from '$lib/match/MatchTimer.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * The board writes straight down the wire rather than through the student
	 * write queue. The queue keys everything on a signed-in student's id and
	 * holds photos in that device's IndexedDB; a kiosk shared by a table of
	 * children has no such owner, and a run queued under "the board" would
	 * replay from whatever tab happened to open next. The iPad is also the one
	 * device that is plugged in and parked next to the access point.
	 *
	 * So this path reports honestly instead: a refused or unreachable write is
	 * SHOWN, and nothing claims to have saved that did not.
	 */
	let message = $state('');
	let busy = $state(false);

	async function logRun(run: LoggedRun) {
		busy = true;
		message = '';
		const runId = crypto.randomUUID();
		const { error } = await data.supabase.from('match_runs').insert({
			id: runId,
			team_id: data.board.teamId,
			strategy_id: data.match.strategy?.id ?? null,
			started_at: run.startedAt,
			elapsed_s: run.elapsedS,
			note: run.note
		});
		if (error) {
			busy = false;
			message = `That run did not save: ${error.message}`;
			return;
		}
		if (run.launches.length > 0) {
			await data.supabase.from('match_run_launches').insert(
				run.launches.map((l) => ({
					id: l.id,
					run_id: runId,
					team_id: data.board.teamId,
					launch_id: l.launchId,
					name: l.name,
					attempted: l.attempted,
					sort_order: l.sortOrder
				}))
			);
		}
		if (run.lines.length > 0) {
			const { error: lineError } = await data.supabase.from('match_run_scores').insert(
				run.lines.map((s) => ({
					id: s.id,
					run_id: runId,
					team_id: data.board.teamId,
					mission_id: s.missionId,
					line_index: s.lineIndex,
					quantity: s.quantity
				}))
			);
			if (lineError) message = `The run saved but the score did not: ${lineError.message}`;
		}
		busy = false;
		await invalidateAll();
	}

	async function removeRun(runId: string) {
		const { data: removed, error } = await data.supabase
			.from('match_runs')
			.delete()
			.eq('id', runId)
			.select('id');
		// Zero rows back with no error is a refusal, not a success. See the
		// repo's rule: never read "it landed" off the absence of an error.
		if (error || (removed ?? []).length === 0) {
			message = 'That run was not removed.';
			return;
		}
		await invalidateAll();
	}
</script>

<svelte:head><title>{data.board.teamName} match timer</title></svelte:head>

{#if message}
	<p class="error boardmsg" role="alert">{message}</p>
{/if}

<MatchTimer
	team={{ name: data.board.teamName, accent: data.board.accent }}
	missions={data.match.missions}
	planLaunches={data.match.planLaunches}
	strategy={data.match.strategy}
	history={data.match.history.runs}
	bestPoints={data.match.history.best_points}
	connection={busy ? 'syncing' : 'online'}
	onLog={logRun}
	onDeleteRun={removeRun}
	backHref="/board"
/>

<style>
	.boardmsg {
		margin: 0;
		padding: var(--space-3);
		text-align: center;
		background: var(--surface-1);
	}
</style>
