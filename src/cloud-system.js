import * as THREE from 'three';
import { createCloudField } from './cloud-layout.js';
import { createLowCloudRenderer } from './cloud-low.js';
import { createHighCloudRenderer } from './cloud-high.js';
import {
  readCloudPreferences,
  writeCloudPreferences,
  validateCloudPreferences,
  resolveCloudView,
} from './cloud-preferences.js';
export const CLOUD_CONFIG = Object.freeze({
  wavelength: 4.5,
  erosion: 0.25,
  extinction: 0.8,
  phaseG: 0.4,
});
export function createCloudSystem({
  scene,
  renderer,
  terrainRadius,
  planetRadius = terrainRadius,
  seed,
  storage,
  workerFactory,
  artisticHaze,
  highFactory = createHighCloudRenderer,
} = {}) {
  if (storage === undefined) {
    try {
      storage = globalThis.localStorage;
    } catch {}
  }
  let preferences = readCloudPreferences(storage),
    time = 0,
    view = 'ant',
    visible = true,
    effective = 'low',
    disposed = false,
    worker = null,
    requestId = 1,
    resourceState = 'idle',
    resourceError = null,
    resources = null,
    high = null,
    highFailed = false,
    diagnosticEmptyClouds = false;
  const field = createCloudField({ seed, terrainRadius }),
    low = createLowCloudRenderer({ scene, field, renderer }),
    windMatrix = new THREE.Matrix4(),
    windInverse = new THREE.Matrix4(),
    windEuler = new THREE.Euler(),
    sunDirection = new THREE.Vector3(-0.4, 0.8, 0.5).normalize(),
    planetCenter = new THREE.Vector3();
  let renderCalls = 0,
    directCalls = 0,
    highCalls = 0;
  function startResources() {
    if (resourceState !== 'idle' || disposed) return;
    try {
      worker = workerFactory
        ? workerFactory()
        : typeof Worker !== 'undefined'
          ? new Worker(new URL('./cloud-volume-worker.js', import.meta.url), { type: 'module' })
          : null;
      if (!worker) {
        resourceState = 'unavailable';
        resourceError = 'Module workers unavailable';
        return;
      }
      resourceState = 'loading';
      const id = requestId;
      worker.onmessage = ({ data }) => {
        if (disposed || data.requestId !== id || id !== requestId) return;
        if (data.type === 'ready') {
          resources = data;
          resourceState = 'ready';
        } else {
          resourceState = 'failed';
          resourceError = data.error ?? 'Cloud resource generation failed';
        }
        worker?.terminate();
        worker = null;
      };
      worker.onerror = (e) => {
        if (disposed) return;
        resourceState = 'failed';
        resourceError = e.message ?? 'Cloud worker failed';
        worker?.terminate();
        worker = null;
      };
      worker.postMessage({
        type: 'bake',
        requestId: id,
        puffs: field.puffs,
        bounds: field.bounds,
        seed,
      });
    } catch (e) {
      resourceState = 'failed';
      resourceError = String(e.message ?? e);
      worker?.terminate();
      worker = null;
    }
  }
  function setPreferences(next) {
    preferences = validateCloudPreferences({ ...preferences, ...next, version: 1 });
    writeCloudPreferences(preferences, storage);
    visible = view !== null && preferences[view];
    if (!visible) low.group.visible = false;
    return { ...preferences };
  }
  function update(dt, options = {}) {
    if (disposed) return;
    time += Math.max(0, Number.isFinite(dt) ? dt : 0);
    view = resolveCloudView(options);
    visible = view !== null && preferences[view];
    windEuler.set(Math.sin(time * 0.002) * 0.018, time * 0.0025, Math.cos(time * 0.0015) * 0.012);
    windMatrix.makeRotationFromEuler(windEuler);
    windInverse.copy(windMatrix).invert();
    if (options.sunDirection) sunDirection.copy(options.sunDirection).normalize();
    if (!visible) {
      low.group.visible = false;
      effective = 'low';
    }
    if (visible && preferences.quality === 'high') startResources();
  }
  function ensureHigh() {
    if (highFailed || !renderer || resourceState !== 'ready') return false;
    try {
      if (!high) {
        high = highFactory({ renderer, bounds: field.bounds, planetRadius, config: CLOUD_CONFIG });
        high.setResources(resources);
        high.setDiagnosticEmptyClouds?.(diagnosticEmptyClouds);
      }
      const state = high.stats();
      if (state.supported === false || state.available === false) {
        resourceError =
          state.reason ?? state.failure ?? state.failureReason ?? 'High cloud formats unavailable';
        return false;
      }
      return true;
    } catch (e) {
      resourceError = String(e.message ?? e);
      highFailed = true;
      high?.dispose();
      high = null;
      return false;
    }
  }
  function prepare(camera) {
    if (disposed) return;
    low.update({ camera, windMatrix, sunDirection, visible });
  }
  function render(targetScene = scene, camera) {
    if (disposed) return;
    renderCalls++;
    effective = 'low';
    if (visible && preferences.quality === 'high' && ensureHigh()) {
      low.group.visible = false;
      try {
        if (
          high.render({
            scene: targetScene,
            camera,
            windInverse,
            sunDirection,
            planetCenter,
            artisticHaze,
          })
        ) {
          effective = 'high';
          highCalls++;
          return;
        }
      } catch (e) {
        resourceError = String(e.message ?? e);
        highFailed = true;
        high.dispose();
        high = null;
      }
    }
    prepare(camera);
    renderer?.render(targetScene, camera);
    directCalls++;
  }
  function setDiagnosticEmptyClouds(value) {
    diagnosticEmptyClouds = !!value;
    high?.setDiagnosticEmptyClouds?.(diagnosticEmptyClouds);
  }
  function resize() {
    high?.resize();
  }
  function stats() {
    const l = low.stats(),
      h = high?.stats();
    return {
      diagnosticEmptyClouds,
      requestedQuality: preferences.quality,
      effectiveQuality: effective,
      resolvedView: view,
      visible,
      preferences: { ...preferences },
      resourceReadiness: resourceState,
      resourceError: resourceError ?? h?.failure ?? null,
      targetDimensions: h?.dimensions ?? null,
      high: h ?? null,
      low: l,
      time,
      cloudRotation: windEuler.y,
      cloudPuffs: field.puffs.length,
      cloudBanks: field.layout.banks.length,
      weatherRegions: (field.layout.weatherRegions ?? []).map((r) => ({
        ...r,
        center: [...r.center],
      })),
      clearDirection: field.layout.clearDirection ? [...field.layout.clearDirection] : null,
      clearAngularRadius: field.layout.clearAngularRadius ?? null,
      cloudDistribution: { ...field.layout.distribution },
      cloudBankDefinitions: field.layout.banks.map((b) => ({ ...b, center: [...b.center] })),
      cloudDensityRange: [
        Math.min(...field.puffs.map((p) => p.density)),
        Math.max(...field.puffs.map((p) => p.density)),
      ],
      cloudScaleRange: [
        Math.min(...field.puffs.flatMap((p) => p.radii)),
        Math.max(...field.puffs.flatMap((p) => p.radii)),
      ],
      cloudRadius: field.cloudRadius,
      minCloudClearance: field.minCloudClearance,
      maxCloudRadius: field.bounds.outer,
      cloudBounds: { ...field.bounds },
      cloudDrawCalls: visible
        ? effective === 'high'
          ? (h?.drawCalls ?? 3)
          : (l.actualDrawCalls ?? 0)
        : 0,
      cloudOpacity: 0.8,
      volumeMethod:
        effective === 'high' ? 'single shell volumetric raymarch' : 'instanced shaded ellipsoids',
      renderCalls,
      directCalls,
      highCalls,
    };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    requestId++;
    worker?.terminate();
    worker = null;
    resources = null;
    low.dispose();
    high?.dispose();
    high = null;
  }
  return {
    resetGpuTimings() {
      low.resetGpuTimings?.();
      high?.resetGpuTimings?.();
    },
    testPuff: () => field.puffs[0],
    setPreferences,
    getPreferences: () => ({ ...preferences }),
    update,
    prepare,
    render,
    resize,
    stats,
    setDiagnosticEmptyClouds,
    dispose,
  };
}
