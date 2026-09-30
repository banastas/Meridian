import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CONFIG_STORAGE_KEY,
  MAX_PRESETS,
  MAX_TIMEZONES,
  STORAGE_MODE_KEY,
  SYNC_PRESET_KEY_PREFIX,
  createConfigStore,
  createPresetSnapshot,
  deserializeSyncConfig,
  normalizeConfig,
  serializeSyncConfig,
} from '../core.js';

const cities = JSON.parse(await readFile(new URL('../data/cities.json', import.meta.url), 'utf8'));
const SYNC_QUOTA_BYTES_PER_ITEM = 8192;

// An in-memory stand-in for chrome.storage.local/sync. Like Chrome, a write
// with any oversized item fails as a whole.
function createArea({ perItemQuota = Infinity } = {}) {
  const data = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));
  return {
    data,
    failWrites: false,
    async get(keys) {
      const list = keys === null ? [...data.keys()] : [].concat(keys);
      return Object.fromEntries(list.filter(key => data.has(key)).map(key => [key, clone(data.get(key))]));
    },
    async set(items) {
      if (this.failWrites) throw new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded');
      for (const [key, value] of Object.entries(items)) {
        if (key.length + new TextEncoder().encode(JSON.stringify(value)).length > perItemQuota) {
          throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
        }
      }
      for (const [key, value] of Object.entries(items)) data.set(key, clone(value));
    },
    async remove(keys) { for (const key of [].concat(keys)) data.delete(key); },
  };
}

const syncArea = () => createArea({ perItemQuota: SYNC_QUOTA_BYTES_PER_ITEM });

function clock() {
  let time = 1_000;
  return () => (time += 1_000);
}

function makeConfig({ zones = 3, citiesPerZone = 1, presets = 0, homeIndex = 0, storageMode = 'local', offset = 0 } = {}) {
  const zoneIds = [...new Set(cities.map(city => city.tz))];
  const zoneList = Array.from({ length: zones }, (_, index) => {
    const tz = zoneIds[(index * 37 + offset) % zoneIds.length];
    return {
      tz,
      workingHours: { enabled: true, start: 540, end: 1020 },
      cities: cities.filter(city => city.tz === tz).slice(0, citiesPerZone).map(({ city, country }) => ({ city, country })),
    };
  });
  const home = { ...zoneList[homeIndex].cities[0], tz: zoneList[homeIndex].tz };
  const base = normalizeConfig({ schemaVersion: 2, home, zones: zoneList, onboardingComplete: true, storageMode });
  base.presets = Array.from({ length: presets }, (_, index) => ({
    id: `preset-${offset}-${index}`,
    name: `Preset ${index}`,
    ...createPresetSnapshot(base),
  }));
  return normalizeConfig(base);
}

function syncedItemKeys(area) {
  return [...area.data.keys()].filter(key => key === CONFIG_STORAGE_KEY || key.startsWith(SYNC_PRESET_KEY_PREFIX)).sort();
}

test('large sync configurations are split so every item fits the per-item quota', () => {
  const large = makeConfig({ zones: MAX_TIMEZONES, citiesPerZone: 3, presets: MAX_PRESETS, storageMode: 'sync' });
  const legacyBytes = CONFIG_STORAGE_KEY.length + JSON.stringify(large).length;
  assert.ok(legacyBytes > SYNC_QUOTA_BYTES_PER_ITEM, `fixture must exceed the quota as one item (${legacyBytes} bytes)`);

  const items = serializeSyncConfig(large);
  for (const [key, value] of Object.entries(items)) {
    const bytes = key.length + new TextEncoder().encode(JSON.stringify(value)).length;
    assert.ok(bytes <= SYNC_QUOTA_BYTES_PER_ITEM, `${key} is ${bytes} bytes`);
  }
  assert.equal(Object.keys(items).filter(key => key.startsWith(SYNC_PRESET_KEY_PREFIX)).length, MAX_PRESETS);
  assert.deepEqual(normalizeConfig(deserializeSyncConfig(items)), large);

  const small = makeConfig({ zones: 4, presets: 1, storageMode: 'sync' });
  const smallItems = serializeSyncConfig(small);
  assert.deepEqual(Object.keys(smallItems), [CONFIG_STORAGE_KEY], 'small configurations keep the original single-item layout');
  assert.deepEqual(smallItems[CONFIG_STORAGE_KEY], small);
});

