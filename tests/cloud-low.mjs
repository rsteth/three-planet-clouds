import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  generateCloudLayout as generate,
  createCloudField as create,
} from '../src/cloud-layout.js';
// Preserve v0.1's deterministic fixtures as explicit legacy coverage. The
// default v0.2 model has separate morphology, weather, and Low integration tests.
const generateCloudLayout = (options) => generate({ ...options, model: 'legacy' });
const createCloudField = (options) => create({ ...options, model: 'legacy' });
import { createLowCloudRenderer } from '../src/cloud-low.js';

// Hash quantized values, not implementation-dependent transcendental last bits.
// One millionth of a layout unit catches seed-stream/placement changes while
// tolerating Math.sin/cos/hypot differences across JS engines and architectures.
const layoutFingerprint = (layout) =>
  createHash('sha256')
    .update(
      JSON.stringify(layout, (key, value) =>
        typeof value === 'number' ? Math.round(value * 1e6) : value,
      ),
    )
    .digest('hex');
// The regional layout intentionally changes the old uniform-placement fixture.
// Seed 40 keeps every quantized value well clear of cross-platform rounding ties.
const fixtureLayout = generateCloudLayout({ seed: 40, cloudRadius: 48 });
assert.equal(
  layoutFingerprint(fixtureLayout),
  'c4a70f19293b8e78eb8d77c0113c44977e935e06b4007e5ffb59c8ecf5f78d63',
);
for (const perturbation of [-1e-12, 1e-12]) {
  const perturbedLayout = JSON.parse(
    JSON.stringify(fixtureLayout, (key, value) =>
      typeof value === 'number' && !Number.isInteger(value) ? value + perturbation : value,
    ),
  );
  assert.equal(
    layoutFingerprint(perturbedLayout),
    layoutFingerprint(fixtureLayout),
    'Small platform math variation cannot fail the seeded contract',
  );
}
// This particular fixture is deliberately well clear of quantization ties.
// No arbitrary/random seed is compared to a cross-platform binary hash.
JSON.stringify(fixtureLayout, (key, value) => {
  if (typeof value === 'number')
    assert.ok(
      (0.5 - Math.abs(value * 1e6 - Math.round(value * 1e6))) / 1e6 > 1e-11,
      'Fixture stays clear of rounding boundaries',
    );
  return value;
});
assert.notEqual(
  layoutFingerprint(generateCloudLayout({ seed: 41, cloudRadius: 48 })),
  layoutFingerprint(fixtureLayout),
);
const point = new THREE.Vector3(),
  east = new THREE.Vector3(),
  up = new THREE.Vector3(),
  forward = new THREE.Vector3();
let worstClearance = Infinity,
  maximumPuffs = 0;
for (const terrainRadius of [30, 43, 62])
  for (const seed of [0, 1, 2, 3, 7, 39, 73, 99, 127, 255, 1024, 2147483647, 4294967295]) {
    const field = createCloudField({ seed, terrainRadius });
    assert.deepEqual(field, createCloudField({ seed, terrainRadius }));
    assert.deepEqual(field.layout, generateCloudLayout({ seed, cloudRadius: terrainRadius + 5 }));
    assert.equal(field.layout.banks.length, 24);
    assert.deepEqual(field.layout.distribution, { wisp: 6, streak: 6, broken: 6, billow: 6 });
    assert.equal(field.puffs.length, field.layout.instances.length);
    assert.ok(field.puffs.length <= 180);
    maximumPuffs = Math.max(maximumPuffs, field.puffs.length);
    assert.ok(field.minCloudClearance >= 1.8);
    assert.equal(field.minCloudClearance, field.bounds.inner - terrainRadius);
    worstClearance = Math.min(worstClearance, field.minCloudClearance);
    assert.ok(field.bounds.outer < terrainRadius + 9);
    for (let i = 0; i < field.puffs.length; i++) {
      const puff = field.puffs[i],
        original = field.layout.instances[i];
      assert.equal(puff.bankId, original.bankIndex);
      assert.equal(puff.density, original.density);
      assert.deepEqual(puff.radii, original.scale);
      assert.deepEqual(
        puff.center,
        original.normal.map((v) => v * (field.cloudRadius + original.alt)),
      );
      east.fromArray(puff.basis[0]);
      up.fromArray(puff.basis[1]);
      forward.fromArray(puff.basis[2]);
      assert.ok(
        Math.abs(east.length() - 1) < 1e-12 &&
          Math.abs(up.length() - 1) < 1e-12 &&
          Math.abs(forward.length() - 1) < 1e-12,
      );
      assert.ok(
        Math.abs(east.dot(up)) < 1e-12 &&
          Math.abs(forward.dot(up)) < 1e-12 &&
          Math.abs(east.dot(forward)) < 1e-12,
      );
      assert.ok(new THREE.Vector3().crossVectors(east, up).distanceTo(forward) < 1e-12);
      for (let j = 0; j < 120; j++) {
        const y = 1 - (2 * (j + 0.5)) / 120,
          angle = j * 2.399963229728653,
          r = Math.sqrt(1 - y * y),
          x = r * Math.cos(angle),
          z = r * Math.sin(angle);
        point
          .fromArray(puff.center)
          .addScaledVector(east, x * puff.radii[0])
          .addScaledVector(up, y * puff.radii[1])
          .addScaledVector(forward, z * puff.radii[2]);
        assert.ok(
          point.length() >= field.bounds.inner - 1e-10 &&
            point.length() <= field.bounds.outer + 1e-10,
          'Analytic radial bounds enclose actual ellipsoid surface',
        );
      }
    }
  }
