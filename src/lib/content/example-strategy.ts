/**
 * THE WORKED EXAMPLE PLAN, and the season mission list it is built against.
 *
 * WHY THIS IS CONTENT AND NOT ROWS. The example exists so a team that has
 * never seen the planner can open something finished and look at it: two
 * launches, real missions, a route that starts and ends in Base, a movement
 * list with numbers in it. It must be impossible to edit into a team's own
 * plan by accident and impossible for a student to delete, and the cheapest
 * way to make both true is for it not to be data at all: it is this module,
 * reviewed in git like any other copy, rendered through the REAL RoutePlanner
 * component with every write affordance off and no persist callback wired.
 * There is no row to update and no row to delete; RLS never enters into it.
 *
 * THE MISSION LIST HERE IS THE SEASON'S REAL LIST (codes, names, points,
 * scoring lines), the same 15 rows 0011 seeds. The database stays the
 * authority for the numbers a live screen shows; this copy exists so the
 * example and the dev harness render without a database, and the codes are
 * joined back to prose in missions.ts by `code` the same way.
 *
 * THE POSITIONS ARE EXAMPLE POSITIONS. A mentor places the real mission dots
 * from the rulebook (0011 seeds none, on purpose, and inventing them for the
 * missions table was explicitly ruled out). The example still needs dots to
 * draw a route past, so it carries its own, clearly labeled on the example
 * screen as part of the example, never written anywhere.
 */
import type { ScoringLine } from '$lib/planner/geometry';
import type {
	MatSetupModel,
	MissionMarker,
	RobotProfileModel,
	StrategyModel
} from '$lib/planner/types';

export interface SeasonMission {
	code: string;
	name: string;
	pointsLabel: string;
	scoring: ScoringLine[];
	sortOrder: number;
}

/** The 15 BIOGLOW Robot Game missions, mirroring 0011's seed. */
export const SEASON_MISSIONS: SeasonMission[] = [
	{ code: 'M01', name: 'Drone Survey', pointsLabel: '20 + 10 bonus', scoring: [{ label: 'Drone is off the mat', points: 20 }, { label: 'Bonus: LiDAR map flipped AND scan marker in the survey area', points: 10, bonus: true }], sortOrder: 1 },
	{ code: 'M02', name: 'Exploding Seeds', pointsLabel: '10 each seed', scoring: [{ label: 'Each seed off the stalk', points: 10 }], sortOrder: 2 },
	{ code: 'M03', name: 'Flip the Rock', pointsLabel: '20 + 10 bonus', scoring: [{ label: 'Research flag is down', points: 20 }, { label: 'Bonus: rock returned to the start area', points: 10, bonus: true }], sortOrder: 3 },
	{ code: 'M04', name: 'Lucky Leaves', pointsLabel: '10, or 30 with the bonus', scoring: [{ label: 'One leaf removed', points: 10 }, { label: 'Bonus: second leaf removed AND katydid still in its original position', points: 20, bonus: true }], sortOrder: 4 },
	{ code: 'M05', name: 'Reaching Roots', pointsLabel: '10 or 20', scoring: [{ label: 'Plant root partially extended', points: 10 }, { label: 'Plant root completely extended', points: 20 }], sortOrder: 5 },
	{ code: 'M06', name: 'Leafcutter Frenzy', pointsLabel: '10 each fragment', scoring: [{ label: 'Ant touching nest AND each leaf fragment contained', points: 10 }], sortOrder: 6 },
	{ code: 'M07', name: 'Humongous Fungus', pointsLabel: '20 + up to two 10-pt bonuses', scoring: [{ label: 'Mycelium completely extended', points: 20 }, { label: 'Bonus: connection to the opposing team extended root', points: 10, bonus: true }], sortOrder: 7 },
	{ code: 'M08', name: 'Tangled', pointsLabel: '30', scoring: [{ label: 'Vine touching the mat', points: 30 }], sortOrder: 8 },
	{ code: 'M09', name: 'Research Platform', pointsLabel: '10 + 10 + 10', scoring: [{ label: 'Platform raised', points: 10 }, { label: 'Camera trap deployed', points: 10 }, { label: 'Seed off the tree', points: 10 }], sortOrder: 9 },
	{ code: 'M10', name: 'Fragile Microhabitats', pointsLabel: '20', scoring: [{ label: 'Root cover down / touching the mat', points: 20 }], sortOrder: 10 },
	{ code: 'M11', name: 'Window to the Past', pointsLabel: '10 + 10', scoring: [{ label: 'Spider habitat in its original position', points: 10 }, { label: 'Snail habitat in its original position', points: 10 }], sortOrder: 11 },
	{ code: 'M12', name: 'Forest Elder', pointsLabel: '20 + 10', scoring: [{ label: 'Cane fully raised and touching the tree', points: 20 }, { label: 'Support tie around the post', points: 10 }], sortOrder: 12 },
	{ code: 'M13', name: 'Keystone Species', pointsLabel: '30', scoring: [{ label: 'Keystone species on the restoration platform AND young trees raised', points: 30 }], sortOrder: 13 },
	{ code: 'M14', name: 'Seeds of Renewal', pointsLabel: '5 each, +5 each bonus', scoring: [{ label: 'Each seed contained in the replantation station', points: 5 }, { label: 'Bonus: each of those seeds also touching the mat', points: 5, bonus: true }], sortOrder: 14 },
	{ code: 'M15', name: 'Biocentric Architecture', pointsLabel: '10 + 10 + 10, + one 10-pt bonus', scoring: [{ label: 'Nesting canopy raised', points: 10 }, { label: 'Garden skylight in', points: 10 }, { label: 'Compost hatch open / touching the mat', points: 10 }, { label: 'Bonus: environmental match to the dock', points: 10, bonus: true }], sortOrder: 15 }
];

