// A self-test the hub runs and grades itself, so verifying the toolkit costs one
// download rather than a reading session.
//
// It targets the thing I have been wrong about twice: the settle behaviour of
// TURN TO. Heading error is checkable on the hub, and so is elapsed time, and the
// oscillation bug has a signature that shows up in the time even when the final
// heading looks fine. A turn that lands correctly but takes 4 seconds has hit the
// timeout, which means it never settled.
//
// Distance is deliberately not self-graded: nothing on the hub can measure the
// floor. The distance tests drive a known amount and stop, for tape-measure checks.

import { Builder, n, s, rep, bool, stack } from "./blocks.js";
import { buildToolkit, callMyBlock, type RobotConfig, type Calibration } from "./toolkit.js";

export function buildSelfTest(b: Builder, c: RobotConfig, cal: Calibration) {
  const tk = buildToolkit(b, c, cal);

  const yaw = () => b.add("flippersensors_orientationAxis", { fields: { AXIS: ["yaw", null] } });
  const timer = () => b.add("flippersensors_timer");
  const write = (txt: string) => b.add("flipperlight_lightDisplayText", { inputs: { TEXT: s(txt) } });
  const wait = (sec: number) => b.add("control_wait", { inputs: { DURATION: n(sec) } });

  const hat = b.add("flipperevents_whenProgramStarts", { topLevel: true, x: 40, y: 40 });
  const seq: string[] = [];

  seq.push(callMyBlock(b, tk.startRun, [n(0), n(40)]));
  seq.push(wait(1));

  /**
   * One graded turn. Passes only if the heading landed AND the turn settled rather
   * than timing out, because the oscillation defect produces a correct final
   * heading with a four second duration.
   */
  const gradedTurn = (target: number, label: string) => {
    seq.push(b.add("flippersensors_resetTimer"));
    seq.push(callMyBlock(b, tk.turnTo, [n(target), n(35)]));
    seq.push(b.varSet("testTime", rep(timer(), "")));
    seq.push(b.varSet("testErr", rep(
      b.op("operator_mathop", {
        NUM: rep(b.op("operator_subtract", { NUM1: n(target), NUM2: rep(yaw()) })),
      }, { OPERATOR: ["abs", null] }), "")));

    const landed = b.op("operator_lt", { OPERAND1: rep(b.varRead("testErr")), OPERAND2: s("3") });
    const settled = b.op("operator_lt", { OPERAND1: rep(b.varRead("testTime")), OPERAND2: s("3") });
    const passed = b.op("operator_and", { OPERAND1: bool(landed), OPERAND2: bool(settled) });

    // distinguish the two failure modes rather than reporting a bare fail
    const failBranch = b.add("control_if_else", {
      inputs: {
        CONDITION: bool(b.op("operator_lt", { OPERAND1: rep(b.varRead("testErr")), OPERAND2: s("3") })),
        SUBSTACK: stack(write(label + " SLOW")),      // landed but never settled
        SUBSTACK2: stack(write(label + " OFF")),      // wrong heading
      },
    });
    seq.push(b.add("control_if_else", {
      inputs: {
        CONDITION: bool(passed),
        SUBSTACK: stack(write(label + " OK")),
        SUBSTACK2: stack(failBranch),
      },
    }));
    seq.push(wait(3));
  };

  gradedTurn(90, "1");    // quarter turn right
  gradedTurn(0, "2");     // return to start, exercises the wrap through zero
  gradedTurn(-90, "3");   // quarter turn left, exercises negative headings
  gradedTurn(179, "4");   // near the wrap boundary, the case T2 exists for

  // Ungraded: drive a known distance for a tape measure. Nothing on the hub can
  // measure the floor, so this reports nothing and is checked by hand.
  seq.push(write("5"));
  seq.push(wait(2));
  seq.push(callMyBlock(b, tk.drive, [n(300), n(40), n(179)]));
  seq.push(wait(2));
  seq.push(write("END"));

  b.chain(hat, seq);
  return tk;
}
