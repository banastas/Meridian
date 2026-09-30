'use strict';

import {
  CONFIG_STORAGE_KEY,
  DEFAULT_TIMEZONES,
  DEFAULT_WORKING_HOURS,
  MAX_PRESETS,
  MAX_TIMEZONES,
  PLANNER_RANGE_MINUTES,
  addZoneByUtcOffset,
  areZonesAvailable,
  calculateLayoutWidth,
  calculateTimeFontSize,
  createBackup,
  createConfigStore,
  createPresetSnapshot,
  createSearchEntry,
  findAvailabilityWindows,
  floorToStep,
  formatRelativeOffset,
  formatUtcOffset,
  getDayStarts,
  getGradientColors,
  getNextOffsetTransition,
  getOffsetMinutes,
  getRepresentativeCity,
  getSolarGradientColors,
  getSmoothGradientStops,
  getTextColor,
  getTimeInZone as getCoreTimeInZone,
  getTimeZoneSearchNames,
  getZonedDateParts,
  isZoneAvailableAt,
  lerpColorRound,
  normalizeConfig,
  parseBackup,
  prefers24HourClock,
  resolveLocale,
  searchEntries,
  sortZonesByUtcOffset,
} from './core.js?v=1.2.2';

// Localization
let browserLocale = 'en';
let currentLocale = 'en';
let currentLanguage = 'en';
let currentMessageLocale = 'en';
let messages = {};
let cityLocalization = {};
let countryDisplayNames = null;
const timezoneSearchCache = new Map();
const timezoneNameFormatterCache = new Map();
const ASSET_VERSION = '1.2.2';

function hasChromeI18n() {
  return location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined' && chrome.i18n?.getMessage;
}

function hasChromeStorage() {
  return location.protocol === 'chrome-extension:' && typeof chrome !== 'undefined' && chrome.storage?.local;
}

async function fetchMessages(locale) {
  const response = await fetch(`_locales/${locale}/messages.json?v=${ASSET_VERSION}`);
  return response.ok ? response.json() : {};
}

async function loadMessages() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('lang') || (hasChromeI18n() && chrome.i18n.getUILanguage
    ? chrome.i18n.getUILanguage() : navigator.language);
  const locale = resolveLocale(requested);
  browserLocale = String(requested || locale.formatLocale).replace(/_/g, '-');
  currentLocale = locale.formatLocale;
  currentLanguage = locale.language;
  currentMessageLocale = locale.messageLocale;
  document.documentElement.lang = currentLocale;
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
// Time travel counts from the quarter hour that was current when it began,
// so planned times stay put while the planner is open.
let planningOrigin = floorToStep(Date.now());
let planningOpen = false;
let editMode = false;
let lastCanvasKey = '';
let dragTimeZone = null;
let toastTimer = null;
let summaryKey = '';
let timelineKey = '';
const transitionCache = new Map();
// The gradient has no edges, so it is painted at 1× and scaled up; a
// full-resolution backing store costs about 120 MB on a 10-clock 5K display.
const MAX_CANVAS_PIXEL_RATIO = 1;

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
const $searchEmpty = byId('search-empty');
const $homeSearch = byId('home-search');
const $homeResults = byId('home-results');
const $homeEmpty = byId('home-empty');
const $homeDetected = byId('home-detected');
const $homeSetLabel = byId('home-set-label');
const $planner = byId('planner');
const $plannerTime = byId('planner-time');
const $plannerOffset = byId('planner-offset');
const $availabilitySummary = byId('availability-summary');
const $settingsAvailability = byId('settings-availability');
const $timeSlider = byId('time-slider');
const $timelineDays = byId('timeline-days');
const $scrollLeft = byId('scroll-left');
const $scrollRight = byId('scroll-right');
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

// Keep the toast (and its Undo action) open while it is hovered or focused.
function pauseToast() {
  if (toastTimer && $toast.classList.contains('visible')) { clearTimeout(toastTimer); toastTimer = null; }
}
function resumeToast() {
  if (!toastTimer && $toast.classList.contains('visible') && !$toast.matches(':hover, :focus-within')) {
    toastTimer = setTimeout(hideToast, 2000);
  }
}
$toast.addEventListener('mouseenter', pauseToast); $toast.addEventListener('focusin', pauseToast);
$toast.addEventListener('mouseleave', resumeToast); $toast.addEventListener('focusout', resumeToast);

// Time and formatting
function viewedDate() {
  return viewedOffsetMinutes ? new Date(planningOrigin + viewedOffsetMinutes * 60000) : new Date();
}
function getTimeInZone(timeZone, date = viewedDate()) { return getCoreTimeInZone(timeZone, currentLocale, date); }

function getTzAbbreviation(timeZone, date) {
  const cacheKey = `${currentLocale}:${timeZone}`;
  if (!timezoneNameFormatterCache.has(cacheKey)) {
    timezoneNameFormatterCache.set(cacheKey, new Intl.DateTimeFormat(currentLocale, { timeZone, timeZoneName: 'short' }));
  }
  return timezoneNameFormatterCache.get(cacheKey).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || '';
}

