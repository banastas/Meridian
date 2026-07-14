'use strict';

import {
  DEFAULT_TIMEZONES,
  DEFAULT_WORKING_HOURS,
  areZonesAvailable,
  calculateLayoutWidth,
  calculateTimeFontSize,
  createBackup,
  createPresetSnapshot,
  findAvailabilityWindows,
  formatRelativeOffset,
  formatUtcOffset,
  getGradientColors,
  getLocalMinuteOfDay,
  getNextOffsetTransition,
  getOffsetMinutes,
  getRepresentativeCity,
  getSolarGradientColors,
  getSmoothGradientStops,
  getTextColor,
  getTimeInZone as getCoreTimeInZone,
  isMinuteWithinHours,
  lerpColorRound,
  normalizeConfig,
  parseBackup,
  sortZonesByUtcOffset,
} from './core.js?v=1.2.1';

// Localization
let currentLocale = 'en';
let currentLanguage = 'en';
let currentMessageLocale = 'en';
let messages = {};
let cityLocalization = {};
let countryDisplayNames = null;
const timezoneSearchCache = new Map();
const timezoneNameFormatterCache = new Map();
const ASSET_VERSION = '1.2.1';

function hasChromeI18n() {
  return location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined' && chrome.i18n?.getMessage;
}

function hasChromeStorage() {
  return location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined' && chrome.storage?.local;
}

function getLocaleConfig(locale) {
  const language = String(locale || 'en').replace('_', '-').toLowerCase().split('-')[0];
  if (language === 'es') return { language: 'es', messageLocale: 'es_419', formatLocale: 'es-AR' };
  if (language === 'fr') return { language: 'fr', messageLocale: 'fr', formatLocale: 'fr-FR' };
  return { language: 'en', messageLocale: 'en', formatLocale: 'en' };
}

async function fetchMessages(locale) {
  const response = await fetch(`_locales/${locale}/messages.json?v=${ASSET_VERSION}`);
  return response.ok ? response.json() : {};
}

async function loadMessages() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('lang') || (hasChromeI18n() && chrome.i18n.getUILanguage
    ? chrome.i18n.getUILanguage() : navigator.language);
  const locale = getLocaleConfig(requested);
  currentLocale = locale.formatLocale;
  currentLanguage = locale.language;
  currentMessageLocale = locale.messageLocale;
  document.documentElement.lang = currentLanguage;
  if (hasChromeI18n()) return;
  try {
    messages = {
      ...await fetchMessages('en'),
      ...(currentMessageLocale === 'en' ? {} : await fetchMessages(currentMessageLocale)),
    };
  } catch { messages = {}; }
}

function formatLocalMessage(messageData, substitutions) {
  if (!messageData?.message) return '';
  let message = messageData.message;
  const values = Array.isArray(substitutions) ? substitutions : [substitutions];
  for (const [name, placeholder] of Object.entries(messageData.placeholders || {})) {
    const match = String(placeholder.content || '').match(/\$(\d+)/);
    message = message.replace(new RegExp(`\\$${name}\\$`, 'gi'), match ? values[Number(match[1]) - 1] ?? '' : '');
  }
  return message;
}

function t(key, substitutions = []) {
  const values = Array.isArray(substitutions) ? substitutions : [substitutions];
  if (hasChromeI18n()) {
    const value = chrome.i18n.getMessage(key, values);
    if (value) return value;
  }
  return formatLocalMessage(messages[key], values) || key;
}

function applyLocalizedStaticText() {
  document.title = t('extensionName');
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-title]')) element.title = t(element.dataset.i18nTitle);
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = t(element.dataset.i18nPlaceholder);
  for (const element of document.querySelectorAll('[data-i18n-aria-label]')) element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
}

// State and DOM
let cities = [];
let coordinates = {};
let config = normalizeConfig({});
let updateTimer = null;
let searchSelectedIndex = -1;
let searchMode = 'add';
let searchTargetTimeZone = null;
let searchReturnFocus = null;
let viewedOffsetMinutes = 0;
let planningOpen = false;
let editMode = false;
let lastCanvasKey = '';
let dragTimeZone = null;
let toastTimer = null;
const transitionCache = new Map();

const byId = id => document.getElementById(id);
const $canvas = byId('gradient-canvas');
const context = $canvas.getContext('2d');
const blendCanvas = document.createElement('canvas');
const blendContext = blendCanvas.getContext('2d');
const ditherCanvas = document.createElement('canvas');
ditherCanvas.width = 64; ditherCanvas.height = 64;
const ditherContext = ditherCanvas.getContext('2d');
const ditherImage = ditherContext.createImageData(ditherCanvas.width, ditherCanvas.height);
let ditherSeed = 0x6d2b79f5;
for (let index = 0; index < ditherImage.data.length; index += 4) {
  ditherSeed = Math.imul(ditherSeed, 1664525) + 1013904223;
  const value = 96 + ((ditherSeed >>> 24) % 65);
  ditherImage.data[index] = value;
  ditherImage.data[index + 1] = value;
  ditherImage.data[index + 2] = value;
  ditherImage.data[index + 3] = 255;
}
ditherContext.putImageData(ditherImage, 0, 0);
const $dashboard = byId('dashboard');
const $columns = byId('columns');
const $toolbar = byId('toolbar');
const $addBtn = byId('add-btn');
const $timeTravelBtn = byId('time-travel-btn');
const $availabilityToggle = byId('availability-toggle');
const $editBtn = byId('edit-btn');
const $settingsBtn = byId('settings-btn');
const $settingsPanel = byId('settings-panel');
const $toggle24h = byId('toggle-24h');
const $toggleSeconds = byId('toggle-seconds');
const $toggleMotion = byId('toggle-motion');
const $densitySelect = byId('density-select');
const $themeSelect = byId('theme-select');
const $storageSelect = byId('storage-select');
const $presetSelect = byId('preset-select');
const $presetName = byId('preset-name');
const $searchOverlay = byId('search-overlay');
const $searchTitle = byId('search-title');
const $searchInput = byId('search-input');
const $searchResults = byId('search-results');
const $searchMultiFooter = byId('search-multi-footer');
const $searchMultiStatus = byId('search-multi-status');
const $firstRunModal = byId('first-run-modal');
const $onboardingHomeStep = byId('onboarding-home-step');
const $onboardingGoalStep = byId('onboarding-goal-step');
const $homeSearch = byId('home-search');
const $homeResults = byId('home-results');
const $homeDetected = byId('home-detected');
const $planner = byId('planner');
const $plannerTime = byId('planner-time');
const $availabilitySummary = byId('availability-summary');
const $timeSlider = byId('time-slider');
const $toast = byId('toast');
const $toastMessage = byId('toast-message');
const $toastAction = byId('toast-action');

