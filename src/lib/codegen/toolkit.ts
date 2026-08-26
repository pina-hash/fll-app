// The eight My Blocks. Ports are baked from RobotConfig because the emitter only
// produces shapes the SPIKE editor can produce natively: a student has to be able
// to open the output and edit it.

import { Builder, n, s, rep, bool, stack, id } from "./blocks.js";

export interface RobotConfig {
  wheelDiameterMm: number;
  trackWidthMm: number;
  gearRatio: number;          // motor rotations per wheel rotation
  movementPair: string;       // "AB"
  leftMotor: string;
  rightMotor: string;
  attachmentMotors: string[]; // ["C","D"]
  leftColorPort: string;
  rightColorPort: string;
  yawAxis: "up" | "down" | "front" | "back" | "left" | "right"; // T17 hub orientation
}

export interface Calibration { white: number; black: number; }

/** T5: distance in motor degrees, computed here and emitted as a literal. */
export function mmToDegrees(mm: number, c: RobotConfig): number {
  return Math.round((mm / (Math.PI * c.wheelDiameterMm)) * 360 * c.gearRatio);
}

interface Proc { proccode: string; argIds: string[]; argNames: string[]; define: string; }

/**
 * Mean of both drive motors' absolute relative position. Measuring one motor
 * misreports path length whenever heading correction is active, which is always.
 */
function travelledFactory(b: Builder, c: RobotConfig) {
  return () => {
    const one = (port: string) => b.op("operator_mathop", {
      NUM: rep(b.add("flippermoremotor_position", {
        inputs: { PORT: [1, b.selector("flippermoremotor_multiple-port-selector", port)] },
      })),
    }, { OPERATOR: ["abs", null] });
    const sum = b.op("operator_add", { NUM1: rep(one(c.leftMotor)), NUM2: rep(one(c.rightMotor)) });
    return b.op("operator_divide", { NUM1: rep(sum), NUM2: n(2) });
  };
}

function defineMyBlock(b: Builder, proccode: string, argNames: string[], x: number, y: number): Proc {
  const argIds = argNames.map((_, i) => `tkarg${String(i)}` + id("").slice(0, 9));
  const proto = id("prt");
  const define = b.add("procedures_definition", { inputs: { custom_block: [1, proto] }, topLevel: true, x, y }, "def");
  const inputs: Record<string, any> = {};
  argNames.forEach((nm, i) => {
    const a = b.add("argument_reporter_string_number", { fields: { VALUE: [nm, null] }, shadow: true }, "pa");
    inputs[argIds[i]] = [1, a];
  });
  b.blocks[proto] = {
    opcode: "procedures_prototype", next: null, parent: define, inputs, fields: {},
    shadow: true, topLevel: false,
    mutation: {
      tagName: "mutation", children: [], proccode,
      argumentids: JSON.stringify(argIds),
      argumentnames: JSON.stringify(argNames),
      argumentdefaults: JSON.stringify(argNames.map(() => "")),
      warp: "false",
    },
  };
  return { proccode, argIds, argNames, define };
}

export function callMyBlock(b: Builder, p: Proc, args: any[]): string {
  const inputs: Record<string, any> = {};
  p.argIds.forEach((aid, i) => { inputs[aid] = args[i]; });
  return b.add("procedures_call", {
    inputs, mutation: {
      tagName: "mutation", children: [], proccode: p.proccode,
      argumentids: JSON.stringify(p.argIds), warp: "false",
    },
  }, "call");
}

/** T2: ((target - yaw + 180) mod 360) - 180. Scratch mod is non-negative for a
 *  positive divisor, so this is correct as written. Proven renderable by Probe D. */
function wrappedError(b: Builder, targetRep: any): string {
  const yaw = b.add("flippersensors_orientationAxis", { fields: { AXIS: ["yaw", null] } }, "yaw");
  const offset = b.varRead("hdgOffset");
  const localTarget = b.op("operator_subtract", { NUM1: targetRep, NUM2: rep(offset) });
  const diff = b.op("operator_subtract", { NUM1: rep(localTarget), NUM2: rep(yaw) });
  const plus = b.op("operator_add", { NUM1: rep(diff), NUM2: n(180) });
  const mod = b.op("operator_mod", { NUM1: rep(plus), NUM2: n(360) });
  return b.op("operator_subtract", { NUM1: rep(mod), NUM2: n(180) });
}

