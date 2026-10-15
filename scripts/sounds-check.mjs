// SND1: each sound schedules audible, short, click-free notes; "none" schedules nothing.
//   node --experimental-strip-types scripts/sounds-check.mjs
// Node has no Web Audio, so a recording fake stands in for OfflineAudioContext.
import assert from "node:assert/strict";
import { NOTICE_SOUNDS, scheduleNoticeSound } from "../src/core/app/sounds.ts";

function fakeContext() {
  const log = { oscillators: 0, peaks: [], firstGain: [], stops: [] };
  const param = (into) => ({ value: 0, setValueAtTime(v) { log.firstGain.push(v); }, exponentialRampToValueAtTime(v) { into.push(v); } });
  const node = () => ({ connect(next) { return next; } });
  return {
    log,
    currentTime: 0,
    destination: node(),
    createOscillator() { log.oscillators += 1; return { ...node(), type: "sine", frequency: { value: 0 }, start() {}, stop(at) { log.stops.push(at); } }; },
    createGain() { return { ...node(), gain: param(log.peaks) }; },
  };
}

for (const sound of NOTICE_SOUNDS) {
  const context = fakeContext();
  const length = scheduleNoticeSound(context, sound);
  if (sound === "none") {
    assert.equal(length, 0);
    assert.equal(context.log.oscillators, 0, "None plays nothing");
    continue;
  }
  assert.ok(context.log.oscillators >= 1, `${sound} makes a sound`);
  assert.ok(Math.max(...context.log.peaks) >= 0.05, `${sound} is audible`);
  assert.ok(Math.max(...context.log.peaks) <= 0.3, `${sound} is not loud`);
  assert.ok(context.log.firstGain.every((value) => value <= 0.001), `${sound} starts from silence (no click)`);
  assert.ok(length > 0 && length <= 1.5, `${sound} is short (${length} s)`);
}
console.log("sounds-check: ok");
