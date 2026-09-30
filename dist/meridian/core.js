/* ============================================
   Meridian — Shared, testable application logic
   ============================================ */

export const COLOR_BANDS = [
  { top: [15, 15, 40], bottom: [20, 18, 35] },
  { top: [20, 18, 35], bottom: [25, 22, 50] },
  { top: [30, 25, 60], bottom: [55, 40, 80] },
  { top: [80, 55, 100], bottom: [180, 120, 130] },
  { top: [200, 150, 100], bottom: [220, 180, 110] },
  { top: [235, 210, 140], bottom: [245, 235, 190] },
  { top: [250, 240, 200], bottom: [248, 238, 195] },
  { top: [240, 210, 150], bottom: [225, 180, 110] },
  { top: [215, 160, 100], bottom: [200, 120, 95] },
  { top: [180, 100, 90], bottom: [120, 70, 100] },
  { top: [80, 55, 95], bottom: [45, 40, 75] },
  { top: [35, 30, 65], bottom: [18, 16, 42] },
];

export const DEFAULT_TIMEZONES = [
  { tz: 'America/Los_Angeles', city: 'Los Angeles' },
  { tz: 'America/New_York', city: 'New York' },
  { tz: 'Europe/London', city: 'London' },
  { tz: 'Europe/Berlin', city: 'Berlin' },
  { tz: 'Asia/Tokyo', city: 'Tokyo' },
];

export const MIN_COLUMN_WIDTH = 150;
export const MAX_TIMEZONES = 10;
export const MAX_PRESETS = 12;
export const CONFIG_SCHEMA_VERSION = 2;
export const DEFAULT_WORKING_HOURS = Object.freeze({ enabled: true, start: 9 * 60, end: 17 * 60 });
export const DEFAULT_PREFERENCES = Object.freeze({
  use24h: false,
  showSeconds: false,
  infoDensity: 'standard',
  visualTheme: 'clock',
  atmosphericMotion: true,
  availabilityEnabled: false,
  storageMode: 'local',
});

const offsetFormatterCache = new Map();
const dateFormatterCache = new Map();
const timeFormatterCache = new Map();
const canonicalTimeZoneCache = new Map();

// Returns the engine's canonical ID, or null when the runtime rejects the zone.
export function getCanonicalTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return null;
  if (!canonicalTimeZoneCache.has(timeZone)) {
    let canonical = null;
    try {
      canonical = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
    } catch { /* unknown or malformed timezone */ }
    canonicalTimeZoneCache.set(timeZone, canonical);
  }
  return canonicalTimeZoneCache.get(timeZone);
}

export function isValidTimeZone(timeZone) {
  return getCanonicalTimeZone(timeZone) !== null;
}

