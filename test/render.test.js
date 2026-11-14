import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG as C } from '../src/config.js';
import { makeWorld, stepWorld } from '../src/physics.js';
import { createPilot, pilotInput } from '../src/autopilot.js';
import { render, makeParticles } from '../src/renderer.js';
import { TensionAudio } from '../src/audio.js';

function stubCtx() {
  const noop = () => {};
  const target = { canvas: { width: 1280, height: 720 } };
  return new Proxy(target, {
    get(t, prop) {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: noop });
      }
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop in t) return t[prop];
      return noop;
    },
    set() { return true; }
  });
}

test('渲染器在完整自动驾驶对局中无异常', () => {
  const ctx = stubCtx();
  const world = makeWorld();
  const pilot = createPilot();
  const particles = makeParticles();
  for (let i = 0; i < 9000 && world.status === 'running'; i++) {
    const input = pilotInput(pilot, world);
    stepWorld(world, input, C.dt);
    assert.doesNotThrow(() => render(ctx, world, particles, input));
  }
  assert.equal(world.status, 'won');
  assert.doesNotThrow(() => render(ctx, world, particles, { thrust: 0, rearLateral: 0 }));
});

test('TensionAudio 在未初始化时安全降级', () => {
  const a = new TensionAudio();
  assert.doesNotThrow(() => a.update(220));
  assert.doesNotThrow(() => a.blip(440));
  assert.equal(a.toggleMute(), true);
  assert.equal(a.toggleMute(), false);
});