const clockFormatterCache = new Map();
function formatClock(date, timeZone, includeDate = false) {
  const key = `${currentLocale}:${timeZone}:${includeDate}:${config.use24h}`;
  if (!clockFormatterCache.has(key)) {
    clockFormatterCache.set(key, new Intl.DateTimeFormat(currentLocale, {
      timeZone,
      ...(includeDate ? { weekday: 'short', month: 'short', day: 'numeric' } : {}),
      hour: 'numeric', minute: '2-digit', hour12: !config.use24h,
    }));
  }
  return clockFormatterCache.get(key).format(date);
}

function formatInputTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function parseInputTime(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

// Cached per hour; an entry is discarded once its transition is in the past.
function getTransition(timeZone, date) {
  const key = `${timeZone}:${Math.floor(date.getTime() / 3600000)}`;
  const cached = transitionCache.get(key);
  if (cached !== undefined && (!cached || cached.at > date)) return cached;
  const transition = getNextOffsetTransition(timeZone, date, 30);
  if (transitionCache.size > 500) transitionCache.clear();
  transitionCache.set(key, transition);
  return transition;
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

// Edit icons live in a <template> in newtab.html beside the toolbar icons.
const $editIcons = byId('edit-icons').content;
function createEditIcon(action) {
  return $editIcons.querySelector(`[data-icon="${action}"]`)?.cloneNode(true) || null;
}

// Weekday chips start on the locale's first day and use two letters, because
// one-letter names repeat (S, T in English; M in French).
let weekdayCache = null;
function getWeekdays() {
  if (weekdayCache?.locale === currentLocale) return weekdayCache.days;
  let firstDay = 1;
  try {
    const locale = new Intl.Locale(currentLocale);
    firstDay = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay || 1;
  } catch { /* Monday */ }
  const short = new Intl.DateTimeFormat(currentLocale, { weekday: 'short', timeZone: 'UTC' });
  const long = new Intl.DateTimeFormat(currentLocale, { weekday: 'long', timeZone: 'UTC' });
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = (firstDay + index) % 7;
    const date = new Date(Date.UTC(2024, 0, 7 + day)); // 7 January 2024 was a Sunday.
    const name = short.format(date).replace('.', '');
    return { day, short: name.charAt(0).toLocaleUpperCase(currentLocale) + name.slice(1, 2), long: long.format(date) };
  });
  weekdayCache = { locale: currentLocale, days };
  return days;
}

function createEditControls(zone, index) {
  const controls = document.createElement('div');
  controls.className = `edit-controls${editMode ? '' : ' hidden'}`;

  const cityNames = zone.cities.map(getLocalizedCityName).join(', ');
  const button = (action, label, handler, disabled = false) => {
    const element = document.createElement('button');
    element.type = 'button'; element.title = label; element.dataset.action = action;
    element.setAttribute('aria-label', label); element.disabled = disabled;
    element.append(createEditIcon(action) || t('groupCityShort'));
    element.addEventListener('click', handler); return element;
  };
  controls.append(
    button('move-left', t('moveLeft'), () => moveZone(zone.tz, -1, '[data-action="move-left"]'), index === 0),
    button('move-right', t('moveRight'), () => moveZone(zone.tz, 1, '[data-action="move-right"]'), index === config.zones.length - 1),
  );
  if (config.home?.tz !== zone.tz) {
    controls.append(
      button('home', t('setAsHome'), () => setHome(zone.cities[0].city, zone.cities[0].country, zone.tz, true)),
      button('remove', t('removeNamedTimezone', cityNames), () => removeZone(zone.tz)),
    );
  }
  controls.append(button('group', t('groupCity'), event => openSearch('group', event.currentTarget, zone.tz)));

  const hours = document.createElement('div');
  hours.className = 'hours-editor';
  hours.setAttribute('role', 'group');
  hours.setAttribute('aria-label', `${t('hoursShort')} — ${cityNames}`);
  const toggle = document.createElement('label');
  toggle.className = 'hours-toggle';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox'; enabled.checked = zone.workingHours.enabled;
  enabled.setAttribute('aria-label', t('includeWorkingHours'));
  const label = document.createElement('span'); label.textContent = t('hoursShort');
  toggle.append(enabled, label);
  const start = document.createElement('input');
  start.type = 'time'; start.value = formatInputTime(zone.workingHours.start);
  start.setAttribute('aria-label', t('workingDayStarts'));
  const end = document.createElement('input');
  end.type = 'time'; end.value = formatInputTime(zone.workingHours.end);
  end.setAttribute('aria-label', t('workingDayEnds'));
  const range = document.createElement('span');
  range.className = 'hours-range';
  range.append(start, document.createTextNode('–'), end);

  const dayPicker = document.createElement('div');
  dayPicker.className = 'day-picker';
  dayPicker.setAttribute('role', 'group');
  dayPicker.setAttribute('aria-label', `${t('workingDays')} — ${cityNames}`);
  // saveConfig() replaces zone objects, so always update the live one.
  const liveZone = () => config.zones.find(item => item.tz === zone.tz);
  const dayChips = getWeekdays().map(({ day, short, long }) => {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'day-chip'; chip.textContent = short; chip.title = long;
    chip.setAttribute('aria-label', long);
    chip.setAttribute('aria-pressed', String(zone.workingHours.days.includes(day)));
    chip.addEventListener('click', () => {
      const current = liveZone();
      if (!current) return;
      const days = new Set(current.workingHours.days);
      if (days.has(day)) {
        if (days.size === 1) return; // keep at least one working day
        days.delete(day);
      } else days.add(day);
      current.workingHours = { ...current.workingHours, days: [...days].sort((a, b) => a - b) };
      chip.setAttribute('aria-pressed', String(days.has(day)));
      saveConfig(); updateDisplay();
    });
    return chip;
  });
  dayPicker.append(...dayChips);

  // Hours and days only matter while the clock takes part in availability.
  const setScheduleDisabled = disabled => { for (const control of [start, end, ...dayChips]) control.disabled = disabled; };
  setScheduleDisabled(!zone.workingHours.enabled);
  const update = () => {
    const current = liveZone();
    if (!current) return;
    if (!start.value || !end.value) {
      start.value = formatInputTime(current.workingHours.start); end.value = formatInputTime(current.workingHours.end);
      return;
    }
    current.workingHours = { ...current.workingHours, enabled: enabled.checked, start: parseInputTime(start.value), end: parseInputTime(end.value) };
    setScheduleDisabled(!enabled.checked);
    saveConfig(); updateDisplay();
  };
  enabled.addEventListener('change', update); start.addEventListener('change', update); end.addEventListener('change', update);
  hours.append(toggle, range, dayPicker);
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
  const dpr = Math.min(devicePixelRatio || 1, MAX_CANVAS_PIXEL_RATIO);
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
  // A zero-height viewport (background or minimized tab) makes drawImage throw; repaint on resize.
  if (canvasKey !== lastCanvasKey && canvasHeight > 0) {
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
    column.dataset.tone = textColor === 'rgb(0, 0, 0)' ? 'light' : 'dark';
    const timeElement = column.querySelector('.time-display'); timeElement.style.fontSize = `${timeSize}px`;
    const hour = config.use24h ? String(time.hour24).padStart(2, '0') : time.hour12;
    const timeParts = [document.createTextNode(`${hour}:${time.minute}`)];
    if (config.showSeconds) {
      const seconds = document.createElement('span');
      seconds.className = 'seconds'; seconds.textContent = `:${time.second}`; timeParts.push(seconds);
    }
    if (!config.use24h) {
      const period = document.createElement('span');
      period.className = 'ampm'; period.textContent = time.ampm; timeParts.push(period);
    }
    timeElement.replaceChildren(...timeParts);
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
    const available = isZoneAvailableAt(zone, date);
    column.classList.toggle('is-available', available);
  });

  document.body.classList.toggle('density-compact', config.infoDensity === 'compact');
  updatePlanner(date);
  updateScrollHints();
}

