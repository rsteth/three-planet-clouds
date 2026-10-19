import { createWeatherSampler, CLOUD_WEATHER_SIZE } from './cloud-weather.js';

// Pure, renderer-independent cloud baking. Full cubemap/voxel loops belong in
// cloud-volume-worker.js; importing this module does not generate any resources.
export const CLOUD_ENVELOPE_SIZE = 128;
export const CLOUD_NOISE_SIZE = 64;
export const CLOUD_BLUE_NOISE_SIZE = 32;
export const CLOUD_NOISE_SEED = 0x91e10da5;
export const CLOUD_CUBE_FACES = Object.freeze(['+X', '-X', '+Y', '-Y', '+Z', '-Z']);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};

// OpenGL samplerCube orientation, matching THREE.CubeTexture with flipY=false.
// u and v increase with the uploaded x and y texel indices, from -1 to +1.
// Use texel centres, 2*(index+.5)/size-1; the same function also accepts exact
// edges/corners for continuity tests. Face order is +X,-X,+Y,-Y,+Z,-Z.
export function cubeDirection(face, u, v, out = [0, 0, 0]) {
  switch (face) {
    case 0:
      out[0] = 1;
      out[1] = -v;
      out[2] = -u;
      break;
    case 1:
      out[0] = -1;
      out[1] = -v;
      out[2] = u;
      break;
    case 2:
      out[0] = u;
      out[1] = 1;
      out[2] = v;
      break;
    case 3:
      out[0] = u;
      out[1] = -1;
      out[2] = -v;
      break;
    case 4:
      out[0] = u;
      out[1] = -v;
      out[2] = 1;
      break;
    case 5:
      out[0] = -u;
      out[1] = -v;
      out[2] = -1;
      break;
    default:
      throw new RangeError('Unknown cubemap face');
  }
  const r = 1 / Math.hypot(out[0], out[1], out[2]);
  out[0] *= r;
  out[1] *= r;
  out[2] *= r;
  return out;
}

function checkedBounds(bounds) {
  if (
    !bounds ||
    !Number.isFinite(bounds.inner) ||
    !Number.isFinite(bounds.outer) ||
    bounds.inner < 0 ||
    bounds.outer <= bounds.inner
  )
    throw new RangeError('Invalid cloud shell bounds');
  return bounds;
}
function checkedSize(size, max = 256) {
  if (!Number.isInteger(size) || size < 1 || size > max)
    throw new RangeError('Invalid cloud resource size');
  return size;
}

