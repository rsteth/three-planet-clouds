import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCloudSystem, createCloudMeasurement } from '../src/index.js';

const $ = (id) => document.getElementById(id);
const errors = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor('#10252e');
$('viewport').append(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xb9dce6, 0x243b27, 2.2));
const sunDirection = new THREE.Vector3(-0.4, 0.8, 0.5).normalize();
const sun = new THREE.DirectionalLight(0xffedcf, 3);
sun.position.copy(sunDirection).multiplyScalar(160);
scene.add(sun);

// The demo planet is original procedural geometry; no external image assets.
const geometry = new THREE.IcosahedronGeometry(40, 22);
const positions = geometry.attributes.position;
const colors = new Float32Array(positions.count * 3);
const point = new THREE.Vector3();
const sea = new THREE.Color('#286170'),
  land = new THREE.Color('#829267'),
  peaks = new THREE.Color('#b8b396');
const color = new THREE.Color();
for (let i = 0; i < positions.count; i++) {
  point.fromBufferAttribute(positions, i).normalize();
  const h =
    Math.sin(point.x * 7 + Math.sin(point.y * 5)) * Math.cos(point.z * 6 - point.y * 2) +
    0.45 * Math.sin(point.y * 12 + point.x * 5) * Math.cos(point.z * 10);
  const elevation = Math.max(0, h - 0.12) * 1.7;
  color.copy(h > 0.12 ? land : sea);
  if (h > 0.12) color.lerp(peaks, Math.min(1, elevation / 2));
  colors.set([color.r, color.g, color.b], i * 3);
  point.multiplyScalar(40 + elevation);
  positions.setXYZ(i, point.x, point.y, point.z);
}
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
geometry.computeVertexNormals();
const planet = new THREE.Mesh(
  geometry,
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, flatShading: true }),
);
scene.add(planet);
const camera = new THREE.PerspectiveCamera(43, 1, 0.05, 1200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
let view = 'world',
  seed = 39,
  clouds,
  measurement;
let last = performance.now(),
  frame = 0,
  lastStats = 0;

function setView(next) {
  view = next;
  $('view').value = next;
  camera.up.set(0, 1, 0);
  controls.minDistance = 55;
  controls.maxDistance = 380;
  controls.enableZoom = true;
  if (next === 'ant') {
    const up = new THREE.Vector3()
      .fromArray(
        $('pose').value === 'clear' ? clouds.stats().clearDirection : clouds.testPuff().center,
      )
      .normalize();
    const tangent = new THREE.Vector3(0, 1, 0).cross(up).normalize();
    camera.position
      .copy(up)
      .multiplyScalar(
        $('pose').value === 'height' ? Math.hypot(...clouds.testPuff().center) : 43.2,
      );
    const tilt = $('pose').value === 'horizon' ? 0.05 : 0.55;
    const direction = tangent
      .clone()
      .multiplyScalar(1 - tilt)
      .addScaledVector(up, tilt)
      .normalize();
    controls.target.copy(camera.position).addScaledVector(direction, 0.01);
    camera.up.copy(up);
    controls.minDistance = 0.01;
    controls.maxDistance = 0.01;
    controls.enableZoom = false;
  } else {
    controls.target.set(0, 0, 0);
    camera.position
      .fromArray(
        $('pose').value === 'clear' ? clouds.stats().clearDirection : clouds.testPuff().center,
      )
      .normalize()
      .addScaledVector(sunDirection, $('pose').value === 'clear' ? 0 : 0.3)
      .normalize()
      .multiplyScalar(next === 'system' ? 270 : 145);
  }
  camera.lookAt(controls.target);
  controls.update();
}
function regenerate({ preserveCamera = false } = {}) {
  const saved = clouds?.getPreferences();
  measurement?.dispose();
  clouds?.dispose();
  seed = Number($('seed').value) >>> 0;
  $('seed').value = seed;
  // Disable persistence for reproducible demo reloads; applications can use localStorage.
  clouds = createCloudSystem({
    scene,
    renderer,
    terrainRadius: 43,
    planetRadius: 40,
    seed,
    model: $('model').value,
    storage: null,
  });
  if (saved) clouds.setPreferences(saved);
  measurement = createCloudMeasurement(renderer, () => clouds.resetGpuTimings());
  if (!preserveCamera) setView(view);
}
regenerate();
$('quality').addEventListener('change', () =>
  clouds.setPreferences({ quality: $('quality').value }),
);
$('view').addEventListener('change', () => setView($('view').value));
for (const key of ['ant', 'world', 'system'])
  $(key).addEventListener('change', () => clouds.setPreferences({ [key]: $(key).checked }));
$('regenerate').addEventListener('click', regenerate);
$('model').addEventListener('change', () => regenerate({ preserveCamera: true }));
$('pose').addEventListener('change', () => setView(view));
$('measure').addEventListener('click', () => measurement.start());
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  clouds.resize();
}
window.addEventListener('resize', resize);
resize();

