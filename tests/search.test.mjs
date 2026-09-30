import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  TIMEZONE_ABBREVIATIONS,
  createSearchEntry,
  getTimeInZone,
  getTimeZoneSearchNames,
  prefers24HourClock,
  resolveLocale,
  searchEntries,
} from '../core.js';

const cities = JSON.parse(await readFile(new URL('../data/cities.json', import.meta.url), 'utf8'));
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const zoneNames = new Map();
const date = new Date('2026-01-15T12:00:00Z');
// Built the way the page builds its index, with English names.
const entries = cities.map(city => {
  if (!zoneNames.has(city.tz)) zoneNames.set(city.tz, getTimeZoneSearchNames(city.tz, 'en', date));
  return createSearchEntry(city, { countries: [regionNames.of(city.country)], zoneNames: zoneNames.get(city.tz) });
});
const search = query => searchEntries(entries, query);
const first = query => search(query)[0];

test('every abbreviation refers to catalog timezones', () => {
  const zones = new Set(cities.map(city => city.tz));
  for (const [abbreviation, list] of Object.entries(TIMEZONE_ABBREVIATIONS)) {
    assert.ok(list.length > 0, abbreviation);
    for (const zone of list) assert.ok(zones.has(zone), `${abbreviation} lists unknown zone ${zone}`);
  }
});

test('capitalized abbreviations find their timezone first', () => {
  assert.equal(first('IST').tz, 'Asia/Kolkata');
  assert.equal(first('JST').tz, 'Asia/Tokyo');
  assert.equal(first('CET').tz, 'Europe/Paris');
  assert.equal(first('AEST').tz, 'Australia/Sydney');
  assert.equal(first('BST').tz, 'Europe/London');
  assert.equal(first('PST').tz, 'America/Los_Angeles');
  assert.equal(first('SGT').tz, 'Asia/Singapore');
  assert.deepEqual(search('IST').slice(0, 3).map(city => city.city), ['Kolkata', 'Dublin', 'Jerusalem'],
    'each IST zone is offered before more cities in the first one');
  const cet = search('CET');
  assert.equal(new Set(cet.map(city => city.tz)).size, cet.length, 'CET lists twelve different zones');
});

test('lowercase queries still prefer cities that start with them', () => {
  assert.equal(first('ist').city, 'Istanbul');
  assert.ok(search('ist').some(city => city.tz === 'Asia/Kolkata'), 'India follows the city matches');
  assert.equal(first('lon').city, 'London');
  const lon = search('lon').map(city => city.city);
  assert.ok(lon.indexOf('Birmingham') < lon.indexOf('Blanc-Sablon') || !lon.includes('Blanc-Sablon'),
    'a timezone-name match outranks a mid-word substring');
});

test('city names outrank countries, timezone names, and IDs', () => {
  assert.equal(first('paris').city, 'Paris');
  assert.equal(first('new y').city, 'New York');
  assert.equal(first('sao paulo').city, 'Sao Paulo', 'accents and case are ignored');
  assert.equal(first('united k').country, 'GB');
  assert.equal(first('pacific time').tz, 'America/Los_Angeles', 'a timezone name beats Pacific/ IDs');
  assert.equal(first('utc+5:30').tz, 'Asia/Kolkata');
  assert.equal(first('america/new_york').tz, 'America/New_York');
  assert.deepEqual(search('zzqx'), []);
  assert.deepEqual(search('   '), []);
});

test('each city appears once and results are capped', () => {
  const results = search('a');
  assert.equal(results.length, 12);
  assert.equal(new Set(results.map(city => `${city.city}|${city.country}`)).size, 12);
});

test('browser languages map to catalogs and regional formats', () => {
  assert.deepEqual(resolveLocale('en-GB'), { language: 'en', messageLocale: 'en', formatLocale: 'en-GB' });
  assert.deepEqual(resolveLocale('en-US'), { language: 'en', messageLocale: 'en', formatLocale: 'en-US' });
  assert.deepEqual(resolveLocale('es'), { language: 'es', messageLocale: 'es', formatLocale: 'es' });
  assert.deepEqual(resolveLocale('es-ES'), { language: 'es', messageLocale: 'es', formatLocale: 'es-ES' });
  assert.deepEqual(resolveLocale('es-AR'), { language: 'es', messageLocale: 'es_419', formatLocale: 'es-AR' });
  assert.deepEqual(resolveLocale('es_419'), { language: 'es', messageLocale: 'es_419', formatLocale: 'es-419' });
  assert.deepEqual(resolveLocale('fr-CA'), { language: 'fr', messageLocale: 'fr', formatLocale: 'fr-CA' });
  assert.deepEqual(resolveLocale('de-DE'), { language: 'en', messageLocale: 'en', formatLocale: 'en' });
  assert.deepEqual(resolveLocale(''), { language: 'en', messageLocale: 'en', formatLocale: 'en' });
  assert.deepEqual(resolveLocale('not a tag!'), { language: 'en', messageLocale: 'en', formatLocale: 'en' });

  const british = getTimeInZone('Europe/London', resolveLocale('en-GB').formatLocale, new Date('2026-07-14T12:00:00Z')).dateLabel;
  assert.ok(british.indexOf('14') < british.indexOf('Jul'), `UK dates put the day first: ${british}`);
});

test('the default clock format follows the locale', () => {
  assert.equal(prefers24HourClock('en-US'), false);
  assert.equal(prefers24HourClock('en'), false);
  assert.equal(prefers24HourClock('en-GB'), true);
  assert.equal(prefers24HourClock('fr'), true);
  assert.equal(prefers24HourClock('es'), true);
  assert.equal(prefers24HourClock('not a tag!'), false);
});