// A compact quadratic representation of inverse(M). Orthogonal basis vectors
// are columns of M and radii are their scales. No Three.js dependency is needed.
// Layout per puff: symmetric inverse metric (6), -metric*centre (3), o.o,
// unit centre (3), conservative angular cone cosine, density.
export function compileCloudPuffs(puffs) {
  if (!Array.isArray(puffs) || puffs.length > 180)
    throw new RangeError('Expected at most 180 cloud puffs');
  const data = new Float64Array(puffs.length * 15);
  for (let i = 0; i < puffs.length; i++) {
    const p = puffs[i],
      { center, basis, radii } = p;
    if (
      !center ||
      center.length !== 3 ||
      !basis ||
      basis.length !== 3 ||
      !radii ||
      radii.length !== 3 ||
      !center.every(Number.isFinite) ||
      !radii.every((x) => Number.isFinite(x) && x > 0) ||
      !Number.isFinite(p.density)
    )
      throw new TypeError('Invalid cloud puff');
    for (let a = 0; a < 3; a++) {
      if (!basis[a] || basis[a].length !== 3 || !basis[a].every(Number.isFinite))
        throw new TypeError('Invalid puff basis');
      for (let b = 0; b <= a; b++) {
        const dot =
          basis[a][0] * basis[b][0] + basis[a][1] * basis[b][1] + basis[a][2] * basis[b][2];
        if (Math.abs(dot - (a === b ? 1 : 0)) > 1e-5)
          throw new RangeError('Cloud puff basis must be orthonormal');
      }
    }
    const k = i * 15;
    for (let a = 0; a < 3; a++) {
      const b = basis[a],
        s = 1 / (radii[a] * radii[a]);
      data[k] += b[0] * b[0] * s;
      data[k + 1] += b[1] * b[1] * s;
      data[k + 2] += b[2] * b[2] * s;
      data[k + 3] += b[0] * b[1] * s;
      data[k + 4] += b[0] * b[2] * s;
      data[k + 5] += b[1] * b[2] * s;
    }
    const [x, y, z] = center;
    data[k + 6] = -(data[k] * x + data[k + 3] * y + data[k + 4] * z);
    data[k + 7] = -(data[k + 3] * x + data[k + 1] * y + data[k + 5] * z);
    data[k + 8] = -(data[k + 4] * x + data[k + 5] * y + data[k + 2] * z);
    data[k + 9] = -(data[k + 6] * x + data[k + 7] * y + data[k + 8] * z);
    const length = Math.hypot(x, y, z),
      radius = Math.max(...radii);
    data[k + 10] = length ? x / length : 0;
    data[k + 11] = length ? y / length : 0;
    data[k + 12] = length ? z / length : 0;
    data[k + 13] =
      length > radius ? Math.sqrt(Math.max(0, 1 - (radius * radius) / (length * length))) : -1;
    data[k + 14] = clamp01(p.density);
  }
  return data;
}

// Returns premultiplied linear RGBA in [0,1]. Decode RGB by alpha first, then
// reconstruct radial distances as inner + decodedRG*(outer-inner). Intersected
// intervals are deliberately unioned into one lower/upper directional envelope.
export function createEnvelopeSampler(puffs, bounds) {
  checkedBounds(bounds);
  const data = compileCloudPuffs(puffs),
    inner = bounds.inner,
    outer = bounds.outer,
    span = outer - inner;
  return function sample(direction, out = [0, 0, 0, 0]) {
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    if (!(length > 0)) {
      out.fill(0);
      return out;
    }
    const x = direction[0] / length,
      y = direction[1] / length,
      z = direction[2] / length;
    let lower = Infinity,
      upper = -Infinity,
      coverage = 0,
      density = 0;
    for (let k = 0; k < data.length; k += 15) {
      // A sphere enclosing the ellipsoid yields a conservative angular rejection.
      if (x * data[k + 10] + y * data[k + 11] + z * data[k + 12] < data[k + 13] - 1e-12) continue;
      const a =
        data[k] * x * x +
        data[k + 1] * y * y +
        data[k + 2] * z * z +
        2 * (data[k + 3] * x * y + data[k + 4] * x * z + data[k + 5] * y * z);
      const b = data[k + 6] * x + data[k + 7] * y + data[k + 8] * z;
      const discriminant = b * b - a * (data[k + 9] - 1);
      if (discriminant <= 0) continue;
      const root = Math.sqrt(discriminant),
        lo = Math.max(inner, 0, (-b - root) / a),
        hi = Math.min(outer, (-b + root) / a);
      if (hi <= lo) continue;
      // 1-q == discriminant/a, avoiding cancellation in o.o - b*b/a.
      const angularCoverage = smooth(discriminant / a / 0.15);
      if (angularCoverage <= 0) continue;
      lower = Math.min(lower, lo);
      upper = Math.max(upper, hi);
      coverage = Math.max(coverage, angularCoverage);
      density = Math.max(density, data[k + 14]);
    }
    if (coverage === 0) {
      out[0] = out[1] = out[2] = out[3] = 0;
      return out;
    }
    out[0] = coverage * clamp01((lower - inner) / span);
    out[1] = coverage * clamp01((upper - inner) / span);
    out[2] = coverage * density;
    out[3] = coverage;
    return out;
  };
}