const EXAMPLE_TEAM_ID = 'example-team';

/**
 * Example dot positions, spread plausibly across the mat so the example route
 * has something to drive past. They are drawings, not rulebook measurements.
 */
const EXAMPLE_POSITIONS: Record<string, { x: number; y: number }> = {
	M01: { x: 420, y: 980 },
	M02: { x: 760, y: 860 },
	M03: { x: 1080, y: 1010 },
	M04: { x: 1420, y: 900 },
	M05: { x: 1760, y: 1020 },
	M06: { x: 2080, y: 880 },
	M07: { x: 2140, y: 560 },
	M08: { x: 1840, y: 420 },
	M09: { x: 1500, y: 520 },
	M10: { x: 1160, y: 400 },
	M11: { x: 860, y: 520 },
	M12: { x: 560, y: 380 },
	M13: { x: 980, y: 700 },
	M14: { x: 1300, y: 660 },
	M15: { x: 1980, y: 240 }
};

export function exampleMissions(): MissionMarker[] {
	return SEASON_MISSIONS.map((m) => ({
		id: `example-${m.code}`,
		code: m.code,
		name: m.name,
		pointsLabel: m.pointsLabel,
		scoring: m.scoring,
		sortOrder: m.sortOrder,
		xMm: EXAMPLE_POSITIONS[m.code]?.x ?? null,
		yMm: EXAMPLE_POSITIONS[m.code]?.y ?? null
	}));
}

const wp = (launchId: string, x: number, y: number, sortOrder: number) => ({
	id: `example-wp-${launchId}-${sortOrder}`,
	launchId,
	xMm: x,
	yMm: y,
	sortOrder
});

/**
 * Two launches, both starting and ending inside the example Base rectangle
 * (see exampleMatSetup), each attempting two real missions.
 */
export function exampleStrategy(): StrategyModel {
	return {
		id: 'example-strategy',
		teamId: EXAMPLE_TEAM_ID,
		version: 1,
		label: 'Example',
		launches: [
			{
				id: 'example-l1',
				strategyId: 'example-strategy',
				name: 'Trip 1: near side',
				attachmentName: 'Box pusher',
				sortOrder: 1,
				missions: [
					{ id: 'example-l1-m01', launchId: 'example-l1', missionId: 'example-M01', sortOrder: 1, scoringLines: [0, 1] },
					{ id: 'example-l1-m03', launchId: 'example-l1', missionId: 'example-M03', sortOrder: 2, scoringLines: [0] }
				],
				waypoints: [
					wp('example-l1', 180, 220, 1),
					wp('example-l1', 420, 820, 2),
					wp('example-l1', 1080, 860, 3),
					wp('example-l1', 420, 420, 4),
					wp('example-l1', 180, 220, 5)
				]
			},
			{
				id: 'example-l2',
				strategyId: 'example-strategy',
				name: 'Trip 2: far side',
				attachmentName: 'Hook arm',
				sortOrder: 2,
				missions: [
					{ id: 'example-l2-m08', launchId: 'example-l2', missionId: 'example-M08', sortOrder: 1, scoringLines: [0] },
					{ id: 'example-l2-m05', launchId: 'example-l2', missionId: 'example-M05', sortOrder: 2, scoringLines: [1] }
				],
				waypoints: [
					wp('example-l2', 200, 200, 1),
					wp('example-l2', 1500, 300, 2),
					wp('example-l2', 1840, 560, 3),
					wp('example-l2', 1760, 900, 4),
					wp('example-l2', 300, 300, 5)
				]
			}
		]
	};
}

export function exampleRobot(): RobotProfileModel {
	return {
		id: 'example-robot',
		teamId: EXAMPLE_TEAM_ID,
		widthMm: 170,
		lengthMm: 210,
		speedCmS: 30,
		dwellS: 5,
		betweenLaunchesS: 8
	};
}

/** An example Base rectangle so the example can show the start-and-end rule. */
export function exampleMatSetup(): MatSetupModel {
	return { launchWmm: 480, launchHmm: 950 };
}