assert.throws(() => createCloudField({ seed: 0, terrainRadius: NaN }), RangeError);
console.log(
  `PASS canonical field: deterministic regional layout, 39 seed/radius combinations, max ${maximumPuffs} puffs, ${worstClearance.toFixed(3)} minimum conservative clearance, orthonormal bases and analytic shell bounds.`,
);

const field = createCloudField({ seed: 39, terrainRadius: 43 }),
  scene = new THREE.Scene(),
  low = createLowCloudRenderer({ scene, field }),
  { mesh, group } = low;
const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 900),
  wind = new THREE.Matrix4(),
  matrix = new THREE.Matrix4(),
  sun = new THREE.Vector3(1, 2, 3).normalize();
assert.equal(scene.children.length, 1);
assert.equal(group.children.length, 1);
assert.equal(mesh.count, field.puffs.length);
assert.equal(mesh.material.side, THREE.FrontSide);
assert.equal(mesh.material.forceSinglePass, true);
assert.equal(mesh.material.blending, THREE.NormalBlending);
assert.equal(mesh.material.depthTest, true);
assert.equal(mesh.material.depthWrite, false);
assert.equal(mesh.castShadow, false);
assert.equal(mesh.receiveShadow, false);
assert.equal(mesh.geometry.index.count / 3, 120);
assert.ok(low.stats().geometryTriangles <= 21600);
assert.ok(mesh.material.fragmentShader.includes('gl_FrontFacing'));
assert.ok(mesh.material.fragmentShader.includes('uSunDirection'));
assert.ok(mesh.material.fragmentShader.includes('#include <tonemapping_fragment>'));
assert.ok(mesh.material.fragmentShader.includes('#include <colorspace_fragment>'));
const byCenter = new Map(field.puffs.map((p) => [p.center.map(Math.fround).join(','), p]));
function verifyOrderAndAttributes() {
  let previous = -Infinity;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    point.setFromMatrixPosition(matrix);
    const puff = byCenter.get(point.toArray().join(','));
    assert.ok(puff, 'Each transform remains an original canonical puff');
    assert.ok(
      Math.abs(mesh.geometry.attributes.instanceDensity.getX(i) - puff.density) < 1e-7,
      'Density follows its transform',
    );
    point.applyMatrix4(group.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    assert.ok(point.z >= previous - 2e-5, 'Instances sort by camera-space depth, far to near');
    previous = point.z;
  }
}
for (const position of [
  [0, 40, 140],
  [140, 0, 0],
  [-80, -50, 20],
  [0, -140, 0],
  [0, 0, 0],
]) {
  camera.position.fromArray(position);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  low.update({ camera, windMatrix: wind, sunDirection: sun, visible: true });
  verifyOrderAndAttributes();
  assert.ok(mesh.material.uniforms.uSunDirection.value.distanceTo(sun) < 1e-12);
}
let before = low.stats(),
  matrixVersion = mesh.instanceMatrix.version,
  densityVersion = mesh.geometry.attributes.instanceDensity.version,
  insideVersion = mesh.geometry.attributes.instanceInside.version;
for (let i = 0; i < 100; i++)
  low.update({ camera, windMatrix: wind, sunDirection: sun, visible: true });
