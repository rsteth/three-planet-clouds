# API reference

ES modules; JavaScript; exact peer dependency **three@0.169.0**. Import from the package root for the coordinator, or from explicit subpaths for individual parts. The worker entry is a worker script, not an ordinary browser module.

## createCloudSystem(options)

```js
import { createCloudSystem } from 'three-planet-clouds';
const clouds = createCloudSystem({
  scene,
  renderer,
  terrainRadius: 43,
  planetRadius: 40,
  seed: 39,
  storage: null,
});
```

| Option        | Contract                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| scene         | Three.Scene to which the Low group is attached. Required for normal rendering.                                                           |
| renderer      | Three.WebGLRenderer. The system renders the complete scene through it.                                                                   |
| terrainRadius | Positive finite maximum surface radius; determines nominal altitude and shell clearance.                                                 |
| planetRadius  | Solid sphere radius for sunlight blocking; defaults to terrainRadius. Use a meaningful positive value no greater than the terrain bound. |
| seed          | Use an explicit unsigned 32-bit integer for reproducible layout and density.                                                             |
| storage       | Storage-like object with getItem/setItem. Undefined tries global localStorage; null disables persistence. Exceptions are caught.         |
| workerFactory | Optional function returning a Worker-compatible object. Default is a relative module worker.                                             |
| artisticHaze  | Optional adapter for the original artistic limb haze; see Integration.                                                                   |
| highFactory   | Dependency injection hook. Receives renderer, bounds, planetRadius, and coordinator config; normally leave this unchanged.               |

### Lifecycle

| Method                  | Behavior                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| update(dt, options)     | Advance wind in seconds, resolve view and visibility, update sun direction, start a lazy bake if visible High is requested. Call before rendering.    |
| render(scene, camera)   | Render exactly one complete frame through High or direct scene rendering with Low. The scene parameter can be undefined to use the constructor scene. |
| resize()                | Notify after renderer size/projection changes. High targets resize lazily on a subsequent render.                                                     |
| setPreferences(partial) | Merge, validate, optionally persist, and return a copy of preferences.                                                                                |
| getPreferences()        | Return a copy.                                                                                                                                        |
| stats()                 | Allocate and return diagnostic data. Prefer occasional polling rather than every animation frame.                                                     |
| resetGpuTimings()       | Discard isolated cloud timing history and invalidate outstanding samples.                                                                             |
| dispose()               | Idempotently remove Low, terminate the worker, dispose High textures/targets/materials, and restore patched scene material hooks.                     |

Advanced diagnostics: `prepare(camera)` updates the Low draw state without rendering; it is not needed before `render`. `setDiagnosticEmptyClouds(true)` preserves the High pipeline with zero cloud density for composition checks. `testPuff()` returns the first canonical puff **by reference** for camera positioning; do not mutate it.

### Update options and view switches

```js
clouds.update(dt, {
  view: 'ant', // 'ant' | 'world' | 'system' | null
  sunDirection: sun, // nonzero Three.Vector3 pointing toward the sun
});
clouds.setPreferences({ quality: 'high', world: false });
```

Explicit view takes precedence. Invalid explicit view strings throw a RangeError; null hides clouds. Passing no view uses the legacy ant-world adapter:

1. nestActive → hidden.
2. systemActive → World only when systemView is 'world'; otherwise System.
3. mode 'ant' → Ant; all other modes → World.

The explicit view API is recommended for new projects.

Defaults: `{ version: 1, quality: 'low', ant: true, world: true, system: false }`. Visibility and quality are separate. Selecting High does not enable a hidden view. Changing camera presets does not modify visibility preferences.

The standalone storage key is **three-planet-clouds-v1**. It intentionally does not overwrite ant-world's preference record. Valid saved booleans are preserved. Multiple independently configured systems should supply separate storage wrappers or disable persistence.

### Diagnostics

Useful top-level fields include requestedQuality, effectiveQuality, resolvedView, visible, resourceReadiness, resourceError, cloudDrawCalls, targetDimensions, cloudPuffs, cloudBounds, low, and high.

Resource states are idle, loading, ready, unavailable, or failed. Ready describes CPU resource availability, not necessarily successful High rendering. A requested High mode can report effective Low during loading, unsupported rendering, or off-frustum/direct-render fallback.

The High draw count excludes normal scene draws. Timing fields explicitly distinguish isolated cloud passes and whole-frame work. A missing GPU timer is reported as unavailable/null, not zero. Allocation counts are live renderer counters, not bytes.

## Low-level modules

