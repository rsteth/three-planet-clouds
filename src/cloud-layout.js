// Seeded, renderer-independent cloud morphology. Dimensions are ellipsoid radii.
// A small fixed budget keeps all four silhouettes in one instanced draw call.
export function generateCloudLayout({ seed, cloudRadius }) {
  let state = (seed ^ 0xa53c94d7) >>> 0;
  const rand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const unit = (v) => {
    const m = Math.hypot(...v);
    return v.map((x) => x / m);
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const direction = () => {
    const y = rand() * 2 - 1,
      a = rand() * Math.PI * 2,
      r = Math.sqrt(1 - y * y);
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };
  const basis = (center, yaw) => {
    const base = unit(cross(Math.abs(center[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], center)),
      side = cross(center, base);
    const east = base.map((x, k) => x * Math.cos(yaw) + side[k] * Math.sin(yaw));
    return { east, north: cross(center, east) };
  };
  const offset = (center, east, north, along, across) =>
    unit(center.map((x, k) => x + east[k] * along + north[k] * across));
  const instances = [],
    banks = [],
    weatherRegions = [],
    groups = [],
    distribution = { wisp: 0, streak: 0, broken: 0, billow: 0 };
  const types = Object.keys(distribution),
    order = Array.from({ length: 24 }, (_, i) => types[i % 4]);
  // Mix all four families within each stretch of a weather system, while keeping
  // exactly six of each. Neither a region nor a latitude owns a cloud family.
  for (let start = 0; start < 24; start += 4)
    for (let j = 3; j > 0; j--) {
      const k = Math.floor(rand() * (j + 1));
      [order[start + j], order[start + k]] = [order[start + k], order[start + j]];
    }
  // Four unequal weather systems replace the near-uniform Fibonacci scatter.
  // Farthest-candidate anchors leave broad clear areas between the systems; all
  // of their banks inherit a front direction, moisture, and vertical development.
  // Nested groups give the dense system several connected masses and satellites.
  const populations = [[6, 3, 2], [4, 2, 1], [3, 2], [1]],
    depths = [1, 0.66, 0.36, 0.16];
  for (let j = depths.length - 1; j > 0; j--) {
    const k = Math.floor(rand() * (j + 1));
    [depths[j], depths[k]] = [depths[k], depths[j]];
  }
  for (let regionId = 0; regionId < populations.length; regionId++) {
    let center = direction(),
      separation = -Infinity;
    // Bounded work at generation time only. The first direction is fully seeded;
    // subsequent anchors favor empty sky without imposing a repeated latitude grid.
    if (regionId > 0)
      for (let attempt = 0; attempt < 24; attempt++) {
        const candidate = direction(),
          distance = Math.min(...weatherRegions.map((region) => 1 - dot(candidate, region.center)));
        if (distance > separation) {
          center = candidate;
          separation = distance;
        }
      }
    const yaw = rand() * Math.PI * 2,
      { east, north } = basis(center, yaw),
      stretch = 0.85 + rand() * 0.3,
      curve = (rand() - 0.5) * 0.5;
    const depth = depths[regionId],
      moisture = 0.3 + depth * 0.65,
      regionStart = banks.length,
      groupCounts = populations[regionId];
    weatherRegions.push({
      center: [...center],
      depth,
      moisture,
      start: regionStart,
      count: groupCounts.reduce((a, b) => a + b, 0),
    });
    for (let g = 0; g < groupCounts.length; g++) {
      const count = groupCounts[g],
        groupId = groups.length,
        groupAlong = (g - (groupCounts.length - 1) / 2) * (0.32 + rand() * 0.07) * stretch;
      const groupAcross = curve * groupAlong * groupAlong + (rand() - 0.5) * 0.09;
      const groupCenter = offset(center, east, north, groupAlong, groupAcross),
        size = 0.76 + count * 0.075 + rand() * 0.1;
      const groupDepth = Math.min(1, Math.max(0.12, depth + (rand() - 0.5) * 0.16)),
        groupStart = banks.length,
        positions = [],
        sizeClass = count >= 4 ? 'large' : count >= 2 ? 'medium' : 'small';
      groups.push({ regionId, center: [...groupCenter], start: groupStart, count, sizeClass });
      for (let member = 0; member < count; member++) {
        // A center-weighted elliptical patch, not a ring or equally spaced beads.
        // Keep centers distinct but close enough for their irregular lobes to join.
        let along = 0,
          across = 0;
        if (member > 0)
          for (let attempt = 0; attempt < 12; attempt++) {
            along = (rand() + rand() - 1) * (0.09 + count * 0.018);
            across = (rand() + rand() - 1) * (0.055 + count * 0.009);
            if (positions.every((p) => Math.hypot(along - p[0], across - p[1]) > 0.045)) break;
          }
        positions.push([along, across]);
        const bankCenter = offset(
          center,
          east,
          north,
          groupAlong + along,
          groupAcross + across + curve * along,
        );
        // Transport the regional front into the bank's tangent plane. Small local
        // departures preserve a shared flow without making all silhouettes parallel.
        const projected = unit(east.map((x, k) => x - dot(east, bankCenter) * bankCenter[k])),
          side = cross(bankCenter, projected),
          turn = (rand() - 0.5) * 0.5;
        const bankEast = projected.map((x, k) => x * Math.cos(turn) + side[k] * Math.sin(turn)),
          bankNorth = cross(bankCenter, bankEast);
        const i = banks.length,
          type = order[i],
          start = instances.length,
          development = Math.min(1, Math.max(0.1, groupDepth + (rand() - 0.5) * 0.16));
        const scale = size * (0.84 + rand() * 0.28),
          altitude = 0.05 + rand() * 0.17 + (1 - development) * 0.15;
        let length, width, height, density;
        if (type === 'wisp') {
          const small = distribution.wisp === 0;
          length = (small ? 1.2 + rand() * 0.35 : 1.5 + rand() * 1.9) * scale;
          width = (small ? 0.4 + rand() * 0.25 : 0.45 + rand() * 0.55) * scale;
          height = 0.22 + development * 0.36 + rand() * 0.06;
          density = 0.34 + moisture * 0.16 + rand() * 0.04;
        }
        if (type === 'streak') {
          length = (4.8 + rand() * 3.4) * scale;
          width = (0.65 + rand() * 0.7) * scale;
          height = 0.28 + development * 0.48 + rand() * 0.08;
          density = 0.43 + moisture * 0.22 + rand() * 0.04;
        }
        if (type === 'broken') {
          length = (4 + rand() * 3) * scale;
          width = (1.3 + rand() * 1.3) * scale;
          height = 0.55 + development * 0.75 + rand() * 0.12;
          density = 0.53 + moisture * 0.25 + rand() * 0.05;
        }
        if (type === 'billow') {
          length = (4.5 + rand() * 2.8) * scale;
          width = (2.1 + rand() * 1.5) * scale;
          height = 1.2 + development * 0.65 + rand() * 0.08;
          density = 0.7 + moisture * 0.24 + rand() * 0.04;
        }
        const add = (along, across, sx, sy, sz, alt = 0, opacity = density) => {
          const normal = offset(
            bankCenter,
            bankEast,
            bankNorth,
            along / cloudRadius,
            across / cloudRadius,
          );
          // Preserve the full shared shell: >=1.8 terrain clearance and <9 outer
          // altitude, including triangle interiors and the ellipsoid's tangent bulge.
          sy = Math.min(sy, 3.05);
          alt += altitude;
          const tangentLimit = Math.sqrt(
            Math.max(0.01, (cloudRadius + 3.9) ** 2 - (cloudRadius + alt + sy) ** 2),
          );
          instances.push({
            normal,
            east: [...bankEast],
            scale: [Math.min(sx, tangentLimit), sy, Math.min(sz, tangentLimit)],
            alt,
            density: Math.min(1, Math.max(0.25, opacity)),
            bankIndex: i,
          });
        };
        if (type === 'broken') {
          // Three separated islands, each made of a low body and one/two towers.
          for (let fragment = 0; fragment < 3; fragment++) {
            const along = (fragment - 1) * length * 0.94,
              across = (rand() - 0.5) * width * 1.2,
              extent = (0.8 + rand() * 0.65) * scale;
            add(along, across, extent, height * 0.65, width * 0.55, 0, density * 0.86);
            const towers = 1 + (rand() > 0.5 ? 1 : 0);
            for (let j = 0; j < towers; j++)
              add(
                along + (j - (towers - 1) / 2) * extent * 0.8,
                across + (rand() - 0.5) * width * 0.25,
                extent * 0.7,
                height * (0.85 + rand() * 0.45),
                width * 0.5,
                0.1 + rand() * 0.15,
                density * (0.9 + rand() * 0.1),
              );
          }
        } else {
          add(0, 0, length, height, width, 0, density * 0.92);
          const lobes =
            type === 'wisp'
              ? 2 + Math.floor(rand() * 2)
              : type === 'streak'
                ? 3 + Math.floor(rand() * 3)
                : 8 + Math.floor(rand() * 3);
          for (let j = 0; j < lobes; j++) {
            const along = (j / (lobes - 1) - 0.5) * length * 1.5,
              across = (rand() - 0.5) * width * (type === 'billow' ? 1.05 : 0.5);
            if (type === 'billow')
              add(
                along,
                across,
                (1.25 + rand() * 1.15) * scale,
                height * (0.8 + rand() * 0.65),
                (1.15 + rand() * 1.05) * scale,
                0.1 + rand() * 0.25,
                density * (0.88 + rand() * 0.12),
              );
            else
              add(
                along,
                across,
                (length / lobes) * (1.2 + rand() * 0.5),
                height * (0.8 + rand() * 0.6),
                width * (0.65 + rand() * 0.3),
                rand() * 0.1,
                density * (0.8 + rand() * 0.2),
              );
          }
        }
        banks.push({
          type,
          start,
          count: instances.length - start,
          length,
          width,
          height,
          density,
          center: [...bankCenter],
          regionId,
          groupId,
          sizeClass,
          depthScale: development,
        });
        distribution[type]++;
      }
    }
  }
  // Report a reproducible clear-sky direction for inspection. The bound includes
  // every puff's tangent footprint, not just its bank center. This small bounded
  // search runs once with generation and is never part of either renderer's loop.
  const footprints = instances.map((p) =>
    Math.asin(Math.min(1, Math.max(p.scale[0], p.scale[2]) / (cloudRadius + p.alt - p.scale[1]))),
  );
  let clearDirection = [0, 1, 0],
    clearAngularRadius = -Infinity;
  for (let probe = 0; probe < 96; probe++) {
    const y = 1 - (2 * (probe + 0.5)) / 96,
      a = probe * Math.PI * (3 - Math.sqrt(5)),
      r = Math.sqrt(1 - y * y),
      candidate = [r * Math.cos(a), y, r * Math.sin(a)];
    let clearance = Math.PI;
    for (let i = 0; i < instances.length; i++)
      clearance = Math.min(
        clearance,
        Math.acos(Math.max(-1, Math.min(1, dot(candidate, instances[i].normal)))) - footprints[i],
      );
    if (clearance > clearAngularRadius) {
      clearDirection = candidate;
      clearAngularRadius = clearance;
    }
  }
  return {
    instances,
    banks,
    distribution,
    weatherRegions,
    groups,
    clearDirection,
    clearAngularRadius: Math.max(0, clearAngularRadius),
  };
}

// Canonical ellipsoids shared by both renderers and the envelope-baking worker.
// Conversion must not consume random numbers or change seeded placement,
// morphology, or density. Both qualities consume this one canonical field.
export function createCloudField({ seed, terrainRadius }) {
  if (!Number.isFinite(terrainRadius) || terrainRadius <= 0)
    throw new RangeError('A positive terrain envelope radius is required');
  const cloudRadius = terrainRadius + 5,
    layout = generateCloudLayout({ seed, cloudRadius }),
    puffs = [];
  let inner = Infinity,
    outer = 0;
  for (const puff of layout.instances) {
    const up = [...puff.normal],
      projection = puff.east[0] * up[0] + puff.east[1] * up[1] + puff.east[2] * up[2];
    const east = puff.east.map((v, i) => v - projection * up[i]),
      eastLength = Math.hypot(...east);
    for (let i = 0; i < 3; i++) east[i] /= eastLength;
    // This is the same right-handed basis previously used by atmosphere.js.
    const forward = [
      east[1] * up[2] - east[2] * up[1],
      east[2] * up[0] - east[0] * up[2],
      east[0] * up[1] - east[1] * up[0],
    ];
    const radius = cloudRadius + puff.alt,
      radii = [...puff.scale],
      center = up.map((v) => v * radius);
    puffs.push({
      center,
      basis: [east, up, forward],
      radii,
      density: puff.density,
      bankId: puff.bankIndex,
    });
    // The radial axis points through the planet origin. The exact lower bound is
    // therefore R - ry. For the upper bound maximize the meridional ellipse in
    // the plane of the longer tangent axis, including its stationary point.
    const tangent = Math.max(radii[0], radii[2]),
      vertical = radii[1],
      difference = tangent * tangent - vertical * vertical;
    const y = difference > 0 ? Math.min(1, (radius * vertical) / difference) : 1;
    const farthest = Math.sqrt((radius + vertical * y) ** 2 + tangent * tangent * (1 - y * y));
    inner = Math.min(inner, radius - vertical);
    outer = Math.max(outer, farthest);
  }
  return {
    seed,
    terrainRadius,
    layout,
    puffs,
    bounds: { inner, outer },
    cloudRadius,
    minCloudClearance: inner - terrainRadius,
  };
}
