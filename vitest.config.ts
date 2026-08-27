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
		// tests/ holds the integration suite, which needs the local stack. The
		// codegen control suite lives beside the emitter it breaks on purpose and
		// needs no database at all; both run in the one command.
		include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
		// ONE shared database for the whole run. Files create run-tagged rows and
		// remove them in afterAll; running files concurrently would make one
		// file's cleanup race another's seeding. Keep this false.
		fileParallelism: false,
		hookTimeout: 60_000,
		testTimeout: 30_000
	}
});
