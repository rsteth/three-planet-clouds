# Validation

## Release checks — 2026-10-18

The standalone release was checked with **Node.js 25.9.0** and the pinned **Three.js 0.169.0**. Node 22 is the declared minimum; it was not separately executed in this extraction session.

Eight automated test entry points cover:

- High shell intersections, a shared 48-sample budget, depth clipping, target limits, material/output contracts, renderer-state restoration, fallback, resize, and disposal.
- Low canonical geometry, deterministic layouts, analytic bounds, instance order, inside flags, unchanged-buffer reuse, hidden early exits, and query lifecycle.
- Preference validation, every boolean visibility combination, storage failures, and the legacy view adapter.
- Regional layout distribution, clear-sky regions, correlated density/development, and terrain clearance across 396 seed/radius combinations.
- Envelope intersections against 2,500 independent inverse-transform references, cubemap seams/corners, quantization, and premultiplied filtering.
- Periodic 3D noise, the fixed rank-mask histogram and spectral suppression, and a real Node module-worker bridge exercising messages, transferred data, and errors.
- Coordinator loading/fallback/visibility behavior and stale-worker/disposal handling.
- Two-phase measurement and allocation snapshots, plus standalone exports, explicit view routing, and the isolated preference key.

Many renderer checks use a mocked GL context. They establish state and algorithm contracts, not shader compilation or image quality. The volume worker test executes real generation code. Seed fixtures quantize layout coordinates to avoid false failures from last-bit cross-platform trigonometry differences.

## Standalone browser smoke test

The runtime tarball was also installed into a separate temporary consumer. Its pinned peer resolved to Three r169, root and subpath imports resolved, and its packaged module worker completed a full seed-39 bake with transferred texture buffers. Local documentation links and the packaged license/worker file list were checked. Formatting checks passed.

The demo was exercised in the local Chromium-based in-app browser, reporting **Chrome 155**. Its desktop user-agent string is not used to infer the device model or actual OS version.

Verified at a **1920 × 1080 drawing buffer**:

- Low produced one cloud draw with 155 puffs for seed 39.
- High completed the real browser worker bake, compiled, and rendered through a 682 × 384 cloud target with three cloud postprocess draws.
- Both qualities × Ant/World/System × visible/hidden: **12 UI cases passed**.
- High World and Ant views were visually inspected; the Ant sky demonstrates the dense overhead volume.
- No browser warning/error logs or application error events were reported during these checks.
- Four seed-regeneration cycles (101 → 39 → 101 → 39) retained three geometries, nine textures, six shader programs, and three High render targets after warming.
- Portrait resizing produced a 621 × 1344 scene buffer and 310 × 672 cloud buffer; returning to landscape restored 1920 × 1080 and 682 × 384 with the same live allocation counts.
- The measurement control completed both phases and collected 240 whole-frame GPU samples. This functional check was not a matched performance benchmark.

See [browser-smoke.json](browser-smoke.json) for the recorded case outcomes and additional lifecycle checks. Screenshots in images/ show the actual demo, not generated concept art.

The display and measurement controls are functional examples, not a portable performance certification. Historic game measurements are separated in [Performance](PERFORMANCE.md). Mobile Safari, Android, low-end integrated GPUs, XR, external composers, and unusual transparent shaders remain unqualified.

## Re-run before a release

1. Run npm ci, npm test, and npm run format:check.
2. Run npm pack and confirm the archive contains the worker, volume-data module, exports, root license, and all third-party notices.
3. Install that tarball into a separate temporary consumer, import its root and subpaths, and confirm its worker URL resolves.
4. Open the demo, switch Low/High in all views, and toggle each view off/on. High must report effective High, not silently pass the check through fallback.
5. Change seed, return to the original seed, and compare the frozen layout.
6. Resize landscape → portrait → landscape while High is active. Verify target dimensions follow the drawing buffer and old targets do not accumulate.
7. Repeat regeneration and quality/view changes. Compare warmed live texture/geometry/program counts; initial compilation may legitimately increase program count.
8. Test opaque silhouettes, close clouds, inside-puff cameras, and the planet limb. Check developer-console errors.
9. Capture matched off/Low/High timings on named target devices. Record whether GPU timing is unavailable.
10. Review shader and asset attribution when changing any adapted material.

A clean automated run is necessary but does not replace the visual and device checks.
