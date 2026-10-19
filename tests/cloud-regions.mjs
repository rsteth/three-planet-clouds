import assert from 'node:assert/strict';
import { createCloudField, generateCloudLayout } from '../src/cloud-layout.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const probes = Array.from({ length: 384 }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / 384,
    a = i * Math.PI * (3 - Math.sqrt(5)),
    r = Math.sqrt(1 - y * y);
  return [r * Math.cos(a), y, r * Math.sin(a)];
});
function spatialMetrics(centers) {
  const counts = probes.map(
      (p) => centers.filter((center) => dot(p, center) > Math.cos(0.4)).length,
    ),
    average = mean(counts);
  return {
    fano: mean(counts.map((count) => (count - average) ** 2)) / average,
    maxPatch: Math.max(...counts),
    neighbors: centers.filter((center, i) =>
      centers.some((other, j) => i !== j && dot(center, other) > Math.cos(0.22)),
    ).length,
  };
}
// Calibrate the regression against the old near-uniform construction. A test
// that accepts evenly scattered centers cannot establish regional coherence.
const uniformCenters = Array.from({ length: 24 }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / 24,
    a = i * Math.PI * (3 - Math.sqrt(5)),
    r = Math.sqrt(1 - y * y);
  return [r * Math.cos(a), y, r * Math.sin(a)];
});
const uniform = spatialMetrics(uniformCenters);
assert.ok(uniform.fano < 1 && uniform.maxPatch < 4 && uniform.neighbors === 0);

// Remove each family's mean before comparing development with local weather;
// tall billows versus flat wisps alone must not satisfy depth-coherence tests.
function weatherCorrelation(layout, property) {
  const values = layout.banks.map((bank) => ({
    x: layout.weatherRegions[bank.regionId].depth,
    y:
      bank[property] -
      mean(
        layout.banks.filter((other) => other.type === bank.type).map((other) => other[property]),
      ),
  }));
  const average = mean(values.map((v) => v.x));
  return (
    values.reduce((sum, v) => sum + (v.x - average) * v.y, 0) /
    Math.sqrt(
      values.reduce((sum, v) => sum + (v.x - average) ** 2, 0) *
        values.reduce((sum, v) => sum + v.y * v.y, 0),
    )
  );
}
const seeds = [...Array.from({ length: 128 }, (_, i) => i), 255, 1024, 2147483647, 4294967295];
let minimumFano = Infinity,
  minimumClearPatch = Infinity,
  minimumClearFraction = 1,
  minimumCorrelation = 1,
  maximumPuffs = 0,
  minimumClearance = Infinity;