function updatePlanner(date) {
  if (!config.home) return;
  const now = new Date();
  const homeTime = formatClock(date, config.home.tz, true);
  const ahead = viewedOffsetMinutes ? formatRelativeOffset(Math.round((date - now) / 60000), 0) : '';
  $plannerTime.textContent = homeTime;
  $plannerOffset.textContent = ahead;
  $timeSlider.setAttribute('aria-valuetext', ahead ? `${homeTime} (${ahead})` : `${t('now')}, ${homeTime}`);
  renderTimelineDays();
  updateAvailabilitySummary(date, now);
}

// Rebuilt only when it changes, so a focused overlap button survives ticks.
function setAvailabilitySummary(text, jumpTo = null) {
  const key = `${text}|${jumpTo?.getTime() ?? ''}`;
  if (key === summaryKey) return;
  summaryKey = key;
  if (!jumpTo) { $availabilitySummary.textContent = text; return; }
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'summary-link'; button.textContent = text; button.title = t('jumpToOverlap');
  button.addEventListener('click', () => { jumpToTime(jumpTo); $timeSlider.focus(); });
  $availabilitySummary.replaceChildren(button);
}

function updateAvailabilitySummary(date, now) {
  if (!config.availabilityEnabled) { setAvailabilitySummary(t('enableAvailabilityHint')); return; }
  if (areZonesAvailable(config.zones, date)) {
    setAvailabilitySummary(t(viewedOffsetMinutes ? 'everyoneAvailableAtTime' : 'everyoneAvailableNow')); return;
  }
  const windows = findAvailabilityWindows(config.zones, now);
  if (!windows.length) { setAvailabilitySummary(t('noOverlapNext48')); return; }
  const next = windows.find(window => window.start > date);
  if (!next) { setAvailabilitySummary(t('noLaterOverlap')); return; }
  const others = config.zones.filter(zone => zone.tz !== config.home.tz).slice(0, 1);
  const labels = [{ tz: config.home.tz, city: config.home }, ...others.map(zone => ({ tz: zone.tz, city: zone.cities[0] }))]
    .map(({ tz, city }) => {
      const day = isSameZonedDay(next.start, now, tz) ? '' : `${formatWeekday(next.start, tz)} `;
      return `${getLocalizedCityName(city)} ${day}${formatClock(next.start, tz)}–${formatClock(next.end, tz)}`;
    });
  setAvailabilitySummary(t('bestOverlap', labels.join(' · ')), next.start);
}

