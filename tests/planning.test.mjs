import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPresetSnapshot,
  findAvailabilityWindows,
  floorToStep,
  getDayStarts,
  getDefaultWorkingDays,
  isZoneAvailableAt,
  normalizeConfig,
  PLANNER_RANGE_MINUTES,
} from '../core.js';

const nineToFive = days => ({ enabled: true, start: 9 * 60, end: 17 * 60, days });

test('default working days follow the region work week', () => {
  assert.deepEqual(getDefaultWorkingDays('FR'), [1, 2, 3, 4, 5]);
  assert.deepEqual(getDefaultWorkingDays('us'), [1, 2, 3, 4, 5]);
  assert.deepEqual(getDefaultWorkingDays('IL'), [0, 1, 2, 3, 4], 'Israel works Sunday to Thursday');
  assert.deepEqual(getDefaultWorkingDays('SA'), [0, 1, 2, 3, 4]);
  assert.deepEqual(getDefaultWorkingDays('IR'), [0, 1, 2, 3, 4, 6], 'Iran rests on Friday only');
  assert.deepEqual(getDefaultWorkingDays('XX'), [1, 2, 3, 4, 5]);
  assert.deepEqual(getDefaultWorkingDays(undefined), [1, 2, 3, 4, 5]);
  const days = getDefaultWorkingDays('FR');
  days.push(6);
  assert.deepEqual(getDefaultWorkingDays('FR'), [1, 2, 3, 4, 5], 'callers cannot mutate the cache');
});

test('stored working days are repaired and default by country', () => {
  const normalized = normalizeConfig({
    home: { city: 'Paris', country: 'FR', tz: 'Europe/Paris' },
    zones: [
      { tz: 'Asia/Jerusalem', cities: [{ city: 'Tel Aviv', country: 'IL' }] },
      { tz: 'Europe/Paris', cities: [{ city: 'Paris', country: 'FR' }], workingHours: { days: [5, 1, 1, 9, 'x', 3] } },
      { tz: 'Asia/Tokyo', cities: [{ city: 'Tokyo', country: 'JP' }], workingHours: { days: [] } },
    ],
  });
  const days = Object.fromEntries(normalized.zones.map(zone => [zone.tz, zone.workingHours.days]));
  assert.deepEqual(days['Asia/Jerusalem'], [0, 1, 2, 3, 4]);
  assert.deepEqual(days['Europe/Paris'], [1, 3, 5]);
  assert.deepEqual(days['Asia/Tokyo'], [1, 2, 3, 4, 5], 'an empty list falls back to the default');
});

test('availability respects working days and overnight shifts', () => {
  const paris = { tz: 'Europe/Paris', workingHours: nineToFive([1, 2, 3, 4, 5]) };
  assert.equal(isZoneAvailableAt(paris, new Date('2026-07-13T08:00:00Z')), true, 'Monday 10:00');
  assert.equal(isZoneAvailableAt(paris, new Date('2026-07-18T08:00:00Z')), false, 'Saturday 10:00');
  assert.equal(isZoneAvailableAt(paris, new Date('2026-07-13T16:00:00Z')), false, 'Monday 18:00');

  const nights = { tz: 'Europe/Paris', workingHours: { enabled: true, start: 22 * 60, end: 6 * 60, days: [1, 2, 3, 4, 5] } };
  assert.equal(isZoneAvailableAt(nights, new Date('2026-07-18T00:00:00Z')), true, 'Saturday 02:00 finishes the Friday shift');
  assert.equal(isZoneAvailableAt(nights, new Date('2026-07-19T00:00:00Z')), false, 'Sunday 02:00 would be a Saturday shift');
  assert.equal(isZoneAvailableAt(nights, new Date('2026-07-17T21:00:00Z')), true, 'Friday 23:00');
  assert.equal(isZoneAvailableAt(nights, new Date('2026-07-18T21:00:00Z')), false, 'Saturday 23:00');

  const legacy = { tz: 'Europe/Paris', workingHours: { enabled: true, start: 540, end: 1020 } };
  assert.equal(isZoneAvailableAt(legacy, new Date('2026-07-18T08:00:00Z')), true, 'schedules without days keep every day');
  const off = { tz: 'Europe/Paris', workingHours: { ...nineToFive([1]), enabled: false } };
  assert.equal(isZoneAvailableAt(off, new Date('2026-07-18T08:00:00Z')), true);
});

test('shared availability skips the weekend', () => {
  const zones = [
    { tz: 'Europe/Paris', workingHours: nineToFive([1, 2, 3, 4, 5]) },
    { tz: 'America/New_York', workingHours: nineToFive([1, 2, 3, 4, 5]) },
  ];
  const friday = new Date('2026-07-17T12:00:00Z');
  const windows = findAvailabilityWindows(zones, friday, { horizonMinutes: 4 * 24 * 60 });
  assert.deepEqual(windows.map(window => window.start.toISOString()), [
    '2026-07-17T13:00:00.000Z',
    '2026-07-20T13:00:00.000Z',
  ]);
});

test('preset snapshots copy working days', () => {
  const config = normalizeConfig({
    home: { city: 'Paris', country: 'FR', tz: 'Europe/Paris' },
    zones: [{ tz: 'Europe/Paris', cities: [{ city: 'Paris', country: 'FR' }] }],
  });
  const snapshot = createPresetSnapshot(config);
  config.zones[0].workingHours.days.push(6);
  assert.deepEqual(snapshot.zones[0].workingHours.days, [1, 2, 3, 4, 5]);
});

test('the planner grid lands on quarter hours and finds local midnights across DST', () => {
  assert.equal(new Date(floorToStep(Date.parse('2026-10-24T12:07:31Z'))).toISOString(), '2026-10-24T12:00:00.000Z');
  assert.equal(floorToStep(Date.parse('2026-10-24T12:15:00Z')), Date.parse('2026-10-24T12:15:00Z'));

  // 25 October 2026 is 25 hours long in London.
  const origin = floorToStep(Date.parse('2026-10-24T12:07:00Z'));
  const starts = getDayStarts('Europe/London', origin, PLANNER_RANGE_MINUTES);
  assert.deepEqual(starts.map(start => start.at.toISOString()), [
    '2026-10-24T23:00:00.000Z',
    '2026-10-26T00:00:00.000Z',
  ]);
  assert.deepEqual(starts.map(start => start.minutes), [660, 2160]);

  const kathmandu = getDayStarts('Asia/Kathmandu', floorToStep(Date.parse('2026-07-14T00:00:00Z')), 24 * 60);
  assert.equal(kathmandu[0].at.toISOString(), '2026-07-14T18:15:00.000Z', 'UTC+5:45 midnights stay exact');
});
