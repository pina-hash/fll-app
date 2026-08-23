import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Vercel, from main. The runtime is pinned so a local build under a
			// newer Node (the adapter refuses unknown majors) and the Vercel build
			// agree on what the server functions run on.
			adapter: adapter({ runtime: 'nodejs22.x' })
		})
	]
});