// Feedback
function showToast(message, action = null) {
  if (toastTimer) clearTimeout(toastTimer);
  $toastMessage.textContent = message;
  $toastAction.classList.toggle('hidden', !action);
  if (action) {
    $toastAction.textContent = action.label;
    $toastAction.onclick = () => { action.run(); hideToast(); };
  } else $toastAction.onclick = null;
  $toast.classList.remove('hidden');
  requestAnimationFrame(() => $toast.classList.add('visible'));
  toastTimer = setTimeout(hideToast, action ? 6000 : 2600);
}

function hideToast() {
  if (toastTimer) clearTimeout(toastTimer);
  $toast.classList.remove('visible');
  toastTimer = setTimeout(() => $toast.classList.add('hidden'), 220);
}

// Time and formatting
function viewedDate() { return new Date(Date.now() + viewedOffsetMinutes * 60000); }
function getTimeInZone(timeZone, date = viewedDate()) { return getCoreTimeInZone(timeZone, currentLocale, date); }

function getTzAbbreviation(timeZone, date) {
  const cacheKey = `${currentLocale}:${timeZone}`;
  if (!timezoneNameFormatterCache.has(cacheKey)) {
    timezoneNameFormatterCache.set(cacheKey, new Intl.DateTimeFormat(currentLocale, { timeZone, timeZoneName: 'short' }));
  }
  return timezoneNameFormatterCache.get(cacheKey).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || '';
}

