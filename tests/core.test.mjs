import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DEFAULT_WORKING_HOURS,
  DEFAULT_TIMEZONES,
  MAX_TIMEZONES,
  addZoneByUtcOffset,
  areZonesAvailable,
  calculateLayoutWidth,
  calculateTimeFontSize,
  createBackup,
  createPresetSnapshot,
  findAvailabilityWindows,
  formatRelativeOffset,
  formatUtcOffset,
  getContrastRatio,
  getGradientColors,
  getLocalMinuteOfDay,
  getNextOffsetTransition,
  getOffsetMinutes,
  getRepresentativeCity,
  getSolarAdjustedHour,
  getSolarGradientColors,
  getSolarTimes,
  getSmoothGradientStops,
  getTextColor,
  getTimeInZone,
  getZonedDateParts,
  isMinuteWithinHours,
  isValidTimeZone,
  lerpColor,
  normalizeConfig,
  parseBackup,
  sortZonesByUtcOffset,
} from '../core.js';

const cities = JSON.parse(await readFile(new URL('../data/cities.json', import.meta.url), 'utf8'));
const coordinates = JSON.parse(await readFile(new URL('../data/timezone-coordinates.json', import.meta.url), 'utf8'));

function referenceOffset(timeZone, date) {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
    hour: '2-digit',
  }).formatToParts(date).find(part => part.type === 'timeZoneName').value;
  if (value === 'GMT') return 0;
  const match = value.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  assert.ok(match, `Unexpected reference offset ${value}`);
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

test('offsets stay correct across the host DST transition windows', () => {
  const timeZones = [...new Set(cities.map(city => city.tz))];
  const dates = [
    '2026-03-29T00:30:00Z',
    '2026-03-29T01:30:00Z',
    '2026-03-29T02:30:00Z',
    '2026-03-29T06:30:00Z',
    '2026-10-25T00:30:00Z',
    '2026-10-25T01:30:00Z',
    '2026-10-25T02:30:00Z',
    '2026-10-25T06:30:00Z',
  ].map(timestamp => new Date(timestamp));

  for (const date of dates) {
    for (const timeZone of timeZones) {
      assert.equal(getOffsetMinutes(timeZone, date), referenceOffset(timeZone, date), `${timeZone} at ${date.toISOString()}`);
    }
  }
});

test('canonical default and detected cities are selected', () => {
  for (const { tz, city } of DEFAULT_TIMEZONES) {
    assert.equal(getRepresentativeCity(cities, tz, city).city, city);
  }
  assert.equal(getRepresentativeCity(cities, 'Europe/Paris').city, 'Paris');
});

test('the first-run world sample sorts west to east without disturbing equal offsets', () => {
  const date = new Date('2026-07-14T12:00:00Z');
  const zones = [
    { tz: 'Europe/Paris', label: 'Home' },
    { tz: 'Asia/Tokyo', label: 'Tokyo' },
    { tz: 'America/Los_Angeles', label: 'Los Angeles' },
    { tz: 'Asia/Shanghai', label: 'Beijing' },
    { tz: 'Europe/Berlin', label: 'Berlin' },
    { tz: 'America/New_York', label: 'New York' },
  ];

  assert.deepEqual(sortZonesByUtcOffset(zones, date).map(zone => zone.label), [
    'Los Angeles',
    'New York',
    'Home',
    'Berlin',
    'Beijing',
    'Tokyo',
  ]);
  assert.deepEqual(zones.map(zone => zone.label), [
    'Home',
    'Tokyo',
    'Los Angeles',
    'Beijing',
    'Berlin',
    'New York',
  ], 'sorting does not mutate saved user order');
});

