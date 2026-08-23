<script lang="ts">
	/**
	 * Fixtures for the real RoutePlanner component. Mission positions here are
	 * HARNESS FIXTURES ONLY, spread across the mat so dragging and clearance
	 * are exercisable; the real positions come from the rulebook, entered by a
	 * mentor, and live in the missions table.
	 *
	 * The persist log at the bottom is the harness's reason to exist: every op
	 * the component would have queued is appended there, so a tap on the mat
	 * observably becomes a `planner_insert waypoints` line. That is the
	 * sentinel round trip.
	 */
	import RoutePlanner from '$lib/planner/RoutePlanner.svelte';
	import type { PlannerOp } from '$lib/planner/ops';
	import type { MissionMarker, StrategyModel } from '$lib/planner/types';
	import type { ConnectionState } from '$lib/student/queue.svelte';

	type Scenario = 'captain' | 'viewer' | 'mentor' | 'empty';
	let scenario = $state<Scenario>('captain');
	let connection = $state<ConnectionState>('online');
	let log = $state<string[]>([]);

	function record(op: PlannerOp) {
		const detail =
			op.kind === 'planner_insert' || op.kind === 'planner_update' || op.kind === 'planner_delete'
				? `${op.kind} ${op.table}`
				: op.kind;
		log = [...log, `${log.length + 1}. ${detail}`];
	}

	const M = (
		code: string,
		name: string,
		pointsLabel: string,
		scoring: { label: string; points: number; bonus?: boolean }[],
		sortOrder: number,
		xMm: number | null,
		yMm: number | null
	): MissionMarker => ({ id: `fixture-${code}`, code, name, pointsLabel, scoring, sortOrder, xMm, yMm });

	// The real 15 codes and names; positions are fixtures (see the header).
	const MISSIONS: MissionMarker[] = [
		M('M01', 'Drone Survey', '20 + 10 bonus', [{ label: 'Drone is off the mat', points: 20 }, { label: 'Bonus: LiDAR map flipped AND scan marker in the survey area', points: 10, bonus: true }], 1, 420, 980),
		M('M02', 'Exploding Seeds', '10 each seed', [{ label: 'Each seed off the stalk', points: 10 }], 2, 760, 860),
		M('M03', 'Flip the Rock', '20 + 10 bonus', [{ label: 'Research flag is down', points: 20 }, { label: 'Bonus: rock returned to the start area', points: 10, bonus: true }], 3, 1080, 1010),
		M('M04', 'Lucky Leaves', '10, or 30 with the bonus', [{ label: 'One leaf removed', points: 10 }, { label: 'Bonus: second leaf removed AND katydid still in its original position', points: 20, bonus: true }], 4, 1420, 900),
		M('M05', 'Reaching Roots', '10 or 20', [{ label: 'Plant root partially extended', points: 10 }, { label: 'Plant root completely extended', points: 20 }], 5, 1760, 1020),
		M('M06', 'Leafcutter Frenzy', '10 each fragment', [{ label: 'Ant touching nest AND each leaf fragment contained', points: 10 }], 6, 2080, 880),
		M('M07', 'Humongous Fungus', '20 + up to two 10-pt bonuses', [{ label: 'Mycelium completely extended', points: 20 }, { label: 'Bonus: connection to the opposing team extended root', points: 10, bonus: true }], 7, 2140, 560),
		M('M08', 'Tangled', '30', [{ label: 'Vine touching the mat', points: 30 }], 8, 1840, 420),
		M('M09', 'Research Platform', '10 + 10 + 10', [{ label: 'Platform raised', points: 10 }, { label: 'Camera trap deployed', points: 10 }, { label: 'Seed off the tree', points: 10 }], 9, 1500, 520),
		M('M10', 'Fragile Microhabitats', '20', [{ label: 'Root cover down / touching the mat', points: 20 }], 10, 1160, 400),
		M('M11', 'Window to the Past', '10 + 10', [{ label: 'Spider habitat in its original position', points: 10 }, { label: 'Snail habitat in its original position', points: 10 }], 11, 860, 520),
		M('M12', 'Forest Elder', '20 + 10', [{ label: 'Cane fully raised and touching the tree', points: 20 }, { label: 'Support tie around the post', points: 10 }], 12, 560, 380),
		M('M13', 'Keystone Species', '30', [{ label: 'Keystone species on the restoration platform AND young trees raised', points: 30 }], 13, null, null),
		M('M14', 'Seeds of Renewal', '5 each, +5 each bonus', [{ label: 'Each seed contained in the replantation station', points: 5 }, { label: 'Bonus: each of those seeds also touching the mat', points: 5, bonus: true }], 14, null, null),
		M('M15', 'Biocentric Architecture', '10 + 10 + 10, + one 10-pt bonus', [{ label: 'Nesting canopy raised', points: 10 }, { label: 'Garden skylight in', points: 10 }, { label: 'Compost hatch open / touching the mat', points: 10 }, { label: 'Bonus: environmental match to the dock', points: 10, bonus: true }], 15, null, null)
	];

	const wp = (launchId: string, x: number, y: number, sortOrder: number) => ({
		id: `fixture-wp-${launchId}-${sortOrder}`,
		launchId,
		xMm: x,
		yMm: y,
		sortOrder
	});

	const STRATEGIES: StrategyModel[] = [
		{
			id: 'fixture-strategy-v2',
			teamId: 'fixture-team',
			version: 2,
			label: null,
			launches: [
				{
					id: 'fx-l1',
					strategyId: 'fixture-strategy-v2',
					name: 'Opening run',
					attachmentName: 'Box pusher',
					sortOrder: 1,
					missions: [
						{ id: 'fx-l1-m01', launchId: 'fx-l1', missionId: 'fixture-M01', sortOrder: 1, scoringLines: [0, 1] },
						{ id: 'fx-l1-m03', launchId: 'fx-l1', missionId: 'fixture-M03', sortOrder: 2, scoringLines: [0] }
					],
					waypoints: [
						wp('fx-l1', 180, 220, 1),
						wp('fx-l1', 420, 820, 2),
						wp('fx-l1', 1080, 860, 3),
						wp('fx-l1', 420, 420, 4),
						wp('fx-l1', 180, 220, 5)
					]
				},
				{
					id: 'fx-l2',
					strategyId: 'fixture-strategy-v2',
					name: 'Far side sweep',
					attachmentName: 'Hook arm',
					sortOrder: 2,
					missions: [
						{ id: 'fx-l2-m08', launchId: 'fx-l2', missionId: 'fixture-M08', sortOrder: 1, scoringLines: [0] },
						{ id: 'fx-l2-m05', launchId: 'fx-l2', missionId: 'fixture-M05', sortOrder: 2, scoringLines: [1] }
					],
					waypoints: [
						wp('fx-l2', 200, 200, 1),
						wp('fx-l2', 1500, 300, 2),
						wp('fx-l2', 1840, 560, 3),
						wp('fx-l2', 1760, 900, 4),
						wp('fx-l2', 300, 300, 5)
					]
				}
			]
		},
		{
			id: 'fixture-strategy-v1',
			teamId: 'fixture-team',
			version: 1,
			label: 'first idea',
			launches: [
				{
					id: 'fx-old-l1',
					strategyId: 'fixture-strategy-v1',
					name: 'One big run',
					attachmentName: '',
					sortOrder: 1,
					missions: [],
					waypoints: [wp('fx-old-l1', 200, 200, 1), wp('fx-old-l1', 1200, 700, 2)]
				}
			]
		}
	];

	const ROBOT = {
		id: 'fixture-robot',
		teamId: 'fixture-team',
		widthMm: 170,
		lengthMm: 210,
		speedCmS: 30,
		dwellS: 5,
		betweenLaunchesS: 8
	};

	const MAT_SETUP = { launchWmm: 480, launchHmm: 950 };