assert.equal(
  low.stats().sortPasses,
  before.sortPasses,
  'An unchanged relative pose needs no sorting',
);
assert.equal(mesh.instanceMatrix.version, matrixVersion);
assert.equal(mesh.geometry.attributes.instanceDensity.version, densityVersion);
assert.equal(mesh.geometry.attributes.instanceInside.version, insideVersion);
// Translation along the same viewing direction changes depths but not their
// ordering. It must not upload canonical matrices again.
camera.position.set(0, 0, 160);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
low.update({ camera, windMatrix: wind, visible: true });
matrixVersion = mesh.instanceMatrix.version;
camera.position.z = 170;
low.update({ camera, windMatrix: wind, visible: true });
assert.equal(mesh.instanceMatrix.version, matrixVersion);
// The one shared wind matrix moves the entire field without changing the
// canonical placement. Validate sort ordering after a tilted wind transform.
wind.makeRotationFromEuler(new THREE.Euler(0.017, 0.53, -0.011));
low.update({ camera, windMatrix: wind, visible: true });
verifyOrderAndAttributes();
assert.ok(group.matrix.equals(wind));
assert.deepEqual(
  field,
  createCloudField({ seed: 39, terrainRadius: 43 }),
  'Rendering cannot mutate the common field',
);
// Visibility takes effect before any camera access, sorting, or upload.
before = low.stats();
matrixVersion = mesh.instanceMatrix.version;
densityVersion = mesh.geometry.attributes.instanceDensity.version;
insideVersion = mesh.geometry.attributes.instanceInside.version;
for (let i = 0; i < 100; i++) low.update({ camera: null, windMatrix: null, visible: false });
assert.equal(group.visible, false);
assert.equal(low.stats().drawCalls, 0);
assert.equal(low.stats().triangles, 0);
for (const key of [
  'sortPasses',
  'sortComparisons',
  'insideTests',
  'instanceUploads',
  'attributeUploads',
  'uploadedBytes',
])
  assert.equal(low.stats()[key], before[key], `Hidden views skip ${key}`);
assert.equal(mesh.instanceMatrix.version, matrixVersion);
assert.equal(mesh.geometry.attributes.instanceDensity.version, densityVersion);
assert.equal(mesh.geometry.attributes.instanceInside.version, insideVersion);
low.update({ camera, windMatrix: wind, visible: true });
assert.equal(group.visible, true);
verifyOrderAndAttributes();
let geometryDisposals = 0,
  materialDisposals = 0,
  meshDisposals = 0;
mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
mesh.material.addEventListener('dispose', () => materialDisposals++);
mesh.addEventListener('dispose', () => meshDisposals++);
low.dispose();
low.dispose();
assert.equal(scene.children.length, 0);
assert.equal(low.stats().drawCalls, 0);
assert.equal(geometryDisposals, 1);
assert.equal(materialDisposals, 1);
assert.equal(meshDisposals, 1);
console.log(
  'PASS Low geometry/draw budget, one-sided double-sided rendering, camera-depth ordering, attribute alignment, current sun, shared wind, hidden early exit, unchanged-buffer reuse, and idempotent disposal.',
);

const identityBasis = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  tinyField = {
    bounds: { inner: 0, outer: 110 },
    puffs: [
      { center: [90, 0, -4], basis: identityBasis, radii: [2, 1, 3], density: 0.4, bankId: 0 },
      { center: [0, 0, -10], basis: identityBasis, radii: [2, 1, 3], density: 0.8, bankId: 1 },
      { center: [0, 0, 0], basis: identityBasis, radii: [2, 1, 3], density: 0.6, bankId: 2 },
    ],
  };
const tiny = createLowCloudRenderer({ scene: new THREE.Scene(), field: tinyField }),
  nearCamera = new THREE.PerspectiveCamera();
