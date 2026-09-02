/**
 * `/dev/route-planner` -- the real `RoutePlanner.svelte` with fixture props.
 *
 * WHY THIS ROUTE IS THE FIRST ONE THE HARNESS DRIVES. It is the surface with
 * the most ways to be wrong that a test cannot see:
 *
 *   * IT IS THE ONE PLATE IN THE APP. `MatCanvas` carries
 *     `data-ground="light"`, so the mat is a light rectangle whichever ground
 *     the app around it is on (CLAUDE.md: "THE MAT IS A LIGHT PLATE ON BOTH
 *     GROUNDS"). A forced ground RE-DECLARES rather than inheriting, and the
 *     failure mode when it does not is silent: a `var()` resolves where it is
 *     DECLARED, so a token the plate does not redeclare falls back to the
 *     dark value and nobody sees it in the markup. That bug has landed five
 *     times across two apps.
 *   * IT DRAWS LABELS ON SVG, WHERE THERE IS NO BACKGROUND. CLAUDE.md's
 *     verification standard names this exactly: "in SVG, through the sibling
 *     shape a label is drawn on: SVG paints no background and a label on a
 *     filled dot sits on a SIBLING". `checks.mjs` composites the real
 *     ancestor ground by painting, which is the only way to read these.
 *   * IT IS A WIDE CHILD IN A GRID. CLAUDE.md: "A grid item defaults to
 *     min-width: auto, so any track holding a deliberately wide child (a
 *     table with a min-width, a fixed-width preview frame) states
 *     min-width: 0 ... or the page scrolls sideways." A mat is exactly that
 *     child, and 375px is where it shows.
 *
 * THE PICTURE FIXTURE IS THIS REPO'S OWN DRAWING. The real field layout is
 * FIRST and LEGO copyrighted and reaches the app only through a mentor's
 * upload; the harness draws a stand-in with the same awkward property (a
 * playing surface inset inside a wall border, at a picture aspect nothing
 * like the mat's) and it is a LIGHT drawing, so the contrast layer is
 * measured against the case it exists for rather than the easy one.
 */
import { setGround } from './_shared.mjs';

