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

export function areZonesAvailable(zones, date = new Date()) {
  return zones.length > 0 && zones.every(zone =>
    isMinuteWithinHours(getLocalMinuteOfDay(zone.tz, date), zone.workingHours));
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

export function getSolarAdjustedHour(localHour, solarTimes) {
  if (!solarTimes) return localHour;
  const { sunrise, sunset } = solarTimes;
  const solarNoon = (sunrise + sunset) / 2;
  if (localHour < sunrise) {
    return 5 * (localHour / Math.max(sunrise, 0.01));
  }
  if (localHour <= solarNoon) {
    return 5 + 7 * ((localHour - sunrise) / Math.max(solarNoon - sunrise, 0.01));
  }
  if (localHour <= sunset) {
    return 12 + 7 * ((localHour - solarNoon) / Math.max(sunset - solarNoon, 0.01));
  }
  return 19 + 5 * ((localHour - sunset) / Math.max(24 - sunset, 0.01));
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

export function getRepresentativeCity(cities, timeZone, preferredCity = '') {
  const candidates = cities.filter(city => city.tz === timeZone);
  if (candidates.length === 0) return null;

  const preferredName = normalizeCityName(preferredCity);
  if (preferredName) {
    const preferred = candidates.find(city => normalizeCityName(city.city) === preferredName);
    if (preferred) return preferred;
  }

  const zoneName = normalizeCityName(timeZone.split('/').at(-1));
  return candidates.find(city => normalizeCityName(city.city) === zoneName) || candidates[0];
}

export function calculateLayoutWidth(viewportWidth, zoneCount) {
  return Math.max(viewportWidth, zoneCount * MIN_COLUMN_WIDTH);
}

export function calculateTimeFontSize(columnWidth, use24h, showSeconds) {
  const divisor = showSeconds ? (use24h ? 4.3 : 4.8) : (use24h ? 3 : 3.5);
  return Math.max(24, Math.min(88, (columnWidth - 24) / divisor));
}

function normalizeWorkingHours(value) {
  const source = value && typeof value === 'object' ? value : {};
  const start = Number.isInteger(source.start) ? source.start : DEFAULT_WORKING_HOURS.start;
  const end = Number.isInteger(source.end) ? source.end : DEFAULT_WORKING_HOURS.end;
  return {
    enabled: source.enabled !== false,
    start: Math.max(0, Math.min(1439, start)),
    end: Math.max(0, Math.min(1439, end)),
  };
}

function normalizeHome(value) {
  return value && typeof value === 'object' &&
    typeof value.city === 'string' && typeof value.country === 'string' && typeof value.tz === 'string'
    ? { city: value.city, country: value.country, tz: value.tz }
    : null;
}

function normalizeZones(value) {
  return Array.isArray(value)
    ? value
      .filter(zone => zone && typeof zone.tz === 'string' && Array.isArray(zone.cities))
      .map(zone => ({
        tz: zone.tz,
        workingHours: normalizeWorkingHours(zone.workingHours),
        cities: zone.cities
          .filter(city => city && typeof city.city === 'string' && typeof city.country === 'string')
          .slice(0, 3)
          .map(city => ({ city: city.city, country: city.country })),
      }))
      .filter(zone => zone.cities.length > 0)
      .filter((zone, index, all) => all.findIndex(item => item.tz === zone.tz) === index)
      .slice(0, 10)
    : [];
}

function repairHomeZone(home, zones) {
  if (!home) return zones;
  let homeZone = zones.find(zone => zone.tz === home.tz);
  if (!homeZone && zones.length < 10) {
    homeZone = { tz: home.tz, workingHours: { ...DEFAULT_WORKING_HOURS }, cities: [] };
    zones.push(homeZone);
  }
  if (homeZone && !homeZone.cities.some(city => city.city === home.city && city.country === home.country)) {
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
      workingHours: { ...zone.workingHours },
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

export function parseBackup(value) {
  const payload = typeof value === 'string' ? JSON.parse(value) : value;
  if (!payload || typeof payload !== 'object') throw new Error('Invalid backup.');
  if (payload.app && payload.app !== 'Meridian') throw new Error('Backup belongs to another application.');
  const config = normalizeConfig(payload.config || payload);
  if (!config.home) throw new Error('Backup has no home timezone.');
  config.onboardingComplete = true;
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
    .slice(0, 12);
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
