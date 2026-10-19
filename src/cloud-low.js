import * as THREE from 'three';

// All ellipsoids share one geometry/material and one single-pass instanced draw.
// Ordinary views cull back faces; only a camera inside a puff needs both sides.
// Sorting reuses fixed storage; wind only changes the group transform.
export function createLowCloudRenderer({ scene, field, renderer }) {
  const puffs = field.puffs,
    count = puffs.length;
  if (count > 180) throw new RangeError('The Low cloud budget is at most 180 puffs');
  const group = new THREE.Group();
  group.name = 'planet-clouds-low';
  group.matrixAutoUpdate = false;
  const geometry = new THREE.SphereGeometry(1, 10, 7);
  const densityAttribute = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(
    THREE.DynamicDrawUsage,
  );
  const insideAttribute = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(
    THREE.DynamicDrawUsage,
  );
  geometry.setAttribute('instanceDensity', densityAttribute);
  geometry.setAttribute('instanceInside', insideAttribute);
  const baseAttribute = new THREE.InstancedBufferAttribute(new Float32Array(count), 1).setUsage(
    THREE.DynamicDrawUsage,
  );
  geometry.setAttribute('instanceBase', baseAttribute);
  const uniforms = {
    uSunDirection: { value: new THREE.Vector3(-0.4, 0.8, 0.5).normalize() },
    uPlanetCenter: { value: new THREE.Vector3() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
    forceSinglePass: true,
    blending: THREE.NormalBlending,
    vertexShader: `
   attribute float instanceDensity;
   attribute float instanceInside;
   attribute float instanceBase;
   varying float vDensity;
   varying float vInside;
   varying vec3 vWorld;
   varying vec3 vNormal;
   varying vec3 vShade;
   uniform vec3 uSunDirection;
   uniform vec3 uPlanetCenter;
   void main(){
    mat3 m=mat3(instanceMatrix);
    // Cofactors implement the inverse transpose for non-uniform puff radii.
    vec3 n=normalize(cross(m[1],m[2])*normal.x+cross(m[2],m[0])*normal.y+cross(m[0],m[1])*normal.z);
    vec4 local=instanceMatrix*vec4(position,1.0);
    float radius=length(local.xyz);
    // Project the lower vertices to the bank's shared spherical cloud base.
    // This makes a closed, inexpensive cap instead of discarding the underside.
    if(instanceBase>0.&&radius<instanceBase){
     local.xyz*=instanceBase/max(radius,.0001);n=-normalize(local.xyz);
    }
    vec4 world=modelMatrix*local;
    vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*n);
    // Broad ambient and Lambert terms vary smoothly over each ellipsoid.
    // Interpolate them from vertices instead of normalizing radial/sun vectors
    // for every overlapping fragment at full drawing-buffer resolution.
    float radial=smoothstep(-0.55,0.8,dot(vNormal,normalize(vWorld-uPlanetCenter)));
    vShade=mix(vec3(0.34,0.46,0.50),vec3(0.72,0.78,0.75),radial);
    vShade+=vec3(0.27,0.26,0.21)*max(0.0,dot(vNormal,uSunDirection));
    vDensity=instanceDensity;vInside=instanceInside;
    gl_Position=projectionMatrix*viewMatrix*world;
   }`,
    fragmentShader: `
   uniform vec3 uSunDirection;
   varying float vDensity;
   varying float vInside;
   varying vec3 vWorld;
   varying vec3 vNormal;
   varying vec3 vShade;
   void main(){
    // Outside: front surface only. Inside: back surface only. Never alpha-blend
    // both sides of a puff, including when the camera crosses its surface.
    // With no inside puffs this shader variant has no discard at all, allowing
    // hardware back-face culling and early opaque-depth rejection.
    #ifdef DOUBLE_SIDED
     if(vInside>0.5?gl_FrontFacing:!gl_FrontFacing)discard;
    #endif
    vec3 n=normalize(vNormal),view=normalize(cameraPosition-vWorld);
    float facing=abs(dot(n,view));
    float forward=max(0.0,dot(-view,uSunDirection));forward*=forward;forward*=forward;
    float rim=1.0-facing;
    vec3 shade=vShade+vec3(0.12,0.13,0.12)*forward*rim*rim;
    float edge=smoothstep(0.0,0.24,facing);
    gl_FragColor=vec4(shade,0.8*vDensity*edge);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = 'planet-cloud-puffs';
  mesh.renderOrder = 2;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(mesh);
  scene.add(group);
  const matrices = new Float32Array(count * 16),
    centers = new Float64Array(count * 3),
    inverseAxes = new Float64Array(count * 9);
  const order = new Uint16Array(count),
    uploadedOrder = new Uint16Array(count),
    depths = new Float64Array(count),
    inside = new Uint8Array(count);
  const localToView = new THREE.Matrix4(),
    lastLocalToView = new THREE.Matrix4(),
    worldToLocal = new THREE.Matrix4(),
    cameraLocal = new THREE.Vector3();
  const metrics = {
    sortPasses: 0,
    sortComparisons: 0,
    instanceUploads: 1,
    attributeUploads: 3,
    uploadedBytes: count * 19 * 4,
    insideTests: 0,
    materialVariantChanges: 0,
  };
  // Four queries bound the number of in-flight measurements. Results are polled
  // only after QUERY_RESULT_AVAILABLE, so GPU timing never stalls the CPU.
  const queries = [null, null, null, null],
    queryPending = new Uint8Array(4),
    queryInvalid = new Uint8Array(4);
  const gpuHistory = new Float64Array(120),
    gpuScratch = new Float64Array(120);
  let gl = null,
    timerExtension = null,
    timerInitialized = false,
    gpuTimerAvailable = false,
    activeQuery = -1;
  let gpuSampleCount = 0,
    gpuHistoryCount = 0,
    gpuHistoryCursor = 0,
    gpuTimeMs = null,
    gpuDisjointEvents = 0;
  let visible = true,
    disposed = false,
    hasView = false,
    actualDrawCalls = 0,
    totalDrawCalls = 0,
    insidePuffs = 0;
  function initializeTimer(activeRenderer) {
    if (timerInitialized || !activeRenderer || typeof activeRenderer.getContext !== 'function')
      return;
    timerInitialized = true;
    gl = activeRenderer.getContext();
    if (!gl || typeof gl.beginQuery !== 'function') return;
    timerExtension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!timerExtension) return;
    for (let i = 0; i < queries.length; i++) {
      queries[i] = gl.createQuery();
      if (!queries[i]) {
        for (let j = 0; j < i; j++) gl.deleteQuery(queries[j]);
        queries.fill(null);
        return;
      }
    }
    gpuTimerAvailable = true;
  }
  function beginGpuMeasurement(activeRenderer) {
    if (disposed || !visible || !group.visible) return;
    actualDrawCalls++;
    totalDrawCalls++;
    initializeTimer(activeRenderer);
    if (!gpuTimerAvailable || gl.isContextLost()) return;
    const disjoint = gl.getParameter(timerExtension.GPU_DISJOINT_EXT);
    if (disjoint) {
      gpuDisjointEvents++;
      gpuHistoryCount = 0;
      gpuHistoryCursor = 0;
      gpuTimeMs = null;
      for (let i = 0; i < queries.length; i++) if (queryPending[i]) queryInvalid[i] = 1;
    }
    for (let i = 0; i < queries.length; i++)
      if (queryPending[i] && gl.getQueryParameter(queries[i], gl.QUERY_RESULT_AVAILABLE)) {
        queryPending[i] = 0;
        if (!disjoint && !queryInvalid[i]) {
          const nanoseconds = gl.getQueryParameter(queries[i], gl.QUERY_RESULT);
          if (Number.isFinite(nanoseconds) && nanoseconds >= 0) {
            gpuTimeMs = nanoseconds / 1e6;
            gpuHistory[gpuHistoryCursor] = gpuTimeMs;
            gpuHistoryCursor = (gpuHistoryCursor + 1) % gpuHistory.length;
            gpuHistoryCount = Math.min(gpuHistoryCount + 1, gpuHistory.length);
            gpuSampleCount++;
          }
        }
        queryInvalid[i] = 0;
      }
    // Timer queries cannot nest. A whole-frame measurement owned by the caller
    // takes precedence; skip this draw's timer without disrupting that query.
    if (disjoint || gl.getQuery(timerExtension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return;
    for (let i = 0; i < queries.length; i++)
      if (!queryPending[i]) {
        activeQuery = i;
        gl.beginQuery(timerExtension.TIME_ELAPSED_EXT, queries[i]);
        break;
      }
  }
  function endGpuMeasurement() {
    if (activeQuery < 0) return;
    gl.endQuery(timerExtension.TIME_ELAPSED_EXT);
    queryPending[activeQuery] = 1;
    activeQuery = -1;
  }
  mesh.onBeforeRender = beginGpuMeasurement;
  mesh.onAfterRender = endGpuMeasurement;
  initializeTimer(renderer);
  for (let i = 0; i < count; i++) {
    const puff = puffs[i],
      offset = i * 16,
      centerOffset = i * 3,
      axesOffset = i * 9;
    centers.set(puff.center, centerOffset);
    order[i] = uploadedOrder[i] = i;
    densityAttribute.array[i] = puff.density;
    baseAttribute.array[i] = puff.baseRadius ?? 0;
    for (let axis = 0; axis < 3; axis++)
      for (let k = 0; k < 3; k++) {
        matrices[offset + axis * 4 + k] = puff.basis[axis][k] * puff.radii[axis];
        inverseAxes[axesOffset + axis * 3 + k] = puff.basis[axis][k] / puff.radii[axis];
      }
    matrices[offset + 12] = puff.center[0];
    matrices[offset + 13] = puff.center[1];
    matrices[offset + 14] = puff.center[2];
    matrices[offset + 15] = 1;
  }
  mesh.instanceMatrix.array.set(matrices);
  // A planet-centered sphere is conservative for every puff under any wind
  // rotation. No per-frame bounding-volume recomputation is needed.
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), field.bounds.outer);
  mesh.instanceMatrix.needsUpdate = true;
  densityAttribute.needsUpdate = true;
  insideAttribute.needsUpdate = true;
  baseAttribute.needsUpdate = true;

  function update({ camera, windMatrix, sunDirection, visible: enabled = true }) {
    actualDrawCalls = 0;
    visible = !!enabled && !disposed;
    group.visible = visible;
    // Hidden views must do no sorting, inside tests, or buffer uploads.
    if (!visible) return;
    if (windMatrix) group.matrix.copy(windMatrix);
    else group.matrix.identity();
    group.matrixWorldNeedsUpdate = true;
    group.updateWorldMatrix(true, false);
    if (sunDirection) {
      const sun = uniforms.uSunDirection.value;
      if (sunDirection.x !== undefined) sun.copy(sunDirection);
      else sun.set(sunDirection[0], sunDirection[1], sunDirection[2]);
      if (sun.lengthSq() > 0) sun.normalize();
      else sun.set(0, 1, 0);
    }
    uniforms.uPlanetCenter.value.setFromMatrixPosition(group.matrixWorld);
    camera.updateWorldMatrix(true, false);
    localToView.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld);
    const elements = localToView.elements,
      previous = lastLocalToView.elements;
    let relativeChanged = !hasView;
    for (let i = 0; i < 16 && !relativeChanged; i++)
      if (elements[i] !== previous[i]) relativeChanged = true;
    if (!relativeChanged) return;
    lastLocalToView.copy(localToView);
    hasView = true;
    worldToLocal.copy(group.matrixWorld).invert();
    cameraLocal.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(worldToLocal);
    let flagsChanged = false,
      insideCount = 0;
    for (let i = 0; i < count; i++) {
      const c = i * 3,
        a = i * 9,
        x = cameraLocal.x - centers[c],
        y = cameraLocal.y - centers[c + 1],
        z = cameraLocal.z - centers[c + 2];
      const px = x * inverseAxes[a] + y * inverseAxes[a + 1] + z * inverseAxes[a + 2];
      const py = x * inverseAxes[a + 3] + y * inverseAxes[a + 4] + z * inverseAxes[a + 5];
      const pz = x * inverseAxes[a + 6] + y * inverseAxes[a + 7] + z * inverseAxes[a + 8];
      const flag =
        px * px + py * py + pz * pz < 1 &&
        (puffs[i].baseRadius === undefined || cameraLocal.lengthSq() >= puffs[i].baseRadius ** 2)
          ? 1
          : 0;
      insideCount += flag;
      if (inside[i] !== flag) {
        inside[i] = flag;
        flagsChanged = true;
      }
      // Camera-space Z, not radial camera distance. More negative is farther.
      depths[i] =
        elements[2] * centers[c] +
        elements[6] * centers[c + 1] +
        elements[10] * centers[c + 2] +
        elements[14];
    }
    insidePuffs = insideCount;
    const side = insideCount ? THREE.DoubleSide : THREE.FrontSide;
    if (material.side !== side) {
      material.side = side;
      material.needsUpdate = true;
      metrics.materialVariantChanges++;
    }
    metrics.insideTests += count;
    metrics.sortPasses++;
    // Stable insertion sort is cheap for a slowly moving 180-puff field, retains
    // storage, and has deterministic original-index tie breaking.
    for (let i = 1; i < count; i++) {
      const id = order[i],
        depth = depths[id];
      let j = i - 1;
      while (j >= 0) {
        const other = order[j],
          difference = depths[other] - depth;
        metrics.sortComparisons++;
        if (difference < -1e-7 || (Math.abs(difference) <= 1e-7 && other < id)) break;
        order[j + 1] = other;
        j--;
      }
      order[j + 1] = id;
    }
    let orderChanged = false;
    for (let i = 0; i < count && !orderChanged; i++)
      if (order[i] !== uploadedOrder[i]) orderChanged = true;
    if (orderChanged) {
      const destination = mesh.instanceMatrix.array;
      for (let i = 0; i < count; i++) {
        const id = order[i],
          source = id * 16,
          target = i * 16;
        for (let k = 0; k < 16; k++) destination[target + k] = matrices[source + k];
        densityAttribute.array[i] = puffs[id].density;
        baseAttribute.array[i] = puffs[id].baseRadius ?? 0;
        uploadedOrder[i] = id;
      }
      mesh.instanceMatrix.needsUpdate = true;
      densityAttribute.needsUpdate = true;
      baseAttribute.needsUpdate = true;
      metrics.instanceUploads++;
      metrics.attributeUploads += 2;
      metrics.uploadedBytes += count * 18 * 4;
    }
    if (orderChanged || flagsChanged) {
      for (let i = 0; i < count; i++) insideAttribute.array[i] = inside[order[i]];
      insideAttribute.needsUpdate = true;
      metrics.attributeUploads++;
      metrics.uploadedBytes += count * 4;
    }
  }
  function resetGpuTimings() {
    gpuSampleCount = 0;
    gpuHistoryCount = 0;
    gpuHistoryCursor = 0;
    gpuTimeMs = null;
    gpuDisjointEvents = 0;
    gpuHistory.fill(0);
    // A reset starts a fresh measurement window. Queries already submitted may
    // finish later, but their pre-reset samples must never enter the new window.
    for (let i = 0; i < queries.length; i++)
      if (queryPending[i] || i === activeQuery) queryInvalid[i] = 1;
  }
  function stats() {
    let gpuP95Ms = null,
      pending = 0;
    for (let i = 0; i < queryPending.length; i++) pending += queryPending[i];
    if (gpuHistoryCount) {
      for (let i = 0; i < gpuHistoryCount; i++) gpuScratch[i] = gpuHistory[i];
      for (let i = 1; i < gpuHistoryCount; i++) {
        const value = gpuScratch[i];
        let j = i - 1;
        while (j >= 0 && gpuScratch[j] > value) {
          gpuScratch[j + 1] = gpuScratch[j];
          j--;
        }
        gpuScratch[j + 1] = value;
      }
      gpuP95Ms = gpuScratch[Math.ceil(gpuHistoryCount * 0.95) - 1];
    }
    const active = visible && group.visible && !disposed,
      configuredDrawCalls = active && count ? 1 : 0,
      draws = active ? actualDrawCalls : 0;
    return {
      visible: active,
      puffs: count,
      insidePuffs,
      faceMode: material.side === THREE.DoubleSide ? 'inside-single-pass' : 'front-face-culled',
      drawCalls: draws,
      actualDrawCalls: draws,
      configuredDrawCalls,
      totalDrawCalls,
      triangles: ((draws * geometry.index.count) / 3) * count,
      trianglesPerPuff: geometry.index.count / 3,
      geometryTriangles: (geometry.index.count / 3) * count,
      gpuTimerAvailable,
      gpuTimeMs,
      gpuP95Ms,
      gpuSamples: gpuSampleCount,
      gpuPendingQueries: pending,
      gpuDisjointEvents,
      ...metrics,
    };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    visible = false;
    group.visible = false;
    group.removeFromParent();
    geometry.dispose();
    material.dispose();
    mesh.dispose();
    endGpuMeasurement();
    for (let i = 0; i < queries.length; i++)
      if (queries[i]) {
        gl.deleteQuery(queries[i]);
        queries[i] = null;
        queryPending[i] = 0;
      }
  }
  return { group, mesh, update, stats, resetGpuTimings, dispose };
}
