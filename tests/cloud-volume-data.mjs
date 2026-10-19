import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import {
  cubeDirection,
  compileCloudPuffs,
  createEnvelopeSampler,
  bakeEnvelope,
  createPeriodicNoiseSampler,
  bakeDensityNoise,
  fixedBlueNoise,
  CLOUD_ENVELOPE_SIZE,
  CLOUD_NOISE_SIZE,
  CLOUD_BLUE_NOISE_SIZE,
} from '../src/cloud-volume-data.js';
import { generateCloudLayout } from '../src/cloud-layout.js';
const close = (a, b, tolerance = 1e-10) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} (tolerance ${tolerance})`);
const identity = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const puff = (center, radii, density = 0.7, basis = identity) => ({
  center,
  radii,
  density,
  basis,
  bankId: 0,
});
const bounds = { inner: 5, outer: 15 };
let sample = createEnvelopeSampler([puff([0, 0, 10], [2, 1, 3])], bounds);
sample([0, 0, 1]).forEach((v, k) => close(v, [0.2, 0.8, 0.7, 1][k]));
assert.deepEqual(sample([0, 0, -1]), [0, 0, 0, 0]);
assert.deepEqual(sample([0, 0, 0]), [0, 0, 0, 0]);
assert.deepEqual(createEnvelopeSampler([], bounds)([1, 0, 0]), [0, 0, 0, 0]);
assert.deepEqual(
  createEnvelopeSampler([puff([0, 0, 10], [2, 1, 3])], { inner: 9, outer: 11 })([0, 0, 1]),
  [0, 1, 0.7, 1],
);
assert.deepEqual(
  createEnvelopeSampler(
    [puff([0, 0, 9], [1, 1, 1], 0.4), puff([0, 0, 12], [2, 2, 2], 0.9)],
    bounds,
  )([0, 0, 1]),
  [0.3, 0.9, 0.9, 1],
);
const q = 0.925,
  theta = Math.asin((2 * Math.sqrt(q)) / 10),
  coverage = createEnvelopeSampler(
    [puff([0, 0, 10], [2, 2, 2])],
    bounds,
  )([Math.sin(theta), 0, Math.cos(theta)]);
close(coverage[3], 0.5);
close(coverage[2] / coverage[3], 0.7);
assert.throws(
  () =>
    compileCloudPuffs([
      puff([0, 0, 10], [1, 1, 1], 1, [
        [2, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]),
    ]),
  /orthonormal/,
);
assert.throws(() => bakeEnvelope([], { inner: 8, outer: 8 }), /bounds/);
assert.throws(() => bakeDensityNoise(0), /size/);
assert.throws(
  () => compileCloudPuffs(Array.from({ length: 181 }, () => puff([0, 0, 10], [1, 1, 1]))),
  /180/,
);
console.log(
  'PASS radial ellipsoid intersections, positive/clipped intervals, bounded union, q coverage and input validation.',
);

// Independent direct inverse-transform calculation checks the optimized
// quadratic and conservative cone rejection for asymmetric rotated puffs.
let randomState = 7301;
const random = () =>
  (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 4294967296;
const norm = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const asymmetric = [];
for (let i = 0; i < 20; i++) {
  const radial = norm([random() - 0.5, random() - 0.5, random() - 0.5]),
    east = norm(cross(radial, [0.7, 0.2, 0.4])),
    forward = cross(east, radial);
  asymmetric.push(
    puff(
      radial.map((x) => x * 10),
      [0.2 + random() * 2, 0.2 + random(), 0.2 + random() * 2],
      random(),
      [east, radial, forward],
    ),
  );
}
function reference(puffs, direction) {
  let lower = Infinity,
    upper = -Infinity,
    alpha = 0,
    density = 0;
  for (const p of puffs) {
    const o = p.basis.map((b, k) => -dot(p.center, b) / p.radii[k]),
      d = p.basis.map((b, k) => dot(direction, b) / p.radii[k]);
    const a = dot(d, d),
      b = dot(o, d),
      c = dot(o, o) - 1,
      disc = b * b - a * c;
    if (disc <= 0) continue;
    const lo = Math.max(5, (-b - Math.sqrt(disc)) / a),
      hi = Math.min(15, (-b + Math.sqrt(disc)) / a);
    if (lo >= hi) continue;
    const coverage = Math.max(0, Math.min(1, (1 - (dot(o, o) - (b * b) / a)) / 0.15)),
      smooth = coverage * coverage * (3 - 2 * coverage);
    lower = Math.min(lower, lo);
    upper = Math.max(upper, hi);
    alpha = Math.max(alpha, smooth);
    density = Math.max(density, p.density);
  }
  return alpha
    ? [(alpha * (lower - 5)) / 10, (alpha * (upper - 5)) / 10, alpha * density, alpha]
    : [0, 0, 0, 0];
}
sample = createEnvelopeSampler(asymmetric, bounds);
for (let i = 0; i < 2500; i++) {
  const n = norm([random() - 0.5, random() - 0.5, random() - 0.5]),
    actual = sample(n),
    expected = reference(asymmetric, n);
  for (let k = 0; k < 4; k++) close(actual[k], expected[k], 1e-8);
}
console.log(
  'PASS 2,500 independent inverse-transform comparisons, including cone culling and rotated ellipsoids.',
);

// Every shared edge (including its exact corner endpoints) must evaluate the
// same directional field, irrespective of the selected cubemap face.
const coordinates = [-1, -0.75, -0.2, 0, 0.2, 0.75, 1],
  edges = new Map();
for (let face = 0; face < 6; face++)
  for (const edge of [0, 1, 2, 3])
    for (const t of coordinates) {
      const u = edge < 2 ? (edge === 0 ? -1 : 1) : t,
        v = edge >= 2 ? (edge === 2 ? -1 : 1) : t,
        n = cubeDirection(face, u, v);
      const key = n.map((v) => Math.round(v * 1e11)).join(',');
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ face, n });
    }
assert.deepEqual(cubeDirection(0, 0, 0), [1, -0, -0]);
assert.deepEqual(cubeDirection(2, 0, 0), [0, 1, 0]);
assert.deepEqual(cubeDirection(4, 0, 0), [0, -0, 1]);
let seams = 0,
  corners = 0;
for (const group of edges.values()) {
  const faces = new Set(group.map((p) => p.face));
  assert.ok(faces.size === 2 || faces.size === 3);
  if (faces.size === 3) corners++;
  else seams++;
  // Centre one ellipsoid on the seam so equality cannot pass just because the
  // chosen direction happens to be empty. Its centre and surrounding rays agree.
  const n = group[0].n,
    s = createEnvelopeSampler(
      [
        puff(
          n.map((v) => v * 10),
          [2, 2, 2],
        ),
      ],
      bounds,
    ),
    expected = s(n);
  assert.ok(expected[3] > 0.99);
  for (const item of group) for (let k = 0; k < 4; k++) close(s(item.n)[k], expected[k]);
}
assert.equal(corners, 8);
assert.equal(seams, 60);
// Opposite-edge neighbour orientations: +X left borders +Z right, +X top
// borders +Y right with its v reversed. Exact pairs test row/column direction.
for (const t of coordinates) {
  const a = cubeDirection(0, -1, t),
    b = cubeDirection(4, 1, t),
    c = cubeDirection(0, t, -1),
    d = cubeDirection(2, 1, -t);
  a.forEach((x, i) => close(x, b[i]));
  c.forEach((x, i) => close(x, d[i]));
}
const edgePuffs = [
  puff(
    norm([1, 1, 1]).map((x) => x * 10),
    [2, 2, 2],
  ),
  puff(
    norm([1, 0, 1]).map((x) => x * 10),
    [2, 2, 2],
  ),
];
const envelope = bakeEnvelope(edgePuffs, bounds);
assert.equal(envelope.length, 6);
assert.ok(envelope.every((f) => f instanceof Uint8Array && f.length === 128 * 128 * 4));
assert.deepEqual(envelope, bakeEnvelope(edgePuffs, bounds));
const edgeSample = createEnvelopeSampler(edgePuffs, bounds);
let occupied = 0;
for (let face = 0; face < 6; face++)
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4,
        bytes = envelope[face],
        expected = edgeSample(
          cubeDirection(face, (2 * (x + 0.5)) / 128 - 1, (2 * (y + 0.5)) / 128 - 1),
        );
      for (let k = 0; k < 4; k++) {
        close(bytes[i + k] / 255, expected[k], 0.5 / 255 + 1e-12);
        assert.ok(bytes[i + k] <= bytes[i + 3]);
      }
      if (bytes[i + 3]) occupied++;
    }
assert.ok(occupied > 100 && occupied < 10000);
// Filtering a premultiplied valid sample against empty space preserves its
// decoded altitude/density rather than pulling them toward the shell bottom.
const full = edgeSample(norm([1, 1, 1])),
  filtered = full.map((x) => x * 0.137);
for (let c = 0; c < 3; c++) close(filtered[c] / filtered[3], full[c] / full[3]);
console.log(
  `PASS cubemap orientation, ${seams} shared-edge directions, all ${corners} corners, byte encoding and premultiplied filtering.`,
);

// Mathematical periodicity is checked before quantization in every axis, at
// arbitrary negative coordinates, on faces, and across all eight corners.
const noise = createPeriodicNoiseSampler(39),
  different = createPeriodicNoiseSampler(40),
  epsilon = 1e-5;
for (const p of [
  [0.17, 0.35, 0.61],
  [-0.1, 1.7, 2.3],
  [0, 0, 0],
  [1, 1, 1],
  [0.99, 0.02, 0.5],
])
  for (let axis = 0; axis < 3; axis++) {
    const translated = [...p];
    translated[axis] += 1;
    close(noise(...p), noise(...translated), 1e-12);
    const before = [...p],
      after = [...p];
    before[axis] = -epsilon;
    after[axis] = 1 - epsilon;
    close(noise(...before), noise(...after), 1e-12);
    before[axis] = epsilon;
    after[axis] = 1 + epsilon;
    close(noise(...before), noise(...after), 1e-12);
    // Both sides of the continuous seam meet, not only values exactly on it.
    before[axis] = -epsilon;
    after[axis] = epsilon;
    assert.ok(Math.abs(noise(...before) - noise(...after)) < 0.001);
  }
assert.notEqual(noise(0.13, 0.24, 0.75), different(0.13, 0.24, 0.75));
const noiseBytes = bakeDensityNoise(64, 39),
  noiseAgain = bakeDensityNoise(64, 39);
assert.deepEqual(noiseBytes, noiseAgain);
assert.equal(noiseBytes.length, 64 ** 3);
let minimum = 255,
  maximum = 0,
  total = 0;
for (const value of noiseBytes) {
  minimum = Math.min(minimum, value);
  maximum = Math.max(maximum, value);
  total += value;
}
assert.ok(minimum < 110 && maximum > 180);
assert.ok(total / noiseBytes.length > 100 && total / noiseBytes.length < 190);
const index = (x, y, z) => (z * 64 + y) * 64 + x;
for (let axis = 0; axis < 3; axis++) {
  let seamDelta = 0,
    nearDelta = 0;
  for (let a = 0; a < 64; a++)
    for (let b = 0; b < 64; b++) {
      const lo = axis === 0 ? [0, a, b] : axis === 1 ? [a, 0, b] : [a, b, 0],
        hi = [...lo],
        near = [...lo];
      hi[axis] = 63;
      near[axis] = 1;
      seamDelta += Math.abs(noiseBytes[index(...lo)] - noiseBytes[index(...hi)]);
      nearDelta += Math.abs(noiseBytes[index(...lo)] - noiseBytes[index(...near)]);
    }
  assert.ok(seamDelta / 4096 < 10, 'Wrapped texture slices must remain locally smooth');
  assert.ok(
    seamDelta / Math.max(1, nearDelta) < 1.5,
    'Seam discontinuity exceeds adjacent-slice variation',
  );
}
console.log(
  `PASS deterministic periodic Perlin–Worley 64³ R8 noise: range ${minimum}–${maximum}, mean ${(total / noiseBytes.length).toFixed(1)}, all three continuous and filtered wrapping boundaries.`,
);

const blue = fixedBlueNoise(),
  histogram = new Uint16Array(256);
assert.equal(blue.length, 32 * 32);
blue.forEach((v) => histogram[v]++);
assert.ok(histogram.every((v) => v === 4));
const original = blue[0];
blue[0] ^= 255;
assert.equal(fixedBlueNoise()[0], original, 'Callers must not mutate the fixed shared mask');
const fixed = fixedBlueNoise();
let lowPower = 0,
  midPower = 0,
  lowCount = 0,
  midCount = 0;
for (let ky = -13; ky <= 13; ky++)
  for (let kx = -13; kx <= 13; kx++) {
    const radius = Math.hypot(kx, ky);
    if (radius === 0 || radius >= 14 || (radius >= 4 && radius < 6)) continue;
    let re = 0,
      im = 0;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const angle = (2 * Math.PI * (kx * x + ky * y)) / 32,
          value = fixed[y * 32 + x] - 127.5;
        re += value * Math.cos(angle);
        im += value * Math.sin(angle);
      }
    const power = re * re + im * im;
    if (radius < 4) {
      lowPower += power;
      lowCount++;
    } else {
      midPower += power;
      midCount++;
    }
  }
const powerRatio = lowPower / lowCount / (midPower / midCount);
assert.ok(powerRatio < 0.05, `Blue-noise low-frequency power ratio ${powerRatio}`);
console.log(
  `PASS fixed 32² blue-noise rank histogram and low-frequency suppression (${powerRatio.toFixed(5)} low/mid power).`,
);

// Exercise a real module worker and transferred buffers using a minimal browser
// self/postMessage bridge. Tests do not import or execute the voxel loop on the
// UI thread of the application.
const layout = generateCloudLayout({ seed: 39, cloudRadius: 48 });
const canonical = layout.instances.map((p) => {
  if (p.center && p.basis && p.radii) return p;
  const up = p.normal,
    east = norm(p.east.map((v, k) => v - up[k] * dot(p.east, up))),
    forward = cross(east, up);
  return {
    center: up.map((v) => v * (48 + p.alt)),
    basis: [east, up, forward],
    radii: p.scale,
    density: p.density,
    bankId: p.bankIndex,
  };
});
const workerURL = new URL('../src/cloud-volume-worker.js', import.meta.url).href;
const source = `import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:(data,transfer)=>parentPort.postMessage(data,transfer)};await import(${JSON.stringify(workerURL)});parentPort.on('message',data=>self.onmessage({data}));`;
const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), {
  type: 'module',
});
const response = (message) =>
  new Promise((resolve, reject) => {
    const error = (e) => {
        worker.off('message', done);
        reject(e);
      },
      done = (value) => {
        worker.off('error', error);
        resolve(value);
      };
    worker.once('error', error);
    worker.once('message', done);
    worker.postMessage(message);
  });
try {
  const result = await response({
    type: 'bake',
    requestId: 'seed-39',
    puffs: canonical,
    bounds: { inner: 44, outer: 55 },
    seed: 39,
  });
  assert.equal(result.type, 'ready');
  assert.equal(result.requestId, 'seed-39');
  assert.deepEqual(result.bounds, { inner: 44, outer: 55 });
  assert.equal(result.envelope.size, CLOUD_ENVELOPE_SIZE);
  assert.equal(result.noise.size, CLOUD_NOISE_SIZE);
  assert.equal(result.blueNoise.size, CLOUD_BLUE_NOISE_SIZE);
  assert.ok(
    result.envelope.faces.every((f) => f instanceof Uint8Array && f.byteLength === 128 * 128 * 4),
  );
  assert.deepEqual(result.noise.data, noiseBytes);
  assert.deepEqual(result.blueNoise.data, fixed);
  assert.ok(
    result.timings.envelopeMs >= 0 &&
      result.timings.noiseMs >= 0 &&
      result.timings.totalMs >= result.timings.envelopeMs + result.timings.noiseMs,
  );
  const rejected = await response({
    type: 'bake',
    requestId: 'bad-world',
    puffs: [],
    bounds: { inner: 10, outer: 5 },
  });
  assert.equal(rejected.type, 'error');
  assert.equal(rejected.requestId, 'bad-world');
  assert.match(rejected.error, /bounds/);
  console.log(
    `PASS real module-worker protocol/transfer/error handling for ${canonical.length} puffs: envelope ${result.timings.envelopeMs.toFixed(1)} ms, noise ${result.timings.noiseMs.toFixed(1)} ms, total ${result.timings.totalMs.toFixed(1)} ms (CPU resource-bake timings, not GPU rendering).`,
  );
} finally {
  await worker.terminate();
}
