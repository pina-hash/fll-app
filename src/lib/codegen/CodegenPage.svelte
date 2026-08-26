<script lang="ts">
	import {
		DEFAULT_CALIBRATION,
		DEFAULT_CONFIG,
		EMITTED_YAW_AXIS,
		PORTS,
		YAW_AXES
	} from '$lib/codegen/defaults';
	import { canShareFiles, deliver, type DeliveryMethod } from '$lib/codegen/deliver';
	import { generateProjects, type GeneratedProject } from '$lib/codegen/generate';
	import { saveCalibration, saveConfig } from '$lib/codegen/storage';
	import { mmToDegrees, type Calibration, type RobotConfig } from '$lib/codegen/toolkit';
	import type { CodegenData } from '$lib/codegen/storage';
	import type { TeamAccent } from '$lib/console/types';
	import type { Database } from '$lib/supabase/database.types';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { untrack } from 'svelte';

	interface Props {
		/** Null in the dev harness: nothing there can save, and nothing there should. */
		supabase: SupabaseClient<Database> | null;
		team: { id: string; name: string; accent: TeamAccent | null };
		data: CodegenData;
		backHref?: string;
	}

	let { supabase, team, data, backHref = '/app/me' }: Props = $props();

	const stored = $derived(data.configs[0] ?? null);

	// --- the form ------------------------------------------------------------
	// Seeded ONCE from whatever the team has saved, then owned by the student.
	// untrack() is the point: a $derived, or a bare read of `data` here, would
	// throw away what a child has typed the moment any load refetches. Their
	// half-filled form outranks a fresher copy of the same row.
	const seed = untrack(() => ({
		config: data.configs[0] ?? null,
		calibration: data.calibrations[0] ?? null
	}));

	let name = $state(seed.config?.name ?? 'Driving base');
	let cfg = $state<RobotConfig>({
		...DEFAULT_CONFIG,
		...(seed.config?.config ?? {}),
		attachmentMotors: [
			...(seed.config?.config.attachmentMotors ?? DEFAULT_CONFIG.attachmentMotors)
		]
	});

	let cal = $state<Calibration>({
		white: seed.calibration?.white ?? DEFAULT_CALIBRATION.white,
		black: seed.calibration?.black ?? DEFAULT_CALIBRATION.black
	});
	let venueLabel = $state(seed.calibration?.venueLabel ?? '');

	function toggleAttachment(port: string) {
		cfg.attachmentMotors = cfg.attachmentMotors.includes(port)
			? cfg.attachmentMotors.filter((p) => p !== port)
			: [...cfg.attachmentMotors, port].sort();
	}

	// --- the arithmetic, shown rather than hidden ----------------------------
	// THE WHOLE POINT IS THAT A STUDENT CAN SEE IT MOVE. The emitter bakes
	// 360 * gear_ratio / (pi * wheel) into the generated blocks as a literal;
	// if that number is wrong, every drive in every run is wrong by the same
	// percentage and nothing on the robot says so. Type 62 in the wheel box and
	// watch 614 become 554: that is the error, made visible before it ships.
	let checkMm = $state(300);
	const degrees = $derived(mmToDegrees(checkMm, cfg));
	const perMm = $derived((360 * cfg.gearRatio) / (Math.PI * cfg.wheelDiameterMm));

	// --- generation ----------------------------------------------------------
	let projects = $state<GeneratedProject[] | null>(null);
	let generating = $state(false);
	let genError = $state('');

	const findings = $derived(projects ? projects.flatMap((p) => p.findings) : []);
	const clean = $derived(
		projects !== null && projects.length > 0 && projects.every((p) => p.bytes !== null)
	);
	const deliverables = $derived(
		projects
			? projects
					.filter((p): p is GeneratedProject & { bytes: Uint8Array } => p.bytes !== null)
					.map((p) => ({ filename: p.filename, bytes: p.bytes }))
			: []
	);
	const shareable = $derived(deliverables.length > 0 && canShareFiles(deliverables));

	function generate() {
		generating = true;
		genError = '';
		projects = null;
		try {
			projects = generateProjects($state.snapshot(cfg), $state.snapshot(cal));
		} catch (err) {
			genError = err instanceof Error ? err.message : String(err);
		} finally {
			generating = false;
		}
	}

	// Anything that changes the output invalidates a result already on screen,
	// so a student can never download a file built from numbers they have since
	// edited. Cheaper to regenerate than to explain.
	$effect(() => {
		JSON.stringify(cfg);
		JSON.stringify(cal);
		projects = null;
	});

	// --- handing it over -----------------------------------------------------
	let delivered = $state<DeliveryMethod | null>(null);
	let deliverError = $state('');

	async function handOver() {
		if (!clean || !deliverables.length) return;
		deliverError = '';
		try {
			delivered = await deliver(deliverables);
		} catch (err) {
			deliverError = err instanceof Error ? err.message : String(err);
		}
	}

	// --- saving --------------------------------------------------------------
	let saving = $state(false);
	let saveNote = $state('');
	let saveFailed = $state(false);

	async function save() {
		if (!supabase) return;
		saving = true;
		saveNote = '';
		saveFailed = false;
		const cfgRes = await saveConfig(
			supabase,
			team.id,
			stored?.id ?? null,
			name.trim() || 'Driving base',
			$state.snapshot(cfg)
		);
		if (!cfgRes.ok) {
			saveNote = cfgRes.error ?? 'That did not save.';
			saveFailed = true;
			saving = false;
			return;
		}
		const calRes = await saveCalibration(
			supabase,
			team.id,
			[cfg.leftColorPort, cfg.rightColorPort],
			venueLabel.trim(),
			$state.snapshot(cal),
			data.calibrations
		);
		saveNote = calRes.ok ? 'Saved for your team.' : (calRes.error ?? 'That did not save.');
		saveFailed = !calRes.ok;
		saving = false;
	}
