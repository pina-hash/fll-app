---
title: "2026-08-27 -- --season was never an alias, so the alias test could not see it"
date: 2026-08-27
branches: []
migrations: []
subsystems: ["Visual theme, brand"]
record_order: 26
---

Two contrast failures in the mentor console chrome, found by the previous
bundle's sweep and deferred as a different surface. Both on the paper ground,
both on every mentor screen:

    .shell__season-name   --season (mint) on bone      1.14
    .shell__tab--on       --accent-text on --accent-soft  3.88

The first is the interesting one. It is the alias bug again, in a shape the
alias test was structurally unable to see, and it landed ONE DAY after that
test shipped, while the test was passing.

### The cause

`--season` was declared in the PALETTE BLOCK at the top of `colors.css`, whose
selector list is `:root, [data-ground='dark'], [data-ground='paper'],
[data-ground='light']`. One declaration, four ground selectors: both grounds got
IDEA mint, which is 1.27 on the bone sheet and 1.14 behind the header bar it is
actually set on. `--season` is not decoration; the console header and the login
hero both paint the season wordmark with it.

The old check took the DARK SCOPE'S declaration list as the definition of "the
alias set" and asked whether paper and print matched it. Anything the dark scope
did not declare was therefore not in the set and could not be missing from
anything. `--season` was not an alias, so it was not checked, so it was not
found. The test was correct about what it measured and the thing it measured was
the wrong set.

**FIFTH OCCURRENCE, FIFTH DIFFERENT HAT.** A `var()` inside an alias; a hex
inside a component's backplate; four composed shadows on `:root`; a ground-blind
team-accent plate; and now a colour that is simply not an alias. The shapes keep
changing, so the check stopped looking for a shape.

### The widened check

`tests/design-tokens.test.ts` now enumerates. It reads every stylesheet in
`src/lib/design-system/` -- the DIRECTORY, so a new one is covered the day it
lands, not the day somebody remembers to name it -- finds every custom property
whose value is a colour, and asks one question of each: is it declared at TWO
DISTINCT SITES, one the dark ground reaches and the paper ground does not, and
one the other way round?

**TWO SITES IS THE WHOLE TEST, and that is the part worth keeping.** A single
declaration cannot hold two values however many ground selectors it names, which
is exactly how the palette block managed to look correct. Two sites with the
SAME value is fine and is not the bug: `--rule-gray` is deliberately identical on
both grounds, and because it is written twice, changing one is visible.

Colour detection includes the bare rgb-triple idiom (`--shadow-color: 0, 0, 0`),
which is a colour with the function pulled off and would have been the next thing
through. A property is judged over its whole set of declarations rather than one
at a time, because the paper ground writes `--glow: none`, which is not a colour
but IS the paper answer for a property whose dark answer is one; judging it alone
called a present site a missing one.

Measured: **77 colour-valued custom properties**, of which 20 have a single
ground-blind site. Nineteen are exempt and one was the bug.

### The allow list, in full, and why neither half is taken on trust

**RAW PALETTE (13).** `--idea-mint`, `--idea-bone`, `--idea-dim`, `--idea-gear`,
`--idea-brass`, `--idea-patina`, `--idea-copper`, `--idea-crimson`,
`--program-fll`, `--program-fll-explore`, `--program-fll-discover`,
`--program-fll-ink`, `--program-rule`. The IDEA ones are the raw named colours an
alias's literal came from, and `colors.css` has always claimed "no rule below
points at these by name". The FIRST LEGO League ones are published values used
UNMODIFIED: darkening a brand colour for a ground and still calling it the brand
colour is the thing the guidelines forbid, so they are ground-independent by
mandate, and the alias that actually lands on a ground is `--rule-gray`, declared
in both scopes.

That exemption is safe ONLY because nothing uses them, so **the claim is
asserted rather than assumed**: a case greps every tracked source file and fails
if any rule references one. Measured today: zero references, all thirteen. The
moment a component writes `var(--idea-mint)`, the test goes red instead of the
colour going out on a paper ground.

**GROUND-PAIRED (6).** `--accent-on-dark`, `--accent-on-light`,
`--accent-ink-on-dark`, `--accent-ink-on-light`, `--accent-wash-on-dark`,
`--accent-wash-on-light`. A team accent carries its ground in its own NAME, so
the pair is the scope; team-accents.css argues that at length and the reason is
the forced-light mat plate. That exemption is safe only while the pairs are
complete, because one half alone falls through the var() chain to `--text-2` and
a team silently loses its colour on one ground. So a case walks team-accents.css
and requires every `-on-light` to have its `-on-dark` in the SAME rule. Measured:
66 paired properties, 0 broken.

Two further cases keep the list itself honest: an entry whose property no longer
exists fails, and an entry that IS now declared per ground fails, so an exemption
cannot outlive its reason.

### The control, run before the fix

Required by the task and it is the point: a widened check that goes green on the
bug it was written for has not been shown to work, which is exactly how the alias
test passed while missing 63 aliases. Run against the UNFIXED stylesheet, the
enumeration reported one orphan and only one:

    FAIL  every colour in the token layer is declared once per ground >
          each one has a dark site and a paper site, and they are different sites
    + [
    +   "--season is declared at 2 screen site(s): {:root, [data-ground='dark'],
    +    [data-ground='paper'], [data-ground='light']} = #8fe08a |
    +    {[data-season='bioglow']} = #93d6c8",
    + ]
    Tests  1 failed | 17 passed (18)

