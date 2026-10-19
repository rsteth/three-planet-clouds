# API reference

Version 0.2.0 uses ES modules and the exact peer **three@0.169.0**. The lifecycle and visibility API remain compatible; the default shape model and worker resource protocol change. [Ant-world migration](ANT-WORLD-MIGRATION.md) covers the game port.

## createCloudSystem

```js
import { createCloudSystem } from 'three-planet-clouds';
const clouds = createCloudSystem({
  scene,
  renderer,
  terrainRadius: 43,
  planetRadius: 40,
  seed: 39,
  model: 'weather',
  config: { wavelength: 18, erosion: 0.22, detailDistance: 160 },
  storage: null,
});
```

| Option        | Contract                                                                            |
| ------------- | ----------------------------------------------------------------------------------- |
| scene         | Three.Scene receiving the Low group; required for normal rendering                  |
| renderer      | Three.WebGLRenderer; system owns the complete scene render                          |
| terrainRadius | Positive finite terrain envelope                                                    |
| planetRadius  | Solid sunlight-blocking sphere; defaults to terrainRadius                           |
| seed          | Explicit unsigned 32-bit seed recommended; weather defaults to seed zero            |
| model         | 'weather' default or 'legacy'; other values throw                                   |
| config        | Optional High configuration overrides, merged over the selected model's defaults    |
| storage       | Undefined tries localStorage; null disables; Storage-like getItem/setItem accepted  |
| workerFactory | Optional Worker-compatible factory; default is a relative module worker             |
| artisticHaze  | Existing optional artistic haze adapter                                             |
| highFactory   | Advanced dependency injection hook; receives renderer, bounds, planetRadius, config |

Model and config are construction options. Dispose/recreate to change them. They are not persisted in quality preferences.

## Lifecycle and views

| Method                  | Behavior                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| update(dt, options)     | Advance wind in seconds, resolve visibility, update sun, start lazy resources                |
| render(scene, camera)   | Produce one complete scene frame with High or Low fallback                                   |
| resize()                | Notify after renderer/projection changes; targets update lazily                              |
| setPreferences(partial) | Merge, validate, optionally persist, return copy                                             |
| getPreferences()        | Return preference copy                                                                       |
| stats()                 | Allocate a diagnostic snapshot; poll occasionally                                            |
| resetGpuTimings()       | Reset isolated cloud query windows                                                           |
| dispose()               | Idempotently remove Low, terminate worker, dispose resources/targets, restore material hooks |

Call update before render. Pass a finite nonnegative dt in seconds; invalid/negative dt contributes zero. Passing zero freezes wind.

```js
clouds.update(dt, {
  view: 'ant', // 'ant' | 'world' | 'system' | null to hide
  sunDirection: sun, // nonzero Three.Vector3 pointing toward sun
});
clouds.setPreferences({ quality: 'high', world: false });
```

Explicit view takes precedence; invalid strings throw. Without it, the legacy adapter resolves nestActive to null, systemActive to World when systemView is 'world' and otherwise System, and mode 'ant' to Ant with all other modes resolving to World.

Defaults remain **{version:1, quality:'low', ant:true, world:true, system:false}**. Storage key remains **three-planet-clouds-v1**. Model/protocol version 2 is independent of preference schema version 1. Existing valid booleans are preserved.

Advanced methods: prepare(camera) updates Low without rendering; it is unnecessary before render. setDiagnosticEmptyClouds(true) preserves High's pipeline with zero density. testPuff() returns the first canonical Low puff by reference for camera/debug use; do not mutate it.

## Diagnostics

Top-level stats include model, modelVersion, volumeMethod, requestedQuality, effectiveQuality, resolvedView, visible, resourceReadiness, resourceError, targetDimensions, cloudPuffs, cloudBanks, cloudBounds, low, and high.

High stats include densityModel, detailDistance, resourceBytes, primarySamples, shadowSamples, renderTargets, timing scope, and output compatibility notes. Resource bytes now reflect the actual received arrays rather than a hardcoded dimension formula.

Resource states: idle, loading, ready, unavailable, failed. Ready describes CPU data, not successful High rendering. V2 systems reject v1-format worker responses with an explicit update-worker error and retain Low. A requested High mode may be effective Low while loading, after a capability failure, or when the High pass skips.

The High cloud draw count excludes scene capture draws. Missing GPU timing is null/unavailable. Live allocation counts are not byte measurements.

## High configuration

| Parameter              | Weather/direct High default | Clamped range |
| ---------------------- | --------------------------- | ------------- |
| wavelength             | 18                          | 0.1–100       |
| erosion                | 0.22                        | 0–0.9         |
| detailDistance         | 160                         | 1–10000       |
| extinction             | 0.8                         | 0.01–8        |
| phaseG                 | 0.4                         | −0.85–0.85    |
| ambient                | 0.62                        | 0–5           |
| sunlight               | 2.7                         | 0–20          |
| shadowDistance         | 12                          | 0.1–100       |
| depthTolerance         | 0.24                        | 0.001–10      |
| depthRelativeTolerance | 0.006                       | 0–0.1         |

Legacy coordinator mode overrides wavelength to 4.5 and erosion to 0.25, before user config overrides. A direct High factory uses the table defaults even when supplied legacy resources; supply legacy settings explicitly when comparing.

