# Math and rendering technique

Version 0.2 implements two representations of one seeded spherical weather field. **Low** renders hierarchical ellipsoids with a shared base for each bank. **High** evaluates a continuous three-dimensional density inside a spherical shell. Both use the same coverage, height, development, and wind, but their detailed topology and opacity differ.

This is an artistic model, not a weather or fluid simulation. Coordinates use ant-world's small planet units. The coordinator expects the planet at the world origin. The previous representation remains available through model: 'legacy'; its derivations and the shared transport/output pipeline are in [Legacy technique](LEGACY-TECHNIQUE.md).

## Spherical weather

[cloud-weather.js](../src/cloud-weather.js) creates a serializable descriptor from a seed and terrainRadius. A seed avalanche precedes the same unsigned 32-bit LCG used by the earlier layout. The weather and Low layout use independent seeded streams, so spending more random numbers on secondary lobes does not move the weather fronts.

There are three or four regional fronts. New centers use bounded rejection to avoid duplicates; they are not chosen as the globally farthest point. Each region has an orthonormal tangent frame, a curved front, moisture, development, and a base altitude. Length, width, moisture, and development vary independently within bounded ranges.

For unit direction n and a region with center c, east e, and north u:

```text
along  = atan2(dot(n,e), dot(n,c))
across = asin(clamp(dot(n,u),−1,1)) − curve × along²
ellipse = (along / length)² + (across / width)²
front = clamp((exp(−0.5 ellipse) − 0.12) / 0.78, 0, 1)
      × smoothstep(0.15,0.35,dot(n,c))
```

Regions behind the direction or outside a bounded front footprint are rejected early. Sampling directions directly in three-dimensional Cartesian coordinates avoids a longitude seam and polar UV singularity.

Two seeded, quintic-interpolated value-noise fields modulate front coverage. Their spatial frequencies are 3.1 and 9.3 over unit-sphere Cartesian coordinates. For broad noise B, patch noise P, and moisture M:

```text
Cregion = clamp(1.45 × [
  front × (0.72 + 0.35 M)
  + sqrt(front) × [0.28(B − 0.5) + 0.18(P − 0.5)] − 0.05
], 0, 1)

C = 1 − product(1 − Cregion)
```

Development and base altitude are weighted by front² across overlapping regions. Empty directions retain finite default heights. The base adds a small broad-noise variation, keeping neighboring bottoms coherent without imposing one global altitude.

```text
base = terrainRadius + weightedBaseAltitude + 0.12(B − 0.5)
top  = min(shellOuter − 0.15, base + 1.35 + 4.2 development)
shellInner = terrainRadius + 2.25
shellOuter = terrainRadius + 8.8
```

Moisture influences coverage; development influences thickness and the Low family selection. The model does not solve temperature, condensation, convection, or prevailing atmospheric circulation.

## Hierarchical Low shapes

[cloud-hierarchy.js](../src/cloud-hierarchy.js) chooses 18–24 banks, allocates at least two to each region, and distributes the remainder according to regional moisture × length. Candidate locations follow the front's curve, favor actual weather coverage, and maintain a small separation from siblings.

The family comes from local development plus bounded variation:

| Development    | Family |
| -------------- | ------ |
| below 0.28     | wisp   |
| 0.28–0.48      | streak |
| 0.48–0.70      | broken |
| 0.70 and above | billow |

There is no six-of-each quota. A seed may have no tall billows, or a region dominated by them.

Each bank has a broad root, asymmetric first-order lobes, and smaller lobes attached to those. First-order children attach to the root; later children choose an earlier first-order parent. Parent offsets depend on the parent's horizontal radii, with upward-biased growth. Radii shrink by hierarchy level, and the centers are capped against the bank's top. This replaces a repeated row of evenly spaced lobes with branching silhouettes.

The generator reserves capacity for all remaining banks before choosing the current bank's puff count. Total instances never exceed 180. Radius guards and the existing analytic ellipsoid bounds preserve terrain clearance and an outer extent below terrainRadius + 9 for the tested scale.

### Shared base geometry

Every puff carries baseRadius. Low adds one instanced float attribute. Its unit-sphere vertex is first transformed into the ellipsoid's local planet coordinates. Lower vertices are projected out to the bank's spherical base:

```text
p = instanceMatrix × vertex
if length(p) < baseRadius:
    p = normalize(p) × baseRadius
    normal = −normalize(p)
```

The cap is locally flat relative to the spherical planet and remains closed. It does not discard the entire underside. The original inverse-transpose normal construction applies to unprojected vertices.

Containment combines the ellipsoid test with length(cameraLocal) ≥ baseRadius, preventing cameras below a clipped base from selecting the inside-puff face mode. Base attributes follow matrices and densities when sorting changes.

The renderer still shares one 120-triangle geometry, one material, and one instanced draw. It retains camera-depth sorting, typed storage, hidden early exits, and independent inside-flag updates. The new base attribute adds four bytes per instance; no volume textures or procedural fragment-noise loop are needed for Low.

Projection and interpolation are approximate on this coarse mesh. Faceting, transparent overlap order, and differences from High remain visible in close views.

## Worker resources