/** T12: every sensor wait gets a timeout. No exceptions, no opt-out. */
function timedOut(b: Builder, seconds: number): string {
  const t = b.add("flippersensors_timer", {}, "tm");
  return b.op("operator_gt", { OPERAND1: rep(t), OPERAND2: s(String(seconds)) });
}

/** T8: normalized = (raw - black) / (white - black) * 100, constants baked. */
function normalizedLight(b: Builder, port: string, cal: Calibration): string {
  const raw = b.add("flippersensors_reflectivity", {
    inputs: { PORT: [1, b.selector("flippersensors_color-sensor-selector", port)] },
  }, "rl");
  const sub = b.op("operator_subtract", { NUM1: rep(raw), NUM2: n(cal.black) });
  const div = b.op("operator_divide", { NUM1: rep(sub), NUM2: n(cal.white - cal.black) });
  return b.op("operator_multiply", { NUM1: rep(div), NUM2: n(100) });
}

/**
 * Clamp |varName| to `limit`, taking sign from `signVar`. Emits
 *   if <(_mag) OP limit> then { if <(signVar) < 0> then set var to -limit else set var to limit }
 */
function clampGuard(b: Builder, varName: string, signVar: string, limit: number,
                    op: "operator_lt" | "operator_gt"): string {
  const signedTo = (v: number) => b.add("control_if_else", {
    inputs: {
      CONDITION: bool(b.op("operator_lt", { OPERAND1: rep(b.varRead(signVar)), OPERAND2: s("0") })),
      SUBSTACK: stack(b.varSet(varName, n(-v))),
      SUBSTACK2: stack(b.varSet(varName, n(v))),
    },
  });
  return b.add("control_if", {
    inputs: {
      CONDITION: bool(b.op(op, { OPERAND1: rep(b.varRead("mag")), OPERAND2: s(String(limit)) })),
      SUBSTACK: stack(signedTo(limit)),
    },
  });
}

export interface Toolkit {
  startRun: Proc; turnTo: Proc; drive: Proc; driveToLine: Proc;
  squareOnLine: Proc; squareOnWall: Proc; followLine: Proc;
  runMotor: Record<string, Proc>;
}