| Import path                     | Exports and purpose                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| three-planet-clouds/layout      | createCloudField, generateCloudLayout; pure seeded geometry/layout                                                                                       |
| three-planet-clouds/low         | createLowCloudRenderer                                                                                                                                   |
| three-planet-clouds/high        | createHighCloudRenderer, HIGH_CLOUD_CONFIG, cloudTargetSize, intersectCloudShellRay, shader strings, shader-patch helpers                                |
| three-planet-clouds/volume-data | bakeEnvelope, createEnvelopeSampler, compileCloudPuffs, cubeDirection, createPeriodicNoiseSampler, bakeDensityNoise, fixedBlueNoise, size/seed constants |
| three-planet-clouds/preferences | preference constants, validation, read/write, resolveCloudView                                                                                           |
| three-planet-clouds/measurement | createCloudMeasurement                                                                                                                                   |
| three-planet-clouds/worker      | Module worker entry; includes bakeCloudResources and resourceTransferList for worker/test use                                                            |

`createCloudField({ seed, terrainRadius })` returns puffs, bounds, layout, cloudRadius, minCloudClearance. A puff contains center[3], basis[3][3], radii[3], density, bankId. Treat the field as immutable.

`createLowCloudRenderer({ scene, field, renderer })` returns group, mesh, update, stats, resetGpuTimings, dispose. Its update takes camera, windMatrix, sunDirection, visible. It attaches its group to scene but does not render the scene itself.

`createHighCloudRenderer({ renderer, bounds, planetRadius, config })` returns setResources, render, resize, stats, resetGpuTimings, setDiagnosticEmptyClouds, dispose. Its render takes scene, camera, windInverse, sunDirection, planetCenter, and optional artisticHaze; it returns true only when it produced the frame. A caller using it directly must supply a fallback.

### High configuration

Coordinator CLOUD_CONFIG fixes wavelength 4.5, erosion 0.25, extinction 0.8, phaseG 0.4. It does not currently expose an arbitrary config parameter. For tuning, use the direct High factory or an injected factory that merges configuration.

| Parameter              | Direct High default | Clamped range |
| ---------------------- | ------------------- | ------------- |
| wavelength             | 3.6                 | 0.1–100       |
| erosion                | 0.25                | 0–0.9         |
| extinction             | 0.8                 | 0.01–8        |
| phaseG                 | 0.4                 | −0.85–0.85    |
| ambient                | 0.62                | 0–5           |
| sunlight               | 2.7                 | 0–20          |
| shadowDistance         | 12                  | 0.1–100       |
| depthTolerance         | 0.24                | 0.001–10      |
| depthRelativeTolerance | 0.006               | 0–0.1         |

ambientColor defaults to [0.76,0.84,0.88]; sunColor to [1,0.98,0.91]. Colors are linear RGB arrays and are not validated by the numeric clamping helper. No quality option changes the fixed 48/2 samples or 262,144-pixel budget.

### Worker protocol

Request:

```js
{ type: 'bake', requestId, puffs, bounds: { inner, outer }, seed }
```

Success:

```js
{
  type: 'ready', requestId,
  envelope: { size: 128, faces: [/* six Uint8Arrays */] },
  noise: { size: 64, data: /* Uint8Array */ },
  blueNoise: { size: 32, data: /* Uint8Array */ },
  bounds: { inner, outer },
  timings: { envelopeMs, noiseMs, totalMs }
}
```

Error: `{ type: 'error', requestId, error: string }`.

The eight pixel buffers are transferred, not copied in the response. Request puffs are structured-cloned. The coordinator rejects stale responses and terminates the worker on completion/error. Existing work is not canceled merely because the view becomes hidden. Dispose terminates it. There is no automatic retry; recreate the system to retry a failed bake/context after fixing the cause.

Do not import the worker entry in a window: it installs a message handler. Pure CPU functions are available from volume-data. Keep expensive baking out of the UI thread.

## Measurement helper

```js
const measurement = createCloudMeasurement(renderer, () => clouds.resetGpuTimings());
measurement.start(); // optional user-triggered capture

// Each animation frame:
measurement.begin();
// update the application's simulation and camera here
measurement.beginGpu();
clouds.render(scene, camera);
measurement.endGpu();
measurement.end(() => clouds.stats());

// Poll occasionally:
const { active, phase, report } = measurement.stats();
const allocations = measurement.snapshot(() => clouds.stats());
// On teardown:
measurement.dispose();
```

There are two phases of 240 recorded frames plus query draining. The first samples isolated cloud work; the second wraps the entire render in a GPU query. Nested timer queries are avoided. CPU submission and animation-frame interval measurements have separate labels. See [Performance](PERFORMANCE.md) before interpreting their differences.