function isSameZonedDay(a, b, timeZone) {
  const [left, right] = [getZonedDateParts(timeZone, a), getZonedDateParts(timeZone, b)];
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

const weekdayFormatterCache = new Map();
function formatWeekday(date, timeZone) {
  const key = `${currentLocale}:${timeZone}`;
  if (!weekdayFormatterCache.has(key)) weekdayFormatterCache.set(key, new Intl.DateTimeFormat(currentLocale, { timeZone, weekday: 'short' }));
  return weekdayFormatterCache.get(key).format(date);
}

// Day markers sit at home-timezone midnights; the track spans the thumb's
// travel, which is inset by half its 16px width at each end.
function renderTimelineDays() {
  const origin = viewedOffsetMinutes ? planningOrigin : floorToStep(Date.now());
  const key = `${config.home.tz}:${origin}:${currentLocale}`;
  if (key === timelineKey) return;
  timelineKey = key;
  const mark = (fraction, label, className) => {
    const element = document.createElement('span');
    element.className = `timeline-mark ${className}`;
    element.style.setProperty('--position', String(fraction));
    element.textContent = label;
    return element;
  };
  const days = getDayStarts(config.home.tz, origin, PLANNER_RANGE_MINUTES)
    .map(({ minutes, at }) => ({ fraction: minutes / PLANNER_RANGE_MINUTES, label: formatWeekday(at, config.home.tz) }));
  const marks = days.map(({ fraction, label }) => mark(fraction, label, fraction > 0.92 ? 'is-day is-end' : 'is-day'));
  if (!days.length || days[0].fraction > 0.08) marks.unshift(mark(0, t('now'), 'is-now'));
  $timelineDays.replaceChildren(...marks);
}

function setViewedOffset(minutes) {
  const next = Math.max(0, Math.min(PLANNER_RANGE_MINUTES, minutes));
  const wasLive = !viewedOffsetMinutes;
  if (wasLive && next) planningOrigin = floorToStep(Date.now());
  viewedOffsetMinutes = next;
  $timeSlider.value = String(next);
  lastCanvasKey = '';
  updateDisplay();
  if (wasLive !== !next) startTimer();
}

function jumpToTime(date) {
  if (!viewedOffsetMinutes) planningOrigin = floorToStep(Date.now());
  setViewedOffset(Math.round((date - planningOrigin) / 60000));
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
    if (config.zones.length >= MAX_TIMEZONES) { showToast(t('maxTimezones')); return false; }
    config.zones = addZoneByUtcOffset(config.zones, {
      tz: timeZone,
      cities: [{ city, country }],
      workingHours: { ...DEFAULT_WORKING_HOURS },
    });
  }
  saveConfig(); renderColumns(); return true;
}

// Re-rendering replaces every column, so restore focus explicitly.
function focusColumn(timeZone, selector = null) {
  const column = $columns.querySelector(`[data-tz="${CSS.escape(timeZone)}"]`);
  const target = selector ? column?.querySelector(selector) : null;
  (target && !target.disabled ? target : column?.querySelector('.column-content'))?.focus();
}

function removeZone(timeZone) {
  if (config.home?.tz === timeZone) return;
  const index = config.zones.findIndex(zone => zone.tz === timeZone);
  if (index < 0) return;
  const [removed] = config.zones.splice(index, 1);
  saveConfig(); renderColumns();
  const neighbor = config.zones[Math.min(index, config.zones.length - 1)];
  if (neighbor) focusColumn(neighbor.tz, '[data-action="remove"]');
  showToast(t('timezoneRemoved', removed.cities.map(getLocalizedCityName).join(', ')), {
    label: t('undo'),
    run: () => {
      if (config.zones.some(zone => zone.tz === removed.tz)) return;
      if (config.zones.length >= MAX_TIMEZONES) { showToast(t('maxTimezones')); return; }
      config.zones.splice(Math.min(index, config.zones.length), 0, removed); saveConfig(); renderColumns();
      focusColumn(removed.tz, '[data-action="remove"]');
    },
  });
}

function setHome(city, country, timeZone, announce = false) {
  const existing = config.zones.find(zone => zone.tz === timeZone);
  if (!existing && config.zones.length >= MAX_TIMEZONES) { showToast(t('maxTimezones')); return false; }
  config.home = { city, country, tz: timeZone };
  if (!existing) config.zones = addZoneByUtcOffset(config.zones, { tz: timeZone, cities: [{ city, country }], workingHours: { ...DEFAULT_WORKING_HOURS } });
  else if (!existing.cities.some(item => item.city === city && item.country === country)) existing.cities.unshift({ city, country });
  saveConfig(); renderColumns();
  if (announce) { showToast(t('homeChanged', getLocalizedCityName({ city, country }))); focusColumn(timeZone, '[data-action="group"]'); }
  return true;
}

function moveZone(timeZone, direction, focusSelector = null) {
  const index = config.zones.findIndex(zone => zone.tz === timeZone), target = index + direction;
  if (index < 0 || target < 0 || target >= config.zones.length) return;
  [config.zones[index], config.zones[target]] = [config.zones[target], config.zones[index]];
  saveConfig(); renderColumns();
  if (focusSelector) focusColumn(timeZone, focusSelector);
  else $columns.querySelector(`[data-tz="${CSS.escape(timeZone)}"]`)?.focus();
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
function chromeStorageArea(area) {
  const storage = chrome.storage?.[area];
  if (!storage) return null;
  const call = (method, argument) => new Promise((resolve, reject) => {
    storage[method](argument, result => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message)); else resolve(result);
    });
  });
  return { get: keys => call('get', keys), set: items => call('set', items), remove: keys => call('remove', keys) };
}

