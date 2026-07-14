import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  '/usr/share/zoneinfo/zone1970.tab',
  '/usr/share/zoneinfo/zone.tab',
  '/usr/share/zoneinfo.default/zone.tab',
  '/var/db/timezone/zoneinfo/zone.tab',
];

async function firstReadable(paths) {
  for (const candidate of paths) {
    try {
      return { path: candidate, text: await readFile(candidate, 'utf8') };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('No IANA zone.tab file was found on this system.');
}

function parseCoordinate(value) {
  const match = value.match(/^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/);
  if (!match) throw new Error(`Unsupported zone.tab coordinate: ${value}`);
  const latitude = Number(match[2]) + Number(match[3]) / 60 + Number(match[4] || 0) / 3600;
  const longitude = Number(match[6]) + Number(match[7]) / 60 + Number(match[8] || 0) / 3600;
  return {
    latitude: Number(((match[1] === '-' ? -1 : 1) * latitude).toFixed(4)),
    longitude: Number(((match[5] === '-' ? -1 : 1) * longitude).toFixed(4)),
  };
}

const { path: sourcePath, text } = await firstReadable(candidates);
const coordinates = new Map();
for (const line of text.split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [, coordinate, timeZone] = line.split('\t');
  coordinates.set(timeZone, parseCoordinate(coordinate));
}

const tzdataPath = path.join(path.dirname(sourcePath), 'tzdata.zi');
try {
  const tzdata = await readFile(tzdataPath, 'utf8');
  const aliases = new Map();
  for (const line of tzdata.split('\n')) {
    const match = line.match(/^L\s+(\S+)\s+(\S+)$/);
    if (match) aliases.set(match[2], match[1]);
  }
  for (const [alias, initialTarget] of aliases) {
    let target = initialTarget;
    const visited = new Set([alias]);
    while (aliases.has(target) && !visited.has(target)) {
      visited.add(target);
      target = aliases.get(target);
    }
    if (coordinates.has(target)) coordinates.set(alias, coordinates.get(target));
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const cities = JSON.parse(await readFile(path.join(root, 'data/cities.json'), 'utf8'));
const usedZones = [...new Set(cities.map(city => city.tz))].sort();
const missing = usedZones.filter(timeZone => !coordinates.has(timeZone));
if (missing.length) throw new Error(`Missing coordinates for: ${missing.join(', ')}`);

const result = Object.fromEntries(usedZones.map(timeZone => [timeZone, coordinates.get(timeZone)]));
await writeFile(
  path.join(root, 'data/timezone-coordinates.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(`Generated coordinates for ${usedZones.length} timezones from ${sourcePath}.`);
