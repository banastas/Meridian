import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directories = [
  '/usr/share/zoneinfo',
  '/usr/share/zoneinfo.default',
  '/var/db/timezone/zoneinfo',
];
// zone.tab lists every zone at its own location. zone1970.tab omits zones
// merged since 1970 (Europe/Oslo, Atlantic/Reykjavik), so it only fills gaps.
const tabFiles = ['zone.tab', 'zone1970.tab'];

async function readOptional(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function findZoneTables() {
  for (const directory of directories) {
    const tables = [];
    for (const file of tabFiles) {
      const text = await readOptional(path.join(directory, file));
      if (text !== null) tables.push({ path: path.join(directory, file), text });
    }
    if (tables.length) return { directory, tables };
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

const { directory, tables } = await findZoneTables();
const coordinates = new Map();
for (const { text } of tables) {
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [, coordinate, timeZone] = line.split('\t');
    if (!coordinates.has(timeZone)) coordinates.set(timeZone, parseCoordinate(coordinate));
  }
}

// Links only supply coordinates for zones without an entry of their own; a
// link target can be thousands of kilometres away (Atlantic/Reykjavik links
// to Africa/Abidjan).
const tzdata = await readOptional(path.join(directory, 'tzdata.zi'));
if (tzdata !== null) {
  const aliases = new Map();
  for (const line of tzdata.split('\n')) {
    const match = line.match(/^L\s+(\S+)\s+(\S+)$/);
    if (match) aliases.set(match[2], match[1]);
  }
  for (const [alias, initialTarget] of aliases) {
    if (coordinates.has(alias)) continue;
    let target = initialTarget;
    const visited = new Set([alias]);
    while (aliases.has(target) && !visited.has(target)) {
      visited.add(target);
      target = aliases.get(target);
    }
    if (coordinates.has(target)) coordinates.set(alias, coordinates.get(target));
  }
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
console.log(`Generated coordinates for ${usedZones.length} timezones from ${tables.map(table => table.path).join(' and ')}.`);
