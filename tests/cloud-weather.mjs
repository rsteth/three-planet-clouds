import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import * as THREE from 'three';
import {
  createWeatherField,
  createWeatherSampler,
  validateWeatherField,
  weatherDensity,
} from '../src/cloud-weather.js';
import { createCloudField } from '../src/cloud-layout.js';
import { createLowCloudRenderer } from '../src/cloud-low.js';
import { bakeWeatherMap, cubeDirection, bakeDensityNoise } from '../src/cloud-volume-data.js';
import { bakeCloudResources, resourceTransferList } from '../src/cloud-volume-worker.js';

const probes = Array.from({ length: 768 }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / 768,
    a = i * 2.399963229728653,
    r = Math.sqrt(1 - y * y);
  return [r * Math.cos(a), y, r * Math.sin(a)];
});
const populations = new Set(),
  families = new Set();
let clearMinimum = 1,
  cloudMinimum = 1,
  maximumPuffs = 0;
for (const seed of [...Array.from({ length: 48 }, (_, i) => i), 101, 255, 1024, 4294967295])
  for (const terrainRadius of [30, 43, 62]) {
    const field = createCloudField({ seed, terrainRadius }),
      layout = field.layout;
    assert.deepEqual(field, createCloudField({ seed, terrainRadius }));
    assert.equal(field.model, 'weather');
    assert.equal(field.modelVersion, 2);
    assert.ok(field.puffs.length <= 180 && field.puffs.length >= 90);
    assert.ok(layout.banks.length >= 18 && layout.banks.length <= 24);
    populations.add(layout.banks.length);
    families.add(JSON.stringify(layout.distribution));
    maximumPuffs = Math.max(maximumPuffs, field.puffs.length);
    assert.ok(field.minCloudClearance >= 1.8);
    assert.ok(field.bounds.outer < terrainRadius + 9);
    const sample = createWeatherSampler(field.weather);
    let cloudy = 0,
      clear = 0;
    for (const p of probes) {
      const [c, base, top, type] = sample(p);
      assert.ok(c >= 0 && c <= 1 && type >= 0 && type <= 1);
      assert.ok(
        base >= field.weather.bounds.inner && top <= field.weather.bounds.outer && top > base,
      );
      cloudy += c > 0.2;
      clear += c < 0.025;
    }
    cloudMinimum = Math.min(cloudMinimum, cloudy / probes.length);
    clearMinimum = Math.min(clearMinimum, clear / probes.length);
    assert.ok(cloudy / probes.length > 0.1, 'Cloud cover cannot degenerate into isolated dots');
    assert.ok(clear / probes.length > 0.2, 'Large clear regions must survive');
    assert.ok(
      layout.banks.every((b) => sample(b.center)[0] > 0.18),
      'Low bank locations follow actual weather coverage',
    );
    assert.ok(
      layout.instances.some((p) => p.level === 2),
      'Secondary lobes must branch from first-order lobes',
    );
    for (let i = 0; i < layout.instances.length; i++) {
      const p = layout.instances[i],
        bank = layout.banks[p.bankIndex];
      assert.equal(p.baseRadius, bank.baseRadius);
      assert.ok(p.scale.every((r) => Number.isFinite(r) && r > 0));
      if (p.parent >= 0) {
        assert.ok(p.parent < i);
        assert.equal(layout.instances[p.parent].bankIndex, p.bankIndex);
        assert.equal(p.level, layout.instances[p.parent].level + 1);
      }
      const puff = field.puffs[i],
        centerRadius = Math.hypot(...puff.center);
      for (const n of [
        [1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0.6, 0.8, 0],
      ]) {
        const point = puff.center.map(
          (c, k) => c + n.reduce((sum, v, j) => sum + v * puff.basis[j][k] * puff.radii[j], 0),
        );
        assert.ok(
          Math.hypot(...point) >= field.bounds.inner - 1e-8 &&
            Math.hypot(...point) <= field.bounds.outer + 1e-8,
        );
      }
      assert.ok(centerRadius > p.baseRadius);
    }
  }
assert.ok(populations.size >= 5);
assert.ok(
  families.size >= 20,
  'Family populations must respond to seed/weather instead of fixed quotas',
);
assert.throws(() => createCloudField({ terrainRadius: 43, model: 'wrong' }), RangeError);
assert.throws(() => createCloudField({ terrainRadius: 43, model: null }), RangeError);
assert.throws(() => validateWeatherField({ version: 1 }), TypeError);
assert.throws(
  () =>
    validateWeatherField({
      ...createWeatherField({ terrainRadius: 43 }),
      bounds: { inner: 50, outer: 40 },
    }),
  RangeError,
);
console.log(
  `PASS v2 weather/hierarchy across 156 seed/radius combinations: ${populations.size} bank populations, ${families.size} family distributions, max ${maximumPuffs} puffs, ${(cloudMinimum * 100).toFixed(1)}% minimum cloudy directions, ${(clearMinimum * 100).toFixed(1)}% minimum clear sky, actual branching and shared bases.`,
);

