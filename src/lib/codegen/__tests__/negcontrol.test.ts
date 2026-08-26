// @ts-nocheck -- the sixteen control cases below are the tarball's, byte for
// byte, and one of them does not typecheck under this repo's strict settings:
// the un-annotated .find() callback in "speed floor hoisted out of the
// tolerance branch" makes tsc report TS7022 on a `const c` whose type it
// cannot infer without circularity. Annotating that callback would be editing
// a control case, which is the one thing this file must not do, so the file
// opts out of tsc instead. vitest still type-strips and RUNS every case, and
// the emitter it exercises is fully checked. Delete this line the day the
// control cases are allowed to change.
// Negative controls. A check that has never failed has not been tested.
import { expect, test } from "vitest";
import registry from "../../../../docs/FLL_VERIFIED_SHAPES.json";
import { Builder, resetIds } from "../blocks.js";
import { buildToolkit, type RobotConfig, type Calibration } from "../toolkit.js";
import { validate, type PackOpts } from "../package.js";
import { layout } from "../layout.js";
const cfg: RobotConfig = { wheelDiameterMm: 56, trackWidthMm: 112, gearRatio: 1,
  movementPair: "AB", leftMotor: "A", rightMotor: "B", attachmentMotors: ["C"],
  leftColorPort: "E", rightColorPort: "F", yawAxis: "up" };
const cal: Calibration = { white: 95, black: 12 };

function fresh(): PackOpts {
  resetIds();
  const b = new Builder();
  buildToolkit(b, cfg, cal);
  const extensions = b.normalize();
  layout(b.blocks);
  return { name: "x", slotIndex: 0, blocks: b.blocks, variables: b.variables, extensions };
}

// vitest intercepts console.*, and a control suite whose whole product is a
// per-case CAUGHT/MISSED line must not have that line swallowed. Same reasoning
// as tests/db/linked.ts writing its skip reason to the real stream.
const say = (line: string) => process.stdout.write(line + "\n");

/**
 * V9 asks the registry which shapes are real. docs/FLL_VERIFIED_SHAPES.json is
 * a placeholder in this checkout, so every case would report against an empty
 * registry: the thirteen negative controls would "catch" on V9 noise instead of
 * on the defect each one injects, and the three positive controls would trip.
 *
 * So the suite SKIPS, LOUDLY, the way tests/db/linked.ts does. A silent skip
 * would let a bare "16 skipped" read as a pass, which is exactly what a control
 * suite exists to prevent. Drop the real registry in and this goes away.
 */
const placeholder = (registry as { _meta: { placeholder?: boolean } })._meta.placeholder === true;
if (placeholder) {
  const rule = "=".repeat(72);
  process.stderr.write([
    "", rule,
    "SKIPPED (not passed): codegen negative controls",
    "  docs/FLL_VERIFIED_SHAPES.json is a placeholder: its shapes map is empty.",
    "",
    "  These sixteen cases are the only thing that establishes the validator",
    "  fires on a broken file and stays silent on a legal one. This run did",
    "  NOT check that. No .llsp3 this checkout produces has been validated.",
    rule, "", ""
  ].join("\n"));
}
const control = placeholder ? test.skip : test;

function expectCatch(label: string, check: string, mutate: (o: PackOpts) => void) {
  control(`${check}  ${label}`, () => {
    const o = fresh(); mutate(o);
    const hits = validate(o).filter(f => f.check === check);
    const ok = hits.length > 0;
    say(`  ${ok ? "CAUGHT " : "MISSED "} ${check}  ${label}`);
    expect(ok, `${check} stayed silent on a file it must reject: ${label}`).toBe(true);
  });
}

say("negative controls (each breaks the file; the check must fire):");

expectCatch("phantom namespace, the Probe C failure", "V9", o => {
  const k = Object.keys(o.blocks).find(k => o.blocks[k].opcode === "flipperlight_lightDisplayText")!;
  o.blocks[k].opcode = "flipperdisplay_ledMatrixText";
  o.extensions.push("flipperdisplay");
});
expectCatch("opcode absent from the registry", "V9", o => {
  const k = Object.keys(o.blocks).find(k => o.blocks[k].opcode === "flippermove_stopMove")!;
  o.blocks[k].opcode = "flippermove_invented";
});
expectCatch("namespace used but not declared", "V9", o => {
  o.extensions = o.extensions.filter(e => e !== "flippermoremove");
});
expectCatch("sensor loop with no timeout, T12 hard rule", "V1", o => {
  const k = Object.keys(o.blocks).find(k => o.blocks[k].opcode === "control_repeat_until")!;
  const cond = (o.blocks[k].inputs.CONDITION as any[])[1];
  // replace the whole condition with a bare comparison, stripping the timer
  const g = Object.keys(o.blocks).find(x => o.blocks[x].opcode === "operator_gt"
    && x !== cond && o.blocks[x].parent !== null)!;
  o.blocks[k].inputs.CONDITION = [2, g];
  o.blocks[g].parent = k;
});
expectCatch("parent disagrees with the input holding it", "V6", o => {
  const k = Object.keys(o.blocks).find(k => o.blocks[k].opcode === "operator_mod")!;
  o.blocks[k].parent = "nonexistentblockid00";
});
expectCatch("dangling input reference", "V6", o => {
  const k = Object.keys(o.blocks).find(k => Object.values(o.blocks[k].inputs)
    .some(v => typeof (v as any[])[1] === "string"))!;
  const nm = Object.keys(o.blocks[k].inputs).find(x =>
    typeof (o.blocks[k].inputs[x] as any[])[1] === "string")!;
  (o.blocks[k].inputs[nm] as any[])[1] = "ghostblockid00000000";
});
expectCatch("orphan block unreachable from any hat", "V6", o => {
  o.blocks["orphanblockid0000000"] = { opcode: "flippermove_stopMove", next: null,
    parent: null, inputs: {}, fields: {}, shadow: false, topLevel: false };
});

