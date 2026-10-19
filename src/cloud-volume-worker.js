import {
  bakeEnvelope,
  bakeWeatherMap,
  bakeDensityNoise,
  fixedBlueNoise,
  CLOUD_ENVELOPE_SIZE,
  CLOUD_NOISE_SIZE,
  CLOUD_BLUE_NOISE_SIZE,
  CLOUD_NOISE_SEED,
} from './cloud-volume-data.js';
import {
  CLOUD_MODEL_VERSION,
  CLOUD_WEATHER_SIZE,
  CLOUD_DETAIL_SIZE,
  validateWeatherField,
} from './cloud-weather.js';

// V2 request: {type:'bake',requestId,version:2,weather,bounds,seed?}.
// V2 reply: {type:'ready',requestId,version:2,model:'weather',weather,noise,
//            detail,blueNoise,bounds,timings}. See docs/API.md for dimensions.
// Legacy requests omit weather and retain envelope/noise/blueNoise responses.
// All pixel arrays are transferred. The owner discards stale requestIds and
// terminates a replaced world's worker. No voxel generation runs on the UI.
export function bakeCloudResources({ puffs, bounds, weather, version, seed = CLOUD_NOISE_SEED }) {
  if ((version === 2 && !weather) || (weather && version !== undefined && version !== 2))
    throw new TypeError('Invalid v2 weather request');
  if (weather) {
    validateWeatherField(weather);
    if (bounds?.inner !== weather.bounds.inner || bounds?.outer !== weather.bounds.outer)
      throw new RangeError('Weather request bounds must match its descriptor');
    const start = performance.now(),
      faces = bakeWeatherMap(weather),
      weatherEnd = performance.now();
    const noise = bakeDensityNoise(CLOUD_NOISE_SIZE, seed),
      noiseEnd = performance.now();
    const detail = bakeDensityNoise(CLOUD_DETAIL_SIZE, seed ^ 0x74657272),
      detailEnd = performance.now();
    return {
      version: CLOUD_MODEL_VERSION,
      model: 'weather',
      weather: { size: CLOUD_WEATHER_SIZE, faces },
      noise: { size: CLOUD_NOISE_SIZE, data: noise },
      detail: { size: CLOUD_DETAIL_SIZE, data: detail },
      blueNoise: { size: CLOUD_BLUE_NOISE_SIZE, data: fixedBlueNoise() },
      bounds: { ...bounds },
      timings: {
        weatherMs: weatherEnd - start,
        noiseMs: noiseEnd - weatherEnd,
        detailMs: detailEnd - noiseEnd,
        totalMs: performance.now() - start,
      },
    };
  }
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
    ...(resources.weather ?? resources.envelope).faces.map((face) => face.buffer),
    resources.noise.data.buffer,
    ...(resources.detail ? [resources.detail.data.buffer] : []),
    resources.blueNoise.data.buffer,
  ];
}
if (
  typeof document === 'undefined' &&
  typeof self !== 'undefined' &&
  typeof self.postMessage === 'function'
)
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