export function bakeEnvelope(puffs, bounds, size = CLOUD_ENVELOPE_SIZE) {
  checkedSize(size);
  const sample = createEnvelopeSampler(puffs, bounds),
    faces = [],
    direction = new Float64Array(3),
    rgba = new Float64Array(4);
  for (let face = 0; face < 6; face++) {
    const bytes = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        cubeDirection(face, (2 * (x + 0.5)) / size - 1, (2 * (y + 0.5)) / size - 1, direction);
        sample(direction, rgba);
        const offset = (y * size + x) * 4;
        for (let c = 0; c < 4; c++) bytes[offset + c] = Math.round(clamp01(rgba[c]) * 255);
      }
    faces.push(bytes);
  }
  return faces;
}

// RGBA8: coverage, normalized base, normalized top, development. Heights remain
// valid in clear directions. This describes weather, not an ellipsoid union.
export function bakeWeatherMap(weather, size = CLOUD_WEATHER_SIZE) {
  checkedSize(size);
  const sample = createWeatherSampler(weather),
    faces = [];
  const direction = new Float64Array(3),
    values = new Float64Array(4);
  const { inner, outer } = weather.bounds,
    span = outer - inner;
  for (let face = 0; face < 6; face++) {
    const bytes = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        cubeDirection(face, (2 * (x + 0.5)) / size - 1, (2 * (y + 0.5)) / size - 1, direction);
        sample(direction, values);
        values[1] = (values[1] - inner) / span;
        values[2] = (values[2] - inner) / span;
        const offset = (y * size + x) * 4;
        for (let k = 0; k < 4; k++) bytes[offset + k] = Math.round(clamp01(values[k]) * 255);
      }
    faces.push(bytes);
  }
  return faces;
}

function hash(x, y, z, seed) {
  let h =
    (seed ^ Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
const GRADIENTS = [
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1,
  0, 1, -1, 0, -1, -1,
];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10),
  mix = (a, b, t) => a + (b - a) * t;
const modulo = (x, n) => ((x % n) + n) % n;
function makeLattice(period, seed, features = false) {
  const values = new Float64Array(period * period * period * 3);
  for (let z = 0; z < period; z++)
    for (let y = 0; y < period; y++)
      for (let x = 0; x < period; x++) {
        const offset = ((z * period + y) * period + x) * 3,
          h = hash(x, y, z, seed),
          g = (h % 12) * 3;
        for (let axis = 0; axis < 3; axis++)
          values[offset + axis] = features
            ? hash(x, y, z, seed ^ Math.imul(axis + 1, 0x9e3779b9)) / 4294967296
            : GRADIENTS[g + axis];
      }
  return { period, values };
}
function perlin(x, y, z, lattice) {
  const { period: p, values: g } = lattice;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z),
    fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  const x0 = modulo(ix, p),
    y0 = modulo(iy, p),
    z0 = modulo(iz, p),
    x1 = (x0 + 1) % p,
    y1 = (y0 + 1) % p,
    z1 = (z0 + 1) % p;
  const gradient = (a, b, c, dx, dy, dz) => {
    const i = ((c * p + b) * p + a) * 3;
    return g[i] * dx + g[i + 1] * dy + g[i + 2] * dz;
  };
  const u = fade(fx),
    v = fade(fy),
    w = fade(fz);
  return mix(
    mix(
      mix(gradient(x0, y0, z0, fx, fy, fz), gradient(x1, y0, z0, fx - 1, fy, fz), u),
      mix(gradient(x0, y1, z0, fx, fy - 1, fz), gradient(x1, y1, z0, fx - 1, fy - 1, fz), u),
      v,
    ),
    mix(
      mix(gradient(x0, y0, z1, fx, fy, fz - 1), gradient(x1, y0, z1, fx - 1, fy, fz - 1), u),
      mix(
        gradient(x0, y1, z1, fx, fy - 1, fz - 1),
        gradient(x1, y1, z1, fx - 1, fy - 1, fz - 1),
        u,
      ),
      v,
    ),
    w,
  );
}
function worley(x, y, z, lattice) {
  const { period: p, values: f } = lattice,
    ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z),
    fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  let nearest = Infinity;
  // Periodic feature coordinates are wrapped, but offsets stay in the unwrapped
  // neighbouring cells. This is essential at x/y/z boundaries and their corners.
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const index = ((modulo(iz + dz, p) * p + modulo(iy + dy, p)) * p + modulo(ix + dx, p)) * 3;
        const a = dx + f[index] - fx,
          b = dy + f[index + 1] - fy,
          c = dz + f[index + 2] - fz;
        nearest = Math.min(nearest, a * a + b * b + c * c);
      }
  // Usually 27 cells are enough. In the rare case no feature is within one
  // cell unit, a feature two cells away can be nearer. Check just those second-
  // ring cells whose AABB can beat the candidate, keeping F1 continuous across
  // lattice boundaries for every seed rather than relying on probability.
  if (nearest > 1)
    for (let dz = -2; dz <= 2; dz++)
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < 2) continue;
          const bx = Math.max(dx - fx, fx - dx - 1, 0),
            by = Math.max(dy - fy, fy - dy - 1, 0),
            bz = Math.max(dz - fz, fz - dz - 1, 0);
          if (bx * bx + by * by + bz * bz >= nearest) continue;
          const index =
            ((modulo(iz + dz, p) * p + modulo(iy + dy, p)) * p + modulo(ix + dx, p)) * 3;
          const a = dx + f[index] - fx,
            b = dy + f[index + 1] - fy,
            c = dz + f[index + 2] - fz;
          nearest = Math.min(nearest, a * a + b * b + c * c);
        }
  return clamp01(Math.sqrt(nearest) / Math.sqrt(3));
}