for (const seed of seeds)
  for (const terrainRadius of [30, 43, 62]) {
    const field = createCloudField({ seed, terrainRadius }),
      layout = field.layout,
      { banks, instances, weatherRegions, groups } = layout;
    assert.deepEqual(
      field,
      createCloudField({ seed, terrainRadius }),
      'Regional generation and canonical conversion are reproducible',
    );
    assert.deepEqual(layout, generateCloudLayout({ seed, cloudRadius: terrainRadius + 5 }));
    assert.equal(banks.length, 24);
    assert.deepEqual(layout.distribution, { wisp: 6, streak: 6, broken: 6, billow: 6 });
    assert.ok(instances.length >= 126 && instances.length <= 180);
    maximumPuffs = Math.max(maximumPuffs, instances.length);
    assert.ok(field.minCloudClearance >= 1.8);
    assert.ok(field.bounds.outer < terrainRadius + 9);
    minimumClearance = Math.min(minimumClearance, field.minCloudClearance);
    const metrics = spatialMetrics(banks.map((bank) => bank.center));
    assert.ok(
      metrics.neighbors >= 20,
      `Seed ${seed}: banks must have nearby siblings, not global bead spacing`,
    );
    assert.ok(
      metrics.fano > 2.5,
      `Seed ${seed}: spherical patch-count variance must exceed near-uniform/random scatter`,
    );
    assert.ok(metrics.maxPatch >= 8, `Seed ${seed}: at least one substantial cloudy patch`);
    minimumFano = Math.min(minimumFano, metrics.fano);

    assert.equal(weatherRegions.length, 4);
    assert.ok(new Set(weatherRegions.map((region) => region.count)).size >= 3);
    for (let i = 0; i < weatherRegions.length; i++) {
      const region = weatherRegions[i],
        members = banks.filter((bank) => bank.regionId === i);
      assert.equal(members.length, region.count);
      assert.equal(banks[region.start], members[0]);
      assert.ok(
        members.every((bank) => angle(bank.center, region.center) < 0.7),
        'Nested groups stay in their weather system',
      );
      for (let j = 0; j < i; j++)
        assert.ok(
          angle(region.center, weatherRegions[j].center) > 1,
          'Weather systems keep a broad separation',
        );
    }
    assert.ok(
      Math.max(
        ...weatherRegions.flatMap((region) =>
          weatherRegions.map((other) => angle(region.center, other.center)),
        ),
      ) > 2,
      'Weather systems spread across the globe rather than collecting on one side',
    );
    assert.ok(
      Math.max(...weatherRegions.map((region) => region.count)) >= 10 &&
        Math.min(...weatherRegions.map((region) => region.count)) <= 2,
      'Unequal large and sparse regional populations',
    );
    assert.deepEqual(
      new Set(groups.map((group) => group.sizeClass)),
      new Set(['large', 'medium', 'small']),
    );
    assert.ok(
      groups.some((group) => group.count >= 5) &&
        groups.some((group) => group.count >= 2 && group.count <= 3) &&
        groups.some((group) => group.count === 1),
    );
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i],
        members = banks.filter((bank) => bank.groupId === i);
      assert.equal(members.length, group.count);
      assert.equal(banks[group.start], members[0]);
      assert.ok(
        members.every(
          (bank) => bank.regionId === group.regionId && bank.sizeClass === group.sizeClass,
        ),
      );
      assert.ok(
        members.every((bank) => angle(bank.center, group.center) < 0.3),
        'Group labels must describe actual compact geometry',
      );
    }

    const development = banks.map((bank) => bank.depthScale),
      heightCorrelation = weatherCorrelation(layout, 'height'),
      densityCorrelation = weatherCorrelation(layout, 'density');
    assert.ok(
      Math.max(...development) - Math.min(...development) > 0.6,
      'Deep and shallow banks vary within the same field',
    );
    assert.ok(
      heightCorrelation > 0.7,
      'Same-family vertical depth follows coherent regional weather',
    );
    assert.ok(
      densityCorrelation > 0.7,
      'Same-family optical density follows coherent regional weather',
    );
    minimumCorrelation = Math.min(minimumCorrelation, heightCorrelation, densityCorrelation);

    // Conservative full-puff angular footprints, including width and displaced
    // lobes. Clear bank centers alone would miss clouds stretching into the gap.
    const footprints = instances.map((p) => ({
      normal: p.normal,
      angle: Math.asin(
        Math.min(1, Math.max(p.scale[0], p.scale[2]) / (field.cloudRadius + p.alt - p.scale[1])),
      ),
    }));
    const clearanceAt = (point) =>
      Math.min(...footprints.map((p) => angle(point, p.normal) - p.angle));
    const clearFraction = probes.filter((point) => clearanceAt(point) > 0.4).length / probes.length;
    assert.ok(
      clearFraction > 0.4,
      `Seed ${seed}: broad clear areas must coexist with dense regions`,
    );
    const reportedClearance = clearanceAt(layout.clearDirection);
    assert.ok(Math.abs(Math.hypot(...layout.clearDirection) - 1) < 1e-12);
    assert.ok(
      Math.abs(reportedClearance - layout.clearAngularRadius) < 1e-12,
      'Clear direction metadata must match the actual canonical geometry',
    );
    assert.ok(
      reportedClearance > 0.65,
      'A genuinely empty broad cap remains, including on the smallest supported test planet',
    );
    minimumClearPatch = Math.min(minimumClearPatch, reportedClearance);
    minimumClearFraction = Math.min(minimumClearFraction, clearFraction);
  }
// Placement is angular and independent of planet radius; only puff footprints
// and the measured empty cap adapt to its physical size.
for (const seed of [0, 39, 73, 4294967295]) {
  const small = generateCloudLayout({ seed, cloudRadius: 35 }),
    large = generateCloudLayout({ seed, cloudRadius: 67 });
  assert.deepEqual(small.banks, large.banks);
  assert.deepEqual(small.weatherRegions, large.weatherRegions);
  assert.deepEqual(small.groups, large.groups);
  assert.notDeepEqual(
    small.banks,
    generateCloudLayout({ seed: seed + 1, cloudRadius: 35 }).banks,
    'Different seeds produce different weather maps',
  );
}
console.log(
  `PASS regional clouds across ${seeds.length * 3} seed/radius combinations: minimum patch Fano ${minimumFano.toFixed(2)} (uniform ${uniform.fano.toFixed(2)}), ${(minimumClearFraction * 100).toFixed(1)}% broad clear sky, ${minimumClearPatch.toFixed(2)} rad empty cap, ${minimumCorrelation.toFixed(2)} same-family depth/density coherence, large/medium/small groups, max ${maximumPuffs} puffs, ${minimumClearance.toFixed(2)} terrain clearance.`,
);
