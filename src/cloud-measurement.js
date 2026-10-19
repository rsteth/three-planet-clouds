// Opt-in two-phase diagnostics: isolated cloud-pass samples, then whole-frame GPU.
// Nested elapsed queries are forbidden, so these phases are deliberately separate.
export function createCloudMeasurement(renderer, resetCloudTimings = () => {}) {
  const frames = new Float64Array(240),
    cpu = new Float64Array(240),
    gpu = new Float64Array(240);
  let count = 0,
    active = false,
    last = 0,
    start = 0,
    report = null,
    phase = 'idle',
    cloudReport = null,
    gpuCount = 0,
    activeQuery = null,
    epoch = 0;
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  let gl, ext;
  try {
    gl = renderer?.getContext?.();
    ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2');
  } catch {}
  const slots = ext
    ? Array.from({ length: 8 }, () => ({ query: gl.createQuery(), pending: false, epoch: 0 }))
    : [];
  const percentile = (values, p) => {
    const sorted = Array.from(values).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor((sorted.length - 1) * p)] : null;
  };
  function poll() {
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    if (disjoint) {
      epoch++;
      gpuCount = 0;
    }
    for (const slot of slots)
      if (slot.pending && gl.getQueryParameter(slot.query, gl.QUERY_RESULT_AVAILABLE)) {
        slot.pending = false;
        const value = gl.getQueryParameter(slot.query, gl.QUERY_RESULT) / 1e6;
        if (!disjoint && slot.epoch === epoch && Number.isFinite(value) && gpuCount < gpu.length)
          gpu[gpuCount++] = value;
      }
  }
  function finish() {
    active = false;
    phase = 'idle';
    const size = {
      x: 0,
      y: 0,
      set(x, y) {
        this.x = x;
        this.y = y;
        return this;
      },
      floor() {
        this.x = Math.floor(this.x);
        this.y = Math.floor(this.y);
        return this;
      },
    };
    renderer?.getDrawingBufferSize?.(size);
    let device = 'Unavailable';
    try {
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      device = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch {}
    report = {
      samples: 240,
      browser: globalThis.navigator?.userAgent ?? 'Unavailable',
      device,
      drawingBuffer: [size.x, size.y],
      pixelRatio: renderer?.getPixelRatio?.() ?? null,
      frameIntervalMs: { p50: percentile(frames, 0.5), p95: percentile(frames, 0.95) },
      cpuWholeFrameMs: { p50: percentile(cpu, 0.5), p95: percentile(cpu, 0.95) },
      gpuWholeFrameMs: {
        available: !!ext,
        samples: gpuCount,
        p50: percentile(gpu.subarray(0, gpuCount), 0.5),
        p95: percentile(gpu.subarray(0, gpuCount), 0.95),
      },
      clouds: cloudReport,
      notice:
        'Two phases: 240 frames with isolated cloud GPU queries, then 240 frames with whole-frame GPU queries. Whole-frame GPU spans scene and all postprocessing; CPU submission and rAF are separate. Compare whole-frame off/Low/High at the same pose. Isolated pass timings are diagnostic and not additive to whole-frame timing: query boundaries may alter scheduling or tile resolves on deferred GPUs. Differences of separate p95 summaries are not paired-frame p95 costs. Unsupported/disjoint GPU samples are not inferred.',
    };
  }
  function begin() {
    start = now();
    if (active && phase === 'whole' && last) frames[count] = start - last;
    last = start;
    if (active) {
      poll();
      if (phase === 'drain' && !slots.some((s) => s.pending)) finish();
    }
  }
  function beginGpu() {
    if (!active || phase !== 'whole' || !ext || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY))
      return;
    activeQuery = slots.find((s) => !s.pending) ?? null;
    if (activeQuery) {
      activeQuery.epoch = epoch;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, activeQuery.query);
    }
  }
  function endGpu() {
    if (activeQuery) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      activeQuery.pending = true;
      activeQuery = null;
    }
  }
  function end(clouds) {
    if (!active) return;
    if (phase === 'cloud') {
      if (++count === 240) {
        cloudReport = typeof clouds === 'function' ? clouds() : clouds;
        phase = 'whole';
        count = 0;
        last = 0;
      }
      return;
    }
    if (phase !== 'whole') return;
    cpu[count] = now() - start;
    if (!frames[count]) return;
    if (++count === 240) {
      phase = 'drain';
      poll();
      if (!slots.some((s) => s.pending)) finish();
    }
  }
  function snapshot(clouds) {
    const size = {
      x: 0,
      y: 0,
      set(x, y) {
        this.x = x;
        this.y = y;
        return this;
      },
      floor() {
        this.x = Math.floor(this.x);
        this.y = Math.floor(this.y);
        return this;
      },
    };
    renderer?.getDrawingBufferSize?.(size);
    const memory = renderer?.info?.memory;
    return {
      kind: 'allocation-snapshot',
      capturedAtMs: now(),
      drawingBuffer: [size.x, size.y],
      pixelRatio: renderer?.getPixelRatio?.() ?? null,
      rendererAllocations: {
        textures: memory?.textures ?? null,
        geometries: memory?.geometries ?? null,
        programs: Array.isArray(renderer?.info?.programs) ? renderer.info.programs.length : null,
      },
      clouds: typeof clouds === 'function' ? clouds() : clouds,
      notice:
        'Live renderer-wide allocation counts, not GPU bytes. Compare warmed captures at the same viewport and view after repeated resize/quality/nest cycles; initial shader/scene warming can increase counts. This snapshot does not render, resize, reset counters, or start a timing capture.',
    };
  }
  function dispose() {
    endGpu();
    for (const slot of slots) gl.deleteQuery(slot.query);
    active = false;
  }
  return {
    begin,
    beginGpu,
    endGpu,
    end,
    dispose,
    snapshot,
    start() {
      endGpu();
      resetCloudTimings();
      epoch++;
      count = 0;
      last = 0;
      report = null;
      cloudReport = null;
      gpuCount = 0;
      active = true;
      phase = 'cloud';
      frames.fill(0);
      cpu.fill(0);
    },
    stats: () => ({ active, phase, samples: phase === 'cloud' ? count : 240 + count, report }),
  };
}