// HTTP previews use origin-scoped localStorage with the same area shape.
const localStorageArea = {
  async get(keys) {
    const items = {};
    for (const key of keys) {
      try {
        const value = localStorage.getItem(key);
        if (value !== null) items[key] = JSON.parse(value);
      } catch { /* ignore unreadable preview data */ }
    }
    return items;
  },
  async set(items) { for (const [key, value] of Object.entries(items)) localStorage.setItem(key, JSON.stringify(value)); },
  async remove(keys) { for (const key of keys) localStorage.removeItem(key); },
};

let lastSyncErrorToast = 0;
const store = createConfigStore(hasChromeStorage()
  ? { local: chromeStorageArea('local'), sync: chromeStorageArea('sync'), onSyncError: reportSyncError }
  : { local: localStorageArea });

function reportSyncError(error) {
  console.warn('Meridian could not write to Chrome Sync.', error);
  if (Date.now() - lastSyncErrorToast < 60000) return;
  lastSyncErrorToast = Date.now();
  showToast(t('syncSaveFailed'));
}

async function loadConfig() {
  try {
    const result = await store.load();
    config = result.config;
    return result;
  } catch (error) {
    console.error('Meridian could not load settings.', error);
    config = normalizeConfig({});
    return { config, adopted: false };
  }
}

function saveConfig() {
  config = normalizeConfig(config);
  store.save(config).catch(error => console.error('Meridian could not save settings.', error));
  syncSettingsControls();
}

async function changeStorageMode(mode) {
  try {
    const result = await store.setMode(config, mode);
    config = result.config;
    renderColumns(); syncSettingsControls();
    if (result.adopted) {
      showToast(t('syncAdopted'), {
        label: t('keepThisDevice'),
        run: () => { config = { ...result.previous, storageMode: 'sync' }; saveConfig(); store.flush(); renderColumns(); },
      });
    } else showToast(t(config.storageMode === 'sync' ? 'syncEnabled' : 'localStorageEnabled'));
  } catch (error) {
    console.warn('Meridian could not change storage mode.', error);
    syncSettingsControls();
    showToast(t('syncUnavailable'));
  }
}

// Other tabs (and, in sync mode, other devices) save the same configuration.
// Reload it so a stale tab never writes its old copy over newer changes.
let externalReloadTimer = null;
function scheduleExternalReload() {
  clearTimeout(externalReloadTimer);
  externalReloadTimer = setTimeout(async () => {
    let next;
    try { ({ config: next } = await store.load({ repair: false })); } catch { return; }
    if (!next.home || !next.onboardingComplete || JSON.stringify(next) === JSON.stringify(config)) return;
    config = next;
    if (!$firstRunModal.classList.contains('hidden')) {
      $firstRunModal.classList.add('hidden'); setPageInert(false); startTimer();
    }
    renderColumns(); syncSettingsControls();
  }, 150);
}

if (hasChromeStorage()) {
  chrome.storage.onChanged.addListener(changes => { if (store.isExternalChange(changes)) scheduleExternalReload(); });
} else {
  addEventListener('storage', event => { if (event.key === CONFIG_STORAGE_KEY) scheduleExternalReload(); });
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
    if (config.presets.length >= MAX_PRESETS) { showToast(t('maxPresets')); return; }
    preset = { id: crypto.randomUUID ? crypto.randomUUID() : `preset-${Date.now()}` };
    config.presets.push(preset);
  }
  Object.assign(preset, { id: preset.id, name, ...createPresetSnapshot(config) });
  config.activePresetId = preset.id; $presetName.value = '';
  saveConfig(); renderPresets(); showToast(t('presetSaved', name));
}

// Loading a preset replaces the clocks on screen, so Undo restores them.
function activatePreset(id) {
  if (!id) { config.activePresetId = null; saveConfig(); renderPresets(); return; }
  const preset = config.presets.find(item => item.id === id); if (!preset) return;
  const previous = config;
  const storageMode = config.storageMode, presets = config.presets;
  config = normalizeConfig({ ...createPresetSnapshot(preset), presets, activePresetId: id, storageMode, onboardingComplete: true });
  saveConfig(); renderColumns(); syncSettingsControls();
  showToast(t('presetLoaded', preset.name), {
    label: t('undo'),
    run: () => {
      config = normalizeConfig({ ...previous, presets: config.presets, storageMode: config.storageMode });
      saveConfig(); renderColumns(); syncSettingsControls();
    },
  });
}