function formatClock(date, timeZone, includeDate = false) {
  return new Intl.DateTimeFormat(currentLocale, {
    timeZone,
    ...(includeDate ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
    hour: 'numeric', minute: '2-digit', hour12: !config.use24h,
  }).format(date);
}

function formatInputTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function parseInputTime(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function getTransition(timeZone, date) {
  const day = date.toISOString().slice(0, 10);
  const key = `${timeZone}:${day}`;
  if (!transitionCache.has(key)) transitionCache.set(key, getNextOffsetTransition(timeZone, date, 30));
  return transitionCache.get(key);
}

function formatTransition(transition, date) {
  if (!transition) return '';
  const hours = Math.max(1, Math.round((transition.at - date) / 3600000));
  let when;
  try {
    const rtf = new Intl.RelativeTimeFormat(currentLocale, { numeric: 'auto' });
    when = hours < 48 ? rtf.format(hours, 'hour') : rtf.format(Math.round(hours / 24), 'day');
  } catch { when = hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`; }
  return transition.deltaMinutes > 0 ? t('clocksMoveForward', when) : t('clocksMoveBack', when);
}

// Rendering
function getCityKey(city, country) { return `${city}|${country}`; }
function getLocalizedCityName(city) { return cityLocalization.names?.[getCityKey(city.city, city.country)] || city.city; }

function renderColumns() {
  $columns.replaceChildren();
  lastCanvasKey = '';
  config.zones.forEach((zone, index) => {
    const column = document.createElement('section');
    column.className = 'tz-column';
    column.dataset.tz = zone.tz;
    column.draggable = editMode;
    column.tabIndex = editMode ? 0 : -1;
    if (config.home?.tz === zone.tz) column.classList.add('is-home');

    const cityNames = zone.cities.map(getLocalizedCityName).join(', ');
    column.setAttribute('aria-label', config.home?.tz === zone.tz
      ? `${cityNames} — ${t('homeTimezone')}` : `${cityNames} — ${zone.tz}`);

    const content = document.createElement('div');
    content.className = 'column-content';
    content.tabIndex = 0;
    const cityLabel = document.createElement('div');
    cityLabel.className = 'city-label';
    cityLabel.textContent = cityNames;
    const timeDisplay = document.createElement('div');
    timeDisplay.className = 'time-display';
    const dateDisplay = document.createElement('div');
    dateDisplay.className = 'date-display';
    const info = document.createElement('div');
    info.className = 'tz-info';
    const details = document.createElement('div');
    details.className = 'tz-detail-card';
    details.id = `details-${index}`;
    content.setAttribute('aria-describedby', details.id);
    content.append(cityLabel, timeDisplay, dateDisplay, info, details);

    const availabilityBand = document.createElement('span');
    availabilityBand.className = 'availability-band';
    availabilityBand.setAttribute('aria-hidden', 'true');
    column.append(availabilityBand, content, createEditControls(zone, index));
    attachDragHandlers(column);
    $columns.append(column);
  });
  document.body.classList.toggle('edit-mode', editMode);
  updateDisplay();
}

function createEditControls(zone, index) {
  const controls = document.createElement('div');
  controls.className = `edit-controls${editMode ? '' : ' hidden'}`;

  const button = (label, text, handler, disabled = false) => {
    const element = document.createElement('button');
    element.type = 'button'; element.textContent = text; element.title = label;
    element.setAttribute('aria-label', label); element.disabled = disabled;
    element.addEventListener('click', handler); return element;
  };
  controls.append(
    button(t('moveLeft'), '←', () => moveZone(zone.tz, -1), index === 0),
    button(t('moveRight'), '→', () => moveZone(zone.tz, 1), index === config.zones.length - 1),
  );
  if (config.home?.tz !== zone.tz) {
    controls.append(
      button(t('setAsHome'), '⌂', () => setHome(zone.cities[0].city, zone.cities[0].country, zone.tz, true)),
      button(t('removeTimezone'), '×', () => removeZone(zone.tz)),
    );
  }
  controls.append(button(t('groupCity'), t('groupCityShort'), event => openSearch('group', event.currentTarget, zone.tz)));

  const hours = document.createElement('label');
  hours.className = 'hours-editor';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox'; enabled.checked = zone.workingHours.enabled;
  enabled.setAttribute('aria-label', t('includeWorkingHours'));
  const start = document.createElement('input');
  start.type = 'time'; start.value = formatInputTime(zone.workingHours.start);
  start.setAttribute('aria-label', t('workingDayStarts'));
  const end = document.createElement('input');
  end.type = 'time'; end.value = formatInputTime(zone.workingHours.end);
  end.setAttribute('aria-label', t('workingDayEnds'));
  const update = () => {
    zone.workingHours = { enabled: enabled.checked, start: parseInputTime(start.value), end: parseInputTime(end.value) };
    saveConfig(); updateDisplay();
  };
  enabled.addEventListener('change', update); start.addEventListener('change', update); end.addEventListener('change', update);
  const label = document.createElement('span'); label.textContent = t('hoursShort');
  hours.append(enabled, label, start, document.createTextNode('–'), end);
  controls.append(hours);
  return controls;
}

function attachDragHandlers(column) {
  column.addEventListener('dragstart', event => {
    if (!editMode) { event.preventDefault(); return; }
    dragTimeZone = column.dataset.tz; column.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragTimeZone);
  });
  column.addEventListener('dragend', () => {
    dragTimeZone = null;
    for (const item of $columns.children) item.classList.remove('dragging', 'drag-target');
  });
  column.addEventListener('dragover', event => {
    if (!dragTimeZone || dragTimeZone === column.dataset.tz) return;
    event.preventDefault(); column.classList.add('drag-target');
  });
  column.addEventListener('dragleave', () => column.classList.remove('drag-target'));
  column.addEventListener('drop', event => {
    event.preventDefault();
    reorderZone(dragTimeZone, column.dataset.tz);
  });
}

function createSmoothHorizontalGradient(targetContext, palette, width) {
  const gradient = targetContext.createLinearGradient(0, 0, width, 0);
  for (const stop of getSmoothGradientStops(palette)) {
    gradient.addColorStop(stop.offset, `rgb(${stop.color.join(',')})`);
  }
  return gradient;
}

function paintContinuousGradient(colors, canvasWidth, canvasHeight, dpr, backingWidth, backingHeight) {
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = createSmoothHorizontalGradient(context, colors.map(color => color.top), canvasWidth);
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  if (blendCanvas.width !== backingWidth) blendCanvas.width = backingWidth;
  if (blendCanvas.height !== backingHeight) blendCanvas.height = backingHeight;
  blendContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  blendContext.clearRect(0, 0, canvasWidth, canvasHeight);
  blendContext.globalCompositeOperation = 'source-over';
  blendContext.fillStyle = createSmoothHorizontalGradient(blendContext, colors.map(color => color.bottom), canvasWidth);
  blendContext.fillRect(0, 0, canvasWidth, canvasHeight);
  blendContext.globalCompositeOperation = 'destination-in';
  const verticalMask = blendContext.createLinearGradient(0, 0, 0, canvasHeight);
  verticalMask.addColorStop(0, 'rgba(0,0,0,0)');
  verticalMask.addColorStop(1, 'rgba(0,0,0,1)');
  blendContext.fillStyle = verticalMask;
  blendContext.fillRect(0, 0, canvasWidth, canvasHeight);
  blendContext.globalCompositeOperation = 'source-over';
  context.drawImage(blendCanvas, 0, 0, backingWidth, backingHeight, 0, 0, canvasWidth, canvasHeight);
}

function applyGradientDither(backingWidth, backingHeight) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalCompositeOperation = 'soft-light';
  context.globalAlpha = 0.08;
  context.fillStyle = context.createPattern(ditherCanvas, 'repeat');
  context.fillRect(0, 0, backingWidth, backingHeight);
  context.restore();
}

function updateDisplay() {
  const columnElements = [...$columns.querySelectorAll('.tz-column')];
  if (!columnElements.length) return;
  const date = viewedDate();
  const count = columnElements.length;
  const canvasWidth = calculateLayoutWidth(innerWidth, count);
  const canvasHeight = innerHeight;
  const dpr = devicePixelRatio || 1;
  const columnWidth = canvasWidth / count;
  $columns.style.width = `${canvasWidth}px`;
  $canvas.style.width = `${canvasWidth}px`; $canvas.style.height = `${canvasHeight}px`;

  const times = [], colors = [], offsets = [];
  for (const column of columnElements) {
    const timeZone = column.dataset.tz;
    const time = getTimeInZone(timeZone, date);
    times.push(time); offsets.push(getOffsetMinutes(timeZone, date));
    const fractionalMinute = time.minute24 + (config.atmosphericMotion && viewedOffsetMinutes === 0 ? Number(time.second) / 60 : 0);
    colors.push(config.visualTheme === 'solar'
      ? getSolarGradientColors(timeZone, coordinates[timeZone], date)
      : getGradientColors(time.hour24, fractionalMinute));
  }

  const canvasKey = `${Math.floor(date.getTime() / (config.atmosphericMotion && viewedOffsetMinutes === 0 ? 5000 : 60000))}:${canvasWidth}:${canvasHeight}:${dpr}:${config.visualTheme}`;
  if (canvasKey !== lastCanvasKey) {
    lastCanvasKey = canvasKey;
    const backingWidth = Math.round(canvasWidth * dpr), backingHeight = Math.round(canvasHeight * dpr);
    if ($canvas.width !== backingWidth) $canvas.width = backingWidth;
    if ($canvas.height !== backingHeight) $canvas.height = backingHeight;
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, canvasWidth, canvasHeight);
    paintContinuousGradient(colors, canvasWidth, canvasHeight, dpr, backingWidth, backingHeight);
    context.globalCompositeOperation = 'lighter';
    colors.forEach(({ top, bottom }, index) => {
      const centerX = (index + .5) * columnWidth, centerY = canvasHeight * .45;
      const middle = lerpColorRound(top, bottom, .5);
      const bright = lerpColorRound(middle, [255,255,255], .35);
      const alpha = columnElements[index].classList.contains('is-home') ? .06 : .035;
      const radius = Math.max(columnWidth * .7, canvasHeight * .3);
      const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
      glow.addColorStop(0, `rgba(${bright.join(',')},${alpha})`); glow.addColorStop(.5, `rgba(${bright.join(',')},${alpha * .4})`); glow.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = glow; context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    });
    context.globalCompositeOperation = 'source-over';
    applyGradientDither(backingWidth, backingHeight);
  }

  const homeOffset = config.home ? getOffsetMinutes(config.home.tz, date) : null;
  const timeSize = calculateTimeFontSize(columnWidth, config.use24h, config.showSeconds);
  columnElements.forEach((column, index) => {
    const timeZone = column.dataset.tz, time = times[index], color = colors[index];
    const textColor = getTextColor(color.top, color.bottom); column.style.color = textColor;
    const timeElement = column.querySelector('.time-display'); timeElement.style.fontSize = `${timeSize}px`;
    const hour = config.use24h ? String(time.hour24).padStart(2, '0') : time.hour12;
    const seconds = config.showSeconds ? `<span class="seconds">:${time.second}</span>` : '';
    const period = config.use24h ? '' : `<span class="ampm">${time.ampm}</span>`;
    timeElement.innerHTML = `${hour}:${time.minute}${seconds}${period}`;
    column.querySelector('.date-display').textContent = time.dateLabel;
    const relative = homeOffset === null ? '' : formatRelativeOffset(offsets[index], homeOffset);
    column.querySelector('.tz-info').textContent = relative || (config.home?.tz === timeZone ? t('homeTimezone') : t('sameAsHome'));
    const transition = getTransition(timeZone, date);
    column.querySelector('.tz-detail-card').textContent = [
      `${getTzAbbreviation(timeZone, date)} · ${formatUtcOffset(offsets[index])}`,
      timeZone,
      formatTransition(transition, date),
    ].filter(Boolean).join('\n');

    const zone = config.zones.find(item => item.tz === timeZone);
    const available = isMinuteWithinHours(getLocalMinuteOfDay(timeZone, date), zone.workingHours);
    column.classList.toggle('is-available', available);
  });

  document.body.classList.toggle('density-compact', config.infoDensity === 'compact');
  updatePlanner(date);
}

function updatePlanner(date) {
  if (!config.home) return;
  $plannerTime.textContent = formatClock(date, config.home.tz, true);
  if (!config.availabilityEnabled) {
    $availabilitySummary.textContent = t('enableAvailabilityHint'); return;
  }
  if (areZonesAvailable(config.zones, date)) {
    $availabilitySummary.textContent = t('everyoneAvailableNow'); return;
  }
  const window = findAvailabilityWindows(config.zones, new Date())[0];
  if (!window) { $availabilitySummary.textContent = t('noOverlapNext48'); return; }
  const zoneLabels = [config.home.tz, ...config.zones.map(zone => zone.tz).filter(tz => tz !== config.home.tz)].slice(0, 2)
    .map(timeZone => `${formatClock(window.start, timeZone)}–${formatClock(window.end, timeZone)}`);
  $availabilitySummary.textContent = t('bestOverlap', zoneLabels.join(' / '));
}

// Zone management
function addZone(city, country, timeZone) {
  const existing = config.zones.find(zone => zone.tz === timeZone);
  if (existing) {
    if (existing.cities.some(item => item.city === city && item.country === country)) {
      showToast(t('alreadyOnTimezone', getLocalizedCityName({ city, country }))); return false;
    }
    if (existing.cities.length >= 3) { showToast(t('maxCitiesPerTimezone')); return false; }
    existing.cities.push({ city, country });
  } else {
    if (config.zones.length >= 10) { showToast(t('maxTimezones')); return false; }
    config.zones.push({ tz: timeZone, cities: [{ city, country }], workingHours: { ...DEFAULT_WORKING_HOURS } });
  }
  saveConfig(); renderColumns(); return true;
}

function removeZone(timeZone) {
  if (config.home?.tz === timeZone) return;
  const index = config.zones.findIndex(zone => zone.tz === timeZone);
  if (index < 0) return;
  const [removed] = config.zones.splice(index, 1);
  saveConfig(); renderColumns();
  showToast(t('timezoneRemoved', removed.cities.map(getLocalizedCityName).join(', ')), {
    label: t('undo'), run: () => { config.zones.splice(index, 0, removed); saveConfig(); renderColumns(); },
  });
}

function setHome(city, country, timeZone, announce = false) {
  config.home = { city, country, tz: timeZone };
  const existing = config.zones.find(zone => zone.tz === timeZone);
  if (!existing) config.zones.push({ tz: timeZone, cities: [{ city, country }], workingHours: { ...DEFAULT_WORKING_HOURS } });
  else if (!existing.cities.some(item => item.city === city && item.country === country)) existing.cities.unshift({ city, country });
  saveConfig(); renderColumns();
  if (announce) showToast(t('homeChanged', getLocalizedCityName({ city, country })));
}

function moveZone(timeZone, direction) {
  const index = config.zones.findIndex(zone => zone.tz === timeZone), target = index + direction;
  if (index < 0 || target < 0 || target >= config.zones.length) return;
  [config.zones[index], config.zones[target]] = [config.zones[target], config.zones[index]];
  saveConfig(); renderColumns();
  $columns.querySelector(`[data-tz="${CSS.escape(timeZone)}"]`)?.focus();
}

function reorderZone(sourceTimeZone, targetTimeZone) {
  const from = config.zones.findIndex(zone => zone.tz === sourceTimeZone);
  const to = config.zones.findIndex(zone => zone.tz === targetTimeZone);
  if (from < 0 || to < 0 || from === to) return;
  const [zone] = config.zones.splice(from, 1); config.zones.splice(to, 0, zone);
  saveConfig(); renderColumns();
}

function addDefaultZones() {
  for (const { tz, city: preferredCity } of DEFAULT_TIMEZONES) {
    if (config.zones.some(zone => zone.tz === tz)) continue;
    const city = getRepresentativeCity(cities, tz, preferredCity);
    if (city && config.zones.length < 10) config.zones.push({ tz, cities: [{ city: city.city, country: city.country }], workingHours: { ...DEFAULT_WORKING_HOURS } });
  }
  config.zones = sortZonesByUtcOffset(config.zones);
  saveConfig();
}

// Storage, presets, and backup
function chromeStorage(area, method, ...args) {
  return new Promise(resolve => {
    if (!hasChromeStorage() || !chrome.storage?.[area]) { resolve(undefined); return; }
    chrome.storage[area][method](...args, result => resolve(result));
  });
}

async function loadConfig() {
  if (hasChromeStorage()) {
    const local = await chromeStorage('local', 'get', ['meridian_config', 'meridian_storage_mode']);
    const mode = local?.meridian_storage_mode || local?.meridian_config?.storageMode || 'local';
    if (mode === 'sync' && chrome.storage.sync) {
      const synced = await chromeStorage('sync', 'get', ['meridian_config']);
      config = normalizeConfig(synced?.meridian_config || local?.meridian_config || {});
      config.storageMode = 'sync';
    } else config = normalizeConfig(local?.meridian_config || {});
  } else {
    try { config = normalizeConfig(JSON.parse(localStorage.getItem('meridian_config') || '{}')); }
    catch { config = normalizeConfig({}); }
  }
}

function saveConfig() {
  config = normalizeConfig(config);
  if (hasChromeStorage()) {
    chrome.storage.local.set({ meridian_storage_mode: config.storageMode });
    if (config.storageMode === 'sync' && chrome.storage.sync) chrome.storage.sync.set({ meridian_config: config });
    else chrome.storage.local.set({ meridian_config: config });
  } else localStorage.setItem('meridian_config', JSON.stringify(config));
  syncSettingsControls();
}

async function changeStorageMode(mode) {
  config.storageMode = mode === 'sync' ? 'sync' : 'local';
  if (hasChromeStorage()) {
    if (config.storageMode === 'sync' && chrome.storage.sync) {
      await chromeStorage('sync', 'set', { meridian_config: config });
      await chromeStorage('local', 'set', { meridian_storage_mode: 'sync' });
    } else {
      await chromeStorage('local', 'set', { meridian_config: config, meridian_storage_mode: 'local' });
      if (chrome.storage.sync) await chromeStorage('sync', 'remove', ['meridian_config']);
    }
  } else localStorage.setItem('meridian_config', JSON.stringify(config));
  showToast(t(config.storageMode === 'sync' ? 'syncEnabled' : 'localStorageEnabled'));
}

function renderPresets() {
  const first = document.createElement('option'); first.value = ''; first.textContent = t('currentClocks');
  $presetSelect.replaceChildren(first);
  for (const preset of config.presets) {
    const option = document.createElement('option'); option.value = preset.id; option.textContent = preset.name;
    $presetSelect.append(option);
  }
  $presetSelect.value = config.activePresetId || '';
  byId('delete-preset-btn').disabled = !config.activePresetId;
}

function savePreset() {
  const name = $presetName.value.trim() || config.presets.find(item => item.id === config.activePresetId)?.name;
  if (!name) { $presetName.focus(); showToast(t('enterPresetName')); return; }
  let preset = config.presets.find(item => item.id === config.activePresetId && item.name === name);
  if (!preset) {
    if (config.presets.length >= 12) { showToast(t('maxPresets')); return; }
    preset = { id: crypto.randomUUID ? crypto.randomUUID() : `preset-${Date.now()}` };
    config.presets.push(preset);
  }
  Object.assign(preset, { id: preset.id, name, ...createPresetSnapshot(config) });
  config.activePresetId = preset.id; $presetName.value = '';
  saveConfig(); renderPresets(); showToast(t('presetSaved', name));
}

function activatePreset(id) {
  if (!id) { config.activePresetId = null; saveConfig(); renderPresets(); return; }
  const preset = config.presets.find(item => item.id === id); if (!preset) return;
  const storageMode = config.storageMode, presets = config.presets;
  config = normalizeConfig({ ...createPresetSnapshot(preset), presets, activePresetId: id, storageMode, onboardingComplete: true });
  saveConfig(); renderColumns(); syncSettingsControls(); showToast(t('presetLoaded', preset.name));
}

function deletePreset() {
  const preset = config.presets.find(item => item.id === config.activePresetId); if (!preset) return;
  config.presets = config.presets.filter(item => item.id !== preset.id); config.activePresetId = null;
  saveConfig(); renderPresets(); showToast(t('presetDeleted', preset.name));
}

function exportBackup() {
  const payload = createBackup(config);
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `meridian-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); showToast(t('backupExported'));
}

async function importBackup(file) {
  try {
    const payload = JSON.parse(await file.text());
    config = parseBackup(payload);
    saveConfig(); renderColumns(); syncSettingsControls(); closeSettings(); showToast(t('backupImported'));
  } catch { showToast(t('invalidBackup')); }
}

// Search
async function loadData() {
  const [cityResponse, localizationResponse, coordinateResponse] = await Promise.all([
    fetch(`data/cities.json?v=${ASSET_VERSION}`),
    fetch(`data/city-locales.json?v=${ASSET_VERSION}`),
    fetch(`data/timezone-coordinates.json?v=${ASSET_VERSION}`),
  ]);
  cities = await cityResponse.json();
  const allLocalizations = localizationResponse.ok ? await localizationResponse.json() : {};
  cityLocalization = allLocalizations[currentLanguage] || {};
  coordinates = coordinateResponse.ok ? await coordinateResponse.json() : {};
}

function getLocalizedCityAliases(city) { return cityLocalization.aliases?.[getCityKey(city.city, city.country)] || []; }
function getCountryName(country) {
  if (!countryDisplayNames) {
    try { countryDisplayNames = new Intl.DisplayNames([currentLocale], { type: 'region' }); }
    catch { countryDisplayNames = null; }
  }
  return countryDisplayNames?.of(country) || country;
}

function getLocalizedTimezoneSearchText(timeZone) {
  const key = `${currentLocale}:${timeZone}`; if (timezoneSearchCache.has(key)) return timezoneSearchCache.get(key);
  const names = [];
  for (const timeZoneName of ['short', 'long', 'shortGeneric', 'longGeneric']) {
    try {
      const part = new Intl.DateTimeFormat(currentLocale, { timeZone, timeZoneName }).formatToParts(new Date()).find(item => item.type === 'timeZoneName');
      if (part?.value) names.push(part.value);
    } catch { /* generic names are not universal */ }
  }
  const value = [...new Set(names)].join(' '); timezoneSearchCache.set(key, value); return value;
}

function normalizeForSearch(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2019'.,-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function searchCities(query) {
  if (!query) return [];
  const normalized = normalizeForSearch(query), seen = new Set(), starts = [], includes = [];
  for (const city of cities) {
    const cityNames = [city.city, getLocalizedCityName(city), ...getLocalizedCityAliases(city)];
    const text = [...cityNames, city.country, getCountryName(city.country), city.tz, city.tz.replace(/[\/_]/g, ' '), getLocalizedTimezoneSearchText(city.tz)].join(' ');
    if (!normalizeForSearch(text).includes(normalized)) continue;
    const key = getCityKey(city.city, city.country); if (seen.has(key)) continue; seen.add(key);
    (cityNames.some(name => normalizeForSearch(name).startsWith(normalized)) ? starts : includes).push(city);
  }
  return [...starts, ...includes].slice(0, 12);
}

function renderSearchResults(results, list, onSelect) {
  list.replaceChildren(); searchSelectedIndex = -1;
  const input = list === $homeResults ? $homeSearch : $searchInput;
  input.removeAttribute('aria-activedescendant'); input.setAttribute('aria-expanded', String(results.length > 0));
  results.forEach((city, index) => {
    const item = document.createElement('li'); item.id = `${list.id}-option-${index}`; item.role = 'option'; item.ariaSelected = 'false';
    const name = document.createElement('span'); name.className = 'city-name'; name.textContent = `${getLocalizedCityName(city)}, ${getCountryName(city.country)}`;
    const zone = document.createElement('span'); zone.className = 'city-tz'; zone.textContent = city.tz;
    item.append(name, zone); item.addEventListener('click', () => onSelect(city)); list.append(item);
  });
}

function navigateResults(list, direction) {
  const items = [...list.querySelectorAll('li')]; if (!items.length) return;
  searchSelectedIndex = direction === 'down' ? Math.min(searchSelectedIndex + 1, items.length - 1) : Math.max(searchSelectedIndex - 1, 0);
  items.forEach((item, index) => { item.classList.toggle('selected', index === searchSelectedIndex); item.ariaSelected = String(index === searchSelectedIndex); });
  const input = list === $homeResults ? $homeSearch : $searchInput;
  input.setAttribute('aria-activedescendant', items[searchSelectedIndex].id); items[searchSelectedIndex].scrollIntoView({ block: 'nearest' });
}

function selectCurrentResult(list) { const items = list.querySelectorAll('li'); items[searchSelectedIndex]?.click(); }

function setPageInert(inert) { $dashboard.inert = inert; $toolbar.inert = inert; }

function openSearch(mode = 'add', returnFocus = document.activeElement, targetTimeZone = null) {
  closeSettings();
  searchMode = mode; searchReturnFocus = returnFocus; searchTargetTimeZone = targetTimeZone;
  $searchTitle.textContent = mode === 'home' ? t('changeHomeTimezone')
    : mode === 'onboarding' ? t('addMyPeople')
      : mode === 'group' ? t('addCityToTimezone', targetTimeZone)
        : t('addTimezone');
  $searchInput.placeholder = mode === 'home' ? t('searchYourCity') : t('searchCityOrTimezone');
  $searchMultiFooter.classList.toggle('hidden', mode !== 'onboarding');
  $searchMultiStatus.textContent = t('timezonesAdded', String(Math.max(0, config.zones.length - 1)));
  $searchOverlay.classList.remove('hidden'); setPageInert(true);
  $searchInput.value = ''; $searchResults.replaceChildren(); $searchInput.ariaExpanded = 'false';
  setTimeout(() => $searchInput.focus(), 40);
}

function closeSearch() {
  $searchOverlay.classList.add('hidden'); setPageInert(false); $searchInput.value = ''; $searchResults.replaceChildren();
  $searchInput.ariaExpanded = 'false'; $searchInput.removeAttribute('aria-activedescendant');
  searchReturnFocus?.focus?.(); searchReturnFocus = null;
  searchTargetTimeZone = null;
}

// Onboarding
function showGoalStep() {
  $onboardingHomeStep.classList.add('hidden'); $onboardingGoalStep.classList.remove('hidden'); byId('goal-people').focus();
}

function finishOnboarding(goal) {
  config.onboardingComplete = true;
  if (goal === 'sample') addDefaultZones(); else saveConfig();
  $firstRunModal.classList.add('hidden'); setPageInert(false); renderColumns(); startTimer();
  if (goal === 'people') openSearch('onboarding', byId('add-btn'));
}

function showFirstRun() {
  $firstRunModal.classList.remove('hidden'); setPageInert(true);
  const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const detected = getRepresentativeCity(cities, systemTimeZone);
  $homeDetected.replaceChildren();
  if (detected) {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = t('useDetectedLocation', [getLocalizedCityName(detected), getCountryName(detected.country), systemTimeZone]);
    button.addEventListener('click', () => { setHome(detected.city, detected.country, detected.tz); showGoalStep(); });
    $homeDetected.append(button);
  } else {
    const message = document.createElement('p'); message.className = 'detected-message'; message.textContent = t('detectedSearchPrompt', systemTimeZone); $homeDetected.append(message);
  }
  setTimeout(() => $homeSearch.focus(), 80);
}

// Planner, editing, settings
function togglePlanner(force) {
  planningOpen = typeof force === 'boolean' ? force : !planningOpen;
  if (planningOpen && editMode) {
    editMode = false; $editBtn.ariaPressed = 'false'; renderColumns();
  }
  $planner.classList.toggle('hidden', !planningOpen); document.body.classList.toggle('planning-mode', planningOpen);
  $timeTravelBtn.ariaExpanded = String(planningOpen);
  if (planningOpen) { updateDisplay(); $timeSlider.focus(); }
}

function returnToNow(close = false) {
  viewedOffsetMinutes = 0; $timeSlider.value = '0'; lastCanvasKey = ''; updateDisplay();
  if (close) togglePlanner(false);
}

function toggleEdit(force) {
  const nextEditMode = typeof force === 'boolean' ? force : !editMode;
  if (nextEditMode && planningOpen) returnToNow(true);
  editMode = nextEditMode;
  $editBtn.ariaPressed = String(editMode); renderColumns();
}

function toggleAvailability() {
  config.availabilityEnabled = $availabilityToggle.checked;
  document.body.classList.toggle('availability-mode', config.availabilityEnabled);
  saveConfig(); updateDisplay();
}

function openSettings() {
  $settingsPanel.classList.remove('hidden'); $settingsBtn.ariaExpanded = 'true'; syncSettingsControls();
}

function closeSettings({ restoreFocus = false } = {}) {
  const open = !$settingsPanel.classList.contains('hidden'); $settingsPanel.classList.add('hidden'); $settingsBtn.ariaExpanded = 'false';
  if (open && restoreFocus) $settingsBtn.focus();
}

function syncSettingsControls() {
  $toggle24h.checked = config.use24h; $toggleSeconds.checked = config.showSeconds; $toggleMotion.checked = config.atmosphericMotion;
  $densitySelect.value = config.infoDensity; $themeSelect.value = config.visualTheme; $storageSelect.value = config.storageMode;
  $availabilityToggle.checked = config.availabilityEnabled;
  document.body.classList.toggle('availability-mode', config.availabilityEnabled);
  renderPresets();
}

// Events
$addBtn.addEventListener('click', () => openSearch('add', $addBtn));
$timeTravelBtn.addEventListener('click', () => togglePlanner());
$availabilityToggle.addEventListener('change', toggleAvailability);
$editBtn.addEventListener('click', () => toggleEdit());
$settingsBtn.addEventListener('click', event => { event.stopPropagation(); $settingsPanel.classList.contains('hidden') ? openSettings() : closeSettings(); });
byId('settings-close').addEventListener('click', () => closeSettings({ restoreFocus: true }));
byId('search-close').addEventListener('click', closeSearch);
byId('search-done').addEventListener('click', closeSearch);
byId('now-btn').addEventListener('click', () => returnToNow());
$searchOverlay.addEventListener('click', event => { if (event.target === $searchOverlay && searchMode !== 'onboarding') closeSearch(); });
document.addEventListener('click', event => { if (!$settingsPanel.contains(event.target) && event.target !== $settingsBtn) closeSettings(); });

$timeSlider.addEventListener('input', () => { viewedOffsetMinutes = Number($timeSlider.value); lastCanvasKey = ''; updateDisplay(); });
$timeSlider.addEventListener('keydown', event => {
  const increments = { ArrowRight: 15, ArrowUp: 15, ArrowLeft: -15, ArrowDown: -15, PageUp: 60, PageDown: -60 };
  if (increments[event.key]) {
    event.preventDefault(); viewedOffsetMinutes = Math.max(0, Math.min(2880, viewedOffsetMinutes + increments[event.key]));
    $timeSlider.value = String(viewedOffsetMinutes); updateDisplay();
  }
});

$searchInput.addEventListener('input', () => {
  const results = searchCities($searchInput.value).filter(city => searchMode !== 'group' || city.tz === searchTargetTimeZone);
  renderSearchResults(results, $searchResults, city => {
  if (searchMode === 'home') { setHome(city.city, city.country, city.tz, true); closeSearch(); return; }
  const added = addZone(city.city, city.country, city.tz);
  if (searchMode === 'onboarding') {
    if (added) showToast(t('timezoneAdded', getLocalizedCityName(city)));
    $searchInput.value = ''; $searchResults.replaceChildren(); $searchMultiStatus.textContent = t('timezonesAdded', String(Math.max(0, config.zones.length - 1))); $searchInput.focus();
  } else closeSearch();
  });
});

function searchKeydown(event, list, close) {
  if (event.key === 'Escape' && close) close();
  else if (event.key === 'ArrowDown') { event.preventDefault(); navigateResults(list, 'down'); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); navigateResults(list, 'up'); }
  else if (event.key === 'Enter') { event.preventDefault(); selectCurrentResult(list); }
}
$searchInput.addEventListener('keydown', event => searchKeydown(event, $searchResults, searchMode === 'onboarding' ? null : closeSearch));
$homeSearch.addEventListener('input', () => renderSearchResults(searchCities($homeSearch.value), $homeResults, city => { setHome(city.city, city.country, city.tz); showGoalStep(); }));
$homeSearch.addEventListener('keydown', event => searchKeydown(event, $homeResults));
byId('goal-people').addEventListener('click', () => finishOnboarding('people'));
byId('goal-sample').addEventListener('click', () => finishOnboarding('sample'));
byId('goal-home').addEventListener('click', () => finishOnboarding('home'));

for (const [control, key, transform = value => value] of [
  [$toggle24h, 'use24h', value => value], [$toggleSeconds, 'showSeconds', value => value], [$toggleMotion, 'atmosphericMotion', value => value],
]) {
  control.addEventListener('change', () => { config[key] = transform(control.checked); saveConfig(); lastCanvasKey = ''; updateDisplay(); startTimer(); });
}
$densitySelect.addEventListener('change', () => { config.infoDensity = $densitySelect.value; saveConfig(); updateDisplay(); });
$themeSelect.addEventListener('change', () => { config.visualTheme = $themeSelect.value; saveConfig(); lastCanvasKey = ''; updateDisplay(); });
$storageSelect.addEventListener('change', () => changeStorageMode($storageSelect.value));
$presetSelect.addEventListener('change', () => activatePreset($presetSelect.value));
byId('save-preset-btn').addEventListener('click', savePreset);
byId('delete-preset-btn').addEventListener('click', deletePreset);
byId('change-home-btn').addEventListener('click', () => { closeSettings(); openSearch('home', $settingsBtn); });
byId('export-btn').addEventListener('click', exportBackup);
byId('import-btn').addEventListener('click', () => byId('import-file').click());
byId('import-file').addEventListener('change', event => { if (event.target.files[0]) importBackup(event.target.files[0]); event.target.value = ''; });

document.addEventListener('keydown', event => {
  if (event.defaultPrevented) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
  if (event.key === 'Escape') {
    if (!$searchOverlay.classList.contains('hidden')) { if (searchMode !== 'onboarding') closeSearch(); return; }
    if (!$settingsPanel.classList.contains('hidden')) { closeSettings({ restoreFocus: true }); return; }
    if (viewedOffsetMinutes) { returnToNow(); return; }
    if (planningOpen) { togglePlanner(false); return; }
    if (editMode) toggleEdit(false);
    return;
  }
  if (typing || !$firstRunModal.classList.contains('hidden')) return;
  if (event.key === '/' || event.key.toLowerCase() === 'a') { event.preventDefault(); openSearch('add'); }
  else if (event.key.toLowerCase() === 't') { event.preventDefault(); togglePlanner(); }
  else if (event.key.toLowerCase() === 'e') { event.preventDefault(); toggleEdit(); }
  else if (event.key === ',') { event.preventDefault(); $settingsPanel.classList.contains('hidden') ? openSettings() : closeSettings(); }
  else if (editMode && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target.classList.contains('tz-column')) {
    event.preventDefault(); moveZone(event.target.dataset.tz, event.key === 'ArrowLeft' ? -1 : 1);
  }
});

// Lifecycle
function startTimer() {
  if (updateTimer) clearTimeout(updateTimer);
  const interval = config.showSeconds ? 1000 : config.atmosphericMotion && viewedOffsetMinutes === 0 ? 5000 : 60000;
  updateTimer = setTimeout(() => { updateDisplay(); startTimer(); }, interval - Date.now() % interval + 20);
}

let resizeFrame = null;
addEventListener('resize', () => { if (resizeFrame) cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { resizeFrame = null; lastCanvasKey = ''; updateDisplay(); }); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (updateTimer) clearTimeout(updateTimer); updateTimer = null; }
  else if (config.home) { updateDisplay(); startTimer(); }
});

async function init() {
  await loadMessages(); applyLocalizedStaticText(); await loadData(); await loadConfig(); syncSettingsControls();
  if (!config.home || !config.onboardingComplete) showFirstRun();
  else { renderColumns(); startTimer(); }
}

init();
