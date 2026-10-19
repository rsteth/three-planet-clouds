# Performance and measurement

Version 0.2 preserves the draw/sample/target caps but changes weather coverage and density work. Historical timings below belong to legacy mode. The new weather mode needs matched measurements on the actual target devices.

## Work budget

Low submits one instanced mesh with at most 180 × 120 = **21,600 triangles**. Opaque depth rejection and ordinary back-face culling help, but transparent overdraw can dominate. Sorting is bounded by the small puff count, reuses arrays, and avoids uploads when instance order is unchanged.

High has a maximum of **262,144 cloud pixels × 48 primary steps = 12,582,912 primary sample positions** before projected scissoring and early exits. Each occupied step can evaluate two more densities for sunlight. Empty envelope/profile rejection avoids many noise reads. Texture fetches, color reconstruction, scene complexity, and bandwidth still matter; the sample count alone is not a timing prediction.

The complete High frame contains:

1. One full-resolution scene capture, with HDR color, depth, and material metadata.
2. One reduced-resolution/scissored raymarch.
3. One full-resolution reconstruction/composition.
4. One full-resolution output FXAA pass.

The final two passes and scene capture keep growing with drawing-buffer size even when the cloud pixel cap stops growing. Limit device-pixel ratio before assuming High will be cheap on a high-density phone screen.

## Memory

Baked data, excluding driver overhead and duplicates:

| Texture                       |                     Bytes |
| ----------------------------- | ------------------------: |
| Six 128² RGBA8 envelope faces |                   393,216 |
| 64³ R8 density                |                   262,144 |
| 32² R8 jitter                 |                     1,024 |
| Total                         | 656,384 (about 0.626 MiB) |

The weather model adds an independently seeded **32³ R8 detail texture: 32,768 bytes**. Its baked total is **689,152 bytes, about 0.657 MiB**; the table above describes legacy resources. Weather replaces the envelope cubemap with an equally sized coverage/base/top/development cubemap. Detail fades with distance and is skipped for empty or solid samples. The added fetch and changed occupied paths can increase GPU time even though the primary sample cap is unchanged.

High render-target storage is approximately:

```text
scene:      (8-byte RGBA16F + 4-byte RGBA8 metadata + 4-byte depth) × W × H
cloud MRT:  (8-byte RGBA16F + 8-byte RGBA16F) × w × h
composite:  8-byte RGBA16F × W × H

total ≈ 24 W H + 16 w h bytes
```

At 1920 × 1080 with 682 × 384 clouds, this is approximately **51.46 MiB**, plus the baked data. At 2352 × 1246 it is about **71.1 MiB**. These are attachment-format estimates, not measured GPU allocation: browser backbuffers, antialiasing, padding, driver copies, shaders, the rest of the scene, and CPU arrays are additional. Texture source arrays may remain retained after GPU upload.

Low alone does not allocate these High targets. Selecting Low after warming High retains them until disposal. stats().high.resourceBytes describes the actual received baked texture arrays only, not total GPU memory. renderer.info.memory counts objects, not bytes.

## Version 0.2 demo capture

A frozen seed-39 cloudy World pose was captured once per setting on an **Apple M5, machine model Mac17,3, macOS 26.6.2, Chrome 155 / ANGLE Metal**, at **1920 × 1080**, pixel ratio **1.5**. All three captures used the exact same camera and paused wind. Each whole-frame GPU summary contains 240 samples after the separate isolated-query phase.

| Weather setting | Whole-frame GPU p50 | Whole-frame GPU p95 |
| --------------- | ------------------: | ------------------: |
| Clouds off      |             1.71 ms |             5.93 ms |
| Low             |             1.81 ms |             5.81 ms |
| High            |             7.01 ms |             9.90 ms |

These are demo totals on one device, not incremental cloud costs or ant-world timings. The slightly lower Low p95 than Off illustrates run-to-run variance; it does not imply negative overhead. High minus Off is about 3.97 ms between separate p95 summaries, not a paired per-frame p95 cost. The complete record is in [weather-browser-smoke.json](weather-browser-smoke.json). Repeat matched captures on actual target devices before setting a broad performance claim.

## Historical ant-world measurements for legacy mode

These numbers were recorded in the source project's README at commit **23eb201f9a8a63ab1a8963ca05814597f96321a4**, before this extraction. They are not a new benchmark of the standalone demo.

Conditions recorded there: **MacBook Air, Apple M5, 32 GB; macOS 26.6.2; Chrome 154 / ANGLE Metal; drawing buffer 2352 × 1246; pixel ratio 1.6**. The regional layout used a frozen cloudy World pose.

| Mode                 | Whole-frame GPU p95 |
| -------------------- | ------------------: |
| Clouds off           |             3.49 ms |
| Low                  |             3.64 ms |
| High, including FXAA |             7.66 ms |

Separate-summary differences were **+0.15 ms Low** and **+4.17 ms High**. Subtracting two independently measured p95 summaries is not a paired per-frame p95 cost.

An earlier two-run comparison, before the regional layout update, recorded differences of +0.14–0.26 ms Low and +4.18–4.24 ms High. Isolated cloud-pass p95 values of 2.32–2.54 ms Low and 6.80–6.81 ms High were measured in a separate query phase. Those scopes are not additive to the whole-frame numbers; query boundaries can change scheduling or tile resolves on deferred GPUs.

No mobile or low-end-device performance claim follows from this one machine. The standalone browser checks in [Validation](VALIDATION.md) establish functionality, not a certified 30 fps device range.

## Reproducible measurement protocol

1. Record device model, OS, browser, graphics backend, drawing-buffer dimensions, pixel ratio, seed, view, and camera pose.
2. Keep the tab visible. Pause wind and other scene motion; retain the same sun, camera, geometry, and viewport.
3. Warm the chosen Low face variant or High pipeline for at least 120 frames after loading/shader compilation.
4. Capture clouds off, Low, and High under matched conditions. Repeat runs to see noise and thermal effects.
5. Use whole-frame GPU queries for frame cost, CPU timing for submission/update cost, and animation-frame interval for observed pacing. Report all with their scope.
6. Include sample counts, missing timer support, and disjoint events. Never replace unavailable GPU time with CPU time.
7. Check memory separately after repeated seed regeneration, quality switching, hiding, resize, and disposal.

The included helper runs isolated and whole-frame queries in separate phases so they cannot nest. Results are polled only after availability, using bounded query pools. A disjoint event invalidates affected samples. The demo's measurement button exposes the result in Diagnostics and through window.cloudDemo.report().

## Practical budgets

Thirty fps provides roughly **33.3 ms** for the entire frame, including scene rendering and simulation. Start Low for broad support. High is an explicit quality choice, not a guarantee that the complete application stays in budget.

Clouds hidden in the active view should show zero cloud draws and no new sorting/uploads/bake startup. A resource bake already in progress can finish. CPU diagnostics and previously allocated resources remain.

The most promising further optimization is reducing full-resolution capture/composite bandwidth while preserving depth and output parity. Other options are cached noise shared between worlds, more selective reconstruction, or a renderer-specific integration that avoids capturing an already available scene buffer. Each changes a contract and needs measured image comparisons; simply reducing the 48 samples can turn thin clouds into noise.
