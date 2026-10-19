import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCloudSystem } from '../src/cloud-system.js';
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(43, 1, 0.1, 900);
camera.position.set(0, 0, 120);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
let direct = 0,
  created = 0,
  terminated = 0,
  worker,
  posted,
  stored;
const renderer = {
    render() {
      direct++;
    },
  },
  storage = { getItem: () => stored, setItem: (k, v) => (stored = v) };
const system = createCloudSystem({
  scene,
  renderer,
  terrainRadius: 43,
  planetRadius: 40,
  seed: 39,
  storage,
  workerFactory: () => {
    created++;
    return (worker = { postMessage: (data) => (posted = data), terminate: () => terminated++ });
  },
});
for (let mask = 0; mask < 8; mask++) {
  const prefs = { ant: !!(mask & 1), world: !!(mask & 2), system: !!(mask & 4) };
  system.setPreferences(prefs);
  for (const [mode, systemActive, systemView, expected] of [
    ['ant', false, 'system', 'ant'],
    ['colony', false, 'system', 'world'],
    ['ant', true, 'system', 'system'],
    ['ant', true, 'world', 'world'],
  ]) {
    system.update(0.1, { mode, systemActive, systemView });
    const before = system.stats().low;
    system.render(scene, camera);
    const after = system.stats();
    assert.equal(after.resolvedView, expected);
    assert.equal(after.visible, prefs[expected]);
    if (!prefs[expected]) {
      for (const k of ['sortPasses', 'instanceUploads', 'attributeUploads'])
        assert.equal(after.low[k], before[k]);
      assert.equal(after.cloudDrawCalls, 0);
    }
  }
}
system.setPreferences({ quality: 'high', ant: false });
system.update(0.1, { mode: 'ant' });
system.render(scene, camera);
assert.equal(created, 0, 'Hidden high selection does not bake or upload');
system.setPreferences({ ant: true });
system.update(0.1, { mode: 'ant' });
assert.equal(created, 1);
assert.equal(posted.puffs.length, system.stats().cloudPuffs);
assert.equal(posted.type, 'bake');
const rotation = system.stats().cloudRotation;
system.setPreferences({ quality: 'low' });
system.update(1, { mode: 'colony' });
assert.notEqual(system.stats().cloudRotation, rotation);
assert.equal(created, 1);
assert.equal(system.stats().requestedQuality, 'low');
system.update(0.1, { nestActive: true });
system.render(scene, camera);
assert.equal(system.stats().resolvedView, null);
assert.equal(system.stats().visible, false);
assert.ok(direct > 0);
const late = worker.onmessage;
system.dispose();
assert.equal(terminated, 1);
late({ data: { type: 'ready', requestId: posted.requestId, envelope: {}, noise: {} } });
assert.notEqual(system.stats().resourceReadiness, 'ready');
system.dispose();
assert.equal(terminated, 1);
assert.equal(scene.children.length, 0);
const restored = createCloudSystem({
  scene,
  renderer,
  terrainRadius: 43,
  planetRadius: 40,
  seed: 55,
  storage,
});
assert.equal(restored.getPreferences().quality, 'low');
assert.equal(restored.getPreferences().ant, true);
restored.dispose();
console.log(
  'PASS cloud lifecycle: 8 toggle combinations, focused System world, hidden skips sorting/uploads/bake, quality wind continuity, direct rendering, worker once/stale response disposal, world preference persistence',
);

for (const supported of [false, true]) {
  let resourceUploads = 0,
    highDraws = 0,
    disposals = 0,
    w;
  const custom = createCloudSystem({
    scene,
    renderer,
    terrainRadius: 43,
    planetRadius: 40,
    seed: 39,
    storage: {},
    workerFactory: () =>
      (w = {
        postMessage(data) {
          this.id = data.requestId;
        },
        terminate() {},
      }),
    highFactory: () => ({
      setResources() {
        resourceUploads++;
      },
      stats: () => ({
        supported,
        failure: supported ? null : 'unsupported test',
        dimensions: { width: 100, height: 100 },
        drawCalls: 3,
      }),
      render() {
        highDraws++;
        return true;
      },
      resize() {},
      dispose() {
        disposals++;
      },
    }),
  });
  custom.setPreferences({ quality: 'high' });
  custom.update(0.1, { mode: 'ant' });
  w.onmessage({ data: { type: 'ready', requestId: w.id } });
  custom.render(scene, camera);
  assert.equal(custom.stats().requestedQuality, 'high');
  assert.equal(custom.stats().effectiveQuality, supported ? 'high' : 'low');
  assert.equal(resourceUploads, 1);
  if (!supported) assert.match(custom.stats().resourceError, /unsupported test/);
  const beforeDraw = highDraws;
  custom.setPreferences({ ant: false });
  custom.update(1, { mode: 'ant' });
  custom.render(scene, camera);
  assert.equal(highDraws, beforeDraw);
  assert.equal(resourceUploads, 1);
  custom.setPreferences({ ant: true, quality: 'low' });
  custom.update(0.1, { mode: 'ant' });
  custom.render(scene, camera);
  assert.equal(highDraws, beforeDraw);
  custom.dispose();
  custom.dispose();
  assert.equal(disposals, 1);
}
console.log(
  'PASS requested/effective High fallback, successful High handoff, ready-but-hidden work suppression, persistent requests and idempotent High disposal',
);
