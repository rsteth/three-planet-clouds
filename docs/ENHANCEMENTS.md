# Cloud shape and distribution enhancements

Version 0.2.0 adds hierarchical Low shapes and continuous weather-driven High density. The public lifecycle and independent Ant, World, and System visibility controls remain compatible. The default model changes to weather; model: 'legacy' preserves the previous comparison path.

| Area                 | Version 0.1                                  | Version 0.2 weather model                                    |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| Regional layout      | Four fixed populations and 24 banks          | Three/four fronts and 18–24 moisture-weighted banks          |
| Family counts        | Six each of four families                    | Local development chooses families; totals vary by seed      |
| Low morphology       | Broad bodies with repeated lobe arrangements | Root, asymmetric first-order lobes, smaller secondary growth |
| Low bases            | Individual ellipsoid bottoms                 | Shared bank base with closed capped vertices                 |
| High shape           | One min/max radial envelope per direction    | Coverage/height weather map plus actual 3D occupancy         |
| High detail          | One 64³ noise texture                        | 64³ base plus independent 32³ erosion, faded with distance   |
| High baked resources | 656,384 bytes, eight buffers                 | 689,152 bytes, nine buffers                                  |
| Work limits          | 180 puffs, 48/2 samples, capped cloud pixels | Same limits; actual GPU cost still depends on occupancy      |
| Comparison           | One model                                    | Weather and Legacy controls in demo                          |
| Worker safety        | Legacy resource shape                        | Explicit v2 descriptor and mixed-version fallback            |

## How the two approaches fit

The weather descriptor supplies the same coverage, base/top range, and development to the Low generator and High baker. Low represents a limited set of connected shapes within those regions. High uses low-frequency 3D noise to define bodies and preserve internal clear intervals, with a separate erosion signal close to the camera.

This improves the modeling tools without promising identical Low/High silhouettes or physically simulated weather. There is no six-of-each quota, and there is no ellipsoid-envelope union controlling occupancy in weather High.

## Controls and diagnostics

createCloudSystem accepts model and config at construction. stats exposes model, modelVersion, volumeMethod, and the selected High densityModel. Existing quality and view preferences continue to use their previous schema.

The demo adds model comparison and cloudy, clear, horizon, and cloud-height inspection poses. Use Diagnostics to confirm High is genuinely running and to inspect resource bytes, targets, live allocations, and measurement reports.

## Documentation for the next agent

[Ant-world migration](ANT-WORLD-MIGRATION.md) is the handoff entry point. It identifies every runtime file, the worker protocol change, storage/Three integration pitfalls, preserved game adapters, tests, acceptance poses, and a ready-to-use task prompt.

[Technique](TECHNIQUE.md) documents current math and approximations. [Legacy technique](LEGACY-TECHNIQUE.md) retains the earlier derivations for comparison. [Validation](VALIDATION.md) distinguishes automated/browser functionality from device performance evidence.

## Attribution

The modeling references are [SideFX's cloud shape tools](https://www.sidefx.com/docs/houdini/nodes/sop/cloudshapegenerate.html), [Guerrilla's Nubis presentations](https://www.guerrilla-games.com/read/nubis-realtime-volumetric-cloudscapes-in-a-nutshell), and [Takram's weather/shape separation](https://github.com/takram-design-engineering/three-geospatial/tree/main/packages/clouds). New code is authored for this repository; no Houdini dependency, VDB asset, or upstream cloud renderer is bundled. Existing shader notices remain applicable.
