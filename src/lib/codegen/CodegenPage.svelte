<script lang="ts">
	import { DEFAULT_CALIBRATION, DEFAULT_CONFIG } from '$lib/codegen/defaults';
	import HubPorts from '$lib/codegen/HubPorts.svelte';
	import TrackPicture from '$lib/codegen/TrackPicture.svelte';
	import WheelPicture from '$lib/codegen/WheelPicture.svelte';
	import {
		assignRole,
		configPortsFromMap,
		mapProblems,
		portMapFromConfig,
		type Port,
		type PortMap,
		type PortRole
	} from '$lib/codegen/ports';
	import { canShareFiles, deliver, type DeliveryMethod } from '$lib/codegen/deliver';
	import { generateProjects, type GeneratedProject } from '$lib/codegen/generate';
	import {
		LENGTH_UNITS,
		LENGTH_UNIT_STORAGE_KEY,
		UNIT_LABEL,
		UNIT_SHORT,
		UNIT_STEP,
		WHEEL_PRESETS,
		boundsIn,
		commit,
		display,
		isLengthUnit,
		type LengthUnit
	} from '$lib/codegen/units';
	import { mmToDegrees, type Calibration, type RobotConfig } from '$lib/codegen/toolkit';
	import type { CodegenData, CodegenSave } from '$lib/codegen/storage';
	import type { TeamAccent } from '$lib/console/types';
	import { untrack } from 'svelte';

	interface Props {
		/**
		 * THE TEAM IS A PROP, NOT A DERIVATION, and that is the only real
		 * difference between the two surfaces that render this. A student's team
		 * is implicit in current_student_team_id(); a mentor has no current team
		 * and picks one. Both hand it in here, so there is one render path.
		 */
		team: { id: string; name: string; accent: TeamAccent | null };
		/**
		 * How this surface saves, or null when it cannot.
		 *
		 * PRESENCE OF A TRANSPORT IS PRESENCE OF A CONTROL: the Save section below
		 * renders if and only if this is supplied. A surface that forgot to pass
		 * one gets no button, which is a visible mistake, rather than a button
		 * that silently does nothing, which is not. Null in the dev harness, where
		 * nothing may write.
		 */
		save: CodegenSave | null;
		data: CodegenData;
		backHref?: string;
	}

	let { team, save, data, backHref = '/app/me' }: Props = $props();

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

	/**
	 * YAW AXIS IS COLLECTED, STORED, AND IGNORED, SO IT IS NO LONGER ASKED FOR.
	 *
	 * T17 left the emitter when V9 refused `flippermoresensors_setOrientation` as
	 * an unverified shape, and nothing has read `robot_configs.yaw_axis` since.
	 * The COLUMN and its default stay exactly as they are, and `cfg.yawAxis`
	 * still travels to the transport untouched, so a row that already says
	 * 'front' keeps saying 'front'. What is gone is the question: a child should
	 * not be asked something the software throws away.
	 *
	 * IT COMES BACK WHEN THAT SHAPE IS VERIFIED. Put the control back on the
	 * "Our robot" step, and restore the warning that a hub which is not flat and
	 * face up will turn wrong, at the same time as the emitter starts reading it.
	 * See docs/FLL_VERIFIED_SHAPES.json `_meta.unverified_deferred`.
	 */

	// --- what is plugged into which port -------------------------------------
	//
	// THE MAP IS THE SOURCE OF TRUTH AND cfg FOLLOWS IT, one way, never back.
	// That is what makes `movementPair` derived rather than a second answer that
	// can disagree with the two drive ports: see ports.ts.
	const arrivalMap = portMapFromConfig(cfg);
	let portMap = $state<PortMap>(arrivalMap);
	const portProblems = $derived(mapProblems(portMap));

	/**
	 * SEED cfg's PORT FIELDS THROUGH THE MAP, ON ARRIVAL, BEFORE ANYTHING IS
	 * EDITED. A row written by the old form can already disagree with itself:
	 * drives on C and D with "AB" still in the movement_pair column, because the
	 * text box and the two dropdowns were separate answers. Rebuilding them from
	 * the map here means the disagreement does not survive being opened, rather
	 * than surviving until somebody happens to touch a port.
	 */
	{
		// `arrivalMap`, not `portMap`: this is the one-shot repair of what was
		// stored, so it reads the plain value rather than the reactive one.
		const seeded = configPortsFromMap(arrivalMap);
		if (seeded) Object.assign(cfg, seeded);
	}

	function setPort(port: Port, role: PortRole) {
		portMap = assignRole(portMap, port, role);
		const ports = configPortsFromMap(portMap);
		// Null means the map is not complete yet. cfg keeps its last complete
		// answer, the step says what is missing, and Next stays shut, so an
		// incomplete map can never reach the transport or the emitter.
		if (ports) Object.assign(cfg, ports);
	}

	// --- how the two geometry fields are read ---------------------------------
	//
	// THE ROW IS MILLIMETRES AND THE FIELD IS TEXT, AND THEY ARE SYNCED IN ONE
	// DIRECTION AT A TIME. `cfg.wheelDiameterMm` is the exact value; `wheelText`
	// is what the box shows, which is ROUNDED. Text goes to millimetres through
	// commit(), which refuses to write back a number the field itself printed;
	// millimetres go to text only when the unit changes or a preset is picked,
	// never while somebody is mid-word in the box.
	let unit = $state<LengthUnit>('mm');
	let wheelText = $state(display(cfg.wheelDiameterMm, 'mm'));
	let trackText = $state(display(cfg.trackWidthMm, 'mm'));

	const wheelBounds = $derived(boundsIn(unit, 200));
	const trackBounds = $derived(boundsIn(unit, 500));

	/** Repaint both boxes from the exact values. The only downward sync there is. */
	function showStored() {
		wheelText = display(cfg.wheelDiameterMm, unit);
		trackText = display(cfg.trackWidthMm, unit);
	}

	/**
	 * The remembered unit is read ONCE, after mount, and never during SSR.
	 * Seeding the initialiser from localStorage would make the hydrated client
	 * disagree with the HTML the server sent, and localStorage THROWS rather than
	 * returning null in a private window, which is why this is wrapped.
	 */
	$effect(() => {
		try {
			const saved = localStorage.getItem(LENGTH_UNIT_STORAGE_KEY);
			if (isLengthUnit(saved) && saved !== untrack(() => unit)) {
				unit = saved;
				showStored();
			}
		} catch {
			// No storage: mm, which is what the row holds anyway.
		}
	});

	function pickUnit(next: LengthUnit) {
		unit = next;
		// Repaint, do NOT convert: the stored millimetres are untouched by a
		// change of mind about how to read them.
		showStored();
		try {
			localStorage.setItem(LENGTH_UNIT_STORAGE_KEY, next);
		} catch {
			// A device that cannot remember still works; it just asks again.
		}
	}

	function typeWheel(text: string) {
		wheelText = text;
		if (text.trim() === '') return;
		cfg.wheelDiameterMm = commit(Number(text), cfg.wheelDiameterMm, unit);
	}

	function typeTrack(text: string) {
		trackText = text;
		if (text.trim() === '') return;
		cfg.trackWidthMm = commit(Number(text), cfg.trackWidthMm, unit);
	}

	// A half-typed "2." leaves the box on blur; the exact value comes back.
	const settle = () => showStored();

	// --- the wheel, RECOGNISED rather than measured ---------------------------
	//
	// They read the size off the side of the tyre, so the three real wheels are
	// pictures at their true relative sizes and "something else" is a disclosure
	// behind them. The old control was a select of three sentences plus a
	// number box that was always on screen whether or not it applied.
	const WHEEL_MAX_MM = Math.max(...WHEEL_PRESETS.map((w) => w.mm));
	const onPreset = $derived(WHEEL_PRESETS.some((w) => w.mm === cfg.wheelDiameterMm));
	let customWheel: HTMLInputElement | null = $state(null);
	let customOpen = $state(false);

	function pickWheel(mm: number) {
		cfg.wheelDiameterMm = mm;
		customOpen = false;
		showStored();
	}

	function openCustom() {
		customOpen = true;
		queueMicrotask(() => {
			customWheel?.focus();
			customWheel?.select();
		});
	}

	// A stored wheel that is not one of the three opens the box on arrival, so a
	// team with an odd wheel sees their number rather than an unticked row.
	$effect(() => {
		if (!untrack(() => customOpen) && !untrack(() => onPreset)) customOpen = true;
	});

	// --- gears: hidden until a team says they have some -----------------------
	//
	// Most driving bases are direct drive, and "motor turns per wheel turn" is a
	// phrase no nine-year-old should meet unless it applies to them. Default 1,
	// which is what DEFAULT_CONFIG already says; the disclosure opens itself for
	// a stored ratio that is not 1.
	let gearsOpen = $state(cfg.gearRatio !== 1);

	// --- the arithmetic, shown rather than hidden ----------------------------
	// THE WHOLE POINT IS THAT A STUDENT CAN SEE IT MOVE. The emitter bakes
	// 360 * gear_ratio / (pi * wheel) into the generated blocks as a literal;
	// if that number is wrong, every drive in every run is wrong by the same
	// percentage and nothing on the robot says so. Type 62 in the wheel box and
	// watch 614 become 554: that is the error, made visible before it ships.
	let checkMm = $state(300);
	const degrees = $derived(mmToDegrees(checkMm, cfg));
	const perMm = $derived((360 * cfg.gearRatio) / (Math.PI * cfg.wheelDiameterMm));
	// The same distance in the unit on screen, ALONGSIDE the millimetres rather
	// than instead of them: millimetres are what goes into the file.
	const checkInUnit = $derived(display(checkMm, unit));

	// --- one idea per screen --------------------------------------------------
	//
	// FOUR STEPS, NOT ONE WALL. The page was twelve controls in a column; six of
	// them were one question (the hub above), one was thrown away (yaw), and the
	// rest belong to three different ideas. Back and forward, and the progress
	// is on screen the whole time.
	const STEPS = [
		{ key: 'robot', title: 'Our robot' },
		{ key: 'wheels', title: 'Our wheels' },
		{ key: 'sensors', title: 'What our sensors see' },
		{ key: 'make', title: 'Make it' }
	] as const;
	let stepIndex = $state(0);
	const step = $derived(STEPS[stepIndex].key);

	/** What stops this step going forward, or empty. */
	const blockers = $derived(
		step === 'robot'
			? portProblems
			: step === 'sensors' && cal.white <= cal.black
				? ['White has to read a bigger number than black. Check the two readings.']
				: []
	);

	function go(delta: number) {
		if (delta > 0 && blockers.length) return;
		stepIndex = Math.min(STEPS.length - 1, Math.max(0, stepIndex + delta));
		// A step change is a new screen; start it at the top like one.
		if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'instant' });
	}

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

	/**
	 * WHAT GOES TO THE TRANSPORT IS `cfg`, WHICH IS EXACT MILLIMETRES. Nothing
	 * rounded ever reaches it: commit() is the only writer, and it refuses a
	 * number the field printed. A config opened in inches and saved untouched
	 * sends back the millimetres it arrived as.
	 */
	async function handleSave() {
		if (!save) return;
		saving = true;
		saveNote = '';
		saveFailed = false;
		const res = await save({
			existingConfigId: stored?.id ?? null,
			name: name.trim() || 'Driving base',
			config: $state.snapshot(cfg),
			calibration: $state.snapshot(cal),
			calibrationPorts: [cfg.leftColorPort, cfg.rightColorPort],
			venueLabel: venueLabel.trim(),
			existingCalibrations: data.calibrations
		});
		saveNote = res.ok ? 'Saved for your team.' : (res.error ?? 'That did not save.');
		saveFailed = !res.ok;
		saving = false;
	}