export function lerpColor(a, b, amount) {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

export function lerpColorRound(a, b, amount) {
  return lerpColor(a, b, amount).map(Math.round);
}

export function getSmoothGradientStops(colors, subdivisions = 16) {
  if (!Array.isArray(colors) || colors.length === 0) return [];
  if (colors.length === 1) {
    return [{ offset: 0, color: [...colors[0]] }, { offset: 1, color: [...colors[0]] }];
  }

  const steps = Math.max(1, Math.floor(subdivisions));
  const stops = [{ offset: 0, color: [...colors[0]] }];
  for (let index = 0; index < colors.length - 1; index++) {
    for (let step = 0; step <= steps; step++) {
      const raw = step / steps;
      const smooth = raw * raw * (3 - 2 * raw);
      stops.push({
        offset: (index + 0.5 + raw) / colors.length,
        color: lerpColor(colors[index], colors[index + 1], smooth),
      });
    }
  }
  stops.push({ offset: 1, color: [...colors.at(-1)] });
  return stops;
}

export function getGradientColors(hour, minute) {
  const bandIndex = Math.floor(hour / 2);
  const nextBandIndex = (bandIndex + 1) % COLOR_BANDS.length;
  const minutesIntoBand = (hour % 2) * 60 + minute;
  const amount = minutesIntoBand / 120;
  const currentBand = COLOR_BANDS[bandIndex];
  const nextBand = COLOR_BANDS[nextBandIndex];

  return {
    top: lerpColor(currentBand.top, nextBand.top, amount),
    bottom: lerpColor(currentBand.bottom, nextBand.bottom, amount),
  };
}

function linearChannel(value) {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function getRelativeLuminance(color) {
  return (
    0.2126 * linearChannel(color[0]) +
    0.7152 * linearChannel(color[1]) +
    0.0722 * linearChannel(color[2])
  );
}

export function getContrastRatio(foreground, background) {
  const foregroundLuminance = getRelativeLuminance(foreground);
  const backgroundLuminance = getRelativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function getTextColor(topColor, bottomColor) {
  const background = lerpColor(topColor, bottomColor, 0.5);
  const black = [0, 0, 0];
  const white = [255, 255, 255];
  return getContrastRatio(black, background) >= getContrastRatio(white, background)
    ? 'rgb(0, 0, 0)'
    : 'rgb(255, 255, 255)';
}

function getOffsetFormatter(timeZone) {
  if (!offsetFormatterCache.has(timeZone)) {
    offsetFormatterCache.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return offsetFormatterCache.get(timeZone);
}

export function getOffsetMinutes(timeZone, date = new Date()) {
  const parts = {};
  for (const { type, value } of getOffsetFormatter(timeZone).formatToParts(date)) {
    if (type !== 'literal') parts[type] = value;
  }

  const zonedTimestamp = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const sourceTimestamp = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((zonedTimestamp - sourceTimestamp) / 60000);
}

export function formatUtcOffset(offsetMinutes) {
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const sign = offsetMinutes >= 0 ? '+' : '−';
  return minutes
    ? `UTC${sign}${hours}:${String(minutes).padStart(2, '0')}`
    : `UTC${sign}${hours}`;
}

export function formatRelativeOffset(offsetMinutes, homeOffsetMinutes) {
  const difference = offsetMinutes - homeOffsetMinutes;
  if (difference === 0) return '';
  const absoluteMinutes = Math.abs(difference);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const sign = difference > 0 ? '+' : '−';
  if (!hours) return `${sign}${minutes}m`;
  return minutes ? `${sign}${hours}h ${minutes}m` : `${sign}${hours}h`;
}

export function sortZonesByUtcOffset(zones, date = new Date()) {
  return [...zones]
    .map((zone, index) => ({ zone, index, offset: getOffsetMinutes(zone.tz, date) }))
    .sort((a, b) => a.offset - b.offset || a.index - b.index)
    .map(item => item.zone);
}

export function addZoneByUtcOffset(zones, zone, date = new Date()) {
  return sortZonesByUtcOffset([...zones, zone], date);
}

export function isDaylightSavingTime(timeZone, date = new Date()) {
  const year = date.getFullYear();
  const januaryOffset = getOffsetMinutes(timeZone, new Date(year, 0, 1, 12));
  const julyOffset = getOffsetMinutes(timeZone, new Date(year, 6, 1, 12));
  if (januaryOffset === julyOffset) return false;
  return getOffsetMinutes(timeZone, date) !== Math.min(januaryOffset, julyOffset);
}

export function getNextOffsetTransition(timeZone, date = new Date(), horizonDays = 30) {
  const start = new Date(date);
  const initialOffset = getOffsetMinutes(timeZone, start);
  const horizon = start.getTime() + horizonDays * 86400000;
  let low = start.getTime();

  for (let cursor = low + 6 * 3600000; cursor <= horizon; cursor += 6 * 3600000) {
    const offset = getOffsetMinutes(timeZone, new Date(cursor));
    if (offset === initialOffset) {
      low = cursor;
      continue;
    }

    let high = cursor;
    while (high - low > 60000) {
      const middle = Math.floor((low + high) / 120000) * 60000;
      if (getOffsetMinutes(timeZone, new Date(middle)) === initialOffset) low = middle;
      else high = middle;
    }
    return {
      at: new Date(high),
      fromOffset: initialOffset,
      toOffset: offset,
      deltaMinutes: offset - initialOffset,
    };
  }
  return null;
}

function formatterKey(locale, timeZone, options) {
  return `${locale}:${timeZone}:${JSON.stringify(options)}`;
}

function getCachedFormatter(cache, locale, timeZone, options) {
  const key = formatterKey(locale, timeZone, options);
  if (!cache.has(key)) {
    cache.set(key, new Intl.DateTimeFormat(locale, { timeZone, ...options }));
  }
  return cache.get(key);
}

export function getTimeInZone(timeZone, locale, date = new Date()) {
  const twelveHourOptions = {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  };
  const twentyFourHourOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  };
  const dateOptions = { weekday: 'short', month: 'short', day: 'numeric' };

  const twelveHourParts = {};
  for (const { type, value } of getCachedFormatter(
    timeFormatterCache,
    locale,
    timeZone,
    twelveHourOptions,
  ).formatToParts(date)) {
    twelveHourParts[type] = value;
  }

  const twentyFourHourParts = {};
  for (const { type, value } of getCachedFormatter(
    timeFormatterCache,
    'en-GB',
    timeZone,
    twentyFourHourOptions,
  ).formatToParts(date)) {
    twentyFourHourParts[type] = value;
  }

  return {
    hour12: twelveHourParts.hour,
    minute: twelveHourParts.minute,
    second: twelveHourParts.second,
    ampm: twelveHourParts.dayPeriod || '',
    hour24: Number(twentyFourHourParts.hour),
    minute24: Number(twentyFourHourParts.minute),
    dateLabel: getCachedFormatter(
      dateFormatterCache,
      locale,
      timeZone,
      dateOptions,
    ).format(date),
  };
}

export function getZonedDateParts(timeZone, date = new Date()) {
  const parts = {};
  for (const { type, value } of getOffsetFormatter(timeZone).formatToParts(date)) {
    if (type !== 'literal') parts[type] = Number(value);
  }
  return parts;
}

export function getLocalMinuteOfDay(timeZone, date = new Date()) {
  const parts = getZonedDateParts(timeZone, date);
  return parts.hour * 60 + parts.minute;
}

export function isMinuteWithinHours(minute, hours = DEFAULT_WORKING_HOURS) {
  if (!hours.enabled) return true;
  if (hours.start === hours.end) return true;
  if (hours.start < hours.end) return minute >= hours.start && minute < hours.end;
  return minute >= hours.start || minute < hours.end;
}

const workingDaysCache = new Map();

// Working days use JavaScript weekday numbers (0 = Sunday). The default is
// the region's CLDR work week, so Tel Aviv works Sunday to Thursday.
export function getDefaultWorkingDays(region) {
  const key = typeof region === 'string' ? region.toUpperCase() : '';
  if (!workingDaysCache.has(key)) {
    let weekend = [6, 7];
    try {
      const locale = new Intl.Locale(`und-${key || '001'}`);
      const info = locale.getWeekInfo?.() ?? locale.weekInfo;
      if (Array.isArray(info?.weekend) && info.weekend.length) weekend = info.weekend;
    } catch { /* unknown region: Monday to Friday */ }
    // CLDR numbers ISO weekdays 1–7 from Monday.
    const weekendDays = new Set(weekend.map(day => day % 7));
    workingDaysCache.set(key, [0, 1, 2, 3, 4, 5, 6].filter(day => !weekendDays.has(day)));
  }
  return [...workingDaysCache.get(key)];
}

function getZonedWeekday(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function isZoneAvailableAt(zone, date = new Date()) {
  const hours = zone.workingHours || DEFAULT_WORKING_HOURS;
  if (!hours.enabled) return true;
  const parts = getZonedDateParts(zone.tz, date);
  const minute = parts.hour * 60 + parts.minute;
  if (!isMinuteWithinHours(minute, hours)) return false;
  if (!Array.isArray(hours.days)) return true;
  // The early-morning part of an overnight shift belongs to the day it began.
  const weekday = getZonedWeekday(parts);
  const shiftDay = hours.start > hours.end && minute < hours.end ? (weekday + 6) % 7 : weekday;
  return hours.days.includes(shiftDay);
}

export function areZonesAvailable(zones, date = new Date()) {
  return zones.length > 0 && zones.every(zone => isZoneAvailableAt(zone, date));
}

export function findAvailabilityWindows(zones, start = new Date(), options = {}) {
  const stepMinutes = options.stepMinutes || 15;
  const horizonMinutes = options.horizonMinutes || 48 * 60;
  const origin = Math.ceil(start.getTime() / (stepMinutes * 60000)) * stepMinutes * 60000;
  const samples = [];
  for (let minute = 0; minute <= horizonMinutes; minute += stepMinutes) {
    const at = new Date(origin + minute * 60000);
    samples.push({ at, available: areZonesAvailable(zones, at) });
  }

  const windows = [];
  let windowStart = null;
  for (const sample of samples) {
    if (sample.available && windowStart === null) windowStart = sample.at;
    if (!sample.available && windowStart !== null) {
      windows.push({ start: windowStart, end: sample.at });
      windowStart = null;
    }
  }
  if (windowStart !== null) {
    windows.push({ start: windowStart, end: new Date(origin + (horizonMinutes + stepMinutes) * 60000) });
  }
  return windows;
}

/* Planning
   Time travel moves along a fixed 15-minute grid so planned times land on the
   quarter hour, matching the grid availability windows are found on. */

export const PLANNER_STEP_MINUTES = 15;
export const PLANNER_RANGE_MINUTES = 48 * 60;

export function floorToStep(time, stepMinutes = PLANNER_STEP_MINUTES) {
  const step = stepMinutes * 60000;
  return Math.floor(time / step) * step;
}

// Local midnights after `origin`, sampled on the planner grid so they stay
// exact across DST changes. `minutes` is the distance from the origin.
export function getDayStarts(timeZone, origin, rangeMinutes = PLANNER_RANGE_MINUTES, stepMinutes = PLANNER_STEP_MINUTES) {
  const starts = [];
  let previous = getZonedDateParts(timeZone, new Date(origin)).day;
  for (let minutes = stepMinutes; minutes <= rangeMinutes; minutes += stepMinutes) {
    const at = new Date(origin + minutes * 60000);
    const { day } = getZonedDateParts(timeZone, at);
    if (day !== previous) starts.push({ minutes, at });
    previous = day;
  }
  return starts;
}

function dayOfYear(year, month, day) {
  return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86400000);
}

function normalizeHours(value) {
  return ((value % 24) + 24) % 24;
}

function calculateSolarUtcHour(year, month, day, latitude, longitude, sunrise) {
  const n = dayOfYear(year, month, day);
  const longitudeHour = longitude / 15;
  const approximate = n + ((sunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximate - 3.289;
  let trueLongitude = meanAnomaly + 1.916 * Math.sin(meanAnomaly * Math.PI / 180) +
    0.02 * Math.sin(2 * meanAnomaly * Math.PI / 180) + 282.634;
  trueLongitude = ((trueLongitude % 360) + 360) % 360;
  let rightAscension = Math.atan(0.91764 * Math.tan(trueLongitude * Math.PI / 180)) * 180 / Math.PI;
  rightAscension = ((rightAscension % 360) + 360) % 360;
  rightAscension += Math.floor(trueLongitude / 90) * 90 - Math.floor(rightAscension / 90) * 90;
  rightAscension /= 15;
  const sinDeclination = 0.39782 * Math.sin(trueLongitude * Math.PI / 180);
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHour = (Math.cos(90.833 * Math.PI / 180) -
    sinDeclination * Math.sin(latitude * Math.PI / 180)) /
    (cosDeclination * Math.cos(latitude * Math.PI / 180));
  if (cosHour > 1 || cosHour < -1) return null;
  let hourAngle = sunrise
    ? 360 - Math.acos(cosHour) * 180 / Math.PI
    : Math.acos(cosHour) * 180 / Math.PI;
  hourAngle /= 15;
  const localMeanTime = hourAngle + rightAscension - 0.06571 * approximate - 6.622;
  return normalizeHours(localMeanTime - longitudeHour);
}

export function getSolarTimes(timeZone, coordinates, date = new Date()) {
  if (!coordinates || !Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude)) {
    return null;
  }
  const { year, month, day } = getZonedDateParts(timeZone, date);
  const sunriseUtc = calculateSolarUtcHour(year, month, day, coordinates.latitude, coordinates.longitude, true);
  const sunsetUtc = calculateSolarUtcHour(year, month, day, coordinates.latitude, coordinates.longitude, false);
  if (sunriseUtc === null || sunsetUtc === null) return null;
  const midday = new Date(Date.UTC(year, month - 1, day, 12));
  const offsetHours = getOffsetMinutes(timeZone, midday) / 60;
  return {
    sunrise: normalizeHours(sunriseUtc + offsetHours),
    sunset: normalizeHours(sunsetUtc + offsetHours),
  };
}

// Maps local time onto the fixed palette: sunrise → 5, solar noon → 12,
// sunset → 19, and solar midnight → 24. Measuring from sunrise keeps the
// mapping continuous when a summer sunset falls after local midnight.
export function getSolarAdjustedHour(localHour, solarTimes) {
  if (!solarTimes) return localHour;
  const dayLength = normalizeHours(solarTimes.sunset - solarTimes.sunrise) || 24;
  const sinceSunrise = normalizeHours(localHour - solarTimes.sunrise);
  if (sinceSunrise <= dayLength) return 5 + 14 * (sinceSunrise / dayLength);
  const nightProgress = (sinceSunrise - dayLength) / Math.max(24 - dayLength, 0.01);
  return normalizeHours(19 + 10 * nightProgress);
}

export function getSolarGradientColors(timeZone, coordinates, date = new Date()) {
  const parts = getZonedDateParts(timeZone, date);
  const localHour = parts.hour + parts.minute / 60;
  const adjusted = getSolarAdjustedHour(localHour, getSolarTimes(timeZone, coordinates, date));
  const normalizedMinutes = Math.round(normalizeHours(adjusted) * 60) % 1440;
  return getGradientColors(Math.floor(normalizedMinutes / 60), normalizedMinutes % 60);
}

function normalizeCityName(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[._-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sharedPrefixLength(a, b) {
  let length = 0;
  while (length < a.length && a[length] === b[length]) length++;
  return length;
}

// Browsers may report a legacy alias (Asia/Calcutta) for a zone that the
// catalog lists by its current name (Asia/Kolkata). Pick the catalog zone in
// the same canonical group whose name is closest to the requested one.
function findAliasCandidates(cities, timeZone) {
  const canonical = getCanonicalTimeZone(timeZone);
  if (!canonical) return [];
  const aliases = cities.filter(city => getCanonicalTimeZone(city.tz) === canonical);
  if (aliases.length === 0) return [];
  const requested = normalizeCityName(timeZone.split('/').at(-1));
  const score = zone => {
    const name = normalizeCityName(zone.split('/').at(-1));
    return [name === requested ? 1 : 0, sharedPrefixLength(name, requested), aliases.filter(city => city.tz === zone).length];
  };
  const [best] = [...new Set(aliases.map(city => city.tz))].sort((a, b) => {
    const [left, right] = [score(a), score(b)];
    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
  });
  return aliases.filter(city => city.tz === best);
}

export function getRepresentativeCity(cities, timeZone, preferredCity = '') {
  let candidates = cities.filter(city => city.tz === timeZone);
  if (candidates.length === 0) candidates = findAliasCandidates(cities, timeZone);
  if (candidates.length === 0) return null;

  const preferredName = normalizeCityName(preferredCity);
  if (preferredName) {
    const preferred = candidates.find(city => normalizeCityName(city.city) === preferredName);
    if (preferred) return preferred;
  }

  const zoneName = normalizeCityName(candidates[0].tz.split('/').at(-1));
  return candidates.find(city => normalizeCityName(city.city) === zoneName) || candidates[0];
}

/* Search */

const PACIFIC = ['America/Los_Angeles', 'America/Vancouver', 'America/Tijuana'];
const MOUNTAIN = ['America/Denver', 'America/Edmonton', 'America/Boise', 'America/Phoenix'];
const CENTRAL = ['America/Chicago', 'America/Winnipeg', 'America/Mexico_City'];
const EASTERN = ['America/New_York', 'America/Toronto', 'America/Detroit'];
const CENTRAL_EUROPE = [
  'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Vienna',
  'Europe/Zurich', 'Europe/Stockholm', 'Europe/Oslo', 'Europe/Copenhagen', 'Europe/Prague', 'Europe/Warsaw', 'Europe/Budapest',
];
const EASTERN_EUROPE = [
  'Europe/Athens', 'Europe/Helsinki', 'Europe/Kyiv', 'Europe/Bucharest', 'Europe/Sofia', 'Europe/Riga', 'Europe/Vilnius',
  'Europe/Tallinn', 'Africa/Cairo',
];
const WESTERN_EUROPE = ['Europe/Lisbon', 'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Faroe'];
const EASTERN_AUSTRALIA = ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Hobart'];

// Abbreviations people type that ICU only provides in some locales, each
// listed with its zones in order of prominence.
export const TIMEZONE_ABBREVIATIONS = Object.freeze({
  PT: PACIFIC, PST: PACIFIC, PDT: PACIFIC,
  MT: MOUNTAIN, MST: MOUNTAIN, MDT: MOUNTAIN.slice(0, 3),
  CT: CENTRAL, CST: [...CENTRAL, 'Asia/Shanghai', 'Asia/Taipei'], CDT: CENTRAL.slice(0, 2),
  ET: EASTERN, EST: EASTERN, EDT: EASTERN,
  AKST: ['America/Anchorage'], AKDT: ['America/Anchorage'], HST: ['Pacific/Honolulu'],
  AST: ['America/Halifax', 'Asia/Riyadh'], ADT: ['America/Halifax'], NST: ['America/St_Johns'], NDT: ['America/St_Johns'],
  BRT: ['America/Sao_Paulo'], ART: ['America/Argentina/Buenos_Aires'], CLT: ['America/Santiago'],
  COT: ['America/Bogota'], PET: ['America/Lima'],
  GMT: ['Europe/London', 'Europe/Dublin', 'Atlantic/Reykjavik', 'Africa/Accra'],
  UTC: ['Atlantic/Reykjavik', 'Africa/Abidjan', 'Europe/London'],
  BST: ['Europe/London'], IST: ['Asia/Kolkata', 'Europe/Dublin', 'Asia/Jerusalem'],
  WET: WESTERN_EUROPE, WEST: WESTERN_EUROPE, CET: CENTRAL_EUROPE, CEST: CENTRAL_EUROPE,
  EET: EASTERN_EUROPE, EEST: EASTERN_EUROPE, MSK: ['Europe/Moscow'], TRT: ['Europe/Istanbul'],
  WAT: ['Africa/Lagos'], CAT: ['Africa/Maputo', 'Africa/Harare', 'Africa/Lusaka'],
  EAT: ['Africa/Nairobi', 'Africa/Addis_Ababa', 'Africa/Dar_es_Salaam'], SAST: ['Africa/Johannesburg'],
  GST: ['Asia/Dubai'], PKT: ['Asia/Karachi'], NPT: ['Asia/Kathmandu'], ICT: ['Asia/Bangkok', 'Asia/Ho_Chi_Minh'],
  WIB: ['Asia/Jakarta'], SGT: ['Asia/Singapore'], HKT: ['Asia/Hong_Kong'], PHT: ['Asia/Manila'],
  JST: ['Asia/Tokyo'], KST: ['Asia/Seoul'],
  AWST: ['Australia/Perth'], ACST: ['Australia/Adelaide', 'Australia/Darwin'], ACDT: ['Australia/Adelaide'],
  AEST: EASTERN_AUSTRALIA, AEDT: EASTERN_AUSTRALIA.filter(zone => zone !== 'Australia/Brisbane'),
  NZST: ['Pacific/Auckland'], NZDT: ['Pacific/Auckland'],
});

export function normalizeSearchText(value) {
  return String(value)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/−/g, '-')
    .replace(/[’'.,\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Every localized name ICU has for a zone, plus its UTC offset ("UTC+5:30").
export function getTimeZoneSearchNames(timeZone, locale, date = new Date()) {
  const names = [];
  for (const timeZoneName of ['short', 'long', 'shortGeneric', 'longGeneric']) {
    try {
      const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName }).formatToParts(date)
        .find(item => item.type === 'timeZoneName');
      if (part?.value) names.push(part.value);
    } catch { /* generic names are not universal */ }
  }
  names.push(formatUtcOffset(getOffsetMinutes(timeZone, date)));
  return [...new Set(names)];
}

export function createSearchEntry(city, { names = [city.city], countries = [], zoneNames = [] } = {}) {
  const normalize = values => [...new Set(values.map(normalizeSearchText))].filter(Boolean);
  return {
    item: city,
    key: `${city.city}|${city.country}`,
    tz: city.tz,
    names: normalize(names),
    countries: normalize([...countries, city.country]),
    zoneNames: normalize(zoneNames),
    zoneId: normalizeSearchText(city.tz),
  };
}

function hasWordStartingWith(text, query) {
  return text.startsWith(query) || text.includes(` ${query}`);
}

// Lower ranks first: exact city name; abbreviation or exact timezone name
// (when typed in capitals); city prefix; lowercase abbreviation; a later word
// of a city name; country; timezone name; timezone ID; any substring.
function scoreSearchEntry(entry, query, abbreviationZones, abbreviationFirst, leaders) {
  if (entry.names.includes(query)) return 0;
  const abbreviationIndex = abbreviationZones.indexOf(entry.tz);
  const exactZone = abbreviationIndex >= 0 || entry.zoneNames.includes(query);
  // One representative city per abbreviation zone comes before the rest.
  const zoneRank = abbreviationIndex >= 0 ? abbreviationIndex / 100 + (leaders.has(entry.key) ? 0 : 0.5) : 0.99;
  if (exactZone && abbreviationFirst) return 1 + zoneRank;
  if (entry.names.some(name => name.startsWith(query))) return 2;
  if (exactZone) return 2.5 + zoneRank / 10;
  if (entry.names.some(name => name.includes(` ${query}`))) return 3;
  if (entry.countries.some(name => hasWordStartingWith(name, query))) return 4;
  if (entry.zoneNames.some(name => hasWordStartingWith(name, query))) return 5;
  if (hasWordStartingWith(entry.zoneId, query)) return 6;
  if ([...entry.names, ...entry.countries, ...entry.zoneNames, entry.zoneId].some(text => text.includes(query))) return 7;
  return Infinity;
}

/**
 * Ranks search entries for a query. Each entry is
 * { item, key, tz, names, countries, zoneNames, zoneId } with every string
 * already passed through normalizeSearchText().
 */
export function searchEntries(entries, rawQuery, limit = 12) {
  const query = normalizeSearchText(rawQuery);
  if (!query) return [];
  const abbreviationZones = TIMEZONE_ABBREVIATIONS[query.toUpperCase()] || [];
  // "IST" asks for a timezone; "ist" may be the start of Istanbul.
  const abbreviationFirst = /^[A-Z]{2,5}$/.test(String(rawQuery).trim());
  const leaders = new Set();
  for (const zone of abbreviationZones) {
    const zoneEntries = entries.filter(entry => entry.tz === zone);
    const segment = normalizeSearchText(zone.split('/').at(-1));
    const leader = zoneEntries.find(entry => entry.names.includes(segment)) || zoneEntries[0];
    if (leader) leaders.add(leader.key);
  }
  const seen = new Set();
  return entries
    .map((entry, index) => ({ entry, index, score: scoreSearchEntry(entry, query, abbreviationZones, abbreviationFirst, leaders) }))
    .filter(result => Number.isFinite(result.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .filter(({ entry }) => !seen.has(entry.key) && seen.add(entry.key))
    .slice(0, limit)
    .map(({ entry }) => entry.item);
}

/* Locale */

const CATALOG_LANGUAGES = ['en', 'es', 'fr'];

// Maps a browser language tag to its message catalog and formatting locale;
// en-GB keeps day-month dates and es-AR its regional formats.
export function resolveLocale(requested) {
  let locale;
  try { locale = new Intl.Locale(String(requested || 'en').replace(/_/g, '-')); }
  catch { locale = new Intl.Locale('en'); }
  const language = CATALOG_LANGUAGES.includes(locale.language) ? locale.language : 'en';
  const messageLocale = language === 'es' && locale.region && locale.region !== 'ES' ? 'es_419' : language;
  const [supported] = language === locale.language ? Intl.DateTimeFormat.supportedLocalesOf([locale.baseName]) : [];
  return { language, messageLocale, formatLocale: supported || language };
}

export function prefers24HourClock(locale) {
  try {
    return ['h23', 'h24'].includes(new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle);
  } catch {
    return false;
  }
}

export function calculateLayoutWidth(viewportWidth, zoneCount) {
  return Math.max(viewportWidth, zoneCount * MIN_COLUMN_WIDTH);
}

export function calculateTimeFontSize(columnWidth, use24h, showSeconds) {
  const divisor = showSeconds ? (use24h ? 4.3 : 4.8) : (use24h ? 3 : 3.5);
  return Math.max(24, Math.min(88, (columnWidth - 24) / divisor));
}

function normalizeWorkingDays(value, region) {
  const days = Array.isArray(value)
    ? [...new Set(value.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
    : [];
  return days.length ? days : getDefaultWorkingDays(region);
}

export function normalizeWorkingHours(value, region) {
  const source = value && typeof value === 'object' ? value : {};
  const start = Number.isInteger(source.start) ? source.start : DEFAULT_WORKING_HOURS.start;
  const end = Number.isInteger(source.end) ? source.end : DEFAULT_WORKING_HOURS.end;
  return {
    enabled: source.enabled !== false,
    start: Math.max(0, Math.min(1439, start)),
    end: Math.max(0, Math.min(1439, end)),
    days: normalizeWorkingDays(source.days, region),
  };
}

function normalizeHome(value) {
  return value && typeof value === 'object' &&
    typeof value.city === 'string' && typeof value.country === 'string' && isValidTimeZone(value.tz)
    ? { city: value.city, country: value.country, tz: value.tz }
    : null;
}

function normalizeZones(value) {
  return Array.isArray(value)
    ? value
      .filter(zone => zone && isValidTimeZone(zone.tz) && Array.isArray(zone.cities))
      .map(zone => {
        const cities = zone.cities
          .filter(city => city && typeof city.city === 'string' && typeof city.country === 'string')
          .slice(0, 3)
          .map(city => ({ city: city.city, country: city.country }));
        return { tz: zone.tz, workingHours: normalizeWorkingHours(zone.workingHours, cities[0]?.country), cities };
      })
      .filter(zone => zone.cities.length > 0)
      .filter((zone, index, all) => all.findIndex(item => item.tz === zone.tz) === index)
      .slice(0, MAX_TIMEZONES)
    : [];
}

// The home timezone always has a column; at the limit it replaces the last one.
function repairHomeZone(home, zones) {
  if (!home) return zones;
  let homeZone = zones.find(zone => zone.tz === home.tz);
  if (!homeZone) {
    if (zones.length >= MAX_TIMEZONES) zones.splice(MAX_TIMEZONES - 1);
    homeZone = { tz: home.tz, workingHours: normalizeWorkingHours(null, home.country), cities: [] };
    zones.push(homeZone);
  }
  if (!homeZone.cities.some(city => city.city === home.city && city.country === home.country)) {
    homeZone.cities.unshift({ city: home.city, country: home.country });
    homeZone.cities = homeZone.cities.slice(0, 3);
  }
  return zones;
}

export function createPresetSnapshot(config) {
  return {
    home: config.home ? { ...config.home } : null,
    zones: config.zones.map(zone => ({
      tz: zone.tz,
      cities: zone.cities.map(city => ({ ...city })),
      workingHours: { ...zone.workingHours, days: [...(zone.workingHours.days || [])] },
    })),
    use24h: config.use24h,
    showSeconds: config.showSeconds,
    infoDensity: config.infoDensity,
    visualTheme: config.visualTheme,
    atmosphericMotion: config.atmosphericMotion,
    availabilityEnabled: config.availabilityEnabled,
  };
}

export function createBackup(config, date = new Date()) {
  return {
    app: 'Meridian',
    version: 1,
    exportedAt: date.toISOString(),
    config: normalizeConfig(config),
  };
}

// A backup restores clocks and preferences but never chooses where they are
// stored: importing a file must not opt this browser into Chrome Sync.
export function parseBackup(value, { storageMode = 'local' } = {}) {
  const payload = typeof value === 'string' ? JSON.parse(value) : value;
  if (!payload || typeof payload !== 'object') throw new Error('Invalid backup.');
  if (payload.app && payload.app !== 'Meridian') throw new Error('Backup belongs to another application.');
  const config = normalizeConfig(payload.config || payload);
  if (!config.home) throw new Error('Backup has no home timezone.');
  config.onboardingComplete = true;
  config.storageMode = storageMode === 'sync' ? 'sync' : 'local';
  return config;
}

function normalizePresets(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string')
    .map(item => {
      const home = normalizeHome(item.home);
      const zones = repairHomeZone(home, normalizeZones(item.zones));
      return {
        id: item.id.slice(0, 80),
        name: item.name.trim().slice(0, 40) || 'Preset',
        home,
        zones,
        use24h: item.use24h === true,
        showSeconds: item.showSeconds === true,
        infoDensity: item.infoDensity === 'compact' ? 'compact' : 'standard',
        visualTheme: item.visualTheme === 'solar' ? 'solar' : 'clock',
        atmosphericMotion: item.atmosphericMotion !== false,
        availabilityEnabled: item.availabilityEnabled === true,
      };
    }).filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index)
    .slice(0, MAX_PRESETS);
}

export function normalizeConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const home = normalizeHome(source.home);
  const zones = repairHomeZone(home, normalizeZones(source.zones));
  const presets = normalizePresets(source.presets);
  const activePresetId = presets.some(preset => preset.id === source.activePresetId)
    ? source.activePresetId
    : null;

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    home,
    zones,
    use24h: source.use24h === true,
    showSeconds: source.showSeconds === true,
    infoDensity: source.infoDensity === 'compact' ? 'compact' : 'standard',
    visualTheme: source.visualTheme === 'solar' ? 'solar' : 'clock',
    atmosphericMotion: source.atmosphericMotion !== false,
    availabilityEnabled: source.availabilityEnabled === true,
    storageMode: source.storageMode === 'sync' ? 'sync' : 'local',
    presets,
    activePresetId,
    onboardingComplete: source.onboardingComplete === true || Boolean(home && source.schemaVersion !== CONFIG_SCHEMA_VERSION),
  };
}

/* Storage
   Local storage always holds the latest configuration. In sync mode the same
   configuration is also written to chrome.storage.sync after a short delay,
   which keeps edits within Chrome's write-rate quota. */

export const CONFIG_STORAGE_KEY = 'meridian_config';
export const STORAGE_MODE_KEY = 'meridian_storage_mode';
export const SYNC_PRESET_KEY_PREFIX = 'meridian_preset_';
// chrome.storage.sync allows 8,192 bytes per item, measured as the key plus
// the JSON of its value. The margin covers byte-counting differences.
const SYNC_ITEM_BYTE_BUDGET = 8000;

function storageItemBytes(key, value) {
  return key.length + new TextEncoder().encode(JSON.stringify(value)).length;
}

function getSyncPresetKeys() {
  return Array.from({ length: MAX_PRESETS }, (_, index) => `${SYNC_PRESET_KEY_PREFIX}${index}`);
}

// Small configurations keep the original single-item layout. Larger ones move
// each preset into its own item so no item exceeds the sync quota.
export function serializeSyncConfig(config, meta = {}) {
  const { presets, ...settings } = normalizeConfig(config);
  const inline = { ...settings, presets, ...meta };
  if (storageItemBytes(CONFIG_STORAGE_KEY, inline) <= SYNC_ITEM_BYTE_BUDGET) {
    return { [CONFIG_STORAGE_KEY]: inline };
  }
  const items = { [CONFIG_STORAGE_KEY]: { ...settings, presetCount: presets.length, ...meta } };
  presets.forEach((preset, index) => { items[`${SYNC_PRESET_KEY_PREFIX}${index}`] = preset; });
  return items;
}

export function deserializeSyncConfig(items) {
  const stored = items?.[CONFIG_STORAGE_KEY];
  if (!stored || typeof stored !== 'object') return null;
  if (Array.isArray(stored.presets)) return stored;
  const count = Math.min(Math.max(Number.parseInt(stored.presetCount, 10) || 0, 0), MAX_PRESETS);
  const presets = [];
  for (let index = 0; index < count; index++) {
    const preset = items[`${SYNC_PRESET_KEY_PREFIX}${index}`];
    if (preset) presets.push(preset);
  }
  return { ...stored, presets };
}

function mergePresets(primary, secondary) {
  const merged = [...primary];
  for (const preset of secondary) {
    if (!merged.some(item => item.id === preset.id)) merged.push(preset);
  }
  return merged.slice(0, MAX_PRESETS);
}

function createWriterId() {
  return globalThis.crypto?.randomUUID?.() || `writer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Persists configuration to promise-based storage areas shaped like
 * chrome.storage.local/sync ({ get, set, remove }). `sync` is null when
 * Chrome Sync storage is unavailable.
 */
export function createConfigStore({
  local,
  sync = null,
  writerId = createWriterId(),
  now = () => Date.now(),
  syncDelayMs = 1000,
  onSyncError = () => {},
} = {}) {
  let pendingSync = null;
  let syncTimer = null;
  let syncPresetKeys = null;

  const stamp = () => ({ updatedAt: now(), writer: writerId });

  async function writeLocal(config, meta) {
    await local.set({ [CONFIG_STORAGE_KEY]: { ...config, ...meta }, [STORAGE_MODE_KEY]: config.storageMode });
  }

  async function writeSync(config, meta) {
    const items = serializeSyncConfig(config, meta);
    await sync.set(items);
    const written = Object.keys(items).filter(key => key.startsWith(SYNC_PRESET_KEY_PREFIX));
    const stale = (syncPresetKeys ?? getSyncPresetKeys()).filter(key => !written.includes(key));
    if (stale.length) await sync.remove(stale);
    syncPresetKeys = written;
  }

  async function readSync() {
    const items = (await sync.get(null)) || {};
    syncPresetKeys = Object.keys(items).filter(key => key.startsWith(SYNC_PRESET_KEY_PREFIX));
    return deserializeSyncConfig(items);
  }

  function cancelPendingSync() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = null;
    pendingSync = null;
  }

  async function flush() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = null;
    if (!pendingSync || !sync) return true;
    const { config, meta } = pendingSync;
    pendingSync = null;
    try {
      await writeSync(config, meta);
      return true;
    } catch (error) {
      onSyncError(error);
      return false;
    }
  }

  function queueSync(config, meta) {
    pendingSync = { config, meta };
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(flush, syncDelayMs);
  }

  async function save(value) {
    const config = normalizeConfig(value);
    const meta = stamp();
    if (config.storageMode === 'sync' && sync) queueSync(config, meta);
    else cancelPendingSync();
    await writeLocal(config, meta);
    return config;
  }

  // `repair` refreshes the local copy and resumes unsynced edits. Pages that
  // reload after another tab's change pass false so only the writer syncs.
  async function load({ repair = true } = {}) {
    const stored = (await local.get([CONFIG_STORAGE_KEY, STORAGE_MODE_KEY])) || {};
    const localRaw = stored[CONFIG_STORAGE_KEY] || null;
    const mode = stored[STORAGE_MODE_KEY] || localRaw?.storageMode || 'local';

    // A fresh install also checks sync: a synced record means this profile
    // already chose Chrome Sync on another device.
    if (sync && (mode === 'sync' || !localRaw)) {
      let syncRaw = null;
      try { syncRaw = await readSync(); } catch (error) { onSyncError(error); }
      const synced = syncRaw && normalizeConfig({ ...syncRaw, storageMode: 'sync' });
      if (synced?.home) {
        const localUpdatedAt = Number(localRaw?.updatedAt) || 0;
        const syncUpdatedAt = Number(syncRaw.updatedAt) || 0;
        if (mode === 'sync' && localRaw && localUpdatedAt > syncUpdatedAt) {
          // This device has edits that never reached sync (closed tab, quota).
          const config = normalizeConfig({ ...localRaw, storageMode: 'sync' });
          if (repair) queueSync(config, { updatedAt: localUpdatedAt, writer: writerId });
          return { config, adopted: false };
        }
        if (repair && (!localRaw || mode !== 'sync' || syncUpdatedAt > localUpdatedAt)) {
          await writeLocal(synced, { updatedAt: syncUpdatedAt, writer: writerId });
        }
        return { config: synced, adopted: mode !== 'sync' };
      }
    }
    const storageMode = mode === 'sync' && sync ? 'sync' : 'local';
    return { config: normalizeConfig({ ...(localRaw || {}), storageMode }), adopted: false };
  }

  // Switching to sync adopts a configuration already synced from another
  // device instead of overwriting it; presets from both are kept. Switching
  // to local-only removes Meridian's synced record.
  async function setMode(value, mode) {
    const previous = normalizeConfig(value);
    if (mode === 'sync' && sync) {
      const remoteRaw = await readSync();
      const remote = remoteRaw && normalizeConfig({ ...remoteRaw, storageMode: 'sync', onboardingComplete: true });
      const adopted = Boolean(remote?.home);
      const config = normalizeConfig(adopted
        ? { ...remote, presets: mergePresets(remote.presets, previous.presets) }
        : { ...previous, storageMode: 'sync' });
      const meta = stamp();
      cancelPendingSync();
      await writeSync(config, meta);
      await writeLocal(config, meta);
      return { config, adopted, previous };
    }
    const config = normalizeConfig({ ...previous, storageMode: 'local' });
    cancelPendingSync();
    await writeLocal(config, stamp());
    if (sync) await sync.remove([CONFIG_STORAGE_KEY, ...getSyncPresetKeys()]);
    syncPresetKeys = [];
    return { config, adopted: false, previous };
  }

  // chrome.storage.onChanged also reports this page's own writes.
  function isExternalChange(changes) {
    const change = changes?.[CONFIG_STORAGE_KEY];
    if (change) return change.newValue?.writer !== writerId;
    return Boolean(changes && STORAGE_MODE_KEY in changes);
  }

  return { load, save, flush, setMode, isExternalChange, writerId };
}