The v2 request includes the weather descriptor and its exact shell bounds. The worker generates:

| Resource       | Format and dimensions                              |   Bytes |
| -------------- | -------------------------------------------------- | ------: |
| Weather        | six 128² RGBA8 cubemap faces                       | 393,216 |
| Base shape     | 64³ R8 periodic Perlin–Worley                      | 262,144 |
| Detail erosion | independently seeded 32³ R8 periodic Perlin–Worley |  32,768 |
| Fixed jitter   | 32² R8 blue-noise rank mask                        |   1,024 |
| Total          | nine transferred buffers                           | 689,152 |

Weather channels are **R coverage, G normalized base, B normalized top, A development**. The heights normalize against weather.bounds. Unlike the legacy envelope, these channels are not premultiplied by coverage. Clear texels still contain meaningful heights, making interpolation at the edge well behaved.

Face order and orientation match the existing OpenGL cubemap convention, documented in the legacy technique and tested at seams/corners. Weather sampling is continuous before quantization; cubemap resolution and eight-bit height storage remain approximations.

The base noise reuses the previous periodic gradient/Worley baker. The detail texture uses seed XOR 0x74657272. It is independent of the shape texture, with a shorter tile wavelength. Both are generated off the UI thread, use linear filtering and repeat wrapping, and contain data with no color-space conversion.

The worker terminates after responding. Low remains usable while High resources are loading. No envelope bake is required by the weather model.

## Continuous High density

[cloud-high.js](../src/cloud-high.js) uses the same 48-step raymarch, two sunlight samples, depth clipping, projected scissor, early opacity stop, and cloud target cap as before. Only the density construction and resources change.

Transform a sample into the stationary weather frame:

```text
local = inverseWind × (worldPosition − planetCenter)
radius = length(local)
weather = cubemap(normalize(local))
```

Reject shell-exterior samples, coverage below 0.025, and samples outside the decoded base/top interval. Let h be height normalized between those local boundaries and d be development.

```text
profile = smoothstep(0,0.07,h) × [1 − smoothstep(0.78 − 0.23 d,1,h)]
shape = clamp((baseNoise(local / wavelength) − 0.24) / 0.58,0,1)
threshold = 0.32 + 0.5(1 − coverage)
body = smoothstep(threshold, threshold + 0.18, shape × profile)
```

The low-frequency three-dimensional signal determines occupancy. It can leave and re-enter a cloud along a radial line. The weather's base/top range is only a possible cloud region; it does not fill every sample between its extrema.

Default wavelength is 18. The periodic noise tile itself contains several feature frequencies, so the visible lobe size is smaller than the full tile. Increasing wavelength enlarges structures; it does not expand the weather front.

### Nearby detail

The detail lookup fades with distance from the camera:

```text
fade = 1 − smoothstep(0.5 detailDistance, detailDistance, distanceToCamera)
detail = detailNoise(local / (0.13 wavelength))
body = clamp(body − erosion × fade × (1 − detail) × (1 − body),0,1)
density = body × (0.65 + 0.35 d) × smoothstep(0.025,0.18,coverage)
```

Default erosion is 0.22 and detailDistance is 160. The shader skips the detail fetch when fade ≤ 0.01, body is effectively empty, or body ≥ 0.999. Solid cores therefore remain stable and faraway clouds use the broad shape only.

The exported weatherDensity function is a CPU reference for this density construction. Its detail and erosion arguments can represent a partially faded detail sample. It does not perform texture sampling or model the entire renderer.

## Transport and output

The previously tested machinery remains shared with legacy:

- Subtract the inner sphere from the outer ray interval and clip against scene depth.
- Divide the total length of up to two intervals into 48 primary steps.
- Use fixed spatial blue noise rather than temporal history.
- Accumulate Beer–Lambert transmittance and single sunlight scattering.
- Estimate sunlight attenuation with two midpoint densities and a solid-planet occluder.
- Reconstruct from reduced resolution with scene/cloud depth rejection.
- Compose linear cloud radiance with transmitted scene color.
- Preserve the existing material flags, fog/haze adapters, ACES/output handling, and display-space FXAA.

See [Legacy technique sections 7–11](LEGACY-TECHNIQUE.md#7-ray-construction-and-shell-clipping) for the complete ray, transport, reconstruction, and output equations. Those equations now call the selected density model.

No new temporal buffers or render targets are introduced. The additional texture costs 32 KiB; increased density evaluations, occupied paths, and overdraw can still increase GPU time. The old game's measured timing does not establish the new model's cost.

## Shared weather versus identical silhouettes

Low approximates continuous weather with a finite set of banks. High derives its topology from 3D noise. They agree on weather regions, development, altitude range, seed, and rigid wind, but they can differ substantially in coverage around regional edges and in individual cloud silhouettes.

This tradeoff keeps Low affordable. Exact geometric matching would require extracting/decimating density surfaces or generating impostors from High, which this version does not do.

Thin cirrus layers, physical turbulence, terrain cloud shadows, multiple-scattering transport, and actual weather evolution are outside this enhancement. The retained small-world scale and ordinary WebGL2/Three r169 integration constraints still apply.