</script>

<svelte:head><title>dev: route planner</title></svelte:head>

<div class="harness" data-accent="cyan">
	<header class="harness__bar">
		<strong>route planner harness</strong>
		<label>
			scenario
			<select bind:value={scenario}>
				<option value="captain">run captain (edits)</option>
				<option value="viewer">teammate (view only)</option>
				<option value="mentor">mentor</option>
				<option value="empty">no plan yet</option>
			</select>
		</label>
		<label>
			connection
			<select bind:value={connection}>
				<option value="online">online</option>
				<option value="syncing">syncing</option>
				<option value="offline">offline</option>
			</select>
		</label>
		<button type="button" onclick={() => (log = [])}>clear log</button>
	</header>

	{#key scenario}
		<RoutePlanner
			team={{ id: 'fixture-team', name: 'Blue Team' }}
			isMentor={scenario === 'mentor'}
			canEdit={scenario === 'captain' || scenario === 'mentor'}
			missions={MISSIONS}
			strategies={scenario === 'empty' ? [] : STRATEGIES}
			robot={ROBOT}
			matSetup={MAT_SETUP}
			matPhotoUrl={null}
			{connection}
			pendingCount={connection === 'offline' ? 3 : 0}
			failed={[]}
			onPersist={record}
		/>
	{/key}

	<section class="harness__log">
		<h2>persist log</h2>
		<ol data-testid="persist-log">
			{#each log as line, i (i)}
				<li>{line}</li>
			{:else}
				<li class="harness__none">nothing persisted yet</li>
			{/each}
		</ol>
	</section>
</div>

<style>
	.harness {
		min-height: 100dvh;
		padding: var(--space-4);
		display: grid;
		gap: var(--space-4);
		align-content: start;
	}
	.harness__bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-4);
		padding: var(--space-2) var(--space-3);
		border: 1px dashed var(--boundary);
		border-radius: var(--radius-control);
		color: var(--text-muted);
	}
	.harness__bar select,
	.harness__bar button {
		font: inherit;
		min-height: 2.25rem;
	}
	.harness__log h2 {
		font-size: var(--fs-h3);
		margin: 0 0 var(--space-2);
	}
	.harness__log ol {
		margin: 0;
		padding-left: var(--space-5);
		font-family: var(--font-mono);
		font-size: var(--fs-small);
	}
	.harness__none {
		list-style: none;
		color: var(--text-faint);
	}
</style>