nearCamera.position.set(0, 0, 6);
nearCamera.lookAt(0, 0, -1);
nearCamera.updateMatrixWorld(true);
tiny.update({ camera: nearCamera, windMatrix: new THREE.Matrix4(), visible: true });
tiny.mesh.getMatrixAt(0, matrix);
assert.equal(
  matrix.elements[14],
  -10,
  'Far-Z puff sorts first even when another center has greater Euclidean distance',
);
assert.deepEqual(Array.from(tiny.mesh.geometry.attributes.instanceInside.array), [0, 0, 0]);
assert.equal(tiny.mesh.material.side, THREE.FrontSide);
assert.equal(tiny.stats().insidePuffs, 0);
assert.equal(tiny.stats().faceMode, 'front-face-culled');
matrixVersion = tiny.mesh.instanceMatrix.version;
densityVersion = tiny.mesh.geometry.attributes.instanceDensity.version;
insideVersion = tiny.mesh.geometry.attributes.instanceInside.version;
nearCamera.position.set(0, 0, 0);
tiny.update({ camera: nearCamera, visible: true });
assert.deepEqual(Array.from(tiny.mesh.geometry.attributes.instanceInside.array), [0, 0, 1]);
assert.equal(tiny.mesh.material.side, THREE.DoubleSide);
assert.equal(tiny.stats().insidePuffs, 1);
assert.equal(tiny.stats().faceMode, 'inside-single-pass');
assert.equal(
  tiny.mesh.instanceMatrix.version,
  matrixVersion,
  'Entering a puff does not upload unchanged transforms',
);
assert.equal(tiny.mesh.geometry.attributes.instanceDensity.version, densityVersion);
assert.equal(tiny.mesh.geometry.attributes.instanceInside.version, insideVersion + 1);
// Inside detection uses inverse wind and all three ellipsoid axes/radii.
const rotated = new THREE.Matrix4().makeRotationY(Math.PI / 2);
nearCamera.position.set(0, 0, 0).applyMatrix4(rotated);
tiny.update({ camera: nearCamera, windMatrix: rotated, visible: true });
let containsOrigin = false;
for (let i = 0; i < tiny.mesh.count; i++) {
  tiny.mesh.getMatrixAt(i, matrix);
  if (matrix.elements[12] === 0 && matrix.elements[14] === 0) {
    assert.equal(tiny.mesh.geometry.attributes.instanceInside.getX(i), 1);
    containsOrigin = true;
  }
}
assert.equal(containsOrigin, true);
nearCamera.position.set(0, 0, 6);
tiny.update({ camera: nearCamera, visible: true });
assert.equal(tiny.mesh.material.side, THREE.FrontSide);
assert.equal(tiny.stats().insidePuffs, 0);
const stableMaterialVersion = tiny.mesh.material.version;
tiny.update({ camera: nearCamera, visible: true });
assert.equal(
  tiny.mesh.material.version,
  stableMaterialVersion,
  'Only an inside/outside transition changes the shader variant',
);
assert.ok(tiny.mesh.material.fragmentShader.includes('#ifdef DOUBLE_SIDED'));
assert.ok(tiny.mesh.material.vertexShader.includes('vShade='));
tiny.dispose();
// Guard the hot path against accidental per-frame allocations/slice/sort/map.
const source = readFileSync(new URL('../src/cloud-low.js', import.meta.url), 'utf8'),
  hotPath = source.slice(
    source.indexOf('function update('),
    source.indexOf('function resetGpuTimings('),
  );
