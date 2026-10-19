// Pure spherical weather model. All spatial functions take Cartesian unit
// directions, so there is no longitude seam or special polar case.
export const CLOUD_MODEL_VERSION = 2;
export const CLOUD_WEATHER_SIZE = 128;
export const CLOUD_DETAIL_SIZE = 32;
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export function cloudRandom(seed) {
  let state = seed >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  state = (state ^ (state >>> 16)) >>> 0;
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = (p) => {
  const length = Math.hypot(...p);
  return p.map((x) => x / length);
};
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function tangentFrame(center, yaw = 0) {
  const e = unit(cross(Math.abs(center[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], center));
  const n = cross(center, e);
  const east = e.map((v, i) => v * Math.cos(yaw) + n[i] * Math.sin(yaw));
  return { east, north: cross(center, east) };
}
export function frontDirection(region, along, across) {
  return unit(
    region.center.map(
      (v, i) => v + Math.tan(along) * region.east[i] + Math.tan(across) * region.north[i],
    ),
  );
}
function hash(x, y, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// Quintic-interpolated value noise. Used only while generating/baking weather,
// never as a JavaScript per-frame update or GLSL octave loop.
export function weatherNoise(x, y, z, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const fx = fade(x - ix),
    fy = fade(y - iy),
    fz = fade(z - iz);
  let result = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++)
        result +=
          hash(ix + dx, iy + dy, iz + dz, seed) *
          (dx ? fx : 1 - fx) *
          (dy ? fy : 1 - fy) *
          (dz ? fz : 1 - fz);
  return result;
}
export function createWeatherField({ seed = 0, terrainRadius }) {
  if (!Number.isFinite(terrainRadius) || terrainRadius <= 0)
    throw new RangeError('A positive terrain envelope radius is required');
  const random = cloudRandom(seed ^ 0xc10d5eed),
    regions = [];
  const sphere = () => {
    const y = random() * 2 - 1,
      a = random() * Math.PI * 2,
      r = Math.sqrt(1 - y * y);
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };
  const count = 3 + (random() > 0.55 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    let center = sphere();
    // Exclusion prevents duplicate systems without forcing a uniform set of
    // farthest-point anchors. Front widths and populations remain unequal.
    for (let attempt = 0; attempt < 48; attempt++) {
      if (regions.every((r) => dot(center, r.center) < 0.55)) break;
      center = sphere();
    }
    const frame = tangentFrame(center, random() * Math.PI * 2);
    const development = clamp01(0.15 + random() * 0.8);
    regions.push({
      center,
      ...frame,
      length: 0.45 + random() * 0.3,
      width: 0.13 + random() * 0.13,
      curve: (random() - 0.5) * 1.1,
      moisture: 0.58 + random() * 0.4,
      development,
      baseAltitude: 2.65 + random() * 0.45,
    });
  }
  return {
    version: CLOUD_MODEL_VERSION,
    seed: seed >>> 0,
    terrainRadius,
    bounds: { inner: terrainRadius + 2.25, outer: terrainRadius + 8.8 },
    regions,
  };
}
export function validateWeatherField(weather) {
  if (
    weather?.version !== CLOUD_MODEL_VERSION ||
    !Number.isInteger(weather.seed) ||
    weather.seed < 0 ||
    weather.seed > 4294967295 ||
    !Number.isFinite(weather.terrainRadius) ||
    weather.terrainRadius <= 0 ||
    !Array.isArray(weather.regions) ||
    weather.regions.length < 1 ||
    weather.regions.length > 8
  )
    throw new TypeError('Invalid v2 cloud weather field');
  const bounds = weather.bounds;
  if (
    !Number.isFinite(bounds?.inner) ||
    !Number.isFinite(bounds?.outer) ||
    bounds.inner < 0 ||
    bounds.outer <= bounds.inner
  )
    throw new RangeError('Invalid weather bounds');
  for (const r of weather.regions) {
    for (const key of ['center', 'east', 'north'])
      if (
        !Array.isArray(r[key]) ||
        r[key].length !== 3 ||
        !r[key].every(Number.isFinite) ||
        Math.abs(dot(r[key], r[key]) - 1) > 1e-5
      )
        throw new TypeError('Invalid weather frame');
    if (
      Math.abs(dot(r.center, r.east)) +
        Math.abs(dot(r.center, r.north)) +
        Math.abs(dot(r.east, r.north)) >
      1e-5
    )
      throw new TypeError('Weather frame must be orthonormal');
    if (
      !['length', 'width', 'curve', 'moisture', 'development', 'baseAltitude'].every((k) =>
        Number.isFinite(r[k]),
      ) ||
      r.length <= 0 ||
      r.width <= 0 ||
      r.moisture < 0 ||
      r.moisture > 1 ||
      r.development < 0 ||
      r.development > 1
    )
      throw new RangeError('Invalid weather region');
    if (
      weather.terrainRadius + r.baseAltitude - 0.06 < bounds.inner ||
      weather.terrainRadius + r.baseAltitude + 1.5 > bounds.outer
    )
      throw new RangeError('Weather base and thickness must fit its shell');
  }
  return weather;
}
// Output: coverage, absolute base radius, absolute top radius, development.
// Empty directions still carry finite heights: filtering does not pull cloud
// bottoms down to zero at the coverage boundary. No premultiplication here.
export function createWeatherSampler(weather) {
  validateWeatherField(weather);
  const { seed, terrainRadius, regions } = weather;
  return function sample(direction, out = [0, 0, 0, 0]) {
    const length = Math.hypot(...direction);
    if (!(length > 0)) {
      out[0] = 0;
      out[1] = terrainRadius + 2.8;
      out[2] = terrainRadius + 5;
      out[3] = 0.5;
      return out;
    }
    const x = direction[0] / length,
      y = direction[1] / length,
      z = direction[2] / length;
    const broad = weatherNoise(x * 3.1 + 13, y * 3.1 + 7, z * 3.1 + 19, seed);
    const patch = weatherNoise(x * 9.3 + 3, y * 9.3 + 17, z * 9.3 + 5, seed ^ 0x4f1bbcdc);
    let clear = 1,
      weight = 0,
      development = 0,
      base = 0;
    for (const r of regions) {
      const facing = x * r.center[0] + y * r.center[1] + z * r.center[2];
      if (facing <= 0.15) continue;
      const along = Math.atan2(x * r.east[0] + y * r.east[1] + z * r.east[2], facing);
      const across =
        Math.asin(Math.max(-1, Math.min(1, x * r.north[0] + y * r.north[1] + z * r.north[2]))) -
        r.curve * along * along;
      const ellipse = (along / r.length) ** 2 + (across / r.width) ** 2;
      if (ellipse > 6.5) continue;
      const front =
        clamp01((Math.exp(-0.5 * ellipse) - 0.12) / 0.78) * smoothstep(0.15, 0.35, facing);
      const c = clamp01(
        (front * (0.72 + 0.35 * r.moisture) +
          Math.sqrt(front) * (0.28 * (broad - 0.5) + 0.18 * (patch - 0.5)) -
          0.05) *
          1.45,
      );
      clear *= 1 - c;
      const w = front * front;
      weight += w;
      development += w * r.development;
      base += w * r.baseAltitude;
    }
    const type = weight > 1e-8 ? development / weight : 0.5;
    const altitude = (weight > 1e-8 ? base / weight : 2.8) + 0.12 * (broad - 0.5);
    out[0] = 1 - clear;
    out[1] = terrainRadius + altitude;
    out[2] = Math.min(weather.bounds.outer - 0.15, out[1] + 1.35 + 4.2 * type);
    out[3] = type;
    return out;
  };
}
// CPU reference for the GLSL density construction. shape/detail are normalized
// texture values, not procedural noise evaluated in the render loop.
export function weatherDensity(coverage, h, type, shape, detail = 1, erosion = 0.22) {
  if (coverage < 0.025 || h <= 0 || h >= 1) return 0;
  const profile = smoothstep(0, 0.07, h) * (1 - smoothstep(0.78 - 0.23 * type, 1, h));
  const signal = clamp01((shape - 0.24) / 0.58);
  const threshold = 0.32 + 0.5 * (1 - coverage);
  let body = smoothstep(threshold, threshold + 0.18, signal * profile);
  body = clamp01(body - erosion * (1 - detail) * (1 - body));
  return body * (0.65 + 0.35 * type) * smoothstep(0.025, 0.18, coverage);
}
