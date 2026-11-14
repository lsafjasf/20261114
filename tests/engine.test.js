import assert from "node:assert/strict";
import test from "node:test";
import {
  MATERIALS,
  acousticScore,
  evaluateTimeline,
  gaitWaveform,
  generateRound,
  normalizeComponent,
  normalizeSeed,
} from "../src/engine.js";
import { impulseProfile, synthesisProfile } from "../src/audio.js";

test("六个材质拥有互不相同的实时合成参数", () => {
  const profiles = MATERIALS.map((material) => synthesisProfile(material));
  assert.equal(new Set(profiles.map((profile) => JSON.stringify(profile))).size, 6);
  assert.equal(new Set(profiles.map((profile) => profile.grainHz)).size, 6);
  assert.equal(new Set(profiles.map((profile) => profile.lowHz)).size, 6);
  assert.equal(new Set(profiles.map((profile) => profile.ring)).size, 6);
  assert.ok(profiles.find((profile) => profile.grainHz === 580).damp > 0.9);
  assert.ok(profiles.find((profile) => profile.grainHz === 4200).ring > 0.5);
});

test("六种材质生成六条不同波形", () => {
  const waves = MATERIALS.map((material) => gaitWaveform(material, "material-check"));
  assert.equal(new Set(waves.map((wave) => JSON.stringify(wave))).size, 6);
  for (const wave of waves) {
    assert.equal(wave.length, 76);
    assert.ok(wave.every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1));
  }
});

test("相同 seed 生成完全相同的轮次", () => {
  const first = generateRound("481516");
  const second = generateRound("B1-481516");
  assert.deepEqual(second, first);
  assert.equal(second.seed, "481516");
  assert.deepEqual(second.targetOrder, first.targetOrder);
});

test("插入其他轮次后，相同 seed 重开仍保持一致", () => {
  const first = generateRound("994201");
  generateRound("112233");
  generateRound("778899");
  const reopened = generateRound("994201");
  assert.deepEqual(reopened, first);
});

test("不同 seed 会产生不同的材质、声纹或路径", () => {
  const first = generateRound("481516");
  const second = generateRound("481517");
  assert.notDeepEqual(second, first);
  assert.notEqual(second.targetOrder.join(","), first.targetOrder.join(","));
});

test("目标时间线是 0..5 的完整排列，且可由声纹标量复现", () => {
  for (let index = 0; index < 500; index += 1) {
    const round = generateRound(String(200000 + index));
    const slots = round.events.map((event) => event.targetSlot).sort((a, b) => a - b);
    assert.deepEqual(slots, [0, 1, 2, 3, 4, 5]);
    const ranked = [...round.events].sort((a, b) => acousticScore(a) - acousticScore(b));
    assert.deepEqual(ranked.map((event) => event.id), round.targetOrder);
    const scores = ranked.map(acousticScore);
    for (let scoreIndex = 1; scoreIndex < scores.length; scoreIndex += 1) {
      assert.ok(scores[scoreIndex] - scores[scoreIndex - 1] >= 0.012);
    }
  }
});

test("错 0 或 1 段通过，错 2 段以上失败", () => {
  const round = generateRound("481516");
  const exact = new Map(round.events.map((event) => [event.id, event.targetSlot]));
  assert.equal(evaluateTimeline(round, exact).mismatches, 0);
  assert.equal(evaluateTimeline(round, exact).passed, true);

  const oneWrong = new Map(exact);
  const first = round.events[0];
  oneWrong.set(first.id, (first.targetSlot + 1) % 6);
  const one = evaluateTimeline(round, oneWrong);
  assert.equal(one.mismatches, 1);
  assert.equal(one.passed, true);

  const twoWrong = new Map(oneWrong);
  const second = round.events[1];
  twoWrong.set(second.id, (second.targetSlot + 2) % 6);
  const two = evaluateTimeline(round, twoWrong);
  assert.equal(two.mismatches, 2);
  assert.equal(two.passed, false);
});

test("归一化线索能还原声纹标量", () => {
  const round = generateRound("481516");
  for (const event of round.events) {
    const clue = normalizeComponent(event);
    const reproduced = 0.55 * clue.echo + 0.25 * clue.pan + 0.2 * clue.low;
    assert.ok(Math.abs(reproduced - event.score) < 0.001);
  }
});

test("墙距驱动早期反射，开门会延长混响", () => {
  const round = generateRound("481516");
  const profiles = round.events.map((event) => {
    const material = MATERIALS.find((item) => item.id === event.materialId);
    return {
      sealed: impulseProfile(event, material, false),
      open: impulseProfile(event, material, true),
    };
  });
  assert.ok(profiles.every((profile) => profile.open.tail > profile.sealed.tail));
  assert.ok(new Set(profiles.map((profile) => profile.sealed.tail)).size > 1);
  assert.ok(new Set(profiles.map((profile) => profile.sealed.wallDelayMs)).size > 1);
});

test("seed 前缀和非法文本具有稳定归一化结果", () => {
  assert.equal(normalizeSeed("B1-00481516"), "481516");
  assert.equal(normalizeSeed("underground-a"), normalizeSeed("underground-a"));
  assert.match(normalizeSeed("underground-a"), /^\d{6}$/);
});
