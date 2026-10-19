# Integration and compatibility

## Supported baseline

Use **Three.js 0.169.0**, WebGLRenderer, an ordinary perspective or orthographic camera, linear-sRGB working space, and conventional WebGL depth. The reference coordinator renders one planet centered at (0,0,0).

Low needs the instancing and shader functionality already provided by this Three.js/WebGL2 baseline. It does not need half-float render targets or worker textures. This release does not claim WebGL1 support.

High additionally checks renderable half-float color, at least two draw buffers, and complete HDR/depth framebuffers. GPU timer-query support is optional and independent of rendering support. CPU tests cover orthographic ray construction and related contracts; the release browser smoke test uses perspective cameras.

Unsupported formats, material layouts, shader compilation, or output modes cause High to fall back to Low. Inspect resourceError and high.failure to distinguish fallback from a successful High frame. A working Low frame is not evidence that High compiled.

## Render ownership

Call update and then clouds.render for the complete scene. Do not call renderer.render again after it. High performs scene capture plus three full-screen stages; Low delegates to the ordinary renderer.

A non-null current render target makes direct High skip with external-render-target. The coordinator then renders its Low fallback to that target. High is not an EffectComposer Pass or a general render-graph node.

The host still owns the renderer, camera, scene, and non-cloud resources. Stop its animation callback before disposal. Dispose the cloud system before disposing the renderer or removing shared scene materials.

High temporarily changes renderer state and scene fog and patches material compilation hooks. Its normal/error paths restore renderer state; disposal/error restores patched hooks. Use one active High coordinator per renderer/scene. Simultaneous cameras sharing material objects, overlapping render calls, and stacked High coordinators have not been validated.

## Modules, workers, and deployment

The demo resolves Three through an import map. Installed consumers normally use a bundler and the peer dependency. Do not load two different Three copies or versions.

The default worker expression is:

```js
new Worker(new URL('./cloud-volume-worker.js', import.meta.url), { type: 'module' });
```

Preserve this URL relationship, or configure the bundler to emit the worker and its volume-data dependency. If the bundler does not process worker URLs in dependencies, supply workerFactory with a Worker your application constructs from a deployed module entry. It must support postMessage, terminate, onmessage, and onerror and use the protocol in [API](API.md).

Serve modules with a JavaScript MIME type over HTTP(S). file:// is not a supported demo route. Cross-origin isolation/SharedArrayBuffer is not required. CSP must allow the application scripts and the same-origin module worker; there is no runtime CDN fetch.

The package includes all src modules, including the worker and its relative dependency. The demo and tests live in the Git repository; they are intentionally not part of the runtime tarball.

## Cameras, surfaces, and scale

terrainRadius is a terrain bound, not the mean sea level. Clouds can intersect geometry that exceeds that bound. planetRadius is the solid sunlight blocker; the shader does not trace detailed terrain for light occlusion.

The coordinator assumes the origin as the planet center and applies wind there. Do not translate only the planet mesh or wrap it and the clouds in an arbitrary scaled parent. Supporting a translated/scaled world requires coordinated changes to Low transforms, High density lookup, shell bounds, fog, and clipping.

The intended scale has planet radii of a few dozen units. To reuse the design for Earth units or a substantially different scale, scale altitude, puff sizes, wavelength, shadow length, extinction (inverse length), and depth tolerances together. Changing terrainRadius alone does not do that.

Conventional perspective and orthographic rays are implemented. Reverse-depth buffers, logarithmicDepthBuffer, WebXR stereo/multiview, WebGPU, and physical planetary scales are outside this release's validated contract.

## Materials and color

High supports ACESFilmicToneMapping or NoToneMapping with linear-sRGB working space. Other tone operators fall back. ACES exposure must be positive and the compensated clear color must lie in the supported range.

The scene capture writes an auxiliary material-flag attachment. Standard Three materials and conventional ShaderMaterial shaders with a recognizable main function are supported by the patcher. RawShaderMaterial and explicit GLSL3 output layouts are rejected. Custom output declarations, unusual macro-generated main functions, and nonstandard shader pipelines need separate integration work.

High tries to preserve authored fog, tone-mapping opt-outs, and literal shader colors. Mixed transparent/additive layers with different flags are approximated, because one blended metadata sample cannot describe every layer. Transparent objects that do not write depth cannot generally stop the cloud march. Validate water, glass, particles, halos, and additive effects in your actual scene.

The demo uses an opaque canvas. Premultiplied canvas alpha, transparent backgrounds composited over arbitrary HTML, textured scene backgrounds, multiple viewports, and external postprocessing chains are not covered by the browser acceptance run.

## Optional artistic haze adapter

The extracted coordinator accepts the original game's optional descriptor:

```js
{
  (mesh, // authored haze mesh in the scene
    innerRadius,
    outerRadius,
    fade, // current visibility/fade scalar
    tint, // Three.Color
    maxOpacity);
}
```

High temporarily hides that mesh during capture and reconstructs its limb appearance when the camera lies outside the haze sphere. The model uses projected impact radius and cloud transmittance; it is artistic, not atmospheric scattering. The demo does not depend on this adapter.

## Failure and lifecycle behavior

- Requested High remains the saved preference even if effective rendering is Low.
- A worker starts only when needed; a previously started bake can finish while hidden.
- High targets are retained while Low/hidden, reducing switching stalls at the cost of memory.
- Repeated resize replaces old targets; a resize call while hidden defers target allocation.
- dispose is idempotent and invalidates late worker messages.
- Context-loss checks skip High. Recovery and rebaking after a restored context have not been browser-qualified; recreate the system after renderer recovery.
- Resource dimensions and shader constants are a matched contract. Changing the baker's dimensions alone is not a supported public quality setting.

For a lower-risk integration, begin with Low, verify view routing and teardown, then enable High in a minimal scene before adding complex materials.
