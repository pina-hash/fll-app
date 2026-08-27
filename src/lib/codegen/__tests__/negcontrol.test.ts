// Negative controls. A check that has never failed has not been tested.
import { expect, test } from "vitest";
import registry from "../../../../docs/FLL_VERIFIED_SHAPES.json";
import { Builder, resetIds } from "../blocks.js";
import { buildToolkit, type RobotConfig, type Calibration } from "../toolkit.js";
import { pack, validate, verifyContainer, type EmitSource, type PackOpts } from "../package.js";
import { layout } from "../layout.js";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
const cfg: RobotConfig = { wheelDiameterMm: 56, trackWidthMm: 112, gearRatio: 1,
  movementPair: "AB", leftMotor: "A", rightMotor: "B", attachmentMotors: ["C"],
  leftColorPort: "E", rightColorPort: "F", yawAxis: "up" };
const cal: Calibration = { white: 95, black: 12 };

// The source and the block graph come back together, because validate() needs
// both and V5 can only be broken through the source: by the time the emitter
// has run, the calibration is two literals among four hundred.
function fresh(k: Calibration = cal): { o: PackOpts; src: EmitSource } {
  resetIds();
  const b = new Builder();
  buildToolkit(b, cfg, k);
  const extensions = b.normalize();
  layout(b.blocks);
  return {
    o: { name: "x", slotIndex: 0, blocks: b.blocks, variables: b.variables, extensions },
    src: { config: cfg, calibration: k },
  };
}

// vitest intercepts console.*, and a control suite whose whole product is a
// per-case CAUGHT/MISSED line must not have that line swallowed. Same reasoning
// as tests/db/linked.ts writing its skip reason to the real stream.
const say = (line: string) => process.stdout.write(line + "\n");

/**
 * V9 asks the registry which shapes are real. docs/FLL_VERIFIED_SHAPES.json is
 * a placeholder in this checkout, so every case would report against an empty
 * registry: the twenty-three negative controls would "catch" on V9 noise instead
 * of on the defect each one injects, and the five positive controls would trip.
 * V8 asks the same file for its container block, so its cases go the same way.
 *
 * So the suite SKIPS, LOUDLY, the way tests/db/linked.ts does, rather than
 * emitting twenty-nine identical RegistryFault stack traces that say nothing
 * about the twenty-nine defects. The skip is NOT the guard: registry-guard.test.ts fails
 * the run outright when the shipped registry is a placeholder, so a run in that
 * state is red with one legible cause, never a green wall of skips.
 */
const placeholder = (registry as { _meta: { placeholder?: boolean } })._meta.placeholder === true;
if (placeholder) {
  const rule = "=".repeat(72);
  process.stderr.write([
    "", rule,
    "SKIPPED (not passed): codegen negative controls",
    "  docs/FLL_VERIFIED_SHAPES.json is a placeholder: its shapes map is empty.",
    "",
    "  These twenty-nine cases are the only thing that establishes the validator",
    "  fires on a broken file and stays silent on a legal one. This run did",
    "  NOT check that. No .llsp3 this checkout produces has been validated.",
    rule, "", ""
  ].join("\n"));
}
const control = placeholder ? test.skip : test;

