# Updating ant world to cloud model version 2

Use this guide to port **three-planet-clouds 0.2.0** into ant-world. The upgrade implements the two investigated approaches: hierarchical Low shapes and continuous weather-driven High density. The open-source library is the source of truth for these changes. Ant-world was deliberately left for a separate integration task.

Start with [Enhancements](ENHANCEMENTS.md), [Technique](TECHNIQUE.md), and [API](API.md). The original extraction came from ant-world commit 23eb201f9a8a63ab1a8963ca05814597f96321a4. Inspect the destination's current code before porting; later game changes may overlap the renderer adapters.

## Integration choices

**Package integration:** build an npm tarball from this revision and install it with the exact three@0.169.0 peer. Use one Three.js module instance throughout the application. The package is not assumed to be published to npm. Keep its worker URL and relative dependencies deployable.

**Vendored integration:** replace the matching cloud modules in dist/ as a coordinated unit, add the two new modules, and change bare Three imports to ant-world's existing './vendor/three.js' convention. This fits the existing game deployment more directly, but future fixes must be synchronized explicitly.

Do not mix one Three copy from npm with another vendored copy in the same cloud system. ColorManagement and material compilation behavior rely on the pinned renderer instance and conventions.

## Runtime file mapping

| Open-source file           | Ant-world destination                       | Reason                                                                                |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| src/cloud-weather.js       | dist/cloud-weather.js                       | New shared descriptor, sampler, density reference and version constants               |
| src/cloud-hierarchy.js     | dist/cloud-hierarchy.js                     | New Low branching shape generator                                                     |
| src/cloud-layout.js        | dist/cloud-layout.js                        | Model selection, canonical fields, legacy preservation                                |
| src/cloud-low.js           | dist/cloud-low.js                           | Shared base attribute, capped vertices, matching containment and sorted uploads       |
| src/cloud-volume-data.js   | dist/cloud-volume-data.js                   | New weather cubemap baker; retains noise/legacy utilities                             |
| src/cloud-volume-worker.js | dist/cloud-volume-worker.js                 | V2 weather messages, detail bake, nine-buffer transfers                               |
| src/cloud-high.js          | dist/cloud-high.js                          | Weather density branch, detail texture lifecycle, configuration, validation and stats |
| src/cloud-system.js        | dist/cloud-system.js                        | Model/config API, shared weather request, version mismatch fallback and diagnostics   |
| src/cloud-preferences.js   | dist/cloud-preferences.js, merged carefully | Preserve the game's storage key and any current view routing behavior                 |
| src/cloud-measurement.js   | dist/cloud-measurement.js, compare first    | Measurement API unchanged; retain compatible destination improvements                 |

Only high, low, and system import Three directly. The new weather/hierarchy modules are pure JavaScript. src/index.js is a package entry point and is not needed when using relative vendored imports.

Copy the worker, volume-data, weather, and hierarchy modules together with their consumers. A stale cached worker can otherwise look like an unsupported GPU. The coordinator now rejects v1 responses to a v2 request with a readable error and uses Low.

## Preserve game preferences and renderer adapters

The library uses three-planet-clouds-v1. Ant-world uses little-world-clouds-v1 at the extraction revision. Preserve ant-world's key and existing valid booleans; do not silently reset the visibility settings during a cloud upgrade.

Keep the game's existing Ant/World/System visibility controls, focused-world classification, nest suppression, current sun direction, wind update cadence, artisticHaze descriptor, and teardown. The old adapter fields still work. A port may use explicit view: 'ant' | 'world' | 'system' | null instead, but confirm all game paths before changing the adapter.

The cloud system continues to own the complete render call. Do not add a second scene render after clouds.render. Keep the existing resize/camera projection order and the patched-material/output compatibility checks.

Do not copy the demo's procedural terrain, lights, pixel ratio, camera controls, or inspection camera positions into the game. Those exist for isolated validation.

## Enable and compare the new model