const field = createCloudField({ seed: 39, terrainRadius: 43 }),
  sample = createWeatherSampler(field.weather);
const faces = bakeWeatherMap(field.weather, 32);
for (const region of field.weather.regions) {
  for (const theta of [Math.acos(0.15), region.length * Math.sqrt(6.5)]) {
    const nearby = (delta) =>
      region.center.map(
        (v, k) => v * Math.cos(theta + delta) + region.east[k] * Math.sin(theta + delta),
      );
    assert.ok(
      Math.abs(sample(nearby(-1e-7))[0] - sample(nearby(1e-7))[0]) < 1e-4,
      'Coverage fades continuously across support and hemisphere rejection',
    );
  }
}
assert.deepEqual(faces, bakeWeatherMap(field.weather, 32));
let seams = 0;
for (let face = 0; face < 6; face++) {
  for (let y = 0; y < 32; y += 3)
    for (let x = 0; x < 32; x += 3) {
      const expected = sample(
        cubeDirection(face, (2 * (x + 0.5)) / 32 - 1, (2 * (y + 0.5)) / 32 - 1),
      );
      const index = (y * 32 + x) * 4,
        span = field.weather.bounds.outer - field.weather.bounds.inner;
      const actual = [
        faces[face][index] / 255,
        field.weather.bounds.inner + (faces[face][index + 1] / 255) * span,
        field.weather.bounds.inner + (faces[face][index + 2] / 255) * span,
        faces[face][index + 3] / 255,
      ];
      for (let k = 0; k < 4; k++)
        assert.ok(
          Math.abs(expected[k] - actual[k]) <= (k === 1 || k === 2 ? span : 1) / 510 + 1e-10,
        );
    }
  for (const uv of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    const direction = cubeDirection(face, ...uv);
    for (let other = 0; other < 6; other++)
      if (other !== face)
        for (const candidate of [
          [-1, -1],
          [-1, 1],
          [1, -1],
          [1, 1],
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const q = cubeDirection(other, ...candidate);
          if (Math.hypot(...direction.map((v, k) => v - q[k])) < 1e-12) {
            assert.deepEqual(sample(direction), sample(q));
            seams++;
          }
        }
  }
}
for (const n of [
  [0, 1, 0],
  [0, -1, 0],
  [1e-8, 1, 0],
  [-1e-8, 1, 0],
])
  assert.ok(sample(n).every(Number.isFinite));
console.log(
  `PASS weather cubemap quantization, ${seams} shared-edge/corner comparisons, poles, and finite heights in clear sky.`,
);

// A high-noise value with cloud coverage must not create a bridge through a low
// noise value. This was impossible when one min/max envelope defined occupancy.
assert.ok(weatherDensity(0.9, 0.5, 0.8, 0.9) > 0.9);
assert.equal(weatherDensity(0.9, 0.5, 0.8, 0.2), 0);
assert.equal(weatherDensity(0, 0.5, 0.8, 1), 0);
assert.equal(weatherDensity(1, 0, 0.8, 1), 0);
assert.equal(weatherDensity(1, 1, 0.8, 1), 0);
assert.ok(weatherDensity(0.9, 0.5, 0.8, 0.55, 0) <= weatherDensity(0.9, 0.5, 0.8, 0.55, 1));
// Independent trilinear reference for the actual 64³ R8 upload (texel centers
// and repeat wrapping), rather than the unquantized procedural function.
const noiseBytes = bakeDensityNoise(64, 39);
const noise = (x, y, z) => {
  const p = [x * 64 - 0.5, y * 64 - 0.5, z * 64 - 0.5],
    lo = p.map(Math.floor),
    f = p.map((v, k) => v - lo[k]);
  let value = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const ix = (((lo[0] + dx) % 64) + 64) % 64,
          iy = (((lo[1] + dy) % 64) + 64) % 64,
          iz = (((lo[2] + dz) % 64) + 64) % 64;
        value +=
          (noiseBytes[(iz * 64 + iy) * 64 + ix] / 255) *
          (dx ? f[0] : 1 - f[0]) *
          (dy ? f[1] : 1 - f[1]) *
          (dz ? f[2] : 1 - f[2]);
      }
  return value;
};
let splitColumns = 0;
for (const direction of probes) {
  const w = sample(direction);
  let starts = 0,
    previous = false;
  for (let j = 1; j < 64; j++) {
    const h = j / 64,
      r = w[1] + h * (w[2] - w[1]);
    const rho = weatherDensity(w[0], h, w[3], noise(...direction.map((v) => (v * r) / 18)));
    const occupied = rho > 0.05;
    if (occupied && !previous) starts++;
    previous = occupied;
  }
  splitColumns += starts > 1;
}
assert.ok(splitColumns > 0, 'Real seeded 3D density must preserve separated vertical structures');
console.log(
  `PASS continuous density has ${splitColumns} genuinely separated radial columns; coverage/profile bounds and erosion direction.`,
);

