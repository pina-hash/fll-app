<script lang="ts">
	import MatchTimer, { type LoggedRun } from '$lib/match/MatchTimer.svelte';
	import { safeInvalidateAll } from '$lib/student/refresh';
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
	 * SHOWN, and nothing claims to have saved that did not. EVERY part of a run
	 * is judged, the launches included: a run whose score saved but whose
	 * launches did not is a run nobody can read afterwards, because "we tried
	 * these three" is half of what a practice log is for.
	 *
	 * THE REFETCH IS `safeInvalidateAll`, NEVER `invalidateAll`. This kiosk sits
	 * in a gym at a competition. Re-running a server load over a dead connection
	 * makes SvelteKit fall back to a full document reload, which blanks the
	 * iPad in the middle of a meeting; see $lib/student/refresh.ts.
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
			// A table write, not one of this schema's RPCs, so its answer is a
			// constraint name: the board reads a sentence instead.
			message = 'That run did not save. Check this iPad is online, then log it again.';
			return;
		}
		// Two parts still to write. A failure in either is reported without
		// throwing away what did land, so the message names the half that is
		// missing rather than pretending the run is gone.
		const missing: string[] = [];
		if (run.launches.length > 0) {
			const { error: launchError } = await data.supabase.from('match_run_launches').insert(
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
			if (launchError) missing.push('which launches were tried');
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
			if (lineError) missing.push('the score');
		}
		if (missing.length > 0) {
			message = `The run saved, but not ${missing.join(' or ')}. Write it on paper and tell a mentor.`;
		}
		busy = false;
		await safeInvalidateAll();
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
		await safeInvalidateAll();
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