function deletePreset() {
  const index = config.presets.findIndex(item => item.id === config.activePresetId); if (index < 0) return;
  const preset = config.presets[index];
  config.presets = config.presets.filter(item => item.id !== preset.id); config.activePresetId = null;
  saveConfig(); renderPresets();
  showToast(t('presetDeleted', preset.name), {
    label: t('undo'),
    run: () => {
      if (config.presets.some(item => item.id === preset.id)) return;
      if (config.presets.length >= MAX_PRESETS) { showToast(t('maxPresets')); return; }
      config.presets.splice(Math.min(index, config.presets.length), 0, preset);
      config.activePresetId = preset.id;
      saveConfig(); renderPresets();
    },
  });
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
    config = parseBackup(payload, { storageMode: config.storageMode });
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

function getLocalizedTimezoneNames(timeZone) {
  const key = `${currentLocale}:${timeZone}`;
  if (!timezoneSearchCache.has(key)) timezoneSearchCache.set(key, getTimeZoneSearchNames(timeZone, currentLocale));
  return timezoneSearchCache.get(key);
}

// The index holds every city's normalized names. Localized timezone names
// take a few hundred milliseconds to build, so the index fills in idle time
// once search opens and any remainder is finished on the first keystroke.
const searchIndex = [];
function indexNextCity() {
  const city = cities[searchIndex.length];
  searchIndex.push(createSearchEntry(city, {
    names: [city.city, getLocalizedCityName(city), ...getLocalizedCityAliases(city)],
    countries: [getCountryName(city.country)],
    zoneNames: getLocalizedTimezoneNames(city.tz),
  }));
}

let searchIndexWarm = false;
function warmSearchIndex() {
  if (searchIndexWarm) return;
  searchIndexWarm = true;
  const idle = window.requestIdleCallback || (callback => setTimeout(() => callback({ timeRemaining: () => 8 }), 16));
  const step = deadline => {
    while (searchIndex.length < cities.length && deadline.timeRemaining() > 1) indexNextCity();
    if (searchIndex.length < cities.length) idle(step);
  };
  idle(step);
}

function searchCities(query) {
  while (searchIndex.length < cities.length) indexNextCity();
  return searchEntries(searchIndex, query);
}

function renderSearchResults(results, list, onSelect) {
  list.replaceChildren(); searchSelectedIndex = -1;
  const input = list === $homeResults ? $homeSearch : $searchInput;
  const empty = list === $homeResults ? $homeEmpty : $searchEmpty;
  input.removeAttribute('aria-activedescendant'); input.setAttribute('aria-expanded', String(results.length > 0));
  empty.textContent = results.length || !input.value.trim() ? '' : t('noSearchResults');
  const now = new Date();
  const homeOffset = config.home ? getOffsetMinutes(config.home.tz, now) : null;
  results.forEach((city, index) => {
    const item = document.createElement('li'); item.id = `${list.id}-option-${index}`; item.role = 'option'; item.ariaSelected = 'false';
    const name = document.createElement('span'); name.className = 'city-name'; name.textContent = `${getLocalizedCityName(city)}, ${getCountryName(city.country)}`;
    const meta = document.createElement('span'); meta.className = 'city-meta';
    const time = document.createElement('span'); time.className = 'city-time';
    const relative = homeOffset === null ? '' : formatRelativeOffset(getOffsetMinutes(city.tz, now), homeOffset);
    time.textContent = relative ? `${formatClock(now, city.tz)} \u00b7 ${relative}` : formatClock(now, city.tz);
    const zone = document.createElement('span'); zone.className = 'city-tz'; zone.textContent = city.tz;
    meta.append(time, zone);
    item.append(name, meta); item.addEventListener('click', () => onSelect(city)); list.append(item);
  });
  // Highlight the best match so Enter picks it without arrowing first.
  if (results.length) navigateResults(list, 'down');
}

function clearSearchResults(list) {
  list.replaceChildren();
  (list === $homeResults ? $homeEmpty : $searchEmpty).textContent = '';
}

function navigateResults(list, direction) {
  const items = [...list.querySelectorAll('li')]; if (!items.length) return;
  searchSelectedIndex = direction === 'down' ? Math.min(searchSelectedIndex + 1, items.length - 1) : Math.max(searchSelectedIndex - 1, 0);
  items.forEach((item, index) => { item.classList.toggle('selected', index === searchSelectedIndex); item.ariaSelected = String(index === searchSelectedIndex); });
  const input = list === $homeResults ? $homeSearch : $searchInput;
  input.setAttribute('aria-activedescendant', items[searchSelectedIndex].id); items[searchSelectedIndex].scrollIntoView({ block: 'nearest' });
}

function selectCurrentResult(list) { const items = list.querySelectorAll('li'); items[searchSelectedIndex]?.click(); }

function setPageInert(inert) {
  for (const element of [$dashboard, $toolbar, $planner, $settingsPanel, $scrollLeft, $scrollRight]) element.inert = inert;
}

function isModalOpen() {
  return !$searchOverlay.classList.contains('hidden') || !$firstRunModal.classList.contains('hidden');
}

function openSearch(mode = 'add', returnFocus = document.activeElement, targetTimeZone = null) {
  closeSettings();
  searchMode = mode; searchReturnFocus = returnFocus; searchTargetTimeZone = targetTimeZone;
  $searchTitle.textContent = mode === 'home' ? t('changeHomeTimezone')
    : mode === 'onboarding' ? t('addMyPeople')
      : mode === 'group' ? t('addCityToTimezone', targetTimeZone)
        : t('addTimezone');
  $searchInput.placeholder = mode === 'home' ? t('searchYourCity') : t('searchCityOrTimezone');
  $searchMultiFooter.classList.toggle('hidden', mode !== 'onboarding');
  updateMultiAddStatus();
  $searchOverlay.classList.remove('hidden'); setPageInert(true);
  $searchInput.value = ''; clearSearchResults($searchResults); $searchInput.ariaExpanded = 'false';
  setTimeout(() => $searchInput.focus(), 40);
  warmSearchIndex();
}

function updateMultiAddStatus() {
  const count = Math.max(0, config.zones.length - 1);
  let key = 'timezonesAdded';
  try { if (new Intl.PluralRules(currentLocale).select(count) === 'one') key = 'timezoneAddedCount'; } catch { /* keep plural */ }
  $searchMultiStatus.textContent = t(key, String(count));
}

function closeSearch() {
  $searchOverlay.classList.add('hidden'); setPageInert(false); $searchInput.value = ''; clearSearchResults($searchResults);
  $searchInput.ariaExpanded = 'false'; $searchInput.removeAttribute('aria-activedescendant');
  // Adding a city re-renders the columns, detaching the button that opened search.
  const fallback = searchTargetTimeZone
    ? $columns.querySelector(`[data-tz="${CSS.escape(searchTargetTimeZone)}"] [data-action="group"]`)
    : $addBtn;
  (searchReturnFocus?.isConnected ? searchReturnFocus : fallback)?.focus?.();
  searchReturnFocus = null;
  searchTargetTimeZone = null;
}

// Onboarding
function showGoalStep() {
  if (config.home) $homeSetLabel.textContent = t('homeSetTo', getLocalizedCityName(config.home));
  $onboardingHomeStep.classList.add('hidden'); $onboardingGoalStep.classList.remove('hidden'); byId('goal-people').focus();
}

// Before onboarding finishes the only clock is the chosen home, so going
// back clears it rather than leaving the first choice behind as a column.
function returnToHomeStep() {
  config.home = null; config.zones = [];
  saveConfig(); renderColumns();
  $onboardingGoalStep.classList.add('hidden'); $onboardingHomeStep.classList.remove('hidden');
  $homeSearch.value = ''; clearSearchResults($homeResults); $homeSearch.ariaExpanded = 'false';
  $homeSearch.focus();
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
    button.textContent = t('useDetectedLocation', [getLocalizedCityName(detected), getCountryName(detected.country), detected.tz]);
    button.addEventListener('click', () => { setHome(detected.city, detected.country, detected.tz); showGoalStep(); });
    $homeDetected.append(button);
  } else {
    const message = document.createElement('p'); message.className = 'detected-message'; message.textContent = t('detectedSearchPrompt', systemTimeZone); $homeDetected.append(message);
  }
  setTimeout(() => $homeSearch.focus(), 80);
  warmSearchIndex();
}