// Coordinates are normalized texture coordinates: every axis repeats at 1.
// Periodic gradients and feature points make the underlying continuous function
// periodic, rather than merely duplicating the endpoints of a nonperiodic tile.
export function createPeriodicNoiseSampler(seed = CLOUD_NOISE_SEED) {
  seed = seed >>> 0;
  const g4 = makeLattice(4, seed),
    g8 = makeLattice(8, seed ^ 0x75a5b357),
    g16 = makeLattice(16, seed ^ 0x21f0aaad),
    f4 = makeLattice(4, seed ^ 0x68bc21eb, true);
  return function sample(x, y, z) {
    x = modulo(x, 1);
    y = modulo(y, 1);
    z = modulo(z, 1);
    const p = clamp01(
      0.5 +
        0.65 *
          (0.625 * perlin(x * 4, y * 4, z * 4, g4) +
            0.25 * perlin(x * 8, y * 8, z * 8, g8) +
            0.125 * perlin(x * 16, y * 16, z * 16, g16)),
    );
    const w = 1 - worley(x * 4, y * 4, z * 4, f4);
    return clamp01(0.65 * p + 0.35 * w);
  };
}

export function bakeDensityNoise(size = CLOUD_NOISE_SIZE, seed = CLOUD_NOISE_SEED) {
  checkedSize(size, 128);
  const sample = createPeriodicNoiseSampler(seed),
    data = new Uint8Array(size * size * size);
  // Sample texel centres. Repeat+linear filtering then interpolates across the
  // periodic seam correctly; no duplicated endpoint slice or zero border.
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        data[(z * size + y) * size + x] = Math.round(
          sample((x + 0.5) / size, (y + 0.5) / size, (z + 0.5) / size) * 255,
        );
  return data;
}