const scene = new THREE.Scene(),
  low = createLowCloudRenderer({ scene, field });
const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 900),
  matrix = new THREE.Matrix4();
const originals = new Map(field.puffs.map((p) => [p.center.map(Math.fround).join(','), p]));
for (const position of [
  [0, 60, 140],
  [140, 0, 0],
  [-90, -30, 30],
]) {
  camera.position.fromArray(position);
  camera.lookAt(0, 0, 0);
  low.update({ camera, visible: true });
  for (let i = 0; i < low.mesh.count; i++) {
    low.mesh.getMatrixAt(i, matrix);
    const original = originals.get(matrix.elements.slice(12, 15).join(','));
    assert.ok(original);
    assert.ok(
      Math.abs(low.mesh.geometry.attributes.instanceBase.getX(i) - original.baseRadius) < 1e-5,
      'Base follows its sorted instance',
    );
  }
}
const baseVersion = low.mesh.geometry.attributes.instanceBase.version;
for (let i = 0; i < 30; i++) low.update({ visible: false });
assert.equal(low.mesh.geometry.attributes.instanceBase.version, baseVersion);
low.dispose();
const capField = {
  bounds: { inner: 8, outer: 12 },
  puffs: [
    {
      center: [0, 0, 10],
      basis: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      radii: [2, 2, 2],
      density: 0.8,
      baseRadius: 10,
    },
  ],
};
const cap = createLowCloudRenderer({ scene, field: capField });
camera.position.set(0, 0, 9.5);
cap.update({ camera, visible: true });
assert.equal(cap.stats().insidePuffs, 0);
camera.position.z = 10.5;
cap.update({ camera, visible: true });
assert.equal(cap.stats().insidePuffs, 1);
cap.dispose();
console.log(
  'PASS Low base attributes follow sorted transforms, hidden bases do not upload, and containment respects clipped bases.',
);

const resources = bakeCloudResources({
  weather: field.weather,
  bounds: field.weather.bounds,
  seed: 39,
});
assert.equal(resources.version, 2);
assert.equal(resources.model, 'weather');
assert.equal(resources.weather.faces.length, 6);
assert.equal(resources.detail.data.length, 32 ** 3);
assert.equal(resources.envelope, undefined);
assert.equal(resourceTransferList(resources).length, 9);
assert.equal(
  resourceTransferList(resources).reduce((sum, b) => sum + b.byteLength, 0),
  689152,
);
assert.throws(
  () => bakeCloudResources({ version: 2, puffs: field.puffs, bounds: field.bounds }),
  TypeError,
);
assert.throws(
  () => bakeCloudResources({ version: 1, weather: field.weather, bounds: field.weather.bounds }),
  TypeError,
);
const workerURL = new URL('../src/cloud-volume-worker.js', import.meta.url).href;
const worker = new Worker(
  new URL(
    `data:text/javascript,${encodeURIComponent(`import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};await import(${JSON.stringify(workerURL)});parentPort.on('message',data=>self.onmessage({data}));`)}`,
  ),
  { type: 'module' },
);
const response = (data) =>
  new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.postMessage(data);
  });
try {
  const result = await response({
    type: 'bake',
    requestId: 2,
    weather: field.weather,
    bounds: field.weather.bounds,
    seed: 39,
  });
  assert.equal(result.type, 'ready');
  assert.equal(result.requestId, 2);
  assert.deepEqual(result.weather, resources.weather);
  assert.deepEqual(result.detail, resources.detail);
  const rejected = await response({
    type: 'bake',
    requestId: 3,
    weather: { version: 1 },
    bounds: field.weather.bounds,
  });
  assert.equal(rejected.type, 'error');
  console.log(
    `PASS real v2 module worker, nine transferred buffers, deterministic results, invalid descriptor rejection; ${resources.timings.totalMs.toFixed(1)} ms reference CPU bake.`,
  );
} finally {
  await worker.terminate();
}