function updateStatus() {
  const s = clouds.stats(),
    m = measurement.stats();
  if ($('diagnostics').parentElement.open)
    $('diagnostics').textContent = JSON.stringify(
      {
        browser: navigator.userAgent,
        seed,
        model: s.model,
        modelVersion: s.modelVersion,
        view,
        pose: $('pose').value,
        camera: { position: camera.position.toArray(), target: controls.target.toArray() },
        frame,
        requestedQuality: s.requestedQuality,
        effectiveQuality: s.effectiveQuality,
        visible: s.visible,
        resources: s.resourceReadiness,
        error: s.resourceError,
        cloudDraws: s.cloudDrawCalls,
        dimensions: s.targetDimensions,
        high: s.high,
        low: s.low,
        allocations: { ...renderer.info.memory, programs: renderer.info.programs.length },
        errors,
        measurement: m,
      },
      null,
      2,
    );
  $('status').textContent = !s.visible
    ? `Clouds hidden in ${view} view.`
    : s.requestedQuality === 'high' && s.effectiveQuality !== 'high'
      ? `Low active · ${s.resourceError || 'preparing High…'}`
      : `${s.effectiveQuality === 'high' ? 'Volumetric' : 'Instanced'} clouds · ${s.cloudPuffs} puffs in ${s.cloudBanks} banks`;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const entries = [
    ['Scene buffer', `${size.x} × ${size.y}`],
    [
      'Cloud buffer',
      s.effectiveQuality === 'high'
        ? `${s.targetDimensions.width} × ${s.targetDimensions.height}`
        : 'Shared scene',
    ],
    ['Cloud draws', s.cloudDrawCalls],
    ['Resource state', s.resourceReadiness],
    ['Cloud model', s.model],
    ['Weather regions', s.weatherRegions.length],
  ];
  $('metrics').replaceChildren(
    ...entries.flatMap(([key, value]) => {
      const dt = document.createElement('dt'),
        dd = document.createElement('dd');
      dt.textContent = key;
      dd.textContent = value;
      return [dt, dd];
    }),
  );
  $('measure').disabled = m.active;
  if (m.active)
    $('measurement').textContent =
      `Measuring ${m.phase}: ${m.samples} frames. Keep this tab visible and the camera still.`;
  else if (m.report) {
    const gpu = m.report.gpuWholeFrameMs;
    $('measurement').textContent =
      `Whole-frame CPU p95 ${m.report.cpuWholeFrameMs.p95.toFixed(2)} ms. ${gpu.p95 === null ? 'GPU timing unavailable.' : `GPU p95 ${gpu.p95.toFixed(2)} ms (${gpu.samples} samples).`} Full report: window.cloudDemo.report().`;
  }
}
function animate(now) {
  measurement.begin();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  controls.update();
  clouds.update($('pause').checked ? 0 : dt, { view, sunDirection });
  measurement.beginGpu();
  clouds.render(scene, camera);
  measurement.endGpu();
  measurement.end(() => clouds.stats());
  frame++;
  if (now - lastStats > 500) {
    updateStatus();
    lastStats = now;
  }
  requestAnimationFrame(animate);
}
// Public, read-only diagnostics used by the browser acceptance check.
window.cloudDemo = {
  stats: () => clouds.stats(),
  report: () => measurement.stats().report,
  errors: () => [...errors],
  frame: () => frame,
};
requestAnimationFrame(animate);
window.addEventListener('pagehide', () => {
  measurement.dispose();
  clouds.dispose();
  controls.dispose();
  geometry.dispose();
  planet.material.dispose();
  renderer.dispose();
});
