import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG as C } from '../src/config.js';
import { makeWorld, stepWorld } from '../src/physics.js';
import { createPilot, pilotInput } from '../src/autopilot.js';

function run(maxSeconds = 150) {
  const world = makeWorld();
  const pilot = createPilot();
  const steps = Math.round(maxSeconds / C.dt);
  let maxTension = 0;
  let minHp = 100;
  let modes = 0;
  let prevMode = pilot.mode;
  for (let i = 0; i < steps && world.status === 'running'; i++) {
    const input = pilotInput(pilot, world);
    stepWorld(world, input, C.dt);
    maxTension = Math.max(maxTension, world.rope.tension);
    minHp = Math.min(minHp, world.front.hp, world.rear.hp);
    if (pilot.mode !== prevMode) { modes += 1; prevMode = pilot.mode; }
  }
  return { world, maxTension, minHp, modes };
}

test('自动驾驶可完成反向救援且船体无损伤', () => {
  const { world, maxTension, minHp, modes } = run();
  assert.equal(world.status, 'won', `实际状态 ${world.status}, 用时 ${world.time}s`);
  assert.ok(world.time < 150, `耗时过长: ${world.time}s`);
  assert.ok(maxTension <= C.rope.safeTension * 1.02,
    `峰值张力越界: ${maxTension.toFixed(1)}`);
  assert.ok(minHp >= 97, `船体受损: ${minHp.toFixed(1)}`);
  assert.ok(modes >= 2, '应包含多次牵引/收绳循环');
});

test('松弛缆绳不产生张力', () => {
  const world = makeWorld();
  stepWorld(world, { thrust: 0, rearLateral: 0, anchor: null }, C.dt);
  const startDist = Math.hypot(
    world.rear.x - world.front.x, world.rear.y - world.front.y);
  assert.ok(startDist <= C.rope.restLength);
  assert.equal(world.rope.tension, 0);
});

test('同时只能锚定一艘船', () => {
  const world = makeWorld();
  stepWorld(world, { thrust: 0, rearLateral: 0, anchor: 'front' });
  stepWorld(world, { thrust: 0, rearLateral: 0, anchor: 'rear' });
  assert.equal(world.front.anchored, false);
  assert.equal(world.rear.anchored, true);
});

test('持续过紧缆绳会损伤并最终失败', () => {
  const world = makeWorld();
  let lost = false;
  for (let i = 0; i < 60 * 60; i++) {
    stepWorld(world, { thrust: 1, rearLateral: 0, anchor: 'rear' }, C.dt);
    if (world.status === 'lost') { lost = true; break; }
  }
  assert.ok(lost, '过紧缆绳应当导致救援失败');
});
