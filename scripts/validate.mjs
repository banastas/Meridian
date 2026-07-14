import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TIMEZONES,
  findAvailabilityWindows,
  getContrastRatio,
  getGradientColors,
  getRepresentativeCity,
  getSolarTimes,
  getTextColor,
  getOffsetMinutes,
  lerpColor,
  normalizeConfig,
} from '../core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validateDist = process.argv.includes('--dist');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

const manifest = await readJson('manifest.json');
const packageMetadata = await readJson('package.json');
invariant(manifest.manifest_version === 3, 'manifest_version must be 3.');
invariant(packageMetadata.version === manifest.version, 'package.json and manifest versions must match.');
invariant(manifest.default_locale === 'en', 'default_locale must be en.');
invariant(JSON.stringify(manifest.permissions) === JSON.stringify(['storage']), 'Only the storage permission is expected.');
invariant(manifest.chrome_url_overrides?.newtab === 'newtab.html', 'newtab override is missing.');

const localeNames = ['en', 'es', 'es_419', 'fr'];
const catalogs = Object.fromEntries(await Promise.all(localeNames.map(async locale => [
  locale,
  await readJson(`_locales/${locale}/messages.json`),
])));
const englishKeys = Object.keys(catalogs.en).sort();
for (const [locale, catalog] of Object.entries(catalogs)) {
  invariant(
    JSON.stringify(Object.keys(catalog).sort()) === JSON.stringify(englishKeys),
    `${locale} message keys do not match English.`,
  );
  invariant(catalog.extensionDescription.message.length <= 132, `${locale} description exceeds 132 characters.`);
}

