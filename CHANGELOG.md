# Changelog

## 0.2.0 — 2026-10-18

- Default weather model with three/four spherical fronts and variable moisture-weighted bank populations.
- Hierarchical Low clouds with asymmetric secondary lobes, shared bank bases, capped vertices, and sorted base attributes.
- Continuous High 3D occupancy driven by coverage, local heights, and development instead of one radial ellipsoid union.
- Independent 32³ detail erosion with distance fade, retaining the 48/2 sample and cloud pixel limits.
- Versioned weather worker resources, nine transferred buffers, validation, dynamic byte diagnostics, and explicit mixed-version fallback.
- Construction options model/config, pure weather exports, and legacy comparison path.
- Demo model comparison and inspection poses; new weather/morphology/worker regressions.
- Current math, archived legacy derivations, enhancement notes, and a dedicated ant-world migration handoff.

No ant-world runtime files are changed by this library release. Its old numerical seeds and performance measurements describe legacy mode.

## 0.1.0 — 2026-10-18

Initial standalone extraction from ant-world.

- Regional deterministic cloud field shared by Low and High.
- Instanced Low renderer and bounded single-shell High raymarch.
- Worker-generated envelope and periodic density textures.
- Independent Ant / World / System visibility preferences.
- Explicit `view` API, standalone preference key, pinned Three.js peer dependency.
- Procedural demonstration planet, measurement controls, regression suites.
- Math, API, integration, performance, provenance, and attribution documentation.

This release has no remote or registry publication baked into its metadata.