The 17 passing beside it matter too: widening the check did not redden anything
that was already right.

The control SHIPS, over a mutated copy of the real stylesheet: every `--season`
declaration is removed and exactly one is put back in the shared palette block,
which is the state it shipped in. It asserts the enumeration flags that, AND that
the shipped sheet passes, so the case cannot go green by the enumeration simply
answering false to everything.

### The fix

`--season` is a ground alias now: `#8fe08a` dark, `#226e1d` paper, `#226e1d`
print. The paper value is the literal `--accent` already takes there, so no new
colour enters the system. Measured 11.90 / 4.53 on `--chrome-bg`, which is the
header bar the wordmark actually sits on and is NOT one of the three surfaces --
that is why it is now in `theme-contrast.test.ts` with `--chrome-bg` named
explicitly in its surface list.

**THE BIOGLOW RESKIN HAD THE SAME DEFECT WAITING.** `[data-season='bioglow']` was
one rule naming no ground, so the first time anyone set that attribute the dark
cyan would have gone onto the printed page at 1.98. It is two rules now, dark
`#93d6c8` and paper `#286a5d`, which are this file's own `--patina` on each
ground. The attribute is currently set by nothing, so the reskin is dead code
today; it is dead code that is now correct.

**KNOWN LIMIT, WRITTEN DOWN RATHER THAN HIDDEN:** a forced paper plate inside a
dark document inherits the dark season, because `data-season` sits on the root
and the compound selector cannot match the plate. Team accents solve that with
ground-named pairs and a season would need the same if the wordmark ever went
inside a plate. It does not: both consumers are at document level. The comment in
`colors.css` says so.

### The tab

`.shell__tab--on` is a filled pill: `--accent-ink` on `--accent`, 11.14 dark and
5.07 paper. Same resolution as the code generator's current step chip, same
reason, and no reason was found for the nav to differ. Looked at on both grounds
before keeping it: a mint pill in the dark chrome bar and a deep-green one on
paper, which is the treatment the primary button already uses, so "the one you
are on" now says the same thing everywhere in the app.

Worth stating why the wash failed at all, since `--accent-text` is derived to
clear 4.5: the nav's ground is `--chrome-bg`, not one of the three surfaces, and
a 12% wash over it lands on `#c8cdb5`, darker than anything `--accent-text` was
measured against.

### Measured

- **Every mentor route, both grounds, both widths: 44 screens, 0 pairings under
  the floor, 0px horizontal overflow on all 44.** Routes discovered from the
  nav itself rather than typed: `/app`, the eight nav destinations, and the two
  drill-ins. Before this bundle the same sweep found three pairings on each of
  the light-ground screens.
- **No student surface moved, and the harness is shown to be capable of seeing
  it if one had.** A full-page screenshot hash CANNOT answer this: two
  back-to-back runs of identical code differ, because these screens carry a
  clock and a live dot. So what was measured is what this bundle changes:
  for every element, in DOM order, the computed `color`,
  `background-color`, the four border colours, `outline-color`, `fill`,
  `stroke`, `box-shadow`, `text-shadow`, `caret-color` and `column-rule-color`.
  That collector is deterministic (proved: two runs, identical). Sixteen
  student screens (seven `/app/me*` routes plus `/board`, both grounds) hash
  IDENTICALLY at HEAD and with the bundle. The control: the same collector on
  `/app/board` and `/app/teams` differs on all four, at the same element
  counts, so the difference is colour and the harness sees it.
- **`npx svelte-check`: 0 errors, 0 warnings, 723 files.**
- **Full suite on a database rebuilt from the chain: 28 files failed / 19
  passed, 130 tests failed / 458 passed / 92 skipped.** The stand-in is not
  GoTrue and not PostgREST, so most of the suite cannot pass here and only the
  DIFFERENCE is honest: HEAD was 130 failed / 450 passed. Same 130 failures,
  +8 passing. The two touched files alone go 106 to 114, which accounts for the
  +8 exactly: nothing that passed before stopped passing.

### Not verified

- **GoTrue and PostgREST were not in the loop**, for the third bundle running:
  no container registry is reachable from this session. Every claim here is a
  RENDERING claim -- computed styles, resolved grounds, measured contrast,
  overflow -- and none of them depends on which server answered the data call.
- **No printed sheet was produced.** `--season` is asserted in the print scope
  for completeness and measured on the paper ground it copies; it has not been
  through a print dialog.
- **The BIOGLOW reskin was not exercised**, because nothing sets
  `data-season`. Its two rules are measured as colours and asserted by the
  enumeration; the selectors themselves have not been matched by a real
  document.

### Found, not fixed

- **`src/lib/design-system/index.css`'s header is stale.** It says the token
  entry point is "built on the official FIRST and FIRST LEGO League palettes and
  the Roboto family". Both were true before the IDEA bundle and neither is now:
  the identity is the IDEA pathway and the faces are Chakra Petch and Rajdhani.
  It is a comment, it changes no behaviour, and it is not what this bundle was
  asked to touch.

