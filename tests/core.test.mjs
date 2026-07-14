import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DEFAULT_WORKING_HOURS,
  DEFAULT_TIMEZONES,
  areZonesAvailable,
  calculateLayoutWidth,
  calculateTimeFontSize,
  createBackup,
  createPresetSnapshot,
  findAvailabilityWindows,
  formatRelativeOffset,
  formatUtcOffset,
  getCelestialState,
  getContrastRatio,
  getGradientColors,
  getLocalMinuteOfDay,
  getNextOffsetTransition,
  getOffsetMinutes,
  getRepresentativeCity,
  getSolarAdjustedHour,
  getSolarGradientColors,
  getSolarTimes,
  getTextColor,
  getTimeInZone,
  isMinuteWithinHours,
  lerpColor,
  normalizeConfig,
  parseBackup,
} from '../core.js';

const cities = JSON.parse(await readFile(new URL('../data/cities.json', import.meta.url), 'utf8'));

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

test('stored configurations repair a missing home column and malformed values', () => {
  const normalized = normalizeConfig({
    home: { city: 'Paris', country: 'FR', tz: 'Europe/Paris' },
    zones: [{ tz: 'Asia/Tokyo', cities: [{ city: 'Tokyo', country: 'JP' }] }],
    use24h: 1,
    showSeconds: true,
  });
  assert.deepEqual(normalized.zones.at(-1), {
    tz: 'Europe/Paris',
    workingHours: { ...DEFAULT_WORKING_HOURS },
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
  assert.equal(getCelestialState('Europe/Paris', paris, new Date('2026-06-21T12:00:00Z')).kind, 'sun');
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
  assert.deepEqual(normalized.zones[0].workingHours, { enabled: true, start: 0, end: 1439 });
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