const html = await readFile(path.join(root, 'newtab.html'), 'utf8');
const javascript = await readFile(path.join(root, 'newtab.js'), 'utf8');
const css = await readFile(path.join(root, 'newtab.css'), 'utf8');
const usedMessageKeys = new Set([
  ...[...html.matchAll(/data-i18n(?:-title|-placeholder|-aria-label)?="([^"]+)"/g)].map(match => match[1]),
  ...[...javascript.matchAll(/\bt\('([^']+)'/g)].map(match => match[1]),
]);
for (const key of usedMessageKeys) invariant(catalogs.en[key], `Missing English message: ${key}`);

invariant(/role="dialog" aria-modal="true"/.test(html), 'Dialogs need modal semantics.');
invariant(/role="combobox"/.test(html) && /role="listbox"/.test(html), 'Search needs combobox/listbox semantics.');
invariant(/role="status" aria-live="polite"/.test(html), 'Toast needs an aria-live status role.');
invariant(/id="time-slider"[^>]+max="2880"[^>]+step="15"/.test(html), 'Time travel must cover 48 hours in 15-minute steps.');
for (const control of ['time-travel-btn', 'availability-toggle', 'edit-btn', 'export-btn', 'import-btn']) {
  invariant(html.includes(`id="${control}"`), `Missing product control: ${control}`);
}
invariant(/:focus-visible/.test(css) && /:focus-within/.test(css), 'Visible keyboard focus styles are required.');
invariant(/prefers-reduced-motion/.test(css) && /forced-colors/.test(css), 'Motion and forced-color preferences must be supported.');
invariant(!/toLocaleString\(/.test(javascript), 'Timezone offsets must not reparse localized strings.');
invariant(!/https?:\/\//.test(`${html}\n${javascript}\n${css}`), 'Runtime files must not make external requests.');
for (const shortcut of ["event.key === '/'", "event.key.toLowerCase() === 't'", "event.key.toLowerCase() === 'e'", "event.key === ','"]) {
  invariant(javascript.includes(shortcut), `Missing keyboard shortcut contract: ${shortcut}`);
}

const cities = await readJson('data/cities.json');
const cityKeys = cities.map(city => `${city.city}|${city.country}`);
invariant(cityKeys.length === new Set(cityKeys).size, 'City/country entries must be unique.');
for (const city of cities) {
  new Intl.DateTimeFormat('en', { timeZone: city.tz }).format();
}

const cityKeySet = new Set(cityKeys);
const cityLocalizations = await readJson('data/city-locales.json');
for (const [locale, localization] of Object.entries(cityLocalizations)) {
  for (const key of [...Object.keys(localization.names || {}), ...Object.keys(localization.aliases || {})]) {
    invariant(cityKeySet.has(key), `${locale} localization references unknown city ${key}.`);
  }
}

const timezoneCoordinates = await readJson('data/timezone-coordinates.json');
const timeZones = [...new Set(cities.map(city => city.tz))];
invariant(Object.keys(timezoneCoordinates).length === timeZones.length, 'Coordinate map must match the used timezone set.');
for (const timeZone of timeZones) {
  const coordinate = timezoneCoordinates[timeZone];
  invariant(Number.isFinite(coordinate?.latitude) && Number.isFinite(coordinate?.longitude), `Missing coordinates for ${timeZone}.`);
  invariant(coordinate.latitude >= -90 && coordinate.latitude <= 90, `Invalid latitude for ${timeZone}.`);
  invariant(coordinate.longitude >= -180 && coordinate.longitude <= 180, `Invalid longitude for ${timeZone}.`);
}
invariant(getSolarTimes('Europe/Paris', timezoneCoordinates['Europe/Paris'], new Date('2026-07-14')), 'Solar calculation failed.');

for (const { tz, city } of DEFAULT_TIMEZONES) {
  invariant(getRepresentativeCity(cities, tz, city)?.city === city, `Default ${tz} must resolve to ${city}.`);
}
invariant(getRepresentativeCity(cities, 'Europe/Paris')?.city === 'Paris', 'Europe/Paris detection must resolve to Paris.');

const transitionCases = [
  ['2026-03-29T00:30:00Z', 'Africa/Addis_Ababa', 180],
  ['2026-03-29T01:30:00Z', 'Europe/Paris', 120],
  ['2026-10-25T01:30:00Z', 'Africa/Johannesburg', 120],
];
for (const [timestamp, timeZone, expected] of transitionCases) {
  invariant(getOffsetMinutes(timeZone, new Date(timestamp)) === expected, `${timeZone} offset failed at ${timestamp}.`);
}

const normalizedConfig = normalizeConfig({
  home: { city: 'Paris', country: 'FR', tz: 'Europe/Paris' },
  zones: [{ tz: 'Europe/Paris', cities: [{ city: 'Paris', country: 'FR' }] }],
});
invariant(normalizedConfig.schemaVersion === 2 && normalizedConfig.zones[0].workingHours, 'Versioned config migration failed.');
invariant(findAvailabilityWindows(normalizedConfig.zones, new Date(), { horizonMinutes: 60 }).length <= 1, 'Availability scan failed.');

let minimumContrast = Infinity;
for (let minute = 0; minute < 1440; minute++) {
  const gradient = getGradientColors(Math.floor(minute / 60), minute % 60);
  const background = lerpColor(gradient.top, gradient.bottom, 0.5);
  const foreground = getTextColor(gradient.top, gradient.bottom) === 'rgb(0, 0, 0)'
    ? [0, 0, 0]
    : [255, 255, 255];
  minimumContrast = Math.min(minimumContrast, getContrastRatio(foreground, background));
}
invariant(minimumContrast >= 4.5, `Minimum text contrast is ${minimumContrast.toFixed(2)}:1.`);

const readme = await readFile(path.join(root, 'README.md'), 'utf8');
invariant(readme.includes(`**${cities.length} cities**`), `README city count must be ${cities.length}.`);

if (validateDist) {
  const packageRoot = path.join(root, 'dist', 'meridian');
  const zipPath = path.join(root, 'dist', `meridian-${manifest.version}.zip`);
  const sourceFiles = [
    'LICENSE', 'core.js', 'manifest.json', 'newtab.css', 'newtab.html', 'newtab.js',
    ...(await listFiles(path.join(root, '_locales'), '_locales')),
    ...(await listFiles(path.join(root, 'data'), 'data')),
    ...((await listFiles(path.join(root, 'fonts'), 'fonts')).filter(file => file.endsWith('.ttf'))),
    ...((await listFiles(path.join(root, 'icons'), 'icons')).filter(file => /icon(?:16|48|128)\.png$/.test(file))),
  ].sort();
  const packagedFiles = (await listFiles(packageRoot)).sort();
  invariant(JSON.stringify(packagedFiles) === JSON.stringify(sourceFiles), 'Packaged file inventory differs from runtime source inventory.');
  for (const relativePath of sourceFiles) {
    const [source, packaged] = await Promise.all([
      readFile(path.join(root, relativePath)),
      readFile(path.join(packageRoot, relativePath)),
    ]);
    invariant(source.equals(packaged), `Packaged file differs from source: ${relativePath}`);
  }
  invariant((await stat(zipPath)).isFile(), 'Release ZIP is missing.');
  const zipEntries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean).sort();
  invariant(zipEntries.includes('manifest.json'), 'Release ZIP manifest must be at the root.');
  invariant(!zipEntries.some(entry => entry.startsWith('meridian/')), 'Release ZIP must not wrap files in a meridian directory.');
  invariant(JSON.stringify(zipEntries) === JSON.stringify(sourceFiles), 'Release ZIP inventory differs from source inventory.');
}

console.log(`Validated source${validateDist ? ', packaged directory, and release ZIP' : ''}: ${cities.length} cities, ${new Set(cities.map(city => city.tz)).size} timezones, ${localeNames.length} locales, minimum contrast ${minimumContrast.toFixed(2)}:1.`);