// Planner, editing, settings
function togglePlanner(force) {
  planningOpen = typeof force === 'boolean' ? force : !planningOpen;
  if (planningOpen && editMode) {
    editMode = false; $editBtn.ariaPressed = 'false'; renderColumns();
  }
  // Time travel is only shown while the planner is open; closing it by any
  // route must return every clock to the live time.
  if (!planningOpen && viewedOffsetMinutes) {
    viewedOffsetMinutes = 0; $timeSlider.value = '0'; lastCanvasKey = '';
  }
  if (planningOpen) planningOrigin = floorToStep(Date.now());
  const hadFocus = $planner.contains(document.activeElement);
  $planner.classList.toggle('hidden', !planningOpen); document.body.classList.toggle('planning-mode', planningOpen);
  $timeTravelBtn.ariaExpanded = String(planningOpen);
  updateDisplay(); startTimer();
  if (planningOpen) $timeSlider.focus();
  else if (hadFocus) $timeTravelBtn.focus();
}

function returnToNow(close = false) {
  viewedOffsetMinutes = 0; $timeSlider.value = '0'; lastCanvasKey = ''; updateDisplay(); startTimer();
  if (close) togglePlanner(false);
}

function toggleEdit(force) {
  const nextEditMode = typeof force === 'boolean' ? force : !editMode;
  if (nextEditMode && planningOpen) returnToNow(true);
  editMode = nextEditMode;
  $editBtn.ariaPressed = String(editMode); renderColumns();
}

// The planner and Settings both expose this switch; syncSettingsControls()
// keeps them in step.
function setAvailability(enabled) {
  config.availabilityEnabled = enabled;
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
  $availabilityToggle.checked = config.availabilityEnabled; $settingsAvailability.checked = config.availabilityEnabled;
  document.body.classList.toggle('availability-mode', config.availabilityEnabled);
  renderPresets();
}

// Edge fades and arrow buttons appear only in a direction with more clocks.
let scrollHintFrame = null;
function updateScrollHints() {
  const maxScroll = $dashboard.scrollWidth - $dashboard.clientWidth;
  document.body.classList.toggle('can-scroll-left', $dashboard.scrollLeft > 1);
  document.body.classList.toggle('can-scroll-right', $dashboard.scrollLeft < maxScroll - 1);
}

function scrollColumns(direction) {
  const column = $columns.querySelector('.tz-column');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $dashboard.scrollBy({ left: direction * (column?.offsetWidth || innerWidth / 2), behavior: reduceMotion ? 'auto' : 'smooth' });
}

// Events
$addBtn.addEventListener('click', () => openSearch('add', $addBtn));
$timeTravelBtn.addEventListener('click', () => togglePlanner());
$availabilityToggle.addEventListener('change', () => setAvailability($availabilityToggle.checked));
$settingsAvailability.addEventListener('change', () => setAvailability($settingsAvailability.checked));
$editBtn.addEventListener('click', () => toggleEdit());
$settingsBtn.addEventListener('click', event => { event.stopPropagation(); $settingsPanel.classList.contains('hidden') ? openSettings() : closeSettings(); });
byId('settings-close').addEventListener('click', () => closeSettings({ restoreFocus: true }));
byId('search-close').addEventListener('click', closeSearch);
byId('search-done').addEventListener('click', closeSearch);
byId('now-btn').addEventListener('click', () => returnToNow());
$searchOverlay.addEventListener('click', event => { if (event.target === $searchOverlay && searchMode !== 'onboarding') closeSearch(); });
document.addEventListener('click', event => { if (!$settingsPanel.contains(event.target) && event.target !== $settingsBtn) closeSettings(); });

