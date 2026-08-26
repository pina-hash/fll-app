# FLL_CODEGEN_SPEC.md

**THIS IS A PLACEHOLDER. The specification itself is not in this repo and was
not in `fll-codegen-src.tar.gz`.**

The emitter that landed in `src/lib/codegen/` cites this document by number
throughout: its techniques as `T1`..`T17`, its validator checks as `V1`, `V6`,
`V9`, `V10`, `V11`. Those citations are the only trace of the spec that exists
here. What follows is an INDEX of them, quoted from the landed code's own
comments so a reader can find the rule a number refers to. It is not the spec,
it does not restate the reasoning, and it must be replaced by the real
document rather than grown into a substitute for it.

## Techniques cited by the emitter

| # | Where it is implemented | What the code says it is |
|---|---|---|
| T1, T2, T3 | `toolkit.ts`, `TURN TO` | wrapped heading error `((target - yaw + 180) mod 360) - 180`, proportional turn with a floor and a cap, and a settle window |
| T3b | `package.ts`, V10 | the speed floor sits INSIDE the out-of-tolerance branch, or the turn oscillates until the timeout |
| T4, T5 | `toolkit.ts`, `DRIVE` | heading-corrected straight drive; mm to motor degrees, measured as the mean of BOTH drive motors |
| T6 | `toolkit.ts`, `SQUARE ON WALL` | re-reference heading against a wall, timed-press form |
| T7 | `toolkit.ts`, `SQUARE ON LINE` | two passes, dark then light |
| T8 | `toolkit.ts`, `normalizedLight` | `(raw - black) / (white - black) * 100`, calibration constants baked in |
| T9 | `toolkit.ts`, `DRIVE` | correction clamp on the straight drive |
| T12 | `toolkit.ts`, `timedOut` | every sensor wait gets a timeout. No exceptions, no opt-out |
| T13 | `toolkit.ts` | a yaw reset is followed by a settling wait |
| T14 | `toolkit.ts`, `START RUN` | preamble sets the movement pair and the stop method |
| T17 | `toolkit.ts`, `START RUN` | hub yaw axis. NOT EMITTED: the shape is not in the verified registry, so any robot whose hub is not flat-mounted is unsupported |

## Validator checks

| # | What `package.ts` asserts |
|---|---|
| V1 | every `control_repeat_until` / `control_wait_until` has a timer in its condition |
| V6 | link and reachability integrity: no dangling input, no parent that disagrees with the input holding it, no block unreachable from a hat |
| V9 | every opcode is in `FLL_VERIFIED_SHAPES.json`, no opcode is in a namespace this app does not have, and declared extensions cover exactly the namespaces used |
| V10 | technique conformance: T3, T3b, T5, T13, T14 |
| V11 | no two top-level stacks overlap |

`V2`..`V5`, `V7`, `V8` are not referenced by any landed file. Whether they exist
in the real spec is not something this repo can answer.

## What the real document has to carry

Recovered from what the code depends on and cannot restate:

- the empirical record behind `FLL_VERIFIED_SHAPES.json`: which probe established
  each shape, and what the SPIKE App did when a shape was wrong
- the two shadow patterns `blocks.ts` names (`selector`, `menu`) and the probes
  that fixed them
- why `flipperdisplay` is a phantom namespace (the Probe C failure)
- the defect history the comments allude to: the T3 floor that shipped, was
  deleted by an unrelated fix, and survived a clean validator run
