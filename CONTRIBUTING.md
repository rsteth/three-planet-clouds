# Contributing

Use Node.js 22 or newer. Run `npm ci`, `npm test`, and `npm run format:check`. Start `npm run dev` for the interactive demo. CPU checks cannot validate shader compilation, depth edges, transparent composition, or GPU performance; follow [Validation](docs/VALIDATION.md) for rendering changes.

## Keep the invariants explicit

- Both qualities consume the same seeded weather descriptor; their detailed topology differs. Changes to generation need reproducibility tests and visual comparison. Keep the v0.1 fixture checks explicitly in legacy mode.
- Hidden views must skip cloud sorting, uploads, draw work, and starting a new bake.
- Never synchronously generate the volume textures on the application's UI thread. Keep the v2 worker descriptor/renderer resources in sync; test mixed-version Low fallback.
- Keep the 48-step shared interval budget and cloud pixel cap unless the quality contract and measurements change with them.
- Render in linear light, apply the output transform once, and restore the caller's renderer/material state.
- Preserve module-worker files and relative imports in packages and deployments.
- Avoid allocations in the Low per-frame update. Diagnostic snapshots may allocate.
- Treat the exact Three.js peer version as an integration contract. A version bump needs real-browser validation of material hooks, MRT outputs, shader chunks, and output color.

## Useful contributions

Broader mobile/integrated-GPU measurements of the weather model, closer Low/High coverage matching, reduced full-resolution target memory, transparent-material composition improvements, worker resource caching, and a reproducible blue-noise generator are useful next steps. Keep changes small enough to review and include relevant captures and device conditions. Maintain docs/ANT-WORLD-MIGRATION.md when changing a contract needed by the game port.

Do not widen compatibility claims based solely on CPU tests. Do not infer GPU time from CPU submission duration or displayed fps.

## Licensing and attribution

Contribute code you have the right to share under the project's MIT terms. Preserve third-party notices and identify new source or asset provenance. Technique inspiration belongs in CREDITS.md; copied or adapted material also needs its applicable notice. No contributor agreement or external service is required by this repository.
