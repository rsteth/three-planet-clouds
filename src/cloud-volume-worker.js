import {
  bakeEnvelope,
  bakeDensityNoise,
  fixedBlueNoise,
  CLOUD_ENVELOPE_SIZE,
  CLOUD_NOISE_SIZE,
  CLOUD_BLUE_NOISE_SIZE,
  CLOUD_NOISE_SEED,
} from './cloud-volume-data.js';

// Request: {type:'bake',requestId,puffs,bounds:{inner,outer},seed?}.
// Response: {type:'ready',requestId,envelope:{size,faces},noise:{size,data},
//            blueNoise:{size,data},bounds,timings:{envelopeMs,noiseMs,totalMs}}.
// All pixel arrays are transferred. The owner discards stale requestIds and
// terminates a replaced world's worker. No voxel generation runs on the UI.
export function bakeCloudResources({ puffs, bounds, seed = CLOUD_NOISE_SEED }) {
  const start = performance.now(),
    faces = bakeEnvelope(puffs, bounds),
    envelopeEnd = performance.now();
  const noise = bakeDensityNoise(CLOUD_NOISE_SIZE, seed),
    noiseEnd = performance.now();
  return {
    envelope: { size: CLOUD_ENVELOPE_SIZE, faces },
    noise: { size: CLOUD_NOISE_SIZE, data: noise },
    blueNoise: { size: CLOUD_BLUE_NOISE_SIZE, data: fixedBlueNoise() },
    bounds: { inner: bounds.inner, outer: bounds.outer },
    timings: {
      envelopeMs: envelopeEnd - start,
      noiseMs: noiseEnd - envelopeEnd,
      totalMs: performance.now() - start,
    },
  };
}
export function resourceTransferList(resources) {
  return [
    ...resources.envelope.faces.map((face) => face.buffer),
    resources.noise.data.buffer,
    resources.blueNoise.data.buffer,
  ];
}
if (typeof self !== 'undefined' && typeof self.postMessage === 'function')
  self.onmessage = ({ data }) => {
    if (data?.type !== 'bake') return;
    try {
      const resources = bakeCloudResources(data);
      self.postMessage(
        { type: 'ready', requestId: data.requestId, ...resources },
        resourceTransferList(resources),
      );
    } catch (error) {
      self.postMessage({
        type: 'error',
        requestId: data.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
