import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  cloudTargetSize,
  intersectCloudShellRay,
  createHighCloudRenderer,
  CLOUD_RAYMARCH_FRAGMENT,
  CLOUD_COMPOSITE_FRAGMENT,
  CLOUD_OUTPUT_FRAGMENT,
  inverseACESClearColor,
  addCloudSceneFlags,
} from '../src/cloud-high.js';

for (const [w, h] of [
  [1, 1],
  [390, 844],
  [1920, 1080],
  [3840, 2160],
  [7680, 4320],
  [1170, 2532],
  [900, 100],
  [100, 900],
]) {
  const size = cloudTargetSize(w, h);
  assert.ok(size.width >= 1 && size.height >= 1);
  assert.ok(size.width * size.height <= 262144);
  assert.ok(size.scale <= 0.5);
  assert.ok(Math.abs(size.width - w * size.scale) < 1.01);
  assert.ok(Math.abs(size.height - h * size.scale) < 1.01);
}
assert.deepEqual(cloudTargetSize(1920, 1080), {
  width: 682,
  height: 384,
  scale: Math.sqrt(262144 / (1920 * 1080)),
});
const shell = (origin, direction, depth) =>
  intersectCloudShellRay(origin, direction, 40, 45, depth);
assert.deepEqual(shell([0, 0, 100], [0, 0, -1]), [
  [55, 60],
  [140, 145],
]);
assert.deepEqual(shell([0, 0, 0], [0, 0, 1]), [[40, 45]]);
assert.deepEqual(shell([0, 0, 42], [0, 0, 1]), [[0, 3]]);
assert.deepEqual(shell([0, 0, 42], [0, 0, -1]), [
  [0, 2],
  [82, 87],
]);
assert.deepEqual(shell([0, 0, 100], [0, 0, 1]), []);
assert.deepEqual(shell([0, 0, 100], [0, 0, -1], 54), []);
assert.deepEqual(shell([0, 0, 100], [0, 0, -1], 57), [[55, 57]]);
assert.deepEqual(shell([0, 0, 100], [0, 0, -1], 120), [[55, 60]]);
assert.deepEqual(shell([0, 0, 100], [0, 0, -1], 142), [
  [55, 60],
  [140, 142],
]);
assert.deepEqual(shell([0, 0, 45], [1, 0, 0]), []);
// Every nonempty interval is ordered, clipped, and strictly outside the cavity.
let seed = 12345;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < 4000; i++) {
  const o = [random() * 220 - 110, random() * 220 - 110, random() * 220 - 110],
    d = [random() * 2 - 1, random() * 2 - 1, random() * 2 - 1],
    length = Math.hypot(...d),
    depth = random() * 300;
  for (let axis = 0; axis < 3; axis++) d[axis] /= length;
  const intervals = shell(o, d, depth);
  assert.ok(intervals.length <= 2);
  let previous = 0;
  for (const [a, b] of intervals) {
    assert.ok(a >= previous - 1e-9 && b > a && b <= depth + 1e-9);
    previous = b;
    for (const t of [a, (a + b) / 2, b]) {
      const r = Math.hypot(...o.map((v, k) => v + d[k] * t));
      assert.ok(r >= 40 - 1e-7 && r <= 45 + 1e-7);
    }
  }
}
// Architectural/shader contracts. Browser QA additionally validates compilation
// and pixel behavior; CPU/source checks cannot establish rendered performance.
assert.match(CLOUD_RAYMARCH_FRAGMENT, /const int PRIMARY_SAMPLES=48/);
assert.equal(
  (CLOUD_RAYMARCH_FRAGMENT.match(/for\s*\(/g) ?? []).length,
  1,
  'One 48-step loop shared across both intervals',
);
assert.match(CLOUD_RAYMARCH_FRAGMENT, /firstLength\+intervals.w-intervals.z/);
assert.match(CLOUD_RAYMARCH_FRAGMENT, /cumulative<firstLength/);
assert.match(CLOUD_RAYMARCH_FRAGMENT, /1\.-exp\(-uExtinction\*rho\*ds\)/);
assert.match(CLOUD_RAYMARCH_FRAGMENT, /phaseHG\(dot\(ray,uSunDirection\)\)/);
assert.equal((CLOUD_RAYMARCH_FRAGMENT.match(/densityAt\(worldPosition\+/g) ?? []).length, 2);
assert.match(CLOUD_RAYMARCH_FRAGMENT, /shadowDensity\*segment/);
assert.match(CLOUD_RAYMARCH_FRAGMENT, /transmittance<\.02/);
assert.ok(
  CLOUD_RAYMARCH_FRAGMENT.indexOf('if(radius<=heights.x') <
    CLOUD_RAYMARCH_FRAGMENT.indexOf('texture(uNoise'),
);
assert.ok(!/uTime|uFrame|puffs\[|banks\[/.test(CLOUD_RAYMARCH_FRAGMENT));
assert.match(CLOUD_COMPOSITE_FRAGMENT, /if\(weightSum<=\.00001\)return vec4\(0\.\)/);
assert.match(CLOUD_COMPOSITE_FRAGMENT, /shellIntervals\(origin-uPlanetCenter,ray,fullDistance\)/);
assert.match(CLOUD_COMPOSITE_FRAGMENT, /cloud.rgb\+\(1\.-cloud.a\)\*sceneColor.rgb/);
assert.ok(
  !/tonemapping_fragment|colorspace_fragment/.test(
    CLOUD_COMPOSITE_FRAGMENT + CLOUD_RAYMARCH_FRAGMENT,
  ),
);

function mockRenderer({ supported = true, framebuffer = true } = {}) {
  const state = {
    target: null,
    width: 1280,
    height: 800,
    draws: 0,
    manualSceneClears: 0,
    sceneAutoClears: 0,
    metadataClears: 0,
    colorMask: false,
    buffers: {
      color: {
        setMask(value) {
          state.colorMask = value;
        },
      },
    },
    targetAllocations: new Set(),
    disposedTargets: 0,
    checks: 0,
  };
  const context = {
    COLOR: 4,
    clearBufferfv: (buffer, index, value) => {
      assert.equal(buffer, 4);
      assert.equal(index, 1);
      assert.deepEqual(Array.from(value), [0, 0, 0, 0]);
      state.metadataClears++;
    },
    MAX_DRAW_BUFFERS: 1,
    FRAMEBUFFER: 2,
    FRAMEBUFFER_COMPLETE: 3,
    getExtension: (name) => (name === 'EXT_color_buffer_float' && supported ? {} : null),
    getParameter: () => 4,
    isContextLost: () => false,
    checkFramebufferStatus: () => {
      state.checks++;
      return framebuffer ? 3 : 0;
    },
  };
  const viewport = new THREE.Vector4(2, 3, 640, 400),
    scissor = new THREE.Vector4(4, 5, 600, 350),
    clearColor = new THREE.Color(0.2, 0.3, 0.4);
  const renderer = {
    state,
    getContext: () => context,
    capabilities: { isWebGL2: true },
    autoClear: true,
    autoClearColor: false,
    autoClearDepth: false,
    autoClearStencil: false,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.25,
    outputColorSpace: THREE.SRGBColorSpace,
    xr: { enabled: true },
    info: {
      autoReset: true,
      render: { calls: 0 },
      reset() {
        this.render.calls = 0;
      },
    },
    getDrawingBufferSize: (out) => out.set(state.width, state.height),
    getRenderTarget: () => state.target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getViewport: (out) => out.copy(viewport),
    getScissor: (out) => out.copy(scissor),
    getScissorTest: () => renderer.scissorTest,
    scissorTest: true,
    getClearColor: (out) => out.copy(clearColor),
    getClearAlpha: () => renderer.clearAlpha,
    clearAlpha: 0.7,
    setClearColor: (color, alpha) => {
      clearColor.set(color);
      if (alpha !== undefined) renderer.clearAlpha = alpha;
    },
    setViewport: (value) => viewport.copy(value),
    setScissor: (value) => scissor.copy(value),
    setScissorTest: (value) => {
      renderer.scissorTest = value;
    },
    setRenderTarget: (target) => {
      state.target = target;
      if (target && !state.targetAllocations.has(target)) {
        state.targetAllocations.add(target);
        target.addEventListener('dispose', () => state.disposedTargets++);
      }
    },
    clear: () => {
      if (state.target?.texture?.name === 'Cloud scene linear HDR') {
        assert.equal(
          state.colorMask,
          true,
          'Explicit target color clear must restore its write mask',
        );
        state.manualSceneClears++;
      }
    },
    render(scene) {
      if (state.target?.texture?.name === 'Cloud scene linear HDR') {
        assert.equal(
          renderer.autoClear,
          true,
          'Scene render must restore the depth write mask before clearing',
        );
        assert.equal(
          renderer.autoClearColor,
          false,
          'Independent MRT color clears must not be overwritten',
        );
        assert.equal(renderer.autoClearDepth, true);
        assert.equal(renderer.autoClearStencil, true);
        state.sceneAutoClears++;
      } else
        assert.equal(
          renderer.autoClear,
          false,
          'Fullscreen draws must preserve their inputs and scissored radiance',
        );
      state.draws++;
      renderer.info.render.calls++;
      if (scene.children[0]?.material?.name === 'Cloud composite / output FXAA') {
        assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
        assert.equal(renderer.outputColorSpace, THREE.SRGBColorSpace);
      } else {
        assert.equal(renderer.toneMapping, THREE.NoToneMapping);
        assert.equal(renderer.outputColorSpace, THREE.LinearSRGBColorSpace);
      }
    },
  };
  return renderer;
}
function resourceData() {
  return {
    envelope: {
      size: 1,
      faces: Array.from({ length: 6 }, () => new Uint8Array([0, 255, 255, 255])),
    },
    noise: { size: 1, data: new Uint8Array([128]) },
    blueNoise: { size: 1, data: new Uint8Array([128]) },
    bounds: { inner: 40, outer: 45 },
  };
}
const renderer = mockRenderer(),
  high = createHighCloudRenderer({ renderer, bounds: { inner: 40, outer: 45 }, planetRadius: 39 });
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500);
camera.position.set(0, 0, 140);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const args = {
  scene,
  camera,
  windInverse: new THREE.Matrix3(),
  sunDirection: new THREE.Vector3(1, 2, 3).normalize(),
  planetCenter: new THREE.Vector3(),
};
assert.equal(high.render(args), false);
assert.equal(renderer.state.draws, 0);
assert.equal(renderer.state.targetAllocations.size, 0);
assert.equal(high.setResources(resourceData()), true);
assert.equal(renderer.state.draws, 0);
assert.equal(
  renderer.state.targetAllocations.size,
  0,
  'setResources performs no target work or rendering',
);
assert.equal(high.render(args), true);
assert.equal(renderer.state.draws, 4);
assert.equal(renderer.state.targetAllocations.size, 3);
assert.equal(high.stats().drawCalls, 3);
assert.equal(high.stats().sceneDrawCalls, 1);
assert.equal(renderer.info.render.calls, 4);
assert.equal(high.stats().antialiasing, 'display-space FXAA');
assert.equal(high.stats().dimensions.sceneWidth, 1280);
assert.equal(high.stats().dimensions.sceneHeight, 800);
assert.ok(high.stats().targetPixels <= 262144);
for (let i = 0; i < 4; i++) assert.equal(high.render(args), true);
assert.equal(
  renderer.info.render.calls,
  4,
  'Per-frame counters must not accumulate while High remains active',
);
assert.equal(renderer.state.targetAllocations.size, 3, 'Steady rendering never allocates targets');
assert.equal(renderer.state.checks, 3, 'Framebuffer validation occurs only at allocation');
assert.equal(
  renderer.state.manualSceneClears,
  5,
  'Target color is refreshed explicitly before each color-only clear',
);
assert.equal(
  renderer.state.metadataClears,
  5,
  'Metadata is independently cleared to zero, never the HDR backdrop',
);
assert.equal(
  renderer.state.sceneAutoClears,
  5,
  'Every High frame receives exactly one scene auto-clear',
);
assert.equal(renderer.getRenderTarget(), null);
assert.equal(renderer.autoClear, true);
assert.equal(renderer.autoClearColor, false);
assert.equal(renderer.autoClearDepth, false);
assert.equal(renderer.autoClearStencil, false);
assert.equal(renderer.xr.enabled, true);
assert.equal(renderer.info.autoReset, true);
assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
assert.equal(renderer.outputColorSpace, THREE.SRGBColorSpace);
assert.equal(renderer.getClearAlpha(), 0.7);
assert.equal(renderer.getScissorTest(), true);
assert.deepEqual(renderer.getViewport(new THREE.Vector4()).toArray(), [2, 3, 640, 400]);
assert.deepEqual(renderer.getScissor(new THREE.Vector4()).toArray(), [4, 5, 600, 350]);
renderer.state.width = 640;
renderer.state.height = 360;
high.resize();
assert.equal(
  renderer.state.targetAllocations.size,
  3,
  'A resize notification while hidden defers GPU work',
);
assert.equal(high.render(args), true);
assert.equal(renderer.state.targetAllocations.size, 6);
assert.equal(renderer.state.disposedTargets, 3);
assert.equal(high.stats().dimensions.sceneWidth, 640);
camera.lookAt(0, 0, 280);
camera.updateMatrixWorld();
const before = renderer.state.draws;
assert.equal(high.render(args), false);
assert.equal(high.stats().culled, true);
assert.equal(renderer.state.draws, before, 'Off-frustum shell skips the entire pipeline');
camera.position.set(0, 0, 42);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
assert.equal(high.render(args), true);
assert.deepEqual(
  high.stats().projectedBounds,
  [0, 0, 1, 1],
  'Inside-shell cameras use full bounds',
);
const externalTarget = new THREE.WebGLRenderTarget(20, 30);
renderer.setRenderTarget(externalTarget);
assert.equal(high.render(args), false);
assert.equal(renderer.getRenderTarget(), externalTarget);
assert.equal(high.stats().skipReason, 'external-render-target');
renderer.setRenderTarget(null);
high.dispose();
high.dispose();
// v2 resources use the same postprocess state contracts, with one additional
// density texture. Reject incomplete/mixed worker responses before allocation.
const v2Renderer = mockRenderer(),
  v2High = createHighCloudRenderer({
    renderer: v2Renderer,
    bounds: { inner: 40, outer: 45 },
    planetRadius: 39,
  });
const baseResources = resourceData();
const v2Resources = {
  version: 2,
  model: 'weather',
  weather: baseResources.envelope,
  noise: baseResources.noise,
  detail: { size: 1, data: new Uint8Array([128]) },
  blueNoise: baseResources.blueNoise,
  bounds: baseResources.bounds,
};
assert.equal(v2High.setResources({ ...v2Resources, version: 1 }), false);
assert.equal(v2High.setResources({ ...v2Resources, detail: null }), false);
assert.equal(
  v2High.setResources({ ...v2Resources, detail: { size: 2, data: new Uint8Array(1) } }),
  false,
);
assert.equal(v2High.setResources(v2Resources), true);
assert.equal(v2High.stats().densityModel, 'weather');
assert.equal(v2High.stats().resourceBytes, 27);
assert.equal(v2High.render(args), true);
assert.equal(v2Renderer.state.draws, 4);
assert.equal(v2Renderer.getRenderTarget(), null);
assert.equal(v2High.setResources(resourceData()), true);
assert.equal(v2High.stats().densityModel, 'legacy');
assert.equal(v2High.render(args), true);
v2High.dispose();
v2High.dispose();
assert.equal(v2Renderer.state.disposedTargets, 3);
console.log(
  'PASS v2 High resources, malformed/mixed version rejection, dynamic texture bytes, weather/legacy switching, and renderer restoration.',
);
assert.equal(renderer.state.disposedTargets, 6);
assert.equal(high.render(args), false);
for (const scenario of [{ supported: false }, { framebuffer: false }]) {
  const fallbackRenderer = mockRenderer(scenario),
    fallback = createHighCloudRenderer({
      renderer: fallbackRenderer,
      bounds: { inner: 40, outer: 45 },
      planetRadius: 39,
    });
  fallback.setResources(resourceData());
  assert.equal(fallback.render(args), false);
  assert.equal(fallback.stats().supported, false);
  assert.ok(fallback.stats().failure);
  assert.equal(fallbackRenderer.getRenderTarget(), null);
  assert.equal(fallbackRenderer.autoClear, true);
  assert.equal(fallbackRenderer.xr.enabled, true);
  assert.equal(fallbackRenderer.info.autoReset, true);
  assert.equal(fallback.stats().renderTargets, 0);
  fallback.dispose();
}
// Disjoint queries must remain invalid after the disjoint flag clears, including
// measurements that were not ready when the event happened.
const timedRenderer = mockRenderer(),
  timedContext = timedRenderer.getContext();
const timerExtension = { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 };
let disjoint = false,
  currentQuery = null;
const queries = [];
timedContext.QUERY_RESULT_AVAILABLE = 12;
timedContext.QUERY_RESULT = 13;
timedContext.CURRENT_QUERY = 14;
timedContext.getExtension = (name) =>
  name === 'EXT_disjoint_timer_query_webgl2'
    ? timerExtension
    : name === 'EXT_color_buffer_float'
      ? {}
      : null;
timedContext.getParameter = (parameter) =>
  parameter === timerExtension.GPU_DISJOINT_EXT ? disjoint : 4;
timedContext.createQuery = () => {
  const query = { ready: false, ns: 0 };
  queries.push(query);
  return query;
};
timedContext.getQueryParameter = (query, parameter) =>
  parameter === timedContext.QUERY_RESULT_AVAILABLE ? query.ready : query.ns;
timedContext.getQuery = () => currentQuery;
timedContext.beginQuery = (target, query) => {
  assert.equal(disjoint, false);
  currentQuery = query;
  query.ready = false;
};
timedContext.endQuery = () => {
  currentQuery = null;
};
timedContext.deleteQuery = () => {};
const timed = createHighCloudRenderer({
  renderer: timedRenderer,
  bounds: { inner: 40, outer: 45 },
  planetRadius: 39,
});
timed.setResources(resourceData());
timed.render(args);
queries[0].ready = true;
queries[0].ns = 9e6;
timed.render(args);
assert.equal(timed.stats().gpuMs, 9);
assert.equal(timed.stats().gpuSamples, 1);
disjoint = true;
timed.render(args);
assert.equal(timed.stats().gpuSamples, 0);
assert.equal(timed.stats().gpuMs, null);
disjoint = false;
queries[0].ready = true;
queries[0].ns = 999e6;
timed.render(args);
assert.equal(timed.stats().gpuSamples, 0, 'A late result crossing disjoint is discarded');
queries[0].ready = true;
queries[0].ns = 2e6;
timed.render(args);
assert.equal(timed.stats().gpuSamples, 1);
assert.equal(timed.stats().gpuMs, 2);
assert.equal(
  timed.stats().gpuP95Ms,
  2,
  'Disjoint reset restarts the ring cursor as well as its count',
);
timed.resetGpuTimings();
assert.equal(timed.stats().gpuSamples, 0);
assert.equal(timed.stats().gpuMs, null);
assert.equal(timed.stats().gpuP95Ms, null);
assert.equal(queries.length, 4, 'Capture resets reuse the existing GPU queries');
queries[0].ready = true;
queries[0].ns = 999e6;
timed.render(args);
assert.equal(
  timed.stats().gpuSamples,
  0,
  'A pending result from before the capture reset is excluded',
);
queries[0].ready = true;
queries[0].ns = 3e6;
timed.render(args);
assert.equal(timed.stats().gpuSamples, 1);
assert.equal(timed.stats().gpuP95Ms, 3);
timed.dispose();
// Authoring/output parity contracts: inverse clear round-trips without applying
// ACES twice, and final FXAA contains no tone/color transform at all.
const inputMatrix = new THREE.Matrix3().set(
    0.59719,
    0.35458,
    0.04823,
    0.076,
    0.90834,
    0.01566,
    0.0284,
    0.13383,
    0.83777,
  ),
  outputMatrix = new THREE.Matrix3().set(
    1.60475,
    -0.53108,
    -0.07367,
    -0.10208,
    1.10813,
    -0.00605,
    -0.00327,
    -0.07276,
    1.07602,
  );
function forwardACES(color, exposure) {
  const value = new THREE.Vector3(color.r, color.g, color.b)
    .multiplyScalar(exposure / 0.6)
    .applyMatrix3(inputMatrix);
  for (const key of ['x', 'y', 'z']) {
    const x = value[key];
    value[key] = (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081);
  }
  return value.applyMatrix3(outputMatrix);
}
for (const exposure of [0.5, 1, 1.25, 2])
  for (const color of [
    new THREE.Color(0x142e30),
    new THREE.Color(0, 0, 0),
    new THREE.Color(0.1, 0.1, 0.1),
    new THREE.Color(0.3, 0.3, 0.3),
  ]) {
    const inverse = inverseACESClearColor(color, exposure),
      roundtrip = forwardACES(inverse, exposure);
    assert.ok(
      Math.abs(roundtrip.x - color.r) < 1e-9 &&
        Math.abs(roundtrip.y - color.g) < 1e-9 &&
        Math.abs(roundtrip.z - color.b) < 1e-9,
      'Inverse ACES preserves the authored clear after exactly one output map',
    );
  }
const darkClear = inverseACESClearColor(new THREE.Color(0x142e30), 1.25);
assert.ok(Math.abs(darkClear.r - 0.01586437) < 1e-7);
assert.ok(Math.abs(darkClear.g - 0.03709314) < 1e-7);
assert.ok(Math.abs(darkClear.b - 0.03900714) < 1e-7);
assert.throws(() => inverseACESClearColor(new THREE.Color(), 0), /positive ACES exposure/);
assert.ok(
  !/tonemapping|colorspace|sRGBTransfer|mapOutput/.test(CLOUD_OUTPUT_FRAGMENT),
  'FXAA must not reapply tone mapping or output conversion',
);
assert.match(CLOUD_COMPOSITE_FRAGMENT, /sphere.x<nearDistance/);
assert.match(CLOUD_COMPOSITE_FRAGMENT, /length\(local\)<=uHaze.z/);
assert.match(
  CLOUD_COMPOSITE_FRAGMENT,
  /artisticHazeAlpha\(origin,ray,fullDistance\)\*transmittance/,
);
assert.match(CLOUD_COMPOSITE_FRAGMENT, /-viewPoint.z\/viewPoint.w/);
assert.match(CLOUD_COMPOSITE_FRAGMENT, /factor\*flags.r\*transmittance/);
for (const name of ['standard', 'basic', 'points', 'dashed'])
  assert.match(
    addCloudSceneFlags(THREE.ShaderLib[name].fragmentShader),
    /layout\(location=1\) out highp vec4 cloudSceneFlags/,
  );
const basicFragment = 'void main(){gl_FragColor=vec4(1.);}',
  opaque = addCloudSceneFlags(basicFragment, { fog: true, toneMapped: true }),
  sun = addCloudSceneFlags(basicFragment, { fog: false, toneMapped: false }),
  literal = addCloudSceneFlags(basicFragment, {
    fog: false,
    toneMapped: false,
    literalOutput: true,
  });
assert.match(opaque, /cloudSceneFlags=vec4\(1\.,0\.,0\.,gl_FragColor.a\)/);
assert.match(sun, /cloudSceneFlags=vec4\(0\.,1\.,0\.,gl_FragColor.a\)/);
assert.match(literal, /cloudSceneFlags=vec4\(0\.,0\.,1\.,gl_FragColor.a\)/);
const captureRenderer = mockRenderer(),
  captureScene = new THREE.Scene();
captureScene.fog = new THREE.FogExp2(0x142e30, 0.0015);
const originalFog = captureScene.fog;
const captureMaterial = new THREE.MeshStandardMaterial({ fog: true }),
  sunMaterial = new THREE.MeshBasicMaterial({ fog: false, toneMapped: false }),
  literalMaterial = new THREE.ShaderMaterial({ fragmentShader: basicFragment }),
  hazeMaterial = new THREE.ShaderMaterial({ fragmentShader: basicFragment });
let customCompileCalls = 0;
const originalCompile = function (shader) {
    customCompileCalls++;
    shader.fragmentShader += '\n// original callback';
  },
  originalKey = () => 'existing-custom-key';
captureMaterial.onBeforeCompile = originalCompile;
captureMaterial.customProgramCacheKey = originalKey;
const capturedMesh = new THREE.Mesh(new THREE.SphereGeometry(), captureMaterial),
  hazeMesh = new THREE.Mesh(capturedMesh.geometry, hazeMaterial);
captureScene.add(
  capturedMesh,
  new THREE.Mesh(capturedMesh.geometry, sunMaterial),
  new THREE.Mesh(capturedMesh.geometry, literalMaterial),
  hazeMesh,
);
const capture = createHighCloudRenderer({
  renderer: captureRenderer,
  bounds: { inner: 40, outer: 45 },
  planetRadius: 39,
});
capture.setResources(resourceData());
const underlyingRender = captureRenderer.render;
captureRenderer.render = function (scene, camera) {
  if (scene === captureScene) {
    assert.equal(scene.fog, null);
    assert.equal(hazeMesh.visible, false);
  }
  return underlyingRender(scene, camera);
};
const captureArgs = {
  ...args,
  scene: captureScene,
  artisticHaze: {
    mesh: hazeMesh,
    innerRadius: 39,
    outerRadius: 49,
    fade: 0.8,
    maxOpacity: 0.32,
    tint: [0.58, 0.72, 0.76],
  },
};
assert.equal(capture.render(captureArgs), true);
assert.equal(captureScene.fog, originalFog);
assert.equal(hazeMesh.visible, true);
const hook = captureMaterial.onBeforeCompile,
  key = captureMaterial.customProgramCacheKey();
assert.match(key, /existing-custom-key\|cloud-metadata/);
const shader = { fragmentShader: basicFragment };
captureMaterial.onBeforeCompile(shader, captureRenderer);
assert.equal(customCompileCalls, 1);
assert.match(shader.fragmentShader, /original callback/);
assert.match(shader.fragmentShader, /cloudSceneFlags=vec4\(1\.,0\.,0\.,gl_FragColor.a\)/);
const sunShader = { fragmentShader: basicFragment },
  literalShader = { fragmentShader: basicFragment };
sunMaterial.onBeforeCompile(sunShader, captureRenderer);
literalMaterial.onBeforeCompile(literalShader, captureRenderer);
assert.match(sunShader.fragmentShader, /vec4\(0\.,1\.,0\.,gl_FragColor.a\)/);
assert.match(literalShader.fragmentShader, /vec4\(0\.,0\.,1\.,gl_FragColor.a\)/);
capture.setDiagnosticEmptyClouds(true);
assert.equal(capture.render(captureArgs), true);
assert.equal(capture.stats().diagnosticEmptyClouds, true);
assert.equal(capture.stats().drawCalls, 3);
assert.equal(
  captureMaterial.onBeforeCompile,
  hook,
  'Steady High rendering never reinstalls material hooks',
);
assert.equal(captureMaterial.customProgramCacheKey(), key);
assert.equal(capture.stats().sceneMetadataBytes, 1280 * 800 * 4);
capture.dispose();
assert.equal(captureMaterial.onBeforeCompile, originalCompile);
assert.equal(captureMaterial.customProgramCacheKey, originalKey);
// A framebuffer or shader failure must restore the original callbacks before the
// caller's immediate Low fallback, as well as restoring fog and haze visibility.
for (const failShader of [false, true]) {
  const failingRenderer = mockRenderer({ framebuffer: failShader }),
    failingHigh = createHighCloudRenderer({
      renderer: failingRenderer,
      bounds: { inner: 40, outer: 45 },
      planetRadius: 39,
    });
  failingHigh.setResources(resourceData());
  if (failShader) {
    failingRenderer.debug = { checkShaderErrors: false, onShaderError: undefined };
    const context = failingRenderer.getContext();
    context.getProgramInfoLog = () => 'intentional compile failure';
    failingRenderer.render = () => failingRenderer.debug.onShaderError(context, {}, {}, {});
  }
  assert.equal(failingHigh.render(captureArgs), false);
  assert.equal(failingHigh.stats().supported, false);
  assert.equal(captureMaterial.onBeforeCompile, originalCompile);
  assert.equal(captureMaterial.customProgramCacheKey, originalKey);
  assert.equal(captureScene.fog, originalFog);
  assert.equal(hazeMesh.visible, true);
  failingHigh.dispose();
}
console.log(
  'PASS High shell intervals, shared 48-sample budget, depth clipping contracts, target cap, deferred resources, culling, renderer-state restoration, resize/disposal, AA/output contracts and capability fallback. GPU/image validation is separate.',
);