export function buildToolkit(b: Builder, c: RobotConfig, cal: Calibration): Toolkit {
  const travelled = travelledFactory(b, c);
  // Coordinates are placeholders. layout() measures each stack and assigns real
  // positions after the build, because a stack's height is not knowable until it
  // exists and hand-guessed offsets overlapped the moment one grew.
  const nextY = (_h: number) => 0;

  // ---- START RUN (run number) (base speed).  T14 preamble + T17 yaw axis.
  const startRun = defineMyBlock(b, "START RUN %s AT %s SPEED", ["run", "speed"], 40, nextY(340));
  {
    const pair = b.add("flippermove_setMovementPair", {
      inputs: { PAIR: [1, b.selector("flippermove_movement-port-selector", c.movementPair)] },
    });
    const spd = b.add("flippermove_movementSpeed", { inputs: { SPEED: rep(b.arg("speed")) } });
    const acc = b.add("flippermoremove_movementSetAcceleration", {
      inputs: { ACCELERATION: [1, b.menu("flippermoremove_menu_acceleration", "acceleration", "medium")] },
    });
    const stopm = b.add("flippermoremove_movementSetStopMethod", { fields: { STOP: ["brake", null] } });
    // T17 is NOT emitted: flippermoresensors_setOrientation and its menu shadow are
    // not in the verified registry, and V9 correctly refuses unverified shapes. The
    // SPIKE default yaw axis is correct for a flat-mounted hub, so omitting it is
    // safe only for that case. Any robot with a side-mounted or upright hub needs
    // this block, and until the shape is verified that configuration is unsupported.
    const zeroL = b.add("flippermoremotor_motorSetDegreeCounted", {
      inputs: {
        PORT: [1, b.selector("flippermoremotor_multiple-port-selector", c.leftMotor)],
        VALUE: n(0),
      },
    });
    const zeroR = b.add("flippermoremotor_motorSetDegreeCounted", {
      inputs: {
        PORT: [1, b.selector("flippermoremotor_multiple-port-selector", c.rightMotor)],
        VALUE: n(0),
      },
    });
    const ry = b.add("flippersensors_resetYaw");
    const w = b.add("control_wait", { inputs: { DURATION: n(0.05) } });  // T13
    const off = b.varSet("hdgOffset", s("0"));
    const rt = b.add("flippersensors_resetTimer");
    const txt = b.add("flipperlight_lightDisplayText", { inputs: { TEXT: rep(b.arg("run"), "") } });
    b.chain(startRun.define, [pair, spd, acc, stopm, zeroL, zeroR, ry, w, off, rt, txt]);
  }

  // ---- TURN TO (heading) AT (speed) SPEED.  T1 T2 T3 T12.
  const turnTo = defineMyBlock(b, "TURN TO %s AT %s SPEED", ["heading", "speed"], 40, nextY(420));
  {
    const s0 = b.varSet("settled", s("0"));
    const rt = b.add("flippersensors_resetTimer");

    const body: string[] = [];
    body.push(b.varSet("err", rep(wrappedError(b, rep(b.arg("heading"))), "")));
    const absErr = b.op("operator_mathop", { NUM: rep(b.varRead("err")) }, { OPERATOR: ["abs", null] });
    const inTol = b.op("operator_lt", { OPERAND1: rep(absErr), OPERAND2: s("2") });

    // inside tolerance: count toward settled and command zero
    const settleTick = b.varChange("settled", n(1));
    b.blocks[settleTick].next = b.varSet("pwr", s("0"));

    // outside tolerance: proportional, floored to beat static friction, capped so a
    // 180 degree error does not command 216 percent
    const reset = b.varSet("settled", s("0"));
    const prop = b.varSet("pwr", rep(
      b.op("operator_multiply", { NUM1: rep(b.varRead("err")), NUM2: n(1.2) }), ""));
    const mag = b.varSet("mag", rep(
      b.op("operator_mathop", { NUM: rep(b.varRead("pwr")) }, { OPERATOR: ["abs", null] }), ""));
    const floor = clampGuard(b, "pwr", "err", 15, "operator_lt");
    const cap = clampGuard(b, "pwr", "err", 60, "operator_gt");
    b.chain(reset, [prop, mag, floor, cap]);

    body.push(b.add("control_if_else", {
      inputs: { CONDITION: bool(inTol), SUBSTACK: stack(settleTick), SUBSTACK2: stack(reset) },
    }));
    const negP = b.op("operator_subtract", { NUM1: n(0), NUM2: rep(b.varRead("pwr")) });
    body.push(b.add("flippermoremove_startDualSpeed", {
      inputs: { LEFT: rep(b.varRead("pwr")), RIGHT: rep(negP) },
    }));
    for (let i = 0; i < body.length - 1; i++) b.blocks[body[i]].next = body[i + 1];

    // T3 settle window OR T12 timeout
    const settledEnough = b.op("operator_gt", { OPERAND1: rep(b.varRead("settled")), OPERAND2: s("2") });
    const done = b.op("operator_or", { OPERAND1: bool(settledEnough), OPERAND2: bool(timedOut(b, 4)) });
    const loop = b.add("control_repeat_until", {
      inputs: { CONDITION: bool(done), SUBSTACK: stack(body[0]) },
    });
    const stop = b.add("flippermove_stopMove");
    b.chain(turnTo.define, [s0, rt, loop, stop]);
  }

  // ---- DRIVE (mm) AT (speed) HEADING (heading).  T4 T5 T9 T12.
  const drive = defineMyBlock(b, "DRIVE %s MM AT %s SPEED HEADING %s", ["mm", "speed", "heading"], 40, nextY(420));
  {
    const zeroL = b.add("flippermoremotor_motorSetDegreeCounted", {
      inputs: { PORT: [1, b.selector("flippermoremotor_multiple-port-selector", c.leftMotor)], VALUE: n(0) },
    });
    const zeroR = b.add("flippermoremotor_motorSetDegreeCounted", {
      inputs: { PORT: [1, b.selector("flippermoremotor_multiple-port-selector", c.rightMotor)], VALUE: n(0) },
    });
    const rt = b.add("flippersensors_resetTimer");
    // T5: mm -> degrees, evaluated here, emitted as arithmetic on the parameter
    const perMm = 360 * c.gearRatio / (Math.PI * c.wheelDiameterMm);
    const tgt = b.varSet("target", rep(
      b.op("operator_multiply", { NUM1: rep(b.arg("mm")), NUM2: n(Number(perMm.toFixed(4))) }), ""));

    const body: string[] = [];
    body.push(b.varSet("err", rep(wrappedError(b, rep(b.arg("heading"))), "")));
    body.push(b.varSet("corr", rep(
      b.op("operator_multiply", { NUM1: rep(b.varRead("err")), NUM2: n(1.5) }), "")));
    body.push(b.varSet("mag", rep(
      b.op("operator_mathop", { NUM: rep(b.varRead("corr")) }, { OPERATOR: ["abs", null] }), "")));
    body.push(clampGuard(b, "corr", "err", 30, "operator_gt"));
    const lspd = b.op("operator_subtract", { NUM1: rep(b.arg("speed")), NUM2: rep(b.varRead("corr")) });
    const rspd = b.op("operator_add", { NUM1: rep(b.arg("speed")), NUM2: rep(b.varRead("corr")) });
    body.push(b.add("flippermoremove_startDualSpeed", { inputs: { LEFT: rep(lspd), RIGHT: rep(rspd) } }));
    for (let i = 0; i < body.length - 1; i++) b.blocks[body[i]].next = body[i + 1];

    const absPos = travelled();
    const reached = b.op("operator_gt", { OPERAND1: rep(absPos), OPERAND2: rep(b.varRead("target")) });
    const done = b.op("operator_or", { OPERAND1: bool(reached), OPERAND2: bool(timedOut(b, 8)) });
    const loop = b.add("control_repeat_until", { inputs: { CONDITION: bool(done), SUBSTACK: stack(body[0]) } });
    const stop = b.add("flippermove_stopMove");
    b.chain(drive.define, [zeroL, zeroR, rt, tgt, loop, stop]);
  }

  // ---- DRIVE TO LINE (max mm) AT (speed) HEADING (heading).  T8 T12.
  const driveToLine = defineMyBlock(b, "DRIVE TO LINE MAX %s MM AT %s SPEED HEADING %s",
    ["mm", "speed", "heading"], 40, nextY(420));
  {
    const zeroL = b.add("flippermoremotor_motorSetDegreeCounted", {
      inputs: { PORT: [1, b.selector("flippermoremotor_multiple-port-selector", c.leftMotor)], VALUE: n(0) },
    });
    const zeroR = b.add("flippermoremotor_motorSetDegreeCounted", {
      inputs: { PORT: [1, b.selector("flippermoremotor_multiple-port-selector", c.rightMotor)], VALUE: n(0) },
    });
    const rt = b.add("flippersensors_resetTimer");
    const perMm = 360 * c.gearRatio / (Math.PI * c.wheelDiameterMm);
    const tgt = b.varSet("target", rep(
      b.op("operator_multiply", { NUM1: rep(b.arg("mm")), NUM2: n(Number(perMm.toFixed(4))) }), ""));

    const body: string[] = [];
    body.push(b.varSet("err", rep(wrappedError(b, rep(b.arg("heading"))), "")));
    body.push(b.varSet("corr", rep(
      b.op("operator_multiply", { NUM1: rep(b.varRead("err")), NUM2: n(1.5) }), "")));
    body.push(b.varSet("mag", rep(
      b.op("operator_mathop", { NUM: rep(b.varRead("corr")) }, { OPERATOR: ["abs", null] }), "")));
    body.push(clampGuard(b, "corr", "err", 30, "operator_gt"));
    const lspd = b.op("operator_subtract", { NUM1: rep(b.arg("speed")), NUM2: rep(b.varRead("corr")) });
    const rspd = b.op("operator_add", { NUM1: rep(b.arg("speed")), NUM2: rep(b.varRead("corr")) });
    body.push(b.add("flippermoremove_startDualSpeed", { inputs: { LEFT: rep(lspd), RIGHT: rep(rspd) } }));
    for (let i = 0; i < body.length - 1; i++) b.blocks[body[i]].next = body[i + 1];

    const onLine = b.op("operator_lt", {
      OPERAND1: rep(normalizedLight(b, c.leftColorPort, cal)), OPERAND2: s("40"),
    });
    const absPos = travelled();
    const tooFar = b.op("operator_gt", { OPERAND1: rep(absPos), OPERAND2: rep(b.varRead("target")) });
    const bailout = b.op("operator_or", { OPERAND1: bool(tooFar), OPERAND2: bool(timedOut(b, 8)) });
    const done = b.op("operator_or", { OPERAND1: bool(onLine), OPERAND2: bool(bailout) });
    const loop = b.add("control_repeat_until", { inputs: { CONDITION: bool(done), SUBSTACK: stack(body[0]) } });
    const stop = b.add("flippermove_stopMove");
    b.chain(driveToLine.define, [zeroL, zeroR, rt, tgt, loop, stop]);
  }

  // ---- SQUARE ON LINE AT (speed).  T7 two passes, refined.
  const squareOnLine = defineMyBlock(b, "SQUARE ON LINE AT %s SPEED", ["speed"], 40, nextY(400));
  {
    const seq: string[] = [];
    for (const [threshold, cmp] of [["40", "lt"], ["60", "gt"]] as const) {
      const rt = b.add("flippersensors_resetTimer");
      const lDark = () => b.op(`operator_${cmp}`, {
        OPERAND1: rep(normalizedLight(b, c.leftColorPort, cal)), OPERAND2: s(threshold),
      });
      const rDark = () => b.op(`operator_${cmp}`, {
        OPERAND1: rep(normalizedLight(b, c.rightColorPort, cal)), OPERAND2: s(threshold),
      });
      const lSpeed = b.add("control_if_else", {
        inputs: {
          CONDITION: bool(lDark()),
          SUBSTACK: stack(b.varSet("lspd", s("0"))),
          SUBSTACK2: stack(b.varSet("lspd", rep(b.arg("speed")))),
        },
      });
      const rSpeed = b.add("control_if_else", {
        inputs: {
          CONDITION: bool(rDark()),
          SUBSTACK: stack(b.varSet("rspd", s("0"))),
          SUBSTACK2: stack(b.varSet("rspd", rep(b.arg("speed")))),
        },
      });
      const move = b.add("flippermoremove_startDualSpeed", {
        inputs: { LEFT: rep(b.varRead("lspd")), RIGHT: rep(b.varRead("rspd")) },
      });
      b.blocks[lSpeed].next = rSpeed; b.blocks[rSpeed].next = move;
      const both = b.op("operator_and", { OPERAND1: bool(lDark()), OPERAND2: bool(rDark()) });
      const done = b.op("operator_or", { OPERAND1: bool(both), OPERAND2: bool(timedOut(b, 5)) });
      const loop = b.add("control_repeat_until", { inputs: { CONDITION: bool(done), SUBSTACK: stack(lSpeed) } });
      seq.push(rt, loop);
    }
    seq.push(b.add("flippermove_stopMove"));
    b.chain(squareOnLine.define, seq);
  }

  // ---- SQUARE ON WALL HEADING (heading) FOR (seconds).  T6 re-reference.
  //      Timed-press form: stall detection shapes are not yet verified.
  const squareOnWall = defineMyBlock(b, "SQUARE ON WALL HEADING %s FOR %s SEC", ["heading", "sec"], 40, nextY(300));
  {
    const push = b.add("flippermoremove_startDualSpeed", { inputs: { LEFT: n(-25), RIGHT: n(-25) } });
    const w = b.add("control_wait", { inputs: { DURATION: rep(b.arg("sec")) } });
    const stop = b.add("flippermove_stopMove");
    const ry = b.add("flippersensors_resetYaw");
    const settle = b.add("control_wait", { inputs: { DURATION: n(0.05) } });   // T13
    // the wall's field heading becomes the new local zero
    const off = b.varSet("hdgOffset", rep(b.arg("heading"), ""));
    b.chain(squareOnWall.define, [push, w, stop, ry, settle, off]);
  }

  // ---- FOLLOW LINE (mm) AT (speed) SIDE (side).  T8 + PD, not full PID.
  const followLine = defineMyBlock(b, "FOLLOW LINE %s MM AT %s SPEED SIDE %s",
    ["mm", "speed", "side"], 40, nextY(420));
  {
    const zeroL = b.add("flippermoremotor_motorSetDegreeCounted", {
      inputs: { PORT: [1, b.selector("flippermoremotor_multiple-port-selector", c.leftMotor)], VALUE: n(0) },
    });
    const zeroR = b.add("flippermoremotor_motorSetDegreeCounted", {
      inputs: { PORT: [1, b.selector("flippermoremotor_multiple-port-selector", c.rightMotor)], VALUE: n(0) },
    });
    const rt = b.add("flippersensors_resetTimer");
    const perMm = 360 * c.gearRatio / (Math.PI * c.wheelDiameterMm);
    const tgt = b.varSet("target", rep(
      b.op("operator_multiply", { NUM1: rep(b.arg("mm")), NUM2: n(Number(perMm.toFixed(4))) }), ""));
    const p0 = b.varSet("lastErr", s("0"));

    const body: string[] = [];
    const lightErr = b.op("operator_subtract", {
      NUM1: rep(normalizedLight(b, c.leftColorPort, cal)), NUM2: n(50),
    });
    // side is +1 or -1, so one block serves both edges
    const signed = b.op("operator_multiply", { NUM1: rep(lightErr), NUM2: rep(b.arg("side")) });
    body.push(b.varSet("err", rep(signed, "")));
    const dTerm = b.op("operator_subtract", { NUM1: rep(b.varRead("err")), NUM2: rep(b.varRead("lastErr")) });
    const pPart = b.op("operator_multiply", { NUM1: rep(b.varRead("err")), NUM2: n(0.6) });
    const dPart = b.op("operator_multiply", { NUM1: rep(dTerm), NUM2: n(1.4) });
    const pd = b.op("operator_add", { NUM1: rep(pPart), NUM2: rep(dPart) });
    body.push(b.varSet("corr", rep(pd, "")));
    body.push(b.varSet("lastErr", rep(b.varRead("err"), "")));
    const lspd = b.op("operator_subtract", { NUM1: rep(b.arg("speed")), NUM2: rep(b.varRead("corr")) });
    const rspd = b.op("operator_add", { NUM1: rep(b.arg("speed")), NUM2: rep(b.varRead("corr")) });
    body.push(b.add("flippermoremove_startDualSpeed", { inputs: { LEFT: rep(lspd), RIGHT: rep(rspd) } }));
    for (let i = 0; i < body.length - 1; i++) b.blocks[body[i]].next = body[i + 1];

    const absPos = travelled();
    const reached = b.op("operator_gt", { OPERAND1: rep(absPos), OPERAND2: rep(b.varRead("target")) });
    const done = b.op("operator_or", { OPERAND1: bool(reached), OPERAND2: bool(timedOut(b, 12)) });
    const loop = b.add("control_repeat_until", { inputs: { CONDITION: bool(done), SUBSTACK: stack(body[0]) } });
    const stop = b.add("flippermove_stopMove");
    b.chain(followLine.define, [zeroL, zeroR, rt, tgt, p0, loop, stop]);
  }

  // ---- RUN MOTOR <port> (degrees) AT (speed).  One variant per configured port.
  const runMotor: Record<string, Proc> = {};
  for (const port of c.attachmentMotors) {
    const p = defineMyBlock(b, `RUN MOTOR ${port} %s DEG AT %s SPEED`, ["degrees", "speed"], 40, nextY(200));
    const setSpeed = b.add("flippermotor_motorSetSpeed", {
      inputs: {
        PORT: [1, b.selector("flippermotor_multiple-port-selector", port)],
        SPEED: rep(b.arg("speed")),
      },
    });
    const run = b.add("flippermotor_motorTurnForDirection", {
      inputs: {
        PORT: [1, b.selector("flippermotor_multiple-port-selector", port)],
        DIRECTION: [1, b.selector("flippermotor_custom-icon-direction", "clockwise")],
        VALUE: rep(b.arg("degrees")),
      },
      fields: { UNIT: ["degrees", null] },
    });
    b.chain(p.define, [setSpeed, run]);
    runMotor[port] = p;
  }

  return { startRun, turnTo, drive, driveToLine, squareOnLine, squareOnWall, followLine, runMotor };
}