```js
const clouds = createCloudSystem({
  scene,
  renderer,
  terrainRadius, // actual terrain envelope, not sea level
  planetRadius,
  seed,
  model: 'weather',
  artisticHaze, // preserve existing game descriptor if present
  config: {
    wavelength: 18,
    erosion: 0.22,
    detailDistance: 160,
  },
});
```

weather is the default. To compare against the extracted layout and envelope, reconstruct with model: 'legacy'. Model is a construction option, not a saved quality preference. Switching it requires disposing the old system and constructing the new one.

Quality remains low/high. The settings storage version remains 1; model/protocol version 2 describes a different contract.

The same numerical seed intentionally produces different placement and morphology in weather mode. Legacy keeps the old deterministic layout fixture and coordinator wavelength/erosion defaults. High and Low now share weather conditions rather than identical ellipsoid topology.

## Tests to port or adapt

The open-source tests use bare Three imports and src-relative paths. Adapt these paths for dist/, or run tests against the packaged library during integration.

- Keep the existing game cloud integration suites and gameplay tests.
- Bring tests/cloud-weather.mjs to cover weather seams, quantization, varied regional populations, hierarchical parents, base uploads, density gaps, and the real v2 worker.
- Bring the v2 resource validation/switching cases in cloud-high.mjs and the mixed-version fallback case in cloud-system.mjs.
- Preserve the old low/regions deterministic expectations as explicit model: 'legacy' checks. They must not assert fixed 24-bank/six-of-each counts against weather mode.
- Re-test the Low hot-path allocation guard after formatting; it must select a nonempty function.
- For real worker tests, update both protocol inputs and expected transfer-list length. Weather has nine buffers; legacy has eight.

Do not change the expected seed-39 puff count to an arbitrary constant in browser QA. Read it from the model or check the model/budget/status explicitly. Different modes intentionally have different counts.

## Game acceptance

Use the same seed, fixed pose, sun, viewport, and frozen wind for each comparison.

1. Ant: cloudy sky, clear sky, horizon, near the base, and cloud height. Inspect the capped Low underside and High's detail/holes.
2. World: cloudy and clear hemispheres, planet limb, and close inspection. Both qualities should agree on broad weather regions while preserving deliberate silhouette differences.
3. System: clouds hidden by default; all visibility toggles remain independent. Check focused World versus System routing.
4. Nest: no cloud sorting, uploads, new bake startup, or cloud draws. A previously started worker may finish.
5. Quality loading/fallback: Low appears while High bakes; the GPU must actually report High after readiness. Deliberately fail the worker and check the readable fallback.
6. Composition: retain the game regression poses for scene fog, haze, opaque terrain silhouettes, tone-mapping opt-outs, and additive celestial effects.
7. Lifecycle: repeatedly rebuild a world, switch qualities/views, enter/leave nest, and resize landscape/portrait. Compare warmed live allocations and program counts.
8. Measure matched clouds off, Low, and High on a named target device. The old M5 timing applies to the previous model. Do not claim a 30 fps device range from it.

The 180-instance ceiling, one Low draw, 48 primary steps, two sunlight samples, 262,144 cloud-pixel cap, and three High targets are retained. New High baked resources occupy 689,152 bytes, including 32 KiB of added detail. Full-resolution target memory and total scene cost remain important.

## Suggested task prompt

“Integrate three-planet-clouds 0.2.0 weather and hierarchy changes into ant-world using docs/ANT-WORLD-MIGRATION.md from the public repository. Inspect current ant-world changes first. Preserve the game's Three instance, storage key, view routing, fog/haze/output adapters, and renderer ownership. Port the runtime files as a matched set, adapt the new tests, then run the listed game acceptance poses and measure matched performance. Do not assume old exact bank counts or old GPU timings apply to weather mode.”

## Remaining limits to carry forward

Low is an approximation to High and may differ in edge coverage. Its close silhouettes retain faceting and transparency-order artifacts. High retains fixed-step grain, a finite cubemap/noise resolution, approximate two-sample self-shadowing, and the original transparent-material composition limits.

This upgrade does not require WASM, WebGPU, an atmosphere package, or a full fluid simulation.
