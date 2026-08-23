<script lang="ts">
	import { page } from '$app/state';

	const reasons: Record<string, { title: string; body: string }> = {
		'no-access': {
			title: 'This account is not active here',
			body: 'You signed in, but there is no active mentor or student seat for this account. A mentor can reactivate it.'
		},
		rejected: {
			title: 'Mentor sign-in is boscotech.edu only',
			body: 'That Google account is outside boscotech.edu, so it cannot become a mentor. Students sign in with a team code and PIN.'
		}
	};
	let reason = $derived(reasons[page.url.searchParams.get('reason') ?? ''] ?? {
		title: 'Sign-in did not complete',
		body: 'Something went wrong between Google and us. Try again.'
	});
</script>

<main class="narrow">
	<section class="card">
		<h1>{reason.title}</h1>
		<p class="muted">{reason.body}</p>
		<form method="post" action="/auth/signout">
			<button class="btn btn--primary" type="submit">Back to sign-in</button>
		</form>
	</section>
</main>