test('a newly added timezone joins the current-time order with stable equal offsets', () => {
  const date = new Date('2026-08-28T18:40:00Z');
  const zones = [
    { tz: 'America/Los_Angeles', label: 'Los Angeles' },
    { tz: 'America/New_York', label: 'Boston' },
    { tz: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
    { tz: 'Europe/Madrid', label: 'Madrid' },
    { tz: 'Europe/Bucharest', label: 'Bucharest' },
  ];
  const amsterdam = { tz: 'Europe/Amsterdam', label: 'Amsterdam' };

  assert.deepEqual(addZoneByUtcOffset(zones, amsterdam, date).map(zone => zone.label), [
    'Los Angeles',
    'Boston',
    'Buenos Aires',
    'Madrid',
    'Amsterdam',
    'Bucharest',
  ]);
  assert.deepEqual(zones.map(zone => zone.label), [
    'Los Angeles',
    'Boston',
    'Buenos Aires',
    'Madrid',
    'Bucharest',
  ], 'adding a zone does not mutate the previous saved array');
});

test('locale-native date order is preserved', () => {
  const date = new Date('2026-07-14T12:00:00Z');
  const french = getTimeInZone('Europe/Paris', 'fr-FR', date).dateLabel;
  const spanish = getTimeInZone('Europe/Paris', 'es-AR', date).dateLabel;
  assert.ok(french.indexOf('14') < french.toLowerCase().indexOf('juil'));
  assert.ok(spanish.indexOf('14') < spanish.toLowerCase().indexOf('jul'));
});

test('gradient text always meets WCAG AA small-text contrast', () => {
  let minimum = Infinity;
  for (let minute = 0; minute < 1440; minute++) {
    const gradient = getGradientColors(Math.floor(minute / 60), minute % 60);
    const background = lerpColor(gradient.top, gradient.bottom, 0.5);
    const foreground = getTextColor(gradient.top, gradient.bottom) === 'rgb(0, 0, 0)'
      ? [0, 0, 0]
      : [255, 255, 255];
    minimum = Math.min(minimum, getContrastRatio(foreground, background));
  }
  assert.ok(minimum >= 4.5, `minimum contrast was ${minimum}`);
});

test('smooth horizontal gradient stops preserve edges and interpolate without seams', () => {
  const stops = getSmoothGradientStops([[0, 0, 0], [255, 128, 64]], 4);
  assert.deepEqual(stops[0], { offset: 0, color: [0, 0, 0] });
  assert.deepEqual(stops.at(-1), { offset: 1, color: [255, 128, 64] });
  assert.ok(stops.every((stop, index) => index === 0 || stop.offset >= stops[index - 1].offset));
  const midpoint = stops.find(stop => stop.offset === 0.5);
  assert.deepEqual(midpoint.color, [127.5, 64, 32]);
  assert.deepEqual(getSmoothGradientStops([[12, 34, 56]]), [
    { offset: 0, color: [12, 34, 56] },
    { offset: 1, color: [12, 34, 56] },
  ]);
});

test('stored configurations repair a missing home column and malformed values', () => {
  const normalized = normalizeConfig({
    home: { city: 'Paris', country: 'FR', tz: 'Europe/Paris' },
    zones: [{ tz: 'Asia/Tokyo', cities: [{ city: 'Tokyo', country: 'JP' }] }],
    use24h: 1,
    showSeconds: true,
  });
  assert.deepEqual(normalized.zones.at(-1), {
    tz: 'Europe/Paris',
    workingHours: { ...DEFAULT_WORKING_HOURS, days: [1, 2, 3, 4, 5] },
    cities: [{ city: 'Paris', country: 'FR' }],
  });
  assert.equal(normalized.use24h, false);
  assert.equal(normalized.showSeconds, true);
  assert.equal(normalized.schemaVersion, 2);
  assert.equal(normalized.onboardingComplete, true, 'legacy home configurations migrate past onboarding');
});

test('offset labels and responsive layout calculations are stable', () => {
  assert.equal(formatUtcOffset(-450), 'UTC−7:30');
  assert.equal(formatUtcOffset(0), 'UTC+0');
  assert.equal(formatRelativeOffset(345, 60), '+4h 45m');
  assert.equal(formatRelativeOffset(60, 345), '−4h 45m');
  assert.equal(calculateLayoutWidth(390, 7), 1050);
  assert.equal(calculateLayoutWidth(1280, 6), 1280);
  assert.ok(calculateTimeFontSize(182, true, true) < calculateTimeFontSize(182, true, false));
  assert.equal(calculateTimeFontSize(120, true, true), 24);
  assert.equal(calculateTimeFontSize(400, false, false), 88);
});

test('working-hour windows support normal, overnight, and disabled schedules', () => {
  assert.equal(isMinuteWithinHours(9 * 60, { enabled: true, start: 540, end: 1020 }), true);
  assert.equal(isMinuteWithinHours(17 * 60, { enabled: true, start: 540, end: 1020 }), false);
  assert.equal(isMinuteWithinHours(23 * 60, { enabled: true, start: 1320, end: 360 }), true);
  assert.equal(isMinuteWithinHours(3 * 60, { enabled: true, start: 1320, end: 360 }), true);
  assert.equal(isMinuteWithinHours(12 * 60, { enabled: false, start: 0, end: 1 }), true);
});

test('shared availability finds deterministic 15-minute overlap windows', () => {
  const zones = [
    { tz: 'Europe/Paris', workingHours: { enabled: true, start: 9 * 60, end: 17 * 60 } },
    { tz: 'America/New_York', workingHours: { enabled: true, start: 9 * 60, end: 17 * 60 } },
  ];
  const start = new Date('2026-07-14T00:00:00Z');
  const windows = findAvailabilityWindows(zones, start, { horizonMinutes: 1440, stepMinutes: 15 });
  assert.equal(windows.length, 1);
  assert.equal(windows[0].start.toISOString(), '2026-07-14T13:00:00.000Z');
  assert.equal(windows[0].end.toISOString(), '2026-07-14T15:00:00.000Z');
  assert.equal(areZonesAvailable(zones, new Date('2026-07-14T14:00:00Z')), true);
  assert.equal(areZonesAvailable(zones, new Date('2026-07-14T18:00:00Z')), false);
  assert.equal(getLocalMinuteOfDay('Asia/Kathmandu', new Date('2026-07-14T00:00:00Z')), 345);
});

test('nearby DST transitions are found to the minute and distant ones stay hidden', () => {
  const transition = getNextOffsetTransition('Europe/Paris', new Date('2026-03-20T12:00:00Z'), 30);
  assert.equal(transition.at.toISOString(), '2026-03-29T01:00:00.000Z');
  assert.equal(transition.deltaMinutes, 60);
  assert.equal(getNextOffsetTransition('Europe/Paris', new Date('2026-07-14T12:00:00Z'), 30), null);
});

test('solar calculations respond to latitude, longitude, and season without a network', () => {
  const paris = { latitude: 48.8667, longitude: 2.3333 };
  const summer = getSolarTimes('Europe/Paris', paris, new Date('2026-06-21T12:00:00Z'));
  const winter = getSolarTimes('Europe/Paris', paris, new Date('2026-12-21T12:00:00Z'));
  assert.ok(summer.sunrise < 6 && summer.sunset > 21, JSON.stringify(summer));
  assert.ok(winter.sunrise > 8 && winter.sunset < 18, JSON.stringify(winter));
  assert.ok(getSolarAdjustedHour(summer.sunrise, summer) >= 4.99);
  assert.notDeepEqual(
    getSolarGradientColors('Europe/Paris', paris, new Date('2026-06-21T03:30:00Z')),
    getGradientColors(5, 30),
  );
});

test('versioned configuration normalizes schedules, presets, privacy, and limits', () => {
  const raw = {
    schemaVersion: 2,
    home: { city: 'Paris', country: 'FR', tz: 'Europe/Paris' },
    zones: [{
      tz: 'Europe/Paris',
      cities: [{ city: 'Paris', country: 'FR' }],
      workingHours: { enabled: true, start: -20, end: 2000 },
    }],
    infoDensity: 'compact', visualTheme: 'solar', atmosphericMotion: false,
    availabilityEnabled: true, storageMode: 'sync', onboardingComplete: true,
    presets: [{
      id: 'work', name: 'Work', home: { city: 'Paris', country: 'FR', tz: 'Europe/Paris' },
      zones: [{ tz: 'Europe/Paris', cities: [{ city: 'Paris', country: 'FR' }] }],
      visualTheme: 'solar', infoDensity: 'compact',
    }],
    activePresetId: 'work',
  };
  const normalized = normalizeConfig(raw);
  assert.deepEqual(normalized.zones[0].workingHours, { enabled: true, start: 0, end: 1439, days: [1, 2, 3, 4, 5] });
  assert.equal(normalized.infoDensity, 'compact');
  assert.equal(normalized.visualTheme, 'solar');
  assert.equal(normalized.storageMode, 'sync');
  assert.equal(normalized.presets[0].id, 'work');
  assert.equal(normalized.activePresetId, 'work');
  const snapshot = createPresetSnapshot(normalized);
  assert.equal('presets' in snapshot, false, 'preset snapshots never recurse');
  assert.equal('storageMode' in snapshot, false, 'preset activation never changes privacy mode');
  normalized.zones[0].cities[0].city = 'Changed after snapshot';
  assert.equal(snapshot.zones[0].cities[0].city, 'Paris', 'preset snapshots do not retain mutable config references');
});

test('JSON backups round-trip through the versioned repair contract', () => {
  const config = normalizeConfig({
    home: { city: 'Paris', country: 'FR', tz: 'Europe/Paris' },
    zones: [{ tz: 'Europe/Paris', cities: [{ city: 'Paris', country: 'FR' }] }],
    onboardingComplete: true,
  });
  const backup = createBackup(config, new Date('2026-07-14T12:00:00Z'));
  assert.equal(backup.app, 'Meridian');
  assert.equal(backup.exportedAt, '2026-07-14T12:00:00.000Z');
  assert.deepEqual(parseBackup(JSON.stringify(backup)), config);
  assert.throws(() => parseBackup({ app: 'Something else', config }), /another application/);
  assert.throws(() => parseBackup({ app: 'Meridian', config: {} }), /no home timezone/);
});

test('detection resolves legacy timezone aliases reported by the browser', () => {
  // V8 reports these canonical IDs while the catalog uses current IANA names.
  assert.equal(getRepresentativeCity(cities, 'Asia/Calcutta')?.city, 'Kolkata');
  assert.equal(getRepresentativeCity(cities, 'Asia/Calcutta')?.tz, 'Asia/Kolkata');
  assert.equal(getRepresentativeCity(cities, 'Europe/Kiev')?.city, 'Kyiv');
  assert.equal(getRepresentativeCity(cities, 'Asia/Katmandu')?.city, 'Kathmandu');
  assert.equal(getRepresentativeCity(cities, 'America/Buenos_Aires')?.city, 'Buenos Aires');
  assert.equal(getRepresentativeCity(cities, 'Asia/Saigon')?.tz, 'Asia/Ho_Chi_Minh');
  assert.equal(getRepresentativeCity(cities, 'Asia/Rangoon')?.city, 'Yangon');
  assert.equal(getRepresentativeCity(cities, 'UTC'), null);
  const systemAliases = [...new Set(cities.map(city => city.tz))]
    .map(tz => new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone);
  for (const reported of systemAliases) {
    assert.ok(getRepresentativeCity(cities, reported), `${reported} should resolve to a catalog city`);
  }
});

test('configurations drop timezones the runtime cannot render', () => {
  assert.equal(isValidTimeZone('Europe/Paris'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
  const normalized = normalizeConfig({
    home: { city: 'Paris', country: 'FR', tz: 'Europe/Paris' },
    zones: [
      { tz: 'Mars/Olympus', cities: [{ city: 'Olympus', country: 'XX' }] },
      { tz: 'Europe/Paris', cities: [{ city: 'Paris', country: 'FR' }] },
    ],
    presets: [{ id: 'p', name: 'Broken', zones: [{ tz: 'Nowhere/Zone', cities: [{ city: 'X', country: 'XX' }] }] }],
  });
  assert.deepEqual(normalized.zones.map(zone => zone.tz), ['Europe/Paris']);
  assert.deepEqual(normalized.presets[0].zones, []);
  assert.throws(
    () => parseBackup({ app: 'Meridian', config: { home: { city: 'X', country: 'US', tz: 'Mars/Olympus' } } }),
    /no home timezone/,
  );
});

test('the home timezone keeps a column even at the timezone limit', () => {
  const zoneIds = [...new Set(cities.map(city => city.tz))].filter(tz => tz !== 'Pacific/Honolulu').slice(0, MAX_TIMEZONES);
  const normalized = normalizeConfig({
    home: { city: 'Honolulu', country: 'US', tz: 'Pacific/Honolulu' },
    zones: zoneIds.map(tz => ({ tz, cities: [{ city: tz, country: 'XX' }] })),
  });
  assert.equal(normalized.zones.length, MAX_TIMEZONES);
  assert.ok(normalized.zones.some(zone => zone.tz === 'Pacific/Honolulu'));
});

test('importing a backup never opts this browser into Chrome Sync', () => {
  const synced = createBackup(normalizeConfig({
    home: { city: 'Paris', country: 'FR', tz: 'Europe/Paris' },
    storageMode: 'sync',
    onboardingComplete: true,
  }));
  assert.equal(parseBackup(synced).storageMode, 'local');
  assert.equal(parseBackup(synced, { storageMode: 'local' }).storageMode, 'local');
  assert.equal(parseBackup(synced, { storageMode: 'sync' }).storageMode, 'sync');
});

test('sub-hour home offsets are labelled in minutes', () => {
  assert.equal(formatRelativeOffset(570, 600), '−30m');
  assert.equal(formatRelativeOffset(600, 570), '+30m');
  assert.equal(formatRelativeOffset(345, 300), '+45m');
});

test('bundled solar coordinates describe each zone rather than its link target', () => {
  const expectations = {
    'Atlantic/Reykjavik': [64, 65],
    'Europe/Oslo': [59, 60.5],
    'Europe/Stockholm': [59, 60],
    'Europe/Copenhagen': [55, 56],
    'Europe/Amsterdam': [52, 53],
    'Indian/Reunion': [-21.5, -20],
    'Antarctica/Syowa': [-70, -68],
    'Asia/Kolkata': [22, 23],
  };
  for (const [timeZone, [min, max]] of Object.entries(expectations)) {
    const { latitude } = coordinates[timeZone];
    assert.ok(latitude >= min && latitude <= max, `${timeZone} latitude ${latitude} outside ${min}…${max}`);
  }
});

test('solar palette stays in daylight when a summer sunset falls after midnight', () => {
  const reykjavik = coordinates['Atlantic/Reykjavik'];
  const midsummer = new Date('2026-06-21T13:00:00Z');
  const solar = getSolarTimes('Atlantic/Reykjavik', reykjavik, midsummer);
  assert.ok(solar.sunset < solar.sunrise, 'fixture should wrap past local midnight');
  const noon = getSolarAdjustedHour(13, solar);
  assert.ok(noon > 10 && noon < 14, `13:00 should map near midday, got ${noon}`);
  assert.ok(Math.abs(getSolarAdjustedHour(solar.sunrise, solar) - 5) < 1e-9);
  assert.ok(Math.abs(getSolarAdjustedHour(solar.sunset, solar) - 19) < 1e-9);

  // The mapping advances continuously through the day for ordinary and wrapped days.
  for (const [timeZone, iso] of [['Atlantic/Reykjavik', '2026-06-21T12:00:00Z'], ['Europe/Paris', '2026-12-21T12:00:00Z'], ['Asia/Tokyo', '2026-03-20T03:00:00Z']]) {
    const times = getSolarTimes(timeZone, coordinates[timeZone], new Date(iso));
    let previous = getSolarAdjustedHour(times.sunrise, times);
    for (let step = 1; step <= 96; step++) {
      const hour = (times.sunrise + step / 4) % 24;
      const value = getSolarAdjustedHour(hour, times);
      const advance = ((value - previous) % 24 + 24) % 24;
      assert.ok(advance > 0 && advance < 2, `${timeZone} jumped ${advance}h at ${hour.toFixed(2)}`);
      previous = value;
    }
  }
  // 13:00 in a Reykjavik midsummer renders daylight, not the dusk palette.
  assert.equal(getZonedDateParts('Atlantic/Reykjavik', midsummer).hour, 13);
  const { top, bottom } = getSolarGradientColors('Atlantic/Reykjavik', reykjavik, midsummer);
  assert.equal(getTextColor(top, bottom), 'rgb(0, 0, 0)', 'midday palette is light enough for dark text');
});
