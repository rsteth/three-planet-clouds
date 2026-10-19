import assert from 'node:assert/strict';
import {
  DEFAULT_CLOUD_PREFERENCES as defaults,
  CLOUD_PREFERENCES_KEY,
  validateCloudPreferences,
  readCloudPreferences,
  writeCloudPreferences,
  resolveCloudView,
} from '../src/cloud-preferences.js';
assert.deepEqual(readCloudPreferences(), defaults);
for (const value of [
  null,
  {},
  true,
  [],
  { version: 0, quality: 'high', ant: false },
  { version: 2 },
  'wrong',
])
  assert.deepEqual(validateCloudPreferences(value), defaults);
assert.deepEqual(
  validateCloudPreferences({ version: 1, quality: 'ultra', ant: 0, world: 'false', system: null }),
  defaults,
);
let record;
const storage = {
  getItem: (key) => {
    assert.equal(key, CLOUD_PREFERENCES_KEY);
    return record;
  },
  setItem: (key, value) => {
    assert.equal(key, CLOUD_PREFERENCES_KEY);
    record = value;
  },
};
for (let bits = 0; bits < 8; bits++)
  for (const quality of ['low', 'high']) {
    const prefs = {
      version: 1,
      quality,
      ant: !!(bits & 1),
      world: !!(bits & 2),
      system: !!(bits & 4),
    };
    assert.equal(writeCloudPreferences(prefs, storage), true);
    assert.deepEqual(readCloudPreferences(storage), prefs);
    for (const mode of ['ant', 'colony'])
      for (const systemActive of [false, true])
        for (const systemView of ['system', 'world']) {
          const view = resolveCloudView({ mode, systemActive, systemView });
          assert.equal(
            view,
            systemActive
              ? systemView === 'world'
                ? 'world'
                : 'system'
              : mode === 'ant'
                ? 'ant'
                : 'world',
          );
          assert.equal(
            resolveCloudView({ mode, systemActive, systemView, nestActive: true }),
            null,
          );
        }
  }
record = '{broken';
assert.deepEqual(readCloudPreferences(storage), defaults);
const unavailable = {
  getItem() {
    throw Error();
  },
  setItem() {
    throw Error();
  },
};
assert.deepEqual(readCloudPreferences(unavailable), defaults);
assert.equal(writeCloudPreferences(defaults, unavailable), false);
console.log(
  'PASS cloud preferences: both qualities, all eight visibility combinations, version/type validation, storage failure, focused-world/nest classification',
);

assert.equal(defaults.system, false);
assert.equal(
  validateCloudPreferences({ version: 1, quality: 'high', ant: false, world: true }).system,
  false,
);
assert.equal(
  validateCloudPreferences({ version: 1, system: true }).system,
  true,
  'Ambiguous legacy true is preserved rather than silently rewriting a saved choice',
);
assert.equal(validateCloudPreferences({ version: 1, system: false }).system, false);
assert.equal(
  readCloudPreferences({
    getItem: () =>
      JSON.stringify({ version: 1, quality: 'high', ant: true, world: true, system: true }),
  }).system,
  true,
);
console.log(
  'PASS System defaults off while valid legacy and explicit saved choices remain unchanged.',
);