// Reproducible toroidal void-and-cluster mask, 32x32, Gaussian sigma=1.5,
// seed 0xBA5E. Optimized at 10% occupancy, then ranked through the complement.
// Each byte value occurs four times. Fixed ranks avoid animated-jitter flicker.
const BLUE_NOISE_BYTES = new Uint8Array([
  9, 157, 217, 112, 246, 41, 132, 161, 13, 212, 139, 73, 199, 149, 119, 85, 191, 63, 11, 173, 43,
  193, 5, 161, 233, 132, 101, 155, 237, 115, 178, 144, 243, 65, 133, 13, 184, 92, 200, 67, 241, 115,
  25, 253, 103, 7, 234, 171, 134, 247, 148, 212, 85, 252, 117, 93, 41, 213, 10, 198, 32, 86, 229,
  50, 111, 192, 80, 229, 160, 23, 222, 34, 147, 84, 185, 155, 37, 182, 71, 49, 18, 96, 35, 124, 66,
  24, 178, 204, 69, 171, 124, 253, 73, 170, 134, 26, 215, 163, 38, 102, 58, 122, 175, 108, 191, 49,
  221, 63, 122, 213, 140, 200, 113, 220, 164, 194, 236, 154, 51, 134, 241, 29, 89, 50, 145, 6, 206,
  92, 146, 1, 255, 205, 139, 240, 79, 4, 248, 133, 20, 168, 237, 91, 27, 231, 153, 78, 53, 1, 90,
  109, 225, 7, 102, 152, 227, 183, 216, 107, 179, 61, 226, 112, 70, 173, 15, 47, 150, 209, 67, 96,
  201, 109, 2, 55, 175, 101, 14, 251, 180, 135, 208, 33, 191, 166, 57, 197, 15, 118, 69, 28, 247,
  43, 187, 137, 35, 93, 194, 220, 106, 181, 40, 162, 227, 78, 151, 246, 130, 68, 195, 38, 116, 239,
  64, 145, 79, 120, 249, 77, 138, 41, 236, 153, 127, 86, 21, 202, 235, 159, 119, 62, 20, 232, 125,
  11, 139, 33, 183, 204, 42, 222, 139, 168, 93, 19, 162, 229, 12, 217, 27, 160, 209, 92, 172, 203,
  11, 167, 108, 57, 81, 8, 249, 144, 89, 165, 73, 189, 254, 61, 118, 18, 88, 111, 7, 214, 72, 199,
  43, 127, 99, 177, 48, 105, 230, 2, 55, 103, 74, 239, 151, 225, 131, 176, 45, 208, 31, 243, 109,
  48, 211, 94, 155, 231, 167, 243, 149, 52, 232, 106, 181, 254, 60, 203, 150, 68, 179, 128, 252,
  141, 214, 47, 183, 31, 210, 107, 71, 182, 129, 195, 16, 159, 131, 5, 198, 77, 30, 65, 187, 25,
  125, 154, 4, 82, 141, 16, 245, 120, 21, 201, 38, 189, 23, 121, 76, 97, 14, 158, 230, 3, 97, 59,
  216, 80, 236, 174, 44, 121, 212, 99, 134, 206, 87, 240, 36, 217, 167, 96, 37, 221, 88, 159, 69,
  95, 162, 244, 142, 196, 251, 53, 120, 148, 237, 164, 126, 33, 103, 66, 247, 141, 181, 1, 251, 45,
  173, 66, 193, 121, 52, 210, 187, 136, 54, 242, 114, 227, 8, 56, 112, 41, 170, 88, 218, 35, 74, 19,
  188, 223, 147, 205, 20, 89, 224, 56, 163, 115, 13, 102, 141, 226, 9, 112, 75, 171, 5, 207, 28,
  131, 173, 218, 17, 233, 128, 22, 184, 203, 116, 252, 90, 56, 10, 119, 168, 36, 111, 148, 81, 214,
  237, 180, 27, 85, 242, 158, 26, 232, 104, 147, 184, 44, 83, 190, 101, 204, 72, 143, 57, 96, 172,
  46, 137, 175, 240, 193, 74, 234, 201, 14, 189, 31, 128, 53, 202, 149, 62, 190, 123, 47, 195, 64,
  92, 255, 150, 65, 165, 31, 158, 245, 13, 233, 154, 1, 210, 110, 29, 95, 157, 49, 124, 66, 228, 97,
  156, 77, 250, 109, 39, 218, 91, 248, 138, 15, 213, 119, 0, 238, 53, 221, 113, 87, 192, 127, 65,
  225, 80, 152, 62, 219, 130, 22, 255, 172, 136, 46, 207, 6, 166, 24, 137, 175, 3, 162, 80, 226,
  157, 38, 202, 130, 93, 10, 178, 43, 214, 28, 108, 185, 40, 198, 248, 6, 182, 211, 100, 78, 12,
  239, 178, 120, 220, 85, 234, 69, 211, 37, 116, 55, 180, 104, 76, 186, 146, 249, 70, 132, 165, 82,
  142, 238, 15, 133, 114, 88, 60, 145, 34, 197, 152, 107, 60, 35, 143, 197, 51, 126, 99, 193, 238,
  25, 136, 245, 19, 215, 118, 30, 198, 230, 7, 254, 51, 174, 98, 163, 47, 234, 169, 118, 242, 52,
  222, 188, 82, 246, 102, 18, 156, 253, 12, 142, 164, 87, 208, 63, 165, 46, 79, 160, 103, 59, 117,
  154, 22, 208, 63, 223, 190, 30, 209, 9, 83, 135, 23, 123, 0, 202, 169, 74, 181, 40, 206, 70, 46,
  187, 4, 98, 129, 238, 192, 223, 18, 186, 216, 94, 191, 127, 84, 3, 140, 76, 104, 156, 227, 179,
  68, 163, 219, 129, 45, 225, 114, 89, 131, 231, 105, 247, 151, 220, 179, 11, 54, 136, 86, 146, 42,
  70, 228, 32, 244, 155, 113, 252, 58, 203, 25, 98, 250, 36, 90, 60, 147, 10, 244, 197, 17, 159, 27,
  122, 57, 33, 75, 110, 251, 34, 170, 244, 2, 177, 140, 107, 168, 48, 196, 17, 176, 124, 42, 145,
  192, 110, 230, 184, 211, 83, 37, 150, 67, 222, 174, 82, 194, 235, 144, 205, 126, 72, 199, 99, 123,
  236, 54, 23, 215, 72, 228, 90, 142, 235, 77, 213, 58, 8, 132, 21, 105, 166, 122, 188, 98, 48, 204,
  138, 8, 100, 164, 16, 177, 229, 24, 50, 160, 83, 206, 183, 97, 130, 32, 185, 52, 5, 171, 116, 156,
  239, 174, 75, 253, 50, 224, 3, 241, 117, 22, 255, 61, 219, 44, 91, 59, 111, 137, 218, 186, 16,
  114, 151, 9, 248, 161, 117, 219, 100, 250, 24, 86, 39, 205, 148, 26, 200, 135, 71, 176, 144, 87,
  161, 110, 180, 133, 240, 6, 210, 153, 79, 39, 254, 62, 224, 44, 201, 64, 21, 199, 152, 67, 195,
  224, 126, 95, 55, 113, 158, 91, 34, 212, 58, 228, 39, 200, 73, 28, 196, 169, 68, 20, 231, 125, 95,
  166, 129, 81, 143, 108, 242, 81, 29, 135, 49, 177, 2, 246, 186, 217, 12, 243, 194, 105, 14, 170,
  123, 0, 245, 153, 106, 128, 250, 100, 172, 196, 4, 209, 29, 190, 233, 0, 167, 125, 182, 216, 104,
  157, 78, 143, 30, 71, 169, 51, 121, 149, 249, 84, 215, 140, 94, 223, 40, 84, 189, 32, 54, 146, 75,
  235, 106, 56, 176, 94, 42, 226, 59, 17, 241, 36, 207, 115, 232, 101, 138, 221, 76, 26, 188, 61,
  45, 185, 19, 64, 207,
]);
export function fixedBlueNoise() {
  return BLUE_NOISE_BYTES.slice();
}