expectCatch("T3 speed floor removed, the defect that shipped in v1", "V10", o => {
  for (const [k, b] of Object.entries(o.blocks)) {
    const c = (b.inputs.CONDITION as any[])?.[1];
    if (b.opcode === "control_if" && typeof c === "string") {
      const lhs = (o.blocks[c]?.inputs?.OPERAND1 as any[])?.[1];
      if (typeof lhs === "string" && o.blocks[lhs]?.fields?.VARIABLE?.[0] === "_mag") {
        const prev = Object.keys(o.blocks).find(x => o.blocks[x].next === k);
        if (prev) o.blocks[prev].next = b.next;
        delete o.blocks[k];
      }
    }
  }
});
expectCatch("T13 settling wait removed after a yaw reset", "V10", o => {
  const k = Object.keys(o.blocks).find(k => o.blocks[k].opcode === "flippersensors_resetYaw")!;
  o.blocks[k].next = o.blocks[o.blocks[k].next!].next;
});
expectCatch("T5 distance read from one motor only", "V10", o => {
  const k = Object.keys(o.blocks).find(k => o.blocks[k].opcode === "flippermoremotor_position")!;
  o.blocks[k].opcode = "flippermoremotor_power";
});
expectCatch("T14 preamble stop method removed", "V10", o => {
  const k = Object.keys(o.blocks).find(k => o.blocks[k].opcode === "flippermoremove_movementSetStopMethod")!;
  o.blocks[k].opcode = "flippermove_stopMove";
});

expectCatch("two stacks placed on top of each other", "V11", o => {
  const roots = Object.keys(o.blocks).filter(k => o.blocks[k].topLevel);
  o.blocks[roots[1]].x = o.blocks[roots[0]].x;
  o.blocks[roots[1]].y = o.blocks[roots[0]].y;
});

expectCatch("speed floor hoisted out of the tolerance branch", "V10", o => {
  // lift the floor guard chain out of the else arm and splice it after the if/else
  const ifElse = Object.keys(o.blocks).find(k => {
    if (o.blocks[k].opcode !== "control_if_else") return false;
    const alt = (o.blocks[k].inputs.SUBSTACK2 as any[])?.[1];
    if (typeof alt !== "string") return false;
    let cur: string | null = alt, seen = 0;
    while (cur && seen++ < 10) {
      const c = (o.blocks[cur].inputs.CONDITION as any[])?.[1];
      if (o.blocks[cur].opcode === "control_if" && typeof c === "string") {
        const lhs = (o.blocks[c].inputs.OPERAND1 as any[])?.[1];
        if (typeof lhs === "string" && o.blocks[lhs]?.fields?.VARIABLE?.[0] === "_mag") return true;
      }
      cur = o.blocks[cur].next;
    }
    return false;
  })!;
  const alt = (o.blocks[ifElse].inputs.SUBSTACK2 as any[])[1];
  let prev = alt, floorStart: string | null = null;
  let cur: string | null = alt;
  while (cur) {
    const c = (o.blocks[cur].inputs.CONDITION as any[])?.[1];
    if (o.blocks[cur].opcode === "control_if" && typeof c === "string") {
      const lhs = (o.blocks[c].inputs.OPERAND1 as any[])?.[1];
      if (typeof lhs === "string" && o.blocks[lhs]?.fields?.VARIABLE?.[0] === "_mag") { floorStart = cur; break; }
    }
    prev = cur; cur = o.blocks[cur].next;
  }
  o.blocks[prev].next = null;
  o.blocks[ifElse].next = floorStart;
  o.blocks[floorStart!].parent = ifElse;
});

// Positive controls: legal changes must NOT trip anything. The first attempt at this
// swapped a whole input, which orphaned the reporter that had been in it, and V6 fired
// correctly. The control was wrong, not the check. A legal edit changes a literal in
// place and orphans nothing.
function expectSilent(label: string, mutate: (o: PackOpts) => void) {
  control(`legal edit  ${label}`, () => {
    const o = fresh(); mutate(o);
    const f = validate(o);
    const ok = f.length === 0;
    say(`  ${ok ? "SILENT " : "FALSE+ "} ---  ${label}${ok ? "" : "  <- " + f[0].check + " " + f[0].detail}`);
    expect(f, `a legal edit tripped a check: ${label}`).toEqual([]);
  });
}
say("\npositive controls (legal edits; nothing may fire):");
expectSilent("retune a proportional constant", o => {
  const k = Object.keys(o.blocks).find(k => o.blocks[k].opcode === "operator_multiply"
    && (o.blocks[k].inputs.NUM2 as any[])?.[1]?.[1] === "1.2")!;
  (o.blocks[k].inputs.NUM2 as any[])[1][1] = "0.9";
});
expectSilent("change a stop method", o => {
  const k = Object.keys(o.blocks).find(k => o.blocks[k].opcode === "flippermoremove_movementSetStopMethod")!;
  o.blocks[k].fields.STOP = ["coast", null];
});
expectSilent("recalibrate a light threshold", o => {
  const k = Object.keys(o.blocks).find(k => o.blocks[k].opcode === "operator_subtract"
    && (o.blocks[k].inputs.NUM2 as any[])?.[1]?.[1] === "12")!;
  (o.blocks[k].inputs.NUM2 as any[])[1][1] = "18";
});
