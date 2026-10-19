import {
  createWeatherField,
  createWeatherSampler,
  cloudRandom,
  unit,
  dot,
  cross,
  frontDirection,
  clamp01,
} from './cloud-weather.js';

// Low is a bounded geometric interpretation of the continuous weather field.
// Centers and morphology come from weather; topology is deliberately simpler
// than High's density. Parent links describe real, offset secondary lobes.
export function generateHierarchicalCloudLayout({ seed = 0, cloudRadius }) {
  const terrainRadius = cloudRadius - 5,
    weather = createWeatherField({ seed, terrainRadius });
  const sample = createWeatherSampler(weather),
    random = cloudRandom(seed ^ 0x51deca57);
  const instances = [],
    banks = [],
    groups = [],
    distribution = { wisp: 0, streak: 0, broken: 0, billow: 0 };
  const weatherRegions = weather.regions.map((r) => ({
    ...r,
    center: [...r.center],
    depth: r.development,
    start: 0,
    count: 0,
  }));
  const bankBudget = 18 + Math.floor(random() * 7),
    populations = weather.regions.map(() => 2);
  const weights = weather.regions.map((r) => r.moisture * r.length),
    total = weights.reduce((a, b) => a + b, 0);
  for (let i = populations.length * 2; i < bankBudget; i++) {
    let pick = random() * total,
      id = 0;
    while (id < weights.length - 1 && pick > weights[id]) pick -= weights[id++];
    populations[id]++;
  }
  for (let regionId = 0; regionId < weather.regions.length; regionId++) {
    const region = weather.regions[regionId],
      start = banks.length,
      count = populations[regionId],
      centers = [];
    weatherRegions[regionId].start = start;
    weatherRegions[regionId].count = count;
    const groupId = groups.length,
      sizeClass = count >= 7 ? 'large' : count >= 4 ? 'medium' : 'small';
    groups.push({ regionId, center: [...region.center], start, count, sizeClass });
    for (let member = 0; member < count; member++) {
      let bankCenter = region.center,
        best = -Infinity;
      for (let attempt = 0; attempt < 32; attempt++) {
        const along = (random() + random() - 1) * region.length * 1.25;
        const across =
          region.curve * along * along + (random() + random() - 1) * region.width * 1.3;
        const candidate = frontDirection(region, along, across),
          c = sample(candidate)[0];
        const separated = centers.every((p) => dot(p, candidate) < Math.cos(0.065));
        const score = c - (separated ? 0 : 1);
        if (score > best) {
          best = score;
          bankCenter = candidate;
        }
        if (separated && c > 0.2 && random() < c) break;
      }
      centers.push(bankCenter);
      const w = sample(bankCenter),
        development = clamp01(w[3] + (random() - 0.5) * 0.25);
      const type =
        development < 0.28
          ? 'wisp'
          : development < 0.48
            ? 'streak'
            : development < 0.7
              ? 'broken'
              : 'billow';
      const bankId = banks.length,
        bankStart = instances.length;
      const projected = unit(
        region.east.map((v, k) => v - dot(region.east, bankCenter) * bankCenter[k]),
      );
      const side = cross(bankCenter, projected),
        turn = (random() - 0.5) * 0.35;
      const east = projected.map((v, k) => v * Math.cos(turn) + side[k] * Math.sin(turn));
      const north = cross(bankCenter, east);
      const width = (2 + random() * 2.2) * (type === 'wisp' ? 0.65 : 1);
      const elongation = type === 'streak' ? 2.4 : type === 'wisp' ? 1.8 : 1.1;
      const height = w[2] - w[1],
        baseRadius = w[1],
        density = 0.45 + w[0] * 0.45;
      // Give every bank a base and first-order lobes before spending the bounded
      // remainder on secondary growth. Never truncate the final weather system.
      const remainingBanks = bankBudget - bankId;
      const puffCount = Math.min(
        5 + Math.floor(development * 3),
        Math.floor((180 - instances.length) / remainingBanks),
      );
      const nodes = [];
      for (let j = 0; j < puffCount; j++) {
        const parent = j === 0 ? -1 : j < 4 ? 0 : 1 + Math.floor(random() * Math.min(3, j - 1));
        const level = parent < 0 ? 0 : nodes[parent].level + 1;
        const shrink =
          level === 0 ? 1 : level === 1 ? 0.68 + random() * 0.24 : 0.34 + random() * 0.2;
        const sx = width * elongation * shrink * (0.85 + random() * 0.3);
        const sz = width * shrink * (0.8 + random() * 0.4);
        const sy = Math.min(
          1.75,
          (level === 0 ? 0.17 : level === 1 ? 0.26 : 0.17) * height * (0.8 + random() * 0.35),
        );
        let x = 0,
          z = 0,
          center = baseRadius + sy * 0.7;
        if (parent >= 0) {
          const p = nodes[parent],
            angle = random() * Math.PI * 2;
          x = p.x + Math.cos(angle) * p.sx * (0.45 + random() * 0.4);
          z = p.z + Math.sin(angle) * p.sz * (0.45 + random() * 0.4);
          center = Math.min(w[2] - sy, p.center + p.sy * (0.5 + random() * 0.6));
        }
        center = Math.max(baseRadius + sy * 0.65, center);
        const normal = unit(
          bankCenter.map((v, k) => v + (east[k] * x) / center + (north[k] * z) / center),
        );
        const tangentLimit = Math.sqrt(
          Math.max(0.01, (terrainRadius + 8.75) ** 2 - (center + sy) ** 2),
        );
        const node = {
          x,
          z,
          sx: Math.min(sx, tangentLimit),
          sz: Math.min(sz, tangentLimit),
          center,
          sy,
          level,
          parent,
        };
        nodes.push(node);
        instances.push({
          normal,
          east: [...east],
          scale: [node.sx, sy, node.sz],
          alt: center - cloudRadius,
          density: density * (0.86 + random() * 0.14),
          bankIndex: bankId,
          baseRadius,
          level,
          parent: parent < 0 ? -1 : bankStart + parent,
        });
      }
      const root = nodes[0];
      banks.push({
        type,
        start: bankStart,
        count: puffCount,
        length: root.sx,
        width: root.sz,
        height,
        density,
        center: [...bankCenter],
        regionId,
        groupId,
        sizeClass,
        depthScale: development,
        baseRadius,
        coverage: w[0],
      });
      distribution[type]++;
    }
  }
  // Clear metadata describes Low's entire conservative puff footprint.
  const footprints = instances.map((p) =>
    Math.asin(Math.min(1, Math.max(p.scale[0], p.scale[2]) / (cloudRadius + p.alt - p.scale[1]))),
  );
  let clearDirection = [0, 1, 0],
    clearAngularRadius = -Infinity;
  for (let i = 0; i < 192; i++) {
    const y = 1 - (2 * (i + 0.5)) / 192,
      a = i * 2.399963229728653,
      r = Math.sqrt(1 - y * y),
      p = [r * Math.cos(a), y, r * Math.sin(a)];
    let clearance = Math.PI;
    for (let j = 0; j < instances.length; j++)
      clearance = Math.min(
        clearance,
        Math.acos(Math.max(-1, Math.min(1, dot(p, instances[j].normal)))) - footprints[j],
      );
    if (clearance > clearAngularRadius) {
      clearDirection = p;
      clearAngularRadius = clearance;
    }
  }
  return {
    model: 'weather',
    modelVersion: 2,
    weather,
    instances,
    banks,
    groups,
    distribution,
    weatherRegions,
    clearDirection,
    clearAngularRadius: Math.max(0, clearAngularRadius),
  };
}
