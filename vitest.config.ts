import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

/**
 * Deliberately standalone, NOT an extension of vite.config.ts: the tests are
 * node-side integration tests against the local Supabase stack and need none
 * of the SvelteKit plugin.
 *
 * `.env.test` holds the local stack's DEFAULT keys (the same on every machine
 * that runs `supabase start`); it is committed on purpose and contains no
 * secret. Set the same names in the environment to point the suite elsewhere.
 */
loadEnv({ path: fileURLToPath(new URL('./.env.test', import.meta.url)) });

/**
 * THE SUITE IS TWO PROJECTS, AND THE SPLIT WAS MEASURED, NOT REASONED.
 *
 * On 2026-09-02, at 0f2e3fa, the whole suite was run with NO stack listening
 * on 127.0.0.1:54321/54322. The files below passed in full; every other file
 * under tests/ failed on `connect ECONNREFUSED 127.0.0.1:54322` (or, for
 * device-team and schema-catalog, failed the cases that reach the database).
 * That is the definition of "pure" used here: a file that needs no Supabase
 * client and no Postgres, so it can run on a machine with no Docker and in a
 * CI job that could not boot the stack.
 *
 *   npm test                      both projects (needs the stack)
 *   npm test -- --project pure    the no-stack subset
 *   npm test -- --project db      the stack-backed subset
 *
 * A file moves between the two lists by hand, when it changes what it
 * imports. A db file listed as pure fails visibly without the stack; a pure
 * file left in db merely runs with it. So the mistake that costs anything is
 * loud.
 */
const PURE = [
	'tests/brand-rules.test.ts',
	'tests/build-manual-entry.test.ts',
	'tests/codegen-ports.test.ts',
	'tests/codegen-units.test.ts',
	'tests/design-tokens.test.ts',
	'tests/match-rules.test.ts',
	'tests/parent-qr.test.ts',
	'tests/planner-calibration.test.ts',
	'tests/planner-geometry.test.ts',
	'tests/planner-units.test.ts',
	'tests/student-identity.test.ts',
	'tests/student-role-projection.test.ts',
	'tests/theme-contrast.test.ts',
	'tests/theme-toggle.test.ts',
	// The codegen control suite lives beside the emitter it breaks on purpose
	// and needs no database at all (src/lib/codegen/__tests__/).
	'src/**/*.test.ts'
];

export default defineConfig({
	/**
	 * THE SVELTE PLUGIN IS HERE FOR ONE REASON: a claim about what a component
	 * RENDERS has to be measured on the rendered text. `FirstName` looked
	 * correct in source and emitted "FIRSTLEGO League" in the DOM, because
	 * Svelte trims whitespace at an {#if} boundary. Reading the markup could
	 * not have caught that and cannot catch it coming back, so
	 * tests/brand-rules.test.ts renders the component through `svelte/server`.
	 * It is NOT here to turn this into a component-test suite; everything else
	 * in tests/ is still node-side integration against the local stack.
	 */
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	},
	test: {
		environment: 'node',
		// ONE shared database for the whole run. Files create run-tagged rows and
		// remove them in afterAll; running files concurrently would make one
		// file's cleanup race another's seeding. Keep this false. It is set at
		// the root so it governs both projects.
		fileParallelism: false,
		hookTimeout: 60_000,
		testTimeout: 30_000,
		projects: [
			{
				extends: true,
				test: { name: 'pure', include: PURE }
			},
			{
				extends: true,
				test: {
					name: 'db',
					include: ['tests/**/*.test.ts'],
					exclude: [...PURE, '**/node_modules/**']
				}
			}
		]
	}
});
