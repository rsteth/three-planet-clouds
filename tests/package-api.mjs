import assert from 'node:assert/strict';
import * as api from '../src/index.js';
import * as THREE from 'three';
for (const view of ['ant', 'world', 'system', null])
  assert.equal(api.resolveCloudView({ view }), view);
assert.throws(() => api.resolveCloudView({ view: 'invalid' }), RangeError);
assert.equal(api.CLOUD_PREFERENCES_KEY, 'three-planet-clouds-v1');
assert.equal(typeof api.createCloudSystem, 'function');
assert.equal(typeof api.createCloudMeasurement, 'function');
const scene = new THREE.Scene();
const system = api.createCloudSystem({ scene, terrainRadius: 43, seed: 39, storage: null });
system.setPreferences({ ant: true, world: false, system: true });
for (const [view, visible] of [
  ['ant', true],
  ['world', false],
  ['system', true],
  [null, false],
]) {
  system.update(0, { view });
  assert.equal(system.stats().resolvedView, view);
  assert.equal(system.stats().visible, visible);
}
system.dispose();
assert.equal(scene.children.length, 0);
console.log('PASS standalone exports, explicit views, validation, and isolated preference key');