test('sync saves succeed for configurations larger than one sync item', async () => {
  const local = createArea(), sync = syncArea();
  const errors = [];
  const store = createConfigStore({ local, sync, now: clock(), syncDelayMs: 60_000, onSyncError: error => errors.push(error) });
  const large = makeConfig({ zones: MAX_TIMEZONES, citiesPerZone: 3, presets: MAX_PRESETS, storageMode: 'sync' });
  await assert.rejects(sync.set({ [CONFIG_STORAGE_KEY]: large }), /QUOTA_BYTES_PER_ITEM/, 'the previous single-item write fails');

  await store.save(large);
  assert.equal(await store.flush(), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(normalizeConfig(deserializeSyncConfig(await sync.get(null))), large);
});

test('local storage always holds the latest configuration and sync writes are debounced', async () => {
  const local = createArea(), sync = syncArea();
  const store = createConfigStore({ local, sync, now: clock(), syncDelayMs: 60_000 });
  const config = makeConfig({ storageMode: 'sync' });

  await store.save(config);
  const saved = (await local.get([CONFIG_STORAGE_KEY, STORAGE_MODE_KEY]));
  assert.deepEqual(normalizeConfig(saved[CONFIG_STORAGE_KEY]), config);
  assert.equal(saved[STORAGE_MODE_KEY], 'sync');
  assert.deepEqual(syncedItemKeys(sync), [], 'sync waits for the debounce');

  await store.flush();
  assert.deepEqual(normalizeConfig(deserializeSyncConfig(await sync.get(null))), config);
});

test('enabling sync adopts clocks already synced from another device', async () => {
  const sync = syncArea();
  const laptop = createConfigStore({ local: createArea(), sync, now: clock(), syncDelayMs: 60_000 });
  const laptopConfig = makeConfig({ zones: 5, presets: 2, offset: 1 });
  await laptop.setMode(laptopConfig, 'sync');

  const desktop = createConfigStore({ local: createArea(), sync, now: clock(), syncDelayMs: 60_000 });
  const desktopConfig = makeConfig({ zones: 3, presets: 1, offset: 2 });
  const result = await desktop.setMode(desktopConfig, 'sync');

  assert.equal(result.adopted, true);
  assert.deepEqual(result.config.zones, laptopConfig.zones, "the desktop shows the laptop's clocks");
  assert.deepEqual(result.previous.zones, desktopConfig.zones, 'the replaced clocks are returned for undo');
  assert.deepEqual(
    result.config.presets.map(preset => preset.id),
    [...laptopConfig.presets, ...desktopConfig.presets].map(preset => preset.id),
    'presets from both devices are kept',
  );
  const remote = normalizeConfig(deserializeSyncConfig(await sync.get(null)));
  assert.deepEqual(remote.zones, laptopConfig.zones, "the laptop's synced clocks were not overwritten");
});

test('a fresh install picks up a configuration synced from another device', async () => {
  const sync = syncArea();
  const laptopConfig = makeConfig({ zones: 4, presets: 1 });
  await createConfigStore({ local: createArea(), sync, now: clock() }).setMode(laptopConfig, 'sync');

  const freshLocal = createArea();
  const fresh = createConfigStore({ local: freshLocal, sync, now: clock() });
  const { config, adopted } = await fresh.load();
  assert.equal(adopted, true);
  assert.equal(config.storageMode, 'sync');
  assert.deepEqual(config.zones, laptopConfig.zones);
  assert.equal((await freshLocal.get([STORAGE_MODE_KEY]))[STORAGE_MODE_KEY], 'sync');

  const untouched = createConfigStore({ local: createArea(), sync: syncArea(), now: clock() });
  const empty = await untouched.load();
  assert.equal(empty.config.home, null, 'without synced data a fresh install starts onboarding');
  assert.equal(empty.config.storageMode, 'local');
});

test('edits that never reached sync win over an older synced copy', async () => {
  const local = createArea(), sync = syncArea();
  const now = clock();
  const first = createConfigStore({ local, sync, now, syncDelayMs: 60_000 });
  const original = makeConfig({ zones: 3, storageMode: 'sync' });
  await first.save(original); await first.flush();
  // A tab that saved locally but closed before its debounced sync write.
  const closedTab = createConfigStore({ local, sync: null, now });
  const edited = makeConfig({ zones: 5, storageMode: 'sync' });
  await closedTab.save(edited);

  const next = createConfigStore({ local, sync, now, syncDelayMs: 60_000 });
  const loaded = await next.load();
  assert.deepEqual(loaded.config.zones, edited.zones);
  await next.flush();
  assert.deepEqual(normalizeConfig(deserializeSyncConfig(await sync.get(null))).zones, edited.zones);

  // A newer change from another device still wins over this device's copy.
  const other = createConfigStore({ local: createArea(), sync, now, syncDelayMs: 60_000 });
  const remote = makeConfig({ zones: 2, storageMode: 'sync', offset: 5 });
  await other.save(remote); await other.flush();
  const reloaded = await createConfigStore({ local, sync, now }).load();
  assert.deepEqual(reloaded.config.zones, remote.zones);
});

test('switching to local-only removes every synced Meridian item', async () => {
  const local = createArea(), sync = syncArea();
  sync.data.set('unrelated_extension_key', true);
  const store = createConfigStore({ local, sync, now: clock(), syncDelayMs: 60_000 });
  const large = makeConfig({ zones: MAX_TIMEZONES, citiesPerZone: 3, presets: MAX_PRESETS });
  await store.setMode(large, 'sync');
  assert.ok(syncedItemKeys(sync).length > 1);

  const { config } = await store.setMode(large, 'local');
  assert.equal(config.storageMode, 'local');
  assert.deepEqual(syncedItemKeys(sync), []);
  assert.equal(sync.data.get('unrelated_extension_key'), true);
  assert.equal((await local.get([STORAGE_MODE_KEY]))[STORAGE_MODE_KEY], 'local');
});

test('shrinking the preset list removes stale synced preset items', async () => {
  const sync = syncArea();
  const store = createConfigStore({ local: createArea(), sync, now: clock(), syncDelayMs: 60_000 });
  const large = makeConfig({ zones: MAX_TIMEZONES, citiesPerZone: 3, presets: MAX_PRESETS, storageMode: 'sync' });
  await store.save(large); await store.flush();
  const trimmed = normalizeConfig({ ...large, presets: large.presets.slice(0, 2) });
  await store.save(trimmed); await store.flush();
  assert.deepEqual(syncedItemKeys(sync), [CONFIG_STORAGE_KEY]);
  assert.equal(normalizeConfig(deserializeSyncConfig(await sync.get(null))).presets.length, 2);
});

test('a failed sync write is reported and the local copy is kept', async () => {
  const local = createArea(), sync = syncArea();
  const errors = [];
  const store = createConfigStore({ local, sync, now: clock(), syncDelayMs: 60_000, onSyncError: error => errors.push(error) });
  const config = makeConfig({ storageMode: 'sync' });
  sync.failWrites = true;
  await store.save(config);
  assert.equal(await store.flush(), false);
  assert.equal(errors.length, 1);
  assert.deepEqual(normalizeConfig((await local.get([CONFIG_STORAGE_KEY]))[CONFIG_STORAGE_KEY]), config);
});

test("tabs reloading after another tab's save never write storage themselves", async () => {
  const local = createArea(), sync = syncArea();
  const now = clock();
  const writerTab = createConfigStore({ local, sync, now, syncDelayMs: 60_000 });
  const config = makeConfig({ zones: 4, storageMode: 'sync' });
  await writerTab.save(config); // saved locally; this tab owns the pending sync write

  let writes = 0;
  for (const area of [local, sync]) {
    const set = area.set.bind(area);
    area.set = async items => { writes++; return set(items); };
  }
  const otherTab = createConfigStore({ local, sync, now, syncDelayMs: 0 });
  const reloaded = await otherTab.load({ repair: false });
  assert.deepEqual(reloaded.config.zones, config.zones);
  assert.equal(await otherTab.flush(), true);
  assert.equal(writes, 0, 'only the writing tab syncs the change');

  await writerTab.flush();
  assert.equal(writes, 1);
});

test('storage change events from this page are ignored, others are not', () => {
  const store = createConfigStore({ local: createArea(), writerId: 'this-tab' });
  assert.equal(store.isExternalChange({ [CONFIG_STORAGE_KEY]: { newValue: { writer: 'this-tab' } } }), false);
  assert.equal(store.isExternalChange({ [CONFIG_STORAGE_KEY]: { newValue: { writer: 'other-tab' } } }), true);
  assert.equal(store.isExternalChange({ [CONFIG_STORAGE_KEY]: { newValue: {} } }), true, 'older versions write without a writer');
  assert.equal(store.isExternalChange({ [STORAGE_MODE_KEY]: { newValue: 'sync' } }), true);
  assert.equal(store.isExternalChange({ unrelated: { newValue: 1 } }), false);
});