function expectCatch(label: string, check: string, mutate: (o: PackOpts) => void) {
  control(`${check}  ${label}`, () => {
    const { o, src } = fresh(); mutate(o);
    const hits = validate(o, src).filter(f => f.check === check);
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
      const c: unknown = (o.blocks[cur].inputs.CONDITION as any[])?.[1];
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

// V5, calibration sanity. The defect is LIVE and it is not in the block graph:
// buildToolkit divides by (white - black) and emits the quotient as a literal,
// so these three pairs each bake a broken line follower into a file that passes
// every other check. Broken through the SOURCE, because that is the only place
// the two numbers still exist as numbers.
function expectCalibrationCatch(label: string, k: Calibration) {
  control(`V5  ${label}`, () => {
    const { o, src } = fresh(k);
    const hits = validate(o, src).filter(f => f.check === "V5");
    const ok = hits.length > 0;
    say(`  ${ok ? "CAUGHT " : "MISSED "} V5  ${label}${ok ? "  <- " + hits[0].detail : ""}`);
    expect(ok, `V5 stayed silent on a calibration it must reject: ${label}`).toBe(true);
    // The finding has to name the port and both readings, or a mentor at the
    // table cannot tell which sensor to put back on the mat.
    for (const port of [cfg.leftColorPort, cfg.rightColorPort]) {
      expect(hits.some(h => h.detail.includes(`port ${port}`)),
        `V5 fired without naming port ${port}`).toBe(true);
    }
    expect(hits[0].detail).toContain(`white ${k.white}`);
    expect(hits[0].detail).toContain(`black ${k.black}`);
  });
}
expectCalibrationCatch("white equals black, a division by zero inside the generated blocks",
  { white: 55, black: 55 });
expectCalibrationCatch("white darker than black, every line reading inverted",
  { white: 12, black: 95 });
expectCalibrationCatch("legal for the database but too narrow to bake",
  { white: 30, black: 20 });

// V8, the container round trip. These break the PACKED BYTES rather than the
// block graph, which is the gap V8 exists to close: an emitter that holds the
// right manifest and then writes it wrong passes every other check in the file.
type Parts = {
  manifest: Record<string, unknown>;
  project: Record<string, unknown>;
  stubName: string;
  stubBytes: Uint8Array;
  outerNames: [string, string, string];
  outerLevel: 0 | 6;
  projectLevel: 0 | 6;
  assetLevel: 0 | 6;
};

/** A real pack() output, taken apart into the pieces a control can break. */
function opened(): Parts {
  const { o } = fresh();
  const outer = unzipSync(pack(o));
  const names = Object.keys(outer) as [string, string, string];
  const inner = unzipSync(outer["scratch.sb3"]);
  const stubName = Object.keys(inner).find(k => k !== "project.json")!;
  return {
    manifest: JSON.parse(strFromU8(outer["manifest.json"])),
    project: JSON.parse(strFromU8(inner["project.json"])),
    stubName,
    stubBytes: inner[stubName],
    outerNames: names,
    outerLevel: 0,
    projectLevel: 6,
    assetLevel: 0,
  };
}

/** Put the pieces back together the way pack() does, defects and all. */
function sealed(p: Parts): Uint8Array {
  const sb3 = zipSync({
    "project.json": [strToU8(JSON.stringify(p.project)), { level: p.projectLevel }],
    [p.stubName]: [p.stubBytes, { level: p.assetLevel }],
  } as never);
  const [a, b, c] = p.outerNames;
  return zipSync({
    [a]: strToU8(JSON.stringify(p.manifest)),
    [b]: sb3,
    [c]: strToU8('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 261 238"></svg>'),
  }, { level: p.outerLevel });
}

function expectContainerCatch(label: string, mutate: (p: Parts) => void) {
  control(`V8  ${label}`, () => {
    const p = opened(); mutate(p);
    const hits = verifyContainer(sealed(p)).findings;
    const ok = hits.length > 0;
    say(`  ${ok ? "CAUGHT " : "MISSED "} V8  ${label}${ok ? "  <- " + hits[0].detail : ""}`);
    expect(ok, `V8 stayed silent on a container it must reject: ${label}`).toBe(true);
  });
}
expectContainerCatch("manifest version is not the locked 38", p => { p.manifest.version = 37; });
expectContainerCatch("project.json meta.vm drifted from the app's",
  p => { (p.project.meta as Record<string, unknown>).vm = "0.2.0-prerelease.20990101000000"; });
expectContainerCatch("an outer entry renamed, so the app finds no scratch.sb3",
  p => { p.outerNames = [p.outerNames[0], "project.sb3", p.outerNames[2]]; });
expectContainerCatch("outer entries deflated, not stored", p => { p.outerLevel = 6; });
expectContainerCatch("project.json stored, not deflated", p => { p.projectLevel = 0; });
// The defect pack() actually had. fflate deflates every entry at its default
// level, including a zero-byte one, so the stub asset went out DEFLATED while
// the app writes it STORED. Nothing else in the file could see it: the bytes
// unzip identically either way and the block graph is untouched.
expectContainerCatch("the stub asset deflated, not stored", p => { p.assetLevel = 6; });
expectContainerCatch("the stub asset carries bytes",
  p => { p.stubBytes = strToU8("<svg/>"); });

/**
 * A manifest field with nothing vouching for it is NAMED, not accepted and not
 * refused. Reporting it as a finding would withhold every file this emitter
 * produces over fields nobody has observed the app writing yet; dropping it
 * would let one enter the manifest in silence.
 */
control("V8  a field the registry does not mention is reported, not accepted", () => {
  const p = opened();
  p.manifest.unobservedField = "whatever the emitter felt like";
  const report = verifyContainer(sealed(p));
  say(`  REPORTED V8  ${report.unpinned.length} unpinned manifest field(s)`);
  expect(report.findings, "an unmentioned field is not a defect in the file").toEqual([]);
  expect(report.unpinned).toContain("unobservedField");
  // `version` is the one field the container block pins, so it is never listed.
  expect(report.unpinned).not.toContain("version");
});

// Positive controls: legal changes must NOT trip anything. The first attempt at this
// swapped a whole input, which orphaned the reporter that had been in it, and V6 fired
// correctly. The control was wrong, not the check. A legal edit changes a literal in
// place and orphans nothing.
function expectSilent(label: string, mutate: (o: PackOpts) => void, k: Calibration = cal) {
  control(`legal edit  ${label}`, () => {
    const { o, src } = fresh(k); mutate(o);
    const f = validate(o, src);
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

// V5's positive control. A guard that fires on legitimate work gets deleted, and
// a margin is exactly the kind of guard that does: white 41 on black 20 is a
// dim hall and a sensor sitting a little high, which is a real Saturday and not
// a mistake. 21 clears the floor of 20 by one point, so this is the narrowest
// pair the check may accept, and it must accept it in silence.
expectSilent("a narrow but legal calibration, 21 points apart", () => {}, { white: 41, black: 20 });

/**
 * V8's positive control. It runs on real pack() output taken apart and put back
 * together unchanged, so a failure here means `sealed()` and pack() have drifted
 * and every V8 case above is testing a container this repo does not produce.
 */
control("legal edit  a real container round-trips with nothing to report", () => {
  const clean = verifyContainer(sealed(opened()));
  const ok = clean.findings.length === 0;
  say(`  ${ok ? "SILENT " : "FALSE+ "} ---  a real container round trip${ok ? "" : "  <- " + clean.findings[0].detail}`);
  expect(clean.findings, "V8 fired on a container pack() actually produces").toEqual([]);
});

/** And the same, on bytes pack() produced with nothing taken apart at all. */
control("legal edit  pack() output straight from the emitter", () => {
  const { o } = fresh();
  const clean = verifyContainer(pack(o));
  const ok = clean.findings.length === 0;
  say(`  ${ok ? "SILENT " : "FALSE+ "} ---  pack() output unmodified${ok ? "" : "  <- " + clean.findings[0].detail}`);
  expect(clean.findings, "V8 fired on untouched pack() output").toEqual([]);
});