</script>

<div class="cg" data-accent={team.accent}>
	<header class="cg__top">
		<a class="cg__back" href={backHref}>Back</a>
		<span class="cg__title">Make our robot code</span>
	</header>

	<!--
		PROGRESS IS ON SCREEN THE WHOLE TIME. Four dots and a step name: a child
		who is on screen two can see there are four and that they are two in.
		Tapping a dot goes BACK only; forward is the Next button, so a step's
		blockers cannot be walked past.
	-->
	<nav class="cg__steps" aria-label="Steps">
		{#each STEPS as s, i (s.key)}
			<button
				class="cg__step"
				class:cg__step--on={i === stepIndex}
				class:cg__step--done={i < stepIndex}
				type="button"
				disabled={i > stepIndex}
				aria-current={i === stepIndex ? 'step' : undefined}
				aria-label={`Step ${i + 1}: ${s.title}`}
				onclick={() => (stepIndex = i)}
			>
				<span class="cg__stepnum">{i + 1}</span>
				<span class="cg__steplabel">{s.title}</span>
			</button>
		{/each}
	</nav>

	{#if data.unavailable}
		<p class="cg__note cg__note--warn">{data.unavailable}</p>
	{/if}

	<!-- ============================================================ robot -->
	{#if step === 'robot'}
		<section class="card cg__card">
			<h2 class="cg__h">Our robot</h2>
			<p class="cg__help">
				Tell us about your robot. We build two SPIKE files: the toolkit you drive with, and a
				self test that checks it on the hub.
			</p>

			<label class="field">
				<span>What we call it</span>
				<input class="input" bind:value={name} maxlength="120" />
			</label>

			<h3 class="cg__sub">What is plugged in where</h3>
			<p class="cg__help">
				Look at your hub. Tap each port and say what is in it. We work out the rest.
			</p>
			<HubPorts map={portMap} onassign={setPort} />
		</section>

	<!-- =========================================================== wheels -->
	{:else if step === 'wheels'}
		<section class="card cg__card">
			<h2 class="cg__h">Our wheels</h2>
			<p class="cg__help">
				Read the size off the side of the tyre. It is moulded into the rubber. This one
				number divides every distance in every run, so a wheel picked wrong makes every
				drive wrong.
			</p>

			<div class="cg__wheels" role="group" aria-label="Which wheel">
				{#each WHEEL_PRESETS as w (w.mm)}
					<button
						class="cg__wheel"
						class:cg__wheel--on={!customOpen && cfg.wheelDiameterMm === w.mm}
						type="button"
						aria-pressed={!customOpen && cfg.wheelDiameterMm === w.mm}
						onclick={() => pickWheel(w.mm)}
					>
						<WheelPicture
							mm={w.mm}
							maxMm={WHEEL_MAX_MM}
							selected={!customOpen && cfg.wheelDiameterMm === w.mm}
						/>
						<span class="cg__wheelmm">{w.mm} mm</span>
						<span class="cg__wheelname">{w.label.replace(/^[\d.]+ mm \(the (.*)\)$/, '$1')}</span>
					</button>
				{/each}
			</div>

			{#if !customOpen}
				<button class="btn btn--ghost cg__slab" type="button" onclick={openCustom}>
					Ours is something else
				</button>
			{:else}
				<label class="field">
					<span>Wheel across ({UNIT_LABEL[unit]})</span>
					<input
						class="input"
						type="number"
						inputmode="decimal"
						min={wheelBounds.min}
						max={wheelBounds.max}
						step={UNIT_STEP[unit]}
						bind:this={customWheel}
						value={wheelText}
						oninput={(e) => typeWheel(e.currentTarget.value)}
						onblur={settle}
					/>
				</label>
			{/if}

			<!-- THE SUM, ON THE STEP WHERE THE WHEEL CHANGES, so the number moves
			     while they are looking at it. -->
			<section class="cg__math" aria-live="polite">
				<h3 class="cg__sub">The sum we do for you</h3>
				<div class="cg__sum">
					<label class="cg__sumin">
						<span class="cg__sumlabel">Drive this far</span>
						<input class="input" type="number" min="0" step="1" bind:value={checkMm} />
					</label>
					<p class="cg__answer">
						<strong>{checkMm} mm</strong>
						{#if unit !== 'mm'}<span class="cg__also"
								>(<strong>{checkInUnit} {UNIT_SHORT[unit]}</strong>)</span
							>{/if}
						= <strong class="cg__degrees">{degrees}</strong> motor degrees
					</p>
				</div>
				<p class="cg__work">
					{checkMm} &divide; (&pi; &times; {cfg.wheelDiameterMm} mm) &times; 360 &times; {cfg.gearRatio}
					= {degrees}
					<br />
					That is {perMm.toFixed(4)} motor degrees for every millimetre.
				</p>
				<p class="cg__help">
					Tap a different wheel and watch this number move. It goes into the file as it is,
					so if it is wrong here it is wrong in every single run.
				</p>
			</section>

			<h3 class="cg__sub">How far apart they are</h3>
			<TrackPicture label={`${trackText} ${UNIT_SHORT[unit]}`} />

			<fieldset class="cg__fs">
				<legend>How we measure</legend>
				<p class="cg__help">
					Pick what your ruler says. We always keep the numbers in millimetres, so
					switching this changes nothing about the robot.
				</p>
				<div class="cg__ports">
					{#each LENGTH_UNITS as u (u)}
						<label class="cg__port" class:cg__port--on={unit === u}>
							<input
								type="radio"
								name="cg-unit"
								value={u}
								checked={unit === u}
								onchange={() => pickUnit(u)}
							/>
							<span>{UNIT_LABEL[u]}</span>
						</label>
					{/each}
				</div>
			</fieldset>

			<label class="field">
				<span>Wheel to wheel ({UNIT_LABEL[unit]})</span>
				<input
					class="input"
					type="number"
					inputmode="decimal"
					min={trackBounds.min}
					max={trackBounds.max}
					step={UNIT_STEP[unit]}
					value={trackText}
					oninput={(e) => typeTrack(e.currentTarget.value)}
					onblur={settle}
				/>
			</label>

			{#if unit !== 'mm'}
				<p class="cg__help">
					Saved as {display(cfg.wheelDiameterMm, 'mm')} mm across and
					{display(cfg.trackWidthMm, 'mm')} mm apart. Those are the numbers that go into the
					file.
				</p>
			{/if}

			<!-- GEARS ARE BEHIND A DOOR. Most bases have none. -->
			{#if !gearsOpen}
				<button class="btn btn--ghost cg__slab" type="button" onclick={() => (gearsOpen = true)}>
					Our robot has gears
				</button>
			{:else}
				<label class="field">
					<span>Gears: motor turns per wheel turn</span>
					<input
						class="input"
						type="number"
						min="0.01"
						max="20"
						step="0.01"
						bind:value={cfg.gearRatio}
					/>
				</label>
				<p class="cg__help">
					Most driving bases have no gears at all. If the motor turns the wheel directly,
					this is 1.
				</p>
			{/if}
		</section>

	<!-- ========================================================== sensors -->
	{:else if step === 'sensors'}
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
				<input
					class="input"
					bind:value={venueLabel}
					maxlength="60"
					placeholder="Our table, the gym, the tournament"
				/>
			</label>
		</section>

	<!-- ============================================================= make -->
	{:else}
		<section class="card cg__card">
			<h2 class="cg__h">Make it</h2>
			<p class="cg__help">
				Two files: the toolkit you drive with, and a self test that checks it on the hub.
			</p>
			<button class="btn btn--primary cg__slab cg__go" onclick={generate} disabled={generating}>
				{generating ? 'Making...' : 'Make our two files'}
			</button>

			{#if genError}
				<p class="cg__note cg__note--bad">The generator stopped: {genError}</p>
			{/if}

			{#if projects}
				<!--
					THE FILES ARRIVE AS THINGS YOU CAN SEE. Two cards, named, each
					saying what it is FOR, with what is inside it underneath. The old
					version was a bulleted list of block counts under a grey button.
				-->
				<ul class="cg__files">
					{#each projects as p, i (p.filename)}
						<li class="cg__file ds-rise" style="animation-delay:{i * 0.08}s">
							<span class="cg__fileicon" aria-hidden="true">{i === 0 ? '\u25B6' : '\u2713'}</span>
							<span class="cg__filename">{p.name}</span>
							<span class="cg__filefor">
								{i === 0
									? 'The one you drive with. Open this in the SPIKE App.'
									: 'Run this on the hub once to check the toolkit works.'}
							</span>
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
						{findings.length === 1 ? 'problem' : 'problems'}. We are not going to give you
						a file that the SPIKE App would refuse without telling you why. Show this to a
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

		<!--
			PRESENCE OF A TRANSPORT IS PRESENCE OF A CONTROL. No transport, no
			section: a surface that cannot write shows nothing to press, rather
			than a button that answers a tap with silence. Whether this caller may
			write is still the database's answer, and it comes back from the write
			itself as a refusal naming who can.
		-->
		{#if save}
			<section class="card cg__card">
				<h2 class="cg__h">Keep these numbers</h2>
				<p class="cg__help">
					Saving means nobody has to type them again. A mentor or the Run Captain can save.
				</p>
				<button class="btn btn--secondary cg__slab" onclick={handleSave} disabled={saving}>
					{saving ? 'Saving...' : `Save for ${team.name}`}
				</button>
				{#if saveNote}
					<p class="cg__note" class:cg__note--bad={saveFailed} class:cg__note--ok={!saveFailed}>
						{saveNote}
					</p>
				{/if}
			</section>
		{/if}
	{/if}

	<!-- BACK AND FORWARD, ALWAYS IN THE SAME PLACE. A step that cannot go on
	     says why, in a sentence, rather than greying a button and waiting. -->
	<nav class="cg__move" aria-label="Move between steps">
		{#if blockers.length}
			<ul class="cg__blockers">
				{#each blockers as b (b)}<li>{b}</li>{/each}
			</ul>
		{/if}
		<div class="cg__movebtns">
			<button
				class="btn btn--ghost cg__movebtn"
				type="button"
				disabled={stepIndex === 0}
				onclick={() => go(-1)}
			>
				Back
			</button>
			{#if stepIndex < STEPS.length - 1}
				<button
					class="btn btn--primary cg__movebtn"
					type="button"
					disabled={blockers.length > 0}
					onclick={() => go(1)}
				>
					Next: {STEPS[stepIndex + 1].title}
				</button>
			{/if}
		</div>
	</nav>
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
	.cg__top {
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
	/* The same distance in the unit on screen, beside the millimetres and never
	   instead of them: millimetres are what goes into the file. */
	.cg__also {
		color: var(--text-muted);
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

	/* --- steps ------------------------------------------------------------- */
	.cg__steps {
		display: flex;
		gap: var(--space-2);
		width: 100%;
		max-width: 44rem;
		margin-inline: auto;
		overflow-x: auto;
	}
	.cg__step {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex: 1 1 auto;
		min-height: 2.75rem;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-control);
		border: 1px solid var(--boundary);
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--fs-small);
		font-weight: var(--fw-bold);
		white-space: nowrap;
		cursor: pointer;
	}
	.cg__step:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.cg__step--done {
		color: var(--text-body);
		border-color: var(--text-2);
	}
	/* THE CURRENT STEP IS A FILLED CHIP, AND IT IS NEUTRAL.
	   It was a green pill, which put a second green active state on the page
	   beside the nav pill; the app has exactly one, and the nav owns it. The
	   fill-plus-ink shape is kept, because that is what made it legible on
	   both grounds (green text on the green wash measured 4.31 on paper); only
	   the colour left. */
	.cg__step--on {
		color: var(--text-1);
		border-color: var(--text-1);
		background: var(--plate);
	}
	.cg__stepnum {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		flex: none;
		border-radius: 50%;
		border: 1px solid currentColor;
		font-family: var(--font-mono);
	}
	/* At 375 the four names do not fit; the numbers always do.
	   THE CURRENT STEP'S NAME GOES TOO, and that is the correction: keeping it
	   was meant to say where you are, but "What our sensors see" is wider than
	   the three remaining chips have left, so the fourth chip slid off the
	   right edge of the strip. The step's own heading is the first line of the
	   card directly beneath, so the name was being said twice and the second
	   copy was the one costing a chip. `aria-label` carries the name for a
	   reader at every width. */
	@media (max-width: 34rem) {
		.cg__steplabel {
			display: none;
		}
	}

	.cg__sub {
		margin: var(--space-5) 0 var(--space-2);
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
		color: var(--text-body);
	}

	/* --- wheels: pictures, thumb sized, matching the sign-in roster tiles --- */
	.cg__wheels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}
	.cg__wheel {
		display: grid;
		gap: var(--space-1);
		justify-items: center;
		min-height: 11rem;
		padding: var(--space-3);
		border-radius: var(--radius-tile);
		border: 2px solid var(--boundary);
		background: var(--surface-2);
		color: var(--text-body);
		font: inherit;
		cursor: pointer;
	}
	.cg__wheel--on {
		border-color: var(--text-1);
		background: var(--plate);
	}
	.cg__wheelmm {
		font-family: var(--font-mono);
		font-size: var(--fs-h3);
		font-weight: var(--fw-bold);
	}
	.cg__wheelname {
		font-size: var(--fs-small);
		color: var(--text-muted);
		text-align: center;
	}

	/* The one number on the page that is meant to be watched moving. */
	.cg__degrees {
		color: var(--text-1);
	}
	.cg__math {
		margin: var(--space-5) 0;
		padding: var(--space-4);
		border-radius: var(--radius-card);
		border: 1px solid var(--boundary);
		background: var(--surface-2);
	}

	/* --- generate, and the two file cards ---------------------------------- */
	.cg__go {
		font-family: var(--font-hero);
		letter-spacing: var(--track-label);
	}
	.cg__file {
		display: grid;
		gap: 0.2rem;
		padding: var(--space-4);
		border-radius: var(--radius-card);
		border: 2px solid var(--success);
		background: var(--surface-2);
	}
	.cg__fileicon {
		font-size: var(--fs-h2);
		line-height: 1;
		color: var(--success-text);
	}
	.cg__filefor {
		font-size: var(--fs-body);
		color: var(--text-body);
	}

	/* --- back and forward --------------------------------------------------- */
	.cg__move {
		width: 100%;
		max-width: 44rem;
		margin-inline: auto;
	}
	.cg__movebtns {
		display: flex;
		gap: var(--space-3);
	}
	.cg__movebtn {
		flex: 1 1 0;
		min-height: 3.5rem;
		font-size: var(--fs-h3);
	}
	.cg__blockers {
		margin: 0 0 var(--space-3);
		padding-left: var(--space-4);
		color: var(--warning);
		font-size: var(--fs-body);
	}
</style>