$timeSlider.addEventListener('input', () => setViewedOffset(Number($timeSlider.value)));
$timeSlider.addEventListener('keydown', event => {
  const increments = { ArrowRight: 15, ArrowUp: 15, ArrowLeft: -15, ArrowDown: -15, PageUp: 60, PageDown: -60 };
  if (increments[event.key]) { event.preventDefault(); setViewedOffset(viewedOffsetMinutes + increments[event.key]); }
});

byId('goal-back').addEventListener('click', returnToHomeStep);
$scrollLeft.addEventListener('click', () => scrollColumns(-1));
$scrollRight.addEventListener('click', () => scrollColumns(1));
$dashboard.addEventListener('scroll', () => {
  if (scrollHintFrame) return;
  scrollHintFrame = requestAnimationFrame(() => { scrollHintFrame = null; updateScrollHints(); });
}, { passive: true });

$searchInput.addEventListener('input', () => {
  const results = searchCities($searchInput.value).filter(city => searchMode !== 'group' || city.tz === searchTargetTimeZone);
  renderSearchResults(results, $searchResults, city => {
  if (searchMode === 'home') { if (setHome(city.city, city.country, city.tz, true)) closeSearch(); return; }
  const added = addZone(city.city, city.country, city.tz);
  if (searchMode === 'onboarding') {
    if (added) showToast(t('timezoneAdded', getLocalizedCityName(city)));
    $searchInput.value = ''; clearSearchResults($searchResults); updateMultiAddStatus(); $searchInput.focus();
  } else closeSearch();
  });
});

function searchKeydown(event, list, close) {
  // Handle Escape here only; letting it bubble would also reset time travel or edit mode.
  if (event.key === 'Escape') { event.preventDefault(); close?.(); }
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

// Shortcuts stay active on buttons, checkboxes, and the time slider, but not
// where letters are typed.
const TEXT_ENTRY_TYPES = new Set(['text', 'search', 'email', 'number', 'password', 'tel', 'url', 'time', 'date', 'datetime-local', 'month', 'week']);
function isTextEntry(element) {
  if (!element) return false;
  if (element.isContentEditable || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true;
  return element.tagName === 'INPUT' && TEXT_ENTRY_TYPES.has(element.type);
}

document.addEventListener('keydown', event => {
  if (event.defaultPrevented) return;
  if (event.key === 'Escape') {
    if (!$searchOverlay.classList.contains('hidden')) { if (searchMode !== 'onboarding') closeSearch(); return; }
    if (!$firstRunModal.classList.contains('hidden')) return;
    if (!$settingsPanel.classList.contains('hidden')) { closeSettings({ restoreFocus: true }); return; }
    if (viewedOffsetMinutes) { returnToNow(); return; }
    if (planningOpen) { togglePlanner(false); return; }
    if (editMode) toggleEdit(false);
    return;
  }
  if (isModalOpen() || isTextEntry(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (editMode && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target.classList.contains('tz-column')) {
    event.preventDefault(); moveZone(event.target.dataset.tz, event.key === 'ArrowLeft' ? -1 : 1); return;
  }
  if (event.repeat) return;
  if (event.key === '/' || event.key.toLowerCase() === 'a') { event.preventDefault(); openSearch('add'); }
  else if (event.key.toLowerCase() === 't') { event.preventDefault(); togglePlanner(); }
  else if (event.key.toLowerCase() === 'e') { event.preventDefault(); toggleEdit(); }
  else if (event.key === ',') { event.preventDefault(); $settingsPanel.classList.contains('hidden') ? openSettings() : closeSettings(); }
});

// Lifecycle
function startTimer() {
  if (updateTimer) clearTimeout(updateTimer);
  const interval = config.showSeconds ? 1000 : config.atmosphericMotion && viewedOffsetMinutes === 0 ? 5000 : 60000;
  updateTimer = setTimeout(() => { try { updateDisplay(); } finally { startTimer(); } }, interval - Date.now() % interval + 20);
}

let resizeFrame = null;
addEventListener('resize', () => { if (resizeFrame) cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { resizeFrame = null; lastCanvasKey = ''; updateDisplay(); }); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (updateTimer) clearTimeout(updateTimer); updateTimer = null; store.flush(); }
  else if (config.home) { updateDisplay(); startTimer(); }
});
addEventListener('pagehide', () => { store.flush(); });

async function init() {
  await loadMessages(); applyLocalizedStaticText(); await loadData();
  const { adopted } = await loadConfig();
  // A fresh install starts with the browser locale's usual clock format.
  if (!config.home) config.use24h = prefers24HourClock(browserLocale);
  syncSettingsControls();
  if (!config.home || !config.onboardingComplete) showFirstRun();
  else { renderColumns(); startTimer(); if (adopted) showToast(t('syncAdopted')); }
}

init();