export default {
	path: '/dev/route-planner',
	label: 'Route planner, run captain, plan and mat both set',
	/* The harness boots with the picture off, which is the state with no
	   contrast layer. Turning it on is what puts the scrim, the dark casing
	   and the label outlines under the plan -- the thing worth measuring --
	   so the run selects the calibrated picture first and PROVES it landed by
	   waiting for the image element the component only renders when a
	   calibrated picture is present. */
	prepare: [
		{
			evaluate: setGround('dark'),
			waitMs: 250
		},
		{
			/* A `<select>`, so a select step and not a click: a coordinate click
			   on one opens the browser's native popup, which no page-side
			   predicate can see and no second click can reach.

			   IT RETRIES, AND THE RETRY IS WHY THIS STEP EXISTS rather than an
			   `evaluate` that sets `.value`. Measured here: the binding behind
			   this control took FOUR attempts to attach after the page painted,
			   and the one-shot version reported success, left the control reading
			   "calibrated", and never rendered the picture -- so three
			   measurements at each width came back as findings about a state the
			   run had not reached.

			   THE SELECTOR NAMES THE CONTROL BY WHAT IT OFFERS, NOT BY ITS
			   POSITION. There are five selects in the harness bar and the picture
			   one is the fifth; `.harness__bar select` alone resolves to the FIRST
			   of them (scenario), which has no `calibrated` option, so every
			   attempt would throw and the step would fail twelve times against the
			   wrong element. `:has(option[...])` picks the one select that can
			   answer, and keeps picking it if a future bundle reorders the bar. */
			select: '.harness__bar select:has(option[value="calibrated"])',
			value: 'calibrated',
			/* The predicate names the <image> the component draws ONLY for a
			   calibrated picture. It is the state every measurement below
			   describes, so nothing further needs waiting on. */
			until: `() => !!document.querySelector('.mat svg image')`,
			waitMs: 300
		}
	],
	presence: [
		{ selector: '.harness .rp', label: 'the real RoutePlanner mounted', expectPresent: 1, maxPresent: 1 },
		{ selector: '.mat[data-ground="light"]', label: 'the mat is a forced light plate', expectPresent: 1, maxPresent: 1 },
		{ selector: '.mat svg image', label: 'the field picture is drawn', expectPresent: 1, maxPresent: 1 },
		{ selector: '.mat__scrim', label: 'the dimming scrim, drawn only over a picture', expectPresent: 1 },
		/* THE POSITIVE CONTROL FOR EVERY ABSENCE ROW IN THIS SPEC. An absence
		   row cannot tell "the rule holds" from "the selector was renamed", so
		   it sits beside a row proving the same markup is there to be found. */
		{ selector: '.rp__h2', label: 'the planner\'s own section headings', expectPresent: 1 },
		/* A TEAM ACCENT NEVER TOUCHES A MARK (CLAUDE.md, FIRST branding).
		   BrandLogo resets the accent variables on its own wrapper; this is
		   the other half, that no mark is inside the accent-carrying harness
		   at all. `.bf__marks` below is its positive control. */
		{ selector: '.harness [data-accent] .mark', label: 'no official mark inside an accent subtree', expectPresent: 0 },
		{ selector: '.bf__marks .mark', label: 'the footer marks (the control for the row above)', expectPresent: 2 },
		/* BrandLogo REFUSES rather than distorting, and marks the refusal.
		   Zero refusals is the passing state; the row exists so a refusal
		   caused by a future layout change is visible instead of silent. */
		{ selector: '[data-brand-refused]', label: 'no mark refused itself on this surface', expectPresent: 0 }
	],
	contrast: [
		{ selector: '.harness .rp__h2', label: 'planner section headings', min: 4.5 },
		{ selector: '.harness .rp .small.muted', label: 'the muted explanatory copy', min: 4.5 },
		/* THE SVG LABELS, WHICH ARE THE WHOLE REASON THIS ROUTE IS HERE. Each
		   sits on a sibling shape or on the picture, not on a background of
		   its own, and the mat is a light plate under a dark app. */
		{ selector: '.mat text.mat__launch-label', label: 'the launch area label on the mat', min: 4.5 },
		{ selector: '.mat .mat__axes text', label: 'the ruler tick labels', min: 4.5 },
		{ selector: '.bf__tm', label: 'the trademark attribution in the footer', min: 4.5 }
	],
	tapTargets: [
		/* 44px is the floor for anything a finger uses (CLAUDE.md: "Touch
		   targets are 44px minimum ... The users are nine"). `.btn--small` is
		   a DESKTOP affordance and `@media (pointer: coarse)` puts it back to
		   44px -- the harness reports `pointer: fine`, so a small button
		   measuring under 44 here is the desktop reading and correct. This row
		   therefore names the planner's PRIMARY and SECONDARY controls, not
		   every button on the surface. */
		{ selector: '.harness .rp .btn:not(.btn--small)', label: 'planner controls that are not the desktop-compact size', min: 44 }
	],
	textContains: [
		/* THE ATTRIBUTION IS QUOTED, NOT WRITTEN (CLAUDE.md, FIRST branding):
		   `TRADEMARK_ATTRIBUTION` is the IP policy's section IV.A joint
		   FIRST/LEGO disclaimer word for word. It is present, visible and
		   readable on every other check in this file even when its words have
		   drifted, which is what this check is for. `mustNot` carries the two
		   phrases from the OTHER candidates in that section, which say the
		   marks are used by special permission -- a permission this club has
		   not been granted. */
		{
			selector: '.bf__tm',
			label: 'the joint trademark disclaimer, verbatim',
			must: [
				'is a jointly held trademark of',
				'neither of which is overseeing, involved with, or responsible for this activity, product, or service.'
			],
			mustNot: ['special permission', 'endorsed by']
		}
	],
	ignoreConsole: [
		/* The harness blocks every non-loopback request, and the fixture
		   picture is a data: URI rather than a fetch, so nothing here should
		   log. No pattern is listed: a console error on this route is a
		   finding. */
	]
};
