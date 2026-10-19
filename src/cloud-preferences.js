export const CLOUD_PREFERENCES_KEY = 'three-planet-clouds-v1';
// Existing v1 records have no per-toggle provenance: preserve valid saved booleans.
// Only fresh, missing or invalid System values adopt the new off default.
export const DEFAULT_CLOUD_PREFERENCES = Object.freeze({
  version: 1,
  quality: 'low',
  ant: true,
  world: true,
  system: false,
});
export function validateCloudPreferences(value) {
  const out = { ...DEFAULT_CLOUD_PREFERENCES };
  if (!value || value.version !== 1) return out;
  if (value.quality === 'low' || value.quality === 'high') out.quality = value.quality;
  for (const key of ['ant', 'world', 'system'])
    if (typeof value[key] === 'boolean') out[key] = value[key];
  return out;
}
export function readCloudPreferences(storage) {
  try {
    return validateCloudPreferences(JSON.parse(storage?.getItem(CLOUD_PREFERENCES_KEY)));
  } catch {
    return { ...DEFAULT_CLOUD_PREFERENCES };
  }
}
export function writeCloudPreferences(value, storage) {
  const valid = validateCloudPreferences(value);
  try {
    storage?.setItem(CLOUD_PREFERENCES_KEY, JSON.stringify(valid));
    return true;
  } catch {
    return false;
  }
}
export function resolveCloudView({
  view,
  nestActive = false,
  systemActive = false,
  systemView,
  mode = 'colony',
} = {}) {
  if (view !== undefined) {
    if (view === null || view === 'ant' || view === 'world' || view === 'system') return view;
    throw new RangeError('view must be ant, world, system or null');
  }
  if (nestActive) return null;
  if (systemActive) return systemView === 'world' ? 'world' : 'system';
  return mode === 'ant' ? 'ant' : 'world';
}
