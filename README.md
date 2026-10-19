# Three Planet Clouds

![Weather-driven High clouds in the standalone demonstration](docs/images/high-world.png)

Seeded planetary clouds for Three.js, originally extracted from **ant-world**. Version **0.2.0** adds a shared spherical weather field with two rendering modes:

- **Low:** one instanced draw of branching cloud shapes with shared bases, without density textures.
- **High:** a spherical-shell raymarch through continuous 3D density, with weather coverage, local heights, and independent nearby erosion.

Both use the same weather conditions and wind. Low approximates High's distribution; their detailed silhouettes differ. High falls back to Low during loading or when graphics features are unavailable. Ant, World, and System visibility controls remain independent.

**For the next agent updating ant-world:** start with [Ant-world migration](docs/ANT-WORLD-MIGRATION.md) and [Enhancements](docs/ENHANCEMENTS.md). The guide identifies the coordinated file changes, worker protocol, preserved game adapters, tests, and acceptance cases.

Built by Robin Stethem. This work was informed by [Faraz Shaikh](https://github.com/FarazzShaikh/three-volumetric-clouds), [Leonardo Soares Gonçalves](https://github.com/leoawen/volumetric-clouds), [Shota Matsuda / Takram](https://github.com/takram-design-engineering/three-geospatial/tree/main/packages/clouds), and the cloud-modeling references in [Credits](CREDITS.md).

## Run the demo

Use Node.js 22 or newer:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4173**. No build step, CDN, account, or external texture download is needed.

The demo includes Weather/Legacy model comparison, Low/High quality, three views, per-view visibility switches, cloudy/clear and Ant horizon/cloud-height inspection poses, seeded regeneration, wind pause, diagnostics, and optional measurement capture. Switching model preserves the camera pose; changing an inspection pose reframes it.

```sh
npm test
npm run format:check
npm pack
```

Install the generated tarball into another project together with **three@0.169.0**. The package name does not imply npm registry availability. The exact peer version is deliberate: High patches shader compilation and relies on r169 renderer behavior.

## Minimal integration

```js
import * as THREE from 'three';
import { createCloudSystem } from 'three-planet-clouds';

// scene, camera and renderer belong to the application.
// Keep the planet centered at (0,0,0), in small-world units.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor('#10252e');

const clouds = createCloudSystem({
  scene,
  renderer,
  terrainRadius: 43, // terrain envelope, not mean sea level
  planetRadius: 40, // solid sunlight blocker
  seed: 39,
  model: 'weather', // default; 'legacy' selects the 0.1 comparison
  config: { wavelength: 18, erosion: 0.22, detailDistance: 160 },
  storage: null, // omit to use localStorage
});
clouds.setPreferences({ quality: 'low', ant: true, world: true, system: false });

const sun = new THREE.Vector3(-0.4, 0.8, 0.5).normalize();
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  clouds.update(Math.min(clock.getDelta(), 0.1), { view: 'world', sunDirection: sun });
  clouds.render(scene, camera); // owns the complete scene render
}
frame();

// After renderer size and camera projection changes:
clouds.resize();
// On teardown, after stopping the animation loop:
clouds.dispose();
```

Serve modules over HTTP(S); High baking uses a module worker. [Integration](docs/INTEGRATION.md) covers worker deployment, Three deduplication, materials, color management, and rendering ownership.

## Included budgets

| Part             | Weather model                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Regional field   | 18–24 banks in three/four fronts; at most 180 puffs                                              |
| Low              | 120 triangles per puff; one configured instanced draw                                            |
| Weather map      | Six 128² RGBA8 cubemap faces                                                                     |
| Base and detail  | 64³ R8 base plus independently seeded 32³ R8 detail                                              |
| Sample jitter    | Fixed 32² R8 blue-noise rank mask                                                                |
| High integration | 48 primary steps total across up to two shell intervals; two sunlight samples for occupied steps |
| Cloud resolution | At most half width/height and at most 262,144 cloud pixels                                       |
| High passes      | One scene capture plus raymarch, reconstruction/composition, and display-space FXAA              |
| Defaults         | Weather model; Low quality; Ant/World visible; System hidden                                     |

The generator uses artistic weather fields rather than fluid simulation. There is no terrain cloud-shadow map, temporal reconstruction, automatic performance-based quality switching, or WebGPU backend.

## Documentation

- [Enhancements](docs/ENHANCEMENTS.md): what changed and the limits of the two representations.
- [Ant-world migration](docs/ANT-WORLD-MIGRATION.md): handoff for the later game integration.
- [Technique](docs/TECHNIQUE.md): weather, hierarchical geometry, density equations, sampling, and approximations.
- [Legacy technique](docs/LEGACY-TECHNIQUE.md): archived v0.1 modeling and the shared transport/output derivations.
- [API](docs/API.md) and [Integration](docs/INTEGRATION.md).
- [Performance](docs/PERFORMANCE.md) and [Validation](docs/VALIDATION.md).
- [Provenance](docs/PROVENANCE.md), [Credits](CREDITS.md), and [third-party notices](THIRD_PARTY_NOTICES.md).
- [Contributing](CONTRIBUTING.md) and [Changelog](CHANGELOG.md).

## Performance scope

Low remains the default for broad support. High keeps the existing sample and pixel caps, but its occupancy and texture work changed. Full-resolution capture and composition also scale with the drawing buffer. Device-pixel ratio can matter even after the cloud pixel cap is reached.

Earlier M5/Chrome measurements belong to the legacy model and cannot establish the weather model's cost. See [Performance](docs/PERFORMANCE.md) for budgets and the matched measurement protocol. Thirty fps gives the entire application approximately 33.3 ms per frame.

## License

Original code and documentation use the [MIT License](LICENSE). Retain [third-party notices](THIRD_PARTY_NOTICES.md) and the [licenses directory](licenses/) with the associated shader portions.

The public source repository is [rsteth/three-planet-clouds](https://github.com/rsteth/three-planet-clouds). No npm registry publication is assumed.
