import assert from 'node:assert/strict';
import { createCloudMeasurement } from '../src/cloud-measurement.js';
let time = 0,
  queryActive = null,
  deleted = 0;
Object.defineProperty(globalThis, 'performance', {
  value: { now: () => time },
  configurable: true,
});
const ext = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
const gl = {
  CURRENT_QUERY: 3,
  QUERY_RESULT_AVAILABLE: 4,
  QUERY_RESULT: 5,
  RENDERER: 6,
  getExtension: (name) => (name === 'EXT_disjoint_timer_query_webgl2' ? ext : null),
  createQuery: () => ({}),
  deleteQuery: () => deleted++,
  getParameter: (key) => (key === 2 ? false : 'Mock GPU'),
  getQuery: () => queryActive,
  beginQuery: (target, q) => {
    assert.equal(queryActive, null);
    queryActive = q;
  },
  endQuery: () => (queryActive = null),
  getQueryParameter: (q, key) => (key === 4 ? true : 2000000),
};
const renderer = {
  getContext: () => gl,
  getDrawingBufferSize: (size) => size.set(2352, 1336.4).floor(),
  getPixelRatio: () => 1.6,
};
const measurement = createCloudMeasurement(renderer);
measurement.start();
for (let i = 0; i < 490; i++) {
  time += 16.7;
  measurement.begin();
  measurement.beginGpu();
  time += 3;
  measurement.endGpu();
  measurement.end(() => ({ requestedQuality: 'high', effectiveQuality: 'high' }));
}
const result = measurement.stats();
assert.equal(result.active, false);
assert.equal(result.report.samples, 240);
assert.equal(result.report.gpuWholeFrameMs.available, true);
assert.equal(result.report.gpuWholeFrameMs.samples, 240);
assert.equal(result.report.gpuWholeFrameMs.p95, 2);
assert.equal(result.report.cpuWholeFrameMs.p95, 3);
assert.deepEqual(result.report.drawingBuffer, [2352, 1336]);
assert.equal(result.report.clouds.effectiveQuality, 'high');
measurement.dispose();
assert.equal(deleted, 8);
const fallback = createCloudMeasurement({});
fallback.start();
for (let i = 0; i < 490; i++) {
  time += 16;
  fallback.begin();
  fallback.beginGpu();
  time += 2;
  fallback.endGpu();
  fallback.end({});
}
assert.equal(fallback.stats().report.gpuWholeFrameMs.available, false);
assert.equal(fallback.stats().report.gpuWholeFrameMs.p95, null);
fallback.dispose();
console.log(
  'PASS two-phase 480-frame capture, isolated versus whole-frame query separation, exact GPU sample counts, CPU/rAF labeling, no-extension null metrics and disposal (mock GPU only)',
);

const diagnosticRenderer = {
  ...renderer,
  info: { memory: { textures: 17, geometries: 203 }, programs: [{}, {}] },
};
const diagnostics = createCloudMeasurement(diagnosticRenderer);
const before = diagnostics.stats();
const snapshot = diagnostics.snapshot(() => ({ high: { renderTargets: 3 } }));
assert.deepEqual(snapshot.rendererAllocations, { textures: 17, geometries: 203, programs: 2 });
assert.deepEqual(snapshot.drawingBuffer, [2352, 1336]);
assert.equal(snapshot.clouds.high.renderTargets, 3);
assert.deepEqual(diagnostics.stats(), before);
diagnosticRenderer.info.memory.textures = 19;
assert.equal(diagnostics.snapshot({}).rendererAllocations.textures, 19);
assert.equal(snapshot.rendererAllocations.textures, 17);
diagnostics.dispose();
const missing = createCloudMeasurement({});
assert.deepEqual(missing.snapshot({}).rendererAllocations, {
  textures: null,
  geometries: null,
  programs: null,
});
missing.dispose();
console.log(
  'PASS allocation snapshots are fresh, immutable, optional-safe and do not start or alter measurement/rendering.',
);