assert.ok(hotPath.length > 1000, 'Hot path guard must actually select the update function');
assert.ok(!/\bnew\s|\.sort\(|\.map\(|\.slice\(|\.subarray\(/.test(hotPath));
console.log(
  'PASS camera-space versus distance regression, per-puff inside flags under wind, independent attribute uploads, and allocation-free hot-path guard.',
);

// Fake WebGL verifies asynchronous query lifecycle, not actual GPU performance.
let queryId = 0,
  currentQuery = null,
  readResults = 0,
  deletedQueries = 0,
  disjoint = false;
const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
const fakeGl = {
  QUERY_RESULT_AVAILABLE: 3,
  QUERY_RESULT: 4,
  CURRENT_QUERY: 5,
  getExtension(name) {
    assert.equal(name, 'EXT_disjoint_timer_query_webgl2');
    return extension;
  },
  createQuery() {
    return { id: queryId++, available: false, nanoseconds: 1e6 };
  },
  deleteQuery() {
    deletedQueries++;
  },
  isContextLost() {
    return false;
  },
  getParameter() {
    return disjoint;
  },
  getQuery() {
    return currentQuery;
  },
  beginQuery(target, query) {
    assert.equal(currentQuery, null);
    currentQuery = query;
    query.available = false;
  },
  endQuery() {
    assert.ok(currentQuery);
    currentQuery.available = true;
    currentQuery = null;
  },
  getQueryParameter(query, parameter) {
    if (parameter === this.QUERY_RESULT_AVAILABLE) return query.available;
    assert.equal(query.available, true, 'Never read an unavailable GPU result');
    readResults++;
    return query.nanoseconds;
  },
};
const fakeRenderer = {
    getContext() {
      return fakeGl;
    },
  },
  timed = createLowCloudRenderer({
    scene: new THREE.Scene(),
    field: tinyField,
    renderer: fakeRenderer,
  });
assert.equal(timed.stats().gpuTimerAvailable, true);
assert.equal(timed.stats().gpuTimeMs, null);
assert.equal(queryId, 4);
timed.mesh.onBeforeRender(fakeRenderer);
assert.equal(readResults, 0);
assert.ok(currentQuery);
timed.mesh.onAfterRender();
timed.mesh.onBeforeRender(fakeRenderer);
assert.equal(readResults, 1);
assert.equal(timed.stats().gpuTimeMs, 1);
assert.equal(timed.stats().gpuP95Ms, 1);
timed.mesh.onAfterRender();
// Caller-owned whole-frame queries take precedence and cannot be nested.
const outsideQuery = { owner: 'whole-frame' };
currentQuery = outsideQuery;
timed.mesh.onBeforeRender(fakeRenderer);
assert.equal(currentQuery, outsideQuery);
timed.mesh.onAfterRender();
assert.equal(currentQuery, outsideQuery);
currentQuery = null;
disjoint = true;
timed.mesh.onBeforeRender(fakeRenderer);
assert.equal(currentQuery, null);
assert.equal(timed.stats().gpuTimeMs, null);
assert.equal(timed.stats().gpuP95Ms, null);
disjoint = false;
timed.mesh.onBeforeRender(fakeRenderer);
currentQuery.nanoseconds = 2e6;
timed.mesh.onAfterRender();
timed.mesh.onBeforeRender(fakeRenderer);
assert.equal(timed.stats().gpuP95Ms, 2, 'Discarded pre-disjoint history cannot affect later p95');
timed.mesh.onAfterRender();
const readsBeforeHide = readResults;
timed.update({ visible: false });
timed.mesh.onBeforeRender(fakeRenderer);
assert.equal(readResults, readsBeforeHide, 'Hidden clouds skip timer work');
timed.resetGpuTimings();
assert.equal(timed.stats().gpuSamples, 0);
assert.equal(timed.stats().gpuTimeMs, null);
assert.equal(timed.stats().gpuP95Ms, null);
timed.update({ camera: nearCamera, visible: true });
const readsAtReset = readResults;
timed.mesh.onBeforeRender(fakeRenderer);
assert.equal(
  readResults,
  readsAtReset,
  'A pre-reset outstanding query is discarded without reading its stale result',
);
currentQuery.nanoseconds = 3e6;
timed.mesh.onAfterRender();
timed.mesh.onBeforeRender(fakeRenderer);
assert.equal(timed.stats().gpuSamples, 1);
assert.equal(timed.stats().gpuP95Ms, 3);
assert.equal(timed.stats().gpuTimeMs, 3);
// A reset during an active query invalidates it as well as pending results.
timed.resetGpuTimings();
timed.mesh.onAfterRender();
timed.mesh.onBeforeRender(fakeRenderer);
assert.equal(timed.stats().gpuSamples, 0);
timed.mesh.onAfterRender();
timed.dispose();
assert.equal(deletedQueries, 4);
assert.equal(timed.stats().gpuPendingQueries, 0);
const unsupported = createLowCloudRenderer({
  scene: new THREE.Scene(),
  field: tinyField,
  renderer: {
    getContext() {
      return {
        beginQuery() {},
        getExtension() {
          return null;
        },
      };
    },
  },
});
assert.equal(unsupported.stats().gpuTimerAvailable, false);
unsupported.dispose();
console.log(
  'PASS optional bounded GPU timer queries, non-blocking availability checks, disjoint rejection, nested-query avoidance, hidden skip, and query disposal (CPU mocked, no performance claim).',
);

// Rendering counters come from mesh callbacks, independent of timer support.
const measured = createLowCloudRenderer({ scene: new THREE.Scene(), field: tinyField });
measured.update({ camera: nearCamera, visible: true });
assert.equal(measured.stats().configuredDrawCalls, 1);
assert.equal(measured.stats().drawCalls, 0);
assert.equal(measured.stats().actualDrawCalls, 0);
measured.mesh.onBeforeRender();
measured.mesh.onAfterRender();
assert.equal(measured.stats().drawCalls, 1);
assert.equal(measured.stats().actualDrawCalls, 1);
assert.equal(measured.stats().triangles, 360);
measured.update({ camera: nearCamera, visible: true });
assert.equal(
  measured.stats().actualDrawCalls,
  0,
  'Frustum-culled frames produce zero actual draws',
);
measured.mesh.onBeforeRender();
measured.mesh.onAfterRender();
measured.group.visible = false;
assert.equal(measured.stats().visible, false);
assert.equal(measured.stats().configuredDrawCalls, 0);
assert.equal(measured.stats().actualDrawCalls, 0);
assert.equal(measured.stats().triangles, 0);
assert.equal(measured.stats().totalDrawCalls, 2);
measured.dispose();
console.log(
  'PASS actual versus configured draw diagnostics, timer-independent counters, per-update reset, frustum-cull zero, and direct High-mode group hiding.',
);