</script>

<div class="cg" data-accent={team.accent}>
	<header class="cg__top">
		<a class="cg__back" href={backHref}>Back</a>
		<span class="cg__title">Make our robot code</span>
	</header>

	<p class="cg__lede">
		Tell us about your robot. We build two SPIKE files: the toolkit you drive with, and a self
		test that checks it on the hub.
	</p>

	{#if data.unavailable}
		<p class="cg__note cg__note--warn">{data.unavailable}</p>
	{/if}

	<!-- ------------------------------------------------------------ robot -->
	<section class="card cg__card">
		<h2 class="cg__h">Our robot</h2>

		<label class="field">
			<span>What we call it</span>
			<input class="input" bind:value={name} maxlength="120" />
		</label>

		<div class="cg__pair">
			<label class="field">
				<span>Wheel across (mm)</span>
				<input class="input" type="number" min="1" max="200" step="0.1"
					bind:value={cfg.wheelDiameterMm} />
			</label>
			<label class="field">
				<span>Wheel to wheel (mm)</span>
				<input class="input" type="number" min="1" max="500" step="0.1"
					bind:value={cfg.trackWidthMm} />
			</label>
		</div>

		<label class="field">
			<span>Gears: motor turns per wheel turn</span>
			<input class="input" type="number" min="0.01" max="20" step="0.01"
				bind:value={cfg.gearRatio} />
		</label>

		<div class="cg__pair">
			<label class="field">
				<span>Left drive motor</span>
				<select class="input" bind:value={cfg.leftMotor}>
					{#each PORTS as p (p)}<option value={p}>{p}</option>{/each}
				</select>
			</label>
			<label class="field">
				<span>Right drive motor</span>
				<select class="input" bind:value={cfg.rightMotor}>
					{#each PORTS as p (p)}<option value={p}>{p}</option>{/each}
				</select>
			</label>
		</div>

		<label class="field">
			<span>Movement pair</span>
			<input class="input" bind:value={cfg.movementPair} maxlength="2" size="2"
				aria-describedby="pairhelp" />
		</label>
		<p class="cg__help" id="pairhelp">Two ports, like AB. This is what the SPIKE move blocks use.</p>

		<div class="cg__pair">
			<label class="field">
				<span>Left colour sensor</span>
				<select class="input" bind:value={cfg.leftColorPort}>
					{#each PORTS as p (p)}<option value={p}>{p}</option>{/each}
				</select>
			</label>
			<label class="field">
				<span>Right colour sensor</span>
				<select class="input" bind:value={cfg.rightColorPort}>
					{#each PORTS as p (p)}<option value={p}>{p}</option>{/each}
				</select>
			</label>
		</div>

		<fieldset class="cg__fs">
			<legend>Attachment motors</legend>
			<p class="cg__help">One RUN MOTOR block is made for each one you pick.</p>
			<div class="cg__ports">
				{#each PORTS as p (p)}
					<label class="cg__port" class:cg__port--on={cfg.attachmentMotors.includes(p)}>
						<input type="checkbox" checked={cfg.attachmentMotors.includes(p)}
							onchange={() => toggleAttachment(p)} />
						<span>{p}</span>
					</label>
				{/each}
			</div>
		</fieldset>

		<label class="field">
			<span>Which way the hub faces</span>
			<select class="input" bind:value={cfg.yawAxis}>
				{#each YAW_AXES as a (a)}<option value={a}>{a}</option>{/each}
			</select>
		</label>
		{#if cfg.yawAxis !== EMITTED_YAW_AXIS}
			<p class="cg__note cg__note--warn">
				We save this, but we cannot use it yet. The SPIKE block that sets the hub direction is
				not on our verified list, so the file we build always assumes the hub is flat, face
				<strong>up</strong>. Turns will be wrong on this robot. Lay the hub flat, or wait for
				that block to be checked.
			</p>
		{/if}
	</section>

	<!-- ------------------------------------------------------- calibration -->
	<section class="card cg__card">
		<h2 class="cg__h">What our sensors see</h2>
		<p class="cg__help">
			Hold a colour sensor over white, then over black, and write down what it says. Both
			sensors get the same two numbers.
		</p>
		<div class="cg__pair">
			<label class="field">
				<span>White reads</span>
				<input class="input" type="number" min="0" max="100" bind:value={cal.white} />
			</label>
			<label class="field">
				<span>Black reads</span>
				<input class="input" type="number" min="0" max="100" bind:value={cal.black} />
			</label>
		</div>
		<label class="field">
			<span>Where we measured</span>
			<input class="input" bind:value={venueLabel} maxlength="60"
				placeholder="Our table, the gym, the tournament" />
		</label>
		{#if cal.white <= cal.black}
			<p class="cg__note cg__note--bad">
				White has to read a bigger number than black. Check the two readings.
			</p>
		{/if}
	</section>

	<!-- ------------------------------------------------------- the sum ---- -->
	<section class="card cg__card cg__math">
		<h2 class="cg__h">The sum we do for you</h2>
		<div class="cg__sum">
			<label class="cg__sumin">
				<span class="cg__sumlabel">Drive this far</span>
				<input class="input" type="number" min="0" step="1" bind:value={checkMm} />
			</label>
			<p class="cg__answer" aria-live="polite">
				<strong>{checkMm} mm</strong> = <strong>{degrees}</strong> motor degrees
			</p>
		</div>
		<p class="cg__work">
			{checkMm} &divide; (&pi; &times; {cfg.wheelDiameterMm} mm) &times; 360 &times; {cfg.gearRatio}
			= {degrees}
			<br />
			That is {perMm.toFixed(4)} motor degrees for every millimetre.
		</p>
		<p class="cg__help">
			Change the wheel size above and watch this number move. It goes into the file as it is,
			so if it is wrong here it is wrong in every single run.
		</p>
	</section>

	<!-- ------------------------------------------------------- generate --- -->
	<section class="card cg__card">
		<h2 class="cg__h">Make the files</h2>
		<button class="btn btn--primary cg__slab" onclick={generate} disabled={generating}>
			{generating ? 'Making...' : 'Generate'}
		</button>

		{#if genError}
			<p class="cg__note cg__note--bad">The generator stopped: {genError}</p>
		{/if}

		{#if projects}
			<ul class="cg__files">
				{#each projects as p (p.filename)}
					<li class="cg__file">
						<span class="cg__filename">{p.name}</span>
						<span class="cg__filemeta">
							{p.blockCount} blocks &middot; {p.stacks.length} stacks &middot;
							{p.extensions.join(', ') || 'no extensions'}
						</span>
						<span class="cg__filemeta">Variables: {p.variables.join(', ') || 'none'}</span>
					</li>
				{/each}
			</ul>

			{#if clean}
				<p class="cg__note cg__note--ok">
					Checked: nothing wrong. {deliverables.length} files ready.
				</p>
				<button class="btn btn--primary cg__slab" onclick={handOver}>
					{shareable ? 'Send to the SPIKE App' : 'Download'}
				</button>
				<p class="cg__help">
					{shareable
						? 'This opens the share sheet so you can pick SPIKE straight away.'
						: 'This browser cannot share files, so the files will download instead.'}
				</p>
				{#if delivered === 'shared'}
					<p class="cg__note cg__note--ok">Sent. Pick SPIKE in the sheet.</p>
				{:else if delivered === 'downloaded'}
					<p class="cg__note cg__note--ok">Downloaded. Open them in the SPIKE App.</p>
				{:else if delivered === 'cancelled'}
					<p class="cg__note">You closed the sheet. Nothing was sent.</p>
				{/if}
				{#if deliverError}
					<p class="cg__note cg__note--bad">Could not hand the files over: {deliverError}</p>
				{/if}
			{:else}
				<!--
					A FILE THAT FAILED THE CHECK MUST NEVER REACH A STUDENT. The SPIKE
					App refuses a malformed project with no diagnostic at all, so a bad
					download teaches a child only that the app will not open it. There
					is no download button in this branch and no bytes behind one.
				-->
				<p class="cg__note cg__note--bad">
					We checked the files and found {findings.length}
					{findings.length === 1 ? 'problem' : 'problems'}. We are not going to give you a
					file that the SPIKE App would refuse without telling you why. Show this to a
					mentor.
				</p>
				<ul class="cg__findings">
					{#each findings as f, i (i)}
						<li><code>{f.check}</code> {f.detail}</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>

	<!-- ------------------------------------------------------- save ------- -->
	<section class="card cg__card">
		<h2 class="cg__h">Keep these numbers</h2>
		<p class="cg__help">
			Saving means nobody has to type them again. A mentor or the Run Captain can save.
		</p>
		<button class="btn btn--secondary cg__slab" onclick={save} disabled={saving}>
			{saving ? 'Saving...' : 'Save for our team'}
		</button>
		{#if saveNote}
			<p class="cg__note" class:cg__note--bad={saveFailed} class:cg__note--ok={!saveFailed}>
				{saveNote}
			</p>
		{/if}
	</section>
</div>

<style>
	.cg {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-3) var(--space-6);
		background:
			radial-gradient(120% 60% at 50% 0%, var(--team-accent-wash), transparent 70%),
			var(--surface-0);
	}
	.cg__top,
	.cg__lede {
		width: 100%;
		max-width: 44rem;
		margin-inline: auto;
	}
	.cg__top {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.cg__back {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		border: 2px solid var(--boundary);
		color: var(--text-1);
		text-decoration: none;
		font-weight: var(--fw-bold);
	}
	.cg__title {
		font-family: var(--font-display);
		font-size: var(--fs-h2);
		font-weight: var(--fw-black);
		color: var(--team-accent);
	}
	.cg__lede {
		margin: 0;
		font-size: var(--fs-body);
		color: var(--text-body);
	}
	/* The runtime is 375 first. Above that the cards stop growing, because a
	   form field 1200px wide is harder to read, not easier. */
	.cg__card {
		width: 100%;
		max-width: 44rem;
		/* Centred rather than left-hugging: at 1440 a 44rem column pinned to the
		   left edge reads as a broken layout, and the runtime is 375 first, so
		   the column is capped rather than grown. */
		margin-inline: auto;
	}
	.cg__h {
		margin: 0 0 var(--space-3);
		font-family: var(--font-display);
		font-size: var(--fs-h3);
		font-weight: var(--fw-black);
		color: var(--text-body);
	}
	.cg__pair {
		display: grid;
		gap: var(--space-3);
	}
	@media (min-width: 30rem) {
		.cg__pair {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
	.cg__help {
		margin: 0 0 var(--space-3);
		font-size: var(--fs-small);
		color: var(--text-muted);
	}
	.cg__fs {
		border: 1px solid var(--boundary);
		border-radius: var(--radius-control);
		padding: var(--space-3);
		margin: 0 0 var(--space-3);
	}
	.cg__fs legend {
		font-size: var(--fs-label);
		font-weight: var(--fw-bold);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-faint);
		padding: 0 var(--space-2);
	}
	.cg__ports {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.cg__port {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		min-width: 3.5rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		background: var(--surface-0);
		color: var(--text-body);
		font-weight: var(--fw-bold);
		cursor: pointer;
	}
	.cg__port--on {
		border-color: var(--team-accent);
		background: var(--team-accent-wash);
	}

	/* The sum. Monospaced, because the point is to watch digits change. */
	.cg__sum {
		display: grid;
		gap: var(--space-3);
		align-items: end;
	}
	@media (min-width: 30rem) {
		.cg__sum {
			grid-template-columns: 10rem minmax(0, 1fr);
		}
	}
	.cg__sumin {
		display: grid;
		gap: var(--space-2);
	}
	.cg__sumlabel {
		font-size: var(--fs-label);
		font-weight: var(--fw-bold);
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--text-faint);
	}
	.cg__answer {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-h3);
		color: var(--text-body);
	}
	.cg__work {
		margin: var(--space-3) 0;
		font-family: var(--font-mono);
		font-size: var(--fs-small);
		color: var(--text-muted);
		overflow-x: auto;
	}

	.cg__slab {
		width: 100%;
		min-height: 3.5rem;
		font-size: var(--fs-h3);
	}
	.cg__files {
		list-style: none;
		margin: var(--space-3) 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	.cg__file {
		display: grid;
		gap: 0.15rem;
		padding: var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		background: var(--surface-2);
	}
	.cg__filename {
		font-weight: var(--fw-bold);
		color: var(--text-body);
	}
	.cg__filemeta {
		font-size: var(--fs-small);
		color: var(--text-muted);
	}
	.cg__note {
		margin: var(--space-3) 0 0;
		padding: var(--space-3);
		border-radius: var(--radius-control);
		font-size: var(--fs-body);
		color: var(--text-body);
		background: var(--surface-2);
	}
	.cg__note--ok {
		color: var(--success-text);
		background: var(--surface-2);
	}
	.cg__note--bad {
		color: var(--danger-text);
		background: var(--danger-wash);
	}
	.cg__note--warn {
		color: var(--warning);
		background: var(--warning-wash);
	}
	.cg__findings {
		margin: var(--space-3) 0 0;
		padding-left: var(--space-4);
		font-size: var(--fs-small);
		color: var(--text-body);
		max-height: 20rem;
		overflow: auto;
	}
	.cg__findings code {
		font-family: var(--font-mono);
		font-weight: var(--fw-bold);
	}
</style>