ambientColor defaults to linear RGB [0.76,0.84,0.88]; sunColor to [1,0.98,0.91]. These arrays are not validated by numeric clamping. Configuration does not change the 48/2 samples or cloud pixel cap.

## Pure weather and layout API

```js
import {
  createWeatherField,
  createWeatherSampler,
  weatherDensity,
} from 'three-planet-clouds/weather';
const weather = createWeatherField({ seed: 39, terrainRadius: 43 });
const sample = createWeatherSampler(weather);
const [coverage, baseRadius, topRadius, development] = sample([0, 1, 0]);
```

The descriptor contains version 2, normalized seed, terrainRadius, bounds, and regions. It is serializable and should be treated as immutable. createWeatherSampler validates it and accepts arbitrary nonzero directions, normalizing before sampling. Supplying an output array avoids per-sample output allocation. It is intended for generation, baking, and diagnostics, not per-frame full-sphere sampling.

weatherDensity(coverage,h,type,shape,detail=1,erosion=0.22) is a CPU reference. h is height fraction; shape/detail are noise values in [0,1]. Use erosion × distanceFade to model faded erosion. It performs no texture lookup.

createCloudField({seed,terrainRadius,model='weather'}) returns model, modelVersion, seed, puffs, layout, bounds, cloudRadius, minCloudClearance, and weather when applicable. Bounds conservatively include Low geometry and the weather shell. A weather puff adds baseRadius to center, basis, radii, density, bankId. layout.instances also records level/parent links.

generateCloudLayout accepts seed, cloudRadius, and model. generateLegacyCloudLayout remains available from the layout subpath. Numerical seeds intentionally produce different layouts across models.

## Low-level exports

| Import path                     | Purpose                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| three-planet-clouds             | Coordinator, field generation, low/high factories, weather helpers, preferences, measurement |
| three-planet-clouds/layout      | Layout/field generators, including explicit legacy generator                                 |
| three-planet-clouds/weather     | Descriptor/sampler, validation, density reference, version/size constants                    |
| three-planet-clouds/low         | createLowCloudRenderer                                                                       |
| three-planet-clouds/high        | createHighCloudRenderer, config, size/intersection helpers, shader strings and patch helpers |
| three-planet-clouds/volume-data | Weather/envelope bakers, noise utilities, cubemap directions, blue noise                     |
| three-planet-clouds/preferences | Validation, read/write, view resolver and constants                                          |
| three-planet-clouds/measurement | createCloudMeasurement                                                                       |
| three-planet-clouds/worker      | Worker entry plus bake/transfer functions for worker and test use                            |

Low factory accepts scene, field, renderer and returns group, mesh, update, stats, resetGpuTimings, dispose. update takes camera, windMatrix, sunDirection, visible.

High factory accepts renderer, bounds, planetRadius, config and returns setResources, render, resize, stats, resetGpuTimings, setDiagnosticEmptyClouds, dispose. render takes scene, camera, windInverse, sunDirection, planetCenter, artisticHaze and returns true only when it produces the frame. Direct users must supply fallback.

setResources rejects invalid dimensions, arrays, bounds, or incomplete v2 data before replacing resources. Accepted resources allocate textures, not render targets or a frame. Legacy data is still supported by direct High.

## Worker protocol

V2 request:

```js
{
  type: 'bake', requestId, version: 2,
  weather, // descriptor from createWeatherField
  bounds: weather.bounds, // must match exactly
  seed
}
```

Coordinator requests also carry puffs for diagnostics/compatibility; the weather baker does not use them. Descriptor version is validated. The response carries explicit model/protocol version:

```js
{
  type: 'ready', requestId, version: 2, model: 'weather',
  weather: { size: 128, faces: [/* six RGBA8 Uint8Arrays */] },
  noise: { size: 64, data: /* R8 Uint8Array */ },
  detail: { size: 32, data: /* R8 Uint8Array */ },
  blueNoise: { size: 32, data: /* R8 Uint8Array */ },
  bounds,
  timings: { weatherMs, noiseMs, detailMs, totalMs }
}
```

Nine pixel buffers are transferred. Error response remains {type:'error',requestId,error}. Stale ids are ignored; completion/error/disposal terminate the worker. Hiding does not cancel an existing bake. Failed resource generation is not automatically retried; recreate after resolving the cause.

Legacy requests omit weather and use puffs/bounds/seed, producing envelope/noise/blueNoise and eight buffers. Its envelope remains premultiplied; v2 weather channels are not.

The worker entry installs its handler only outside a document context. Use volume-data for pure functions and keep expensive baking off the UI thread.

## Measurement

```js
const measurement = createCloudMeasurement(renderer, () => clouds.resetGpuTimings());
measurement.start(); // optional user-triggered capture
// Every animation frame:
measurement.begin();
// simulation/camera update
measurement.beginGpu();
clouds.render(scene, camera);
measurement.endGpu();
measurement.end(() => clouds.stats());
// Poll:
const { active, phase, report } = measurement.stats();
const snapshot = measurement.snapshot(() => clouds.stats());
// Teardown:
measurement.dispose();
```

Two phases collect isolated cloud queries and whole-frame queries separately, avoiding nested timers. CPU submission, animation-frame interval, and GPU execution are distinct metrics. See [Performance](PERFORMANCE.md) for the measurement protocol.
