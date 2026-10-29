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
  getLocalMinuteOfDay,
  getNextOffsetTransition,
  getOffsetMinutes,
  getRepresentativeCity,
  getSmoothGradientStops,
  getSkyLight,
  getSolarPaletteHour,
  mixColorAlpha,
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
} from './core.js?v=1.3.0';

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
const ASSET_VERSION = '1.3.0';

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
const $densityInputs = [...document.querySelectorAll('input[name="density"]')];
const $themeInputs = [...document.querySelectorAll('input[name="theme"]')];
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
const $timelineTrack = $planner.querySelector('.timeline-track');
const $timelineSky = byId('timeline-sky');
const $timelineWindows = byId('timeline-windows');
const $timelineTicks = byId('timeline-ticks');
const $travelChip = byId('travel-chip');
const $travelChipText = byId('travel-chip-text');
const $skyEvents = byId('sky-events');
const $columnMenu = byId('column-menu');
const $hoursPopover = byId('hours-popover');
const $hoursEnabled = byId('hours-enabled');
const $hoursStart = byId('hours-start');
const $hoursEnd = byId('hours-end');
const $hoursStartHandle = byId('hours-start-handle');
const $hoursEndHandle = byId('hours-end-handle');
const $hoursDays = byId('hours-days');
const $presetSwitcher = byId('preset-switcher');
const $presetSwitcherBtn = byId('preset-switcher-btn');
const $presetSwitcherName = byId('preset-switcher-name');
const $presetMenu = byId('preset-menu');
const $favicon = document.querySelector('link[rel="icon"]');
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

// Motion. Layout changes animate unless the system asks for reduced motion;
// purely decorative motion also follows the smooth-transitions setting.
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
function prefersReducedMotion() { return reducedMotionQuery.matches; }
function decorativeMotion() { return config.atmosphericMotion && !prefersReducedMotion(); }

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

function renderColumns({ animate = false } = {}) {
  const snapshot = animate ? captureLayout() : null;
  closeMenu({ restoreFocus: false });
  closeHoursPopover({ restoreFocus: false });
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
    // Hours, minutes, and seconds are separate so each can roll on its own and
    // the colon can be kerned and breathe.
    const part = (className, text = '') => {
      const element = document.createElement('span'); element.className = className; element.textContent = text; return element;
    };
    timeDisplay.append(part('time-hours'), part('colon', ':'), part('time-minutes'), part('seconds'), part('ampm'));
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
    column.append(createDragGrip(), availabilityBand, content, createEditControls(zone, index));
    attachDragHandlers(column);
    $columns.append(column);
  });
  document.body.classList.toggle('edit-mode', editMode);
  updateDisplay();
  playLayout(snapshot);
}

// Animates a re-render: each surviving clock slides from its old position,
// new clocks rise into place, and the previous sky cross-fades into the new one.
function captureLayout() {
  if (prefersReducedMotion() || !$columns.children.length || !$canvas.width) return null;
  const positions = new Map();
  for (const column of $columns.children) {
    const rect = column.getBoundingClientRect();
    positions.set(column.dataset.tz, rect.left + rect.width / 2);
  }
  const ghost = document.createElement('canvas');
  ghost.className = 'canvas-ghost'; ghost.setAttribute('aria-hidden', 'true');
  ghost.width = $canvas.width; ghost.height = $canvas.height;
  ghost.style.width = $canvas.style.width; ghost.style.height = $canvas.style.height;
  ghost.getContext('2d').drawImage($canvas, 0, 0);
  return { positions, ghost };
}

function playLayout(snapshot) {
  if (!snapshot) return;
  const ease = 'cubic-bezier(.2,.8,.2,1)';
  const animations = [];
  $canvas.after(snapshot.ghost);
  const fade = snapshot.ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 560, easing: 'ease-out', fill: 'forwards' });
  fade.finished.finally(() => snapshot.ghost.remove());
  for (const column of $columns.children) {
    const content = column.querySelector('.column-content');
    const before = snapshot.positions.get(column.dataset.tz);
    if (before === undefined) {
      animations.push(content.animate([
        { opacity: 0, transform: 'translateY(16px) scale(.97)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'none', filter: 'none' },
      ], { duration: 620, delay: 140, easing: ease, fill: 'backwards' }));
      continue;
    }
    const rect = column.getBoundingClientRect();
    const dx = before - (rect.left + rect.width / 2);
    if (Math.abs(dx) > 1) animations.push(content.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 520, easing: ease }));
  }
  // Columns clip their content; let clocks travel across neighbors while they slide.
  if (!animations.length) return;
  const columns = $columns.children;
  for (const column of columns) column.classList.add('is-reflowing');
  Promise.allSettled(animations.map(animation => animation.finished))
    .then(() => { for (const column of columns) column.classList.remove('is-reflowing'); });
}

// Sets a clock part, rolling the new value in when it changes.
function setRolling(element, text) {
  if (element.textContent === text) return;
  const roll = element.textContent !== '' && decorativeMotion();
  element.textContent = text;
  if (roll) {
    element.animate([
      { transform: 'translateY(-0.24em)', opacity: 0, filter: 'blur(2px)' },
      { transform: 'none', opacity: 1, filter: 'none' },
    ], { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
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

function getLiveZone(timeZone) { return config.zones.find(zone => zone.tz === timeZone); }

const hourFormatterCache = new Map();
function formatMinuteOfDay(minutes, compact = false) {
  const key = `${currentLocale}:${config.use24h}:${compact && minutes % 60 === 0}`;
  if (!hourFormatterCache.has(key)) {
    hourFormatterCache.set(key, new Intl.DateTimeFormat(currentLocale, {
      timeZone: 'UTC', hour: 'numeric', hour12: !config.use24h,
      ...(compact && minutes % 60 === 0 && !config.use24h ? {} : { minute: '2-digit' }),
    }));
  }
  return hourFormatterCache.get(key).format(new Date(Date.UTC(2024, 0, 1, 0, minutes % 1440)));
}

// "Mo–Fr", "Every day", or the individual days when they are not consecutive.
function summarizeDays(days) {
  if (days.length === 7) return t('everyDay');
  const ordered = getWeekdays().filter(({ day }) => days.includes(day));
  const all = getWeekdays().map(({ day }) => day);
  const positions = ordered.map(({ day }) => all.indexOf(day));
  const consecutive = positions.every((position, index) => index === 0 || position === positions[index - 1] + 1);
  if (consecutive && ordered.length > 2) return `${ordered[0].short}–${ordered.at(-1).short}`;
  return ordered.map(({ short }) => short).join(' ');
}

function describeHours(hours) {
  if (!hours.enabled) return { time: t('notInAvailability'), days: '' };
  return { time: `${formatMinuteOfDay(hours.start, true)}–${formatMinuteOfDay(hours.end, true)}`, days: summarizeDays(hours.days || []) };
}

function updateHoursChip(timeZone) {
  const zone = getLiveZone(timeZone);
  const chip = $columns.querySelector(`[data-tz="${CSS.escape(timeZone)}"] [data-action="hours"]`);
  if (!zone || !chip) return;
  const { time, days } = describeHours(zone.workingHours);
  chip.querySelector('.hours-chip-label').textContent = time;
  chip.querySelector('.hours-chip-days').textContent = days;
  chip.classList.toggle('is-off', !zone.workingHours.enabled);
  chip.setAttribute('aria-label', `${t('workingHoursFor', zone.cities.map(getLocalizedCityName).join(', '))}: ${[time, days].filter(Boolean).join(', ')}`);
}

// Edit mode adds a drag handle at the top of each clock and one compact row
// below it: the working-hours summary (which opens the hours editor) and a
// menu for everything else.
function createDragGrip() {
  const grip = document.createElement('span');
  grip.className = `drag-grip${editMode ? '' : ' hidden'}`; grip.title = t('dragToReorder'); grip.setAttribute('aria-hidden', 'true');
  grip.append(createEditIcon('grip'));
  return grip;
}

function createEditControls(zone, index) {
  const controls = document.createElement('div');
  controls.className = `edit-controls${editMode ? '' : ' hidden'}`;
  const cityNames = zone.cities.map(getLocalizedCityName).join(', ');

  const hours = document.createElement('button');
  hours.type = 'button'; hours.className = 'hours-chip'; hours.dataset.action = 'hours';
  hours.setAttribute('aria-haspopup', 'dialog'); hours.setAttribute('aria-expanded', 'false');
  const text = document.createElement('span'); text.className = 'hours-chip-text';
  const label = document.createElement('span'); label.className = 'hours-chip-label';
  const days = document.createElement('span'); days.className = 'hours-chip-days';
  text.append(label, days);
  hours.append(createEditIcon('hours'), text);
  hours.addEventListener('click', () => openHoursPopover(zone.tz, hours));

  const more = document.createElement('button');
  more.type = 'button'; more.className = 'more-button'; more.dataset.action = 'more';
  more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', 'column-menu');
  more.setAttribute('aria-label', t('moreActions', cityNames)); more.title = t('moreActions', cityNames);
  more.append(createEditIcon('more'));
  more.addEventListener('click', () => {
    if (openMenuState?.anchor === more) { closeMenu(); return; }
    const isHome = config.home?.tz === zone.tz;
    const position = config.zones.findIndex(item => item.tz === zone.tz);
    openMenu($columnMenu, more, [
      { icon: 'move-left', label: t('moveLeft'), disabled: position === 0, run: () => moveZone(zone.tz, -1, '[data-action="more"]') },
      { icon: 'move-right', label: t('moveRight'), disabled: position === config.zones.length - 1, run: () => moveZone(zone.tz, 1, '[data-action="more"]') },
      ...(isHome ? [] : [{ icon: 'home', label: t('setAsHome'), run: () => setHome(zone.cities[0].city, zone.cities[0].country, zone.tz, true) }]),
      { icon: 'group', label: t('groupCity'), run: () => openSearch('group', more, zone.tz) },
      ...(isHome ? [] : [{ separator: true }, { icon: 'remove', label: t('removeNamedTimezone', cityNames), danger: true, run: () => removeZone(zone.tz) }]),
    ], 'above');
  });

  controls.append(hours, more);
  queueMicrotask(() => updateHoursChip(zone.tz));
  return controls;
}

// Menus: arrows move between items, Escape returns to the button, and Tab or a
// click elsewhere closes the menu.
let openMenuState = null;
function openMenu(menu, anchor, items, placement = 'below') {
  closeMenu({ restoreFocus: false });
  menu.replaceChildren(...items.map(item => {
    if (item.separator) {
      const separator = document.createElement('div'); separator.className = 'menu-separator'; separator.role = 'separator'; return separator;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.role = item.checked === undefined ? 'menuitem' : 'menuitemradio';
    if (item.checked !== undefined) button.setAttribute('aria-checked', String(item.checked));
    if (item.danger) button.className = 'danger-text';
    const icon = item.icon ? createEditIcon(item.icon) : item.checked ? createEditIcon('check') : null;
    const iconSlot = document.createElement('span'); iconSlot.className = 'menu-icon';
    if (icon) iconSlot.append(icon);
    const text = document.createElement('span'); text.className = 'menu-label'; text.textContent = item.label;
    button.append(iconSlot, text);
    if (item.hint) { const hint = document.createElement('kbd'); hint.textContent = item.hint; button.append(hint); }
    button.disabled = Boolean(item.disabled);
    button.addEventListener('click', () => { closeMenu({ restoreFocus: false }); item.run(); });
    return button;
  }));
  menu.classList.remove('hidden');
  anchor.setAttribute('aria-expanded', 'true');
  openMenuState = { menu, anchor };
  positionFloating(menu, anchor, placement);
  menu.querySelector('button:not(:disabled)')?.focus();
}

function closeMenu({ restoreFocus = true } = {}) {
  if (!openMenuState) return false;
  const { menu, anchor } = openMenuState;
  openMenuState = null;
  menu.classList.add('hidden');
  anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && anchor.isConnected) anchor.focus();
  return true;
}

function menuKeydown(event) {
  const items = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
  const index = items.indexOf(document.activeElement);
  const moves = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 };
  if (event.key in moves) {
    event.preventDefault();
    items[(moves[event.key] + items.length) % items.length]?.focus();
  } else if (event.key === 'Escape') {
    event.preventDefault(); closeMenu();
  } else if (event.key === 'Tab') closeMenu({ restoreFocus: false });
}
$columnMenu.addEventListener('keydown', menuKeydown);
$presetMenu.addEventListener('keydown', menuKeydown);

// Places a fixed-position menu or popover beside its button, inside the viewport.
function positionFloating(element, anchor, placement) {
  const rect = anchor.getBoundingClientRect();
  const width = element.offsetWidth, height = element.offsetHeight, gap = 8, margin = 12;
  const left = Math.max(margin, Math.min(innerWidth - width - margin, rect.left + rect.width / 2 - width / 2));
  const above = rect.top - gap - height;
  const top = placement === 'above' && above > margin ? above : Math.min(innerHeight - height - margin, rect.bottom + gap);
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(Math.max(margin, top))}px`;
}

// Working-hours editor: a 24-hour bar painted with the day's sky, two handles
// for the start and end, exact time fields, and the working days.
let hoursState = null;
const HOURS_STEP = 15;

function openHoursPopover(timeZone, chip) {
  if (hoursState?.tz === timeZone) { closeHoursPopover(); return; }
  closeMenu({ restoreFocus: false });
  closeHoursPopover({ restoreFocus: false });
  const zone = getLiveZone(timeZone);
  if (!zone) return;
  hoursState = { tz: timeZone, chip };
  byId('hours-title').textContent = t('workingHoursFor', zone.cities.map(getLocalizedCityName).join(', '));
  $hoursDays.replaceChildren(...getWeekdays().map(({ day, short, long }) => {
    const chipButton = document.createElement('button');
    chipButton.type = 'button'; chipButton.className = 'day-chip'; chipButton.dataset.day = String(day);
    chipButton.textContent = short; chipButton.title = long; chipButton.setAttribute('aria-label', long);
    chipButton.addEventListener('click', () => {
      const current = getLiveZone(timeZone);
      if (!current) return;
      const days = new Set(current.workingHours.days);
      if (days.has(day)) {
        if (days.size === 1) return; // keep at least one working day
        days.delete(day);
      } else days.add(day);
      updateHours({ days: [...days].sort((a, b) => a - b) });
    });
    return chipButton;
  }));
  byId('hours-bar-sky').style.background = createDayGradient(hour => getGradientColors(Math.floor(hour) % 24, (hour % 1) * 60));
  $hoursPopover.classList.remove('hidden');
  chip.setAttribute('aria-expanded', 'true');
  syncHoursPopover();
  positionFloating($hoursPopover, chip, 'above');
  $hoursEnabled.focus();
}

function closeHoursPopover({ restoreFocus = true } = {}) {
  if (!hoursState) return false;
  const { tz } = hoursState;
  hoursState = null;
  $hoursPopover.classList.add('hidden');
  const chip = $columns.querySelector(`[data-tz="${CSS.escape(tz)}"] [data-action="hours"]`);
  chip?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) chip?.focus();
  return true;
}

function updateHours(patch) {
  const zone = hoursState && getLiveZone(hoursState.tz);
  if (!zone) return;
  zone.workingHours = { ...zone.workingHours, ...patch };
  saveConfig(); updateDisplay(); syncHoursPopover(); updateHoursChip(hoursState.tz);
}

// A stored end of 0 after a later start means midnight, drawn at the right edge.
function handlePosition(minutes, isEnd, hours) {
  return isEnd && minutes === 0 && hours.start > 0 ? 1440 : minutes;
}

function syncHoursPopover() {
  const zone = hoursState && getLiveZone(hoursState.tz);
  if (!zone) return;
  const hours = zone.workingHours;
  $hoursEnabled.checked = hours.enabled;
  $hoursPopover.classList.toggle('is-off', !hours.enabled);
  $hoursStart.value = formatInputTime(hours.start); $hoursEnd.value = formatInputTime(hours.end);
  for (const [handle, value, isEnd] of [[$hoursStartHandle, hours.start, false], [$hoursEndHandle, hours.end, true]]) {
    handle.style.setProperty('--position', String(handlePosition(value, isEnd, hours) / 1440));
    handle.setAttribute('aria-valuenow', String(value));
    handle.setAttribute('aria-valuetext', formatMinuteOfDay(value));
    handle.setAttribute('aria-disabled', String(!hours.enabled));
    handle.tabIndex = hours.enabled ? 0 : -1;
  }
  const range = byId('hours-bar-range'), wrap = byId('hours-bar-wrap');
  const end = handlePosition(hours.end, true, hours);
  if (hours.start === hours.end) {
    range.style.left = '0%'; range.style.width = '100%'; wrap.hidden = true;
  } else if (hours.start < end) {
    range.style.left = `${hours.start / 14.4}%`; range.style.width = `${(end - hours.start) / 14.4}%`; wrap.hidden = true;
  } else {
    range.style.left = `${hours.start / 14.4}%`; range.style.width = `${(1440 - hours.start) / 14.4}%`;
    wrap.style.left = '0%'; wrap.style.width = `${hours.end / 14.4}%`; wrap.hidden = false;
  }
  for (const control of [$hoursStart, $hoursEnd]) control.disabled = !hours.enabled;
  for (const chipButton of $hoursDays.children) {
    chipButton.setAttribute('aria-pressed', String(hours.days.includes(Number(chipButton.dataset.day))));
    chipButton.disabled = !hours.enabled;
  }
}

function setHandleValue(handle, minutes) {
  const value = ((Math.round(minutes / HOURS_STEP) * HOURS_STEP) % 1440 + 1440) % 1440;
  updateHours(handle === $hoursStartHandle ? { start: value } : { end: value });
}

for (const handle of [$hoursStartHandle, $hoursEndHandle]) {
  handle.addEventListener('keydown', event => {
    const zone = hoursState && getLiveZone(hoursState.tz);
    if (!zone?.workingHours.enabled) return;
    const current = Number(handle.getAttribute('aria-valuenow'));
    const steps = { ArrowRight: 15, ArrowUp: 15, ArrowLeft: -15, ArrowDown: -15, PageUp: 60, PageDown: -60 };
    if (event.key in steps) { event.preventDefault(); setHandleValue(handle, current + steps[event.key]); }
    else if (event.key === 'Home') { event.preventDefault(); setHandleValue(handle, 0); }
    else if (event.key === 'End') { event.preventDefault(); setHandleValue(handle, 1425); }
  });
}

// Pointer dragging; pressing the bar itself moves the nearer handle there.
const $hoursBar = $hoursPopover.querySelector('.hours-bar');
$hoursBar.addEventListener('pointerdown', event => {
  const zone = hoursState && getLiveZone(hoursState.tz);
  if (!zone?.workingHours.enabled) return;
  const rect = $hoursBar.getBoundingClientRect();
  const minuteAt = clientX => Math.max(0, Math.min(1440, (clientX - rect.left) / rect.width * 1440));
  let handle = event.target.closest('.hours-handle');
  if (!handle) {
    const minute = minuteAt(event.clientX), hours = zone.workingHours;
    const distance = value => Math.abs(value - minute);
    handle = distance(hours.start) <= distance(handlePosition(hours.end, true, hours)) ? $hoursStartHandle : $hoursEndHandle;
    setHandleValue(handle, minute);
  }
  event.preventDefault();
  handle.focus();
  handle.classList.add('is-dragging');
  $hoursBar.setPointerCapture(event.pointerId);
  const move = moveEvent => setHandleValue(handle, minuteAt(moveEvent.clientX));
  const stop = () => {
    handle.classList.remove('is-dragging');
    $hoursBar.removeEventListener('pointermove', move);
    $hoursBar.removeEventListener('pointerup', stop);
    $hoursBar.removeEventListener('pointercancel', stop);
  };
  $hoursBar.addEventListener('pointermove', move);
  $hoursBar.addEventListener('pointerup', stop);
  $hoursBar.addEventListener('pointercancel', stop);
});

$hoursEnabled.addEventListener('change', () => updateHours({ enabled: $hoursEnabled.checked }));
for (const [input, key] of [[$hoursStart, 'start'], [$hoursEnd, 'end']]) {
  input.addEventListener('change', () => {
    if (!input.value) { syncHoursPopover(); return; }
    updateHours({ [key]: parseInputTime(input.value) });
  });
}
byId('hours-close').addEventListener('click', () => closeHoursPopover());

// Sky colors across a day as a CSS gradient; `colorAt` takes an hour (0–24).
function createDayGradient(colorAt, samples = 48) {
  const stops = Array.from({ length: samples + 1 }, (_, index) => {
    const { top, bottom } = colorAt(index * 24 / samples);
    return `rgb(${lerpColorRound(top, bottom, .5).join(',')}) ${(index / samples * 100).toFixed(2)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function attachDragHandlers(column) {
  const clearTargets = () => { for (const item of $columns.children) item.classList.remove('drop-before', 'drop-after'); };
  column.addEventListener('dragstart', event => {
    if (!editMode) { event.preventDefault(); return; }
    closeMenu({ restoreFocus: false }); closeHoursPopover({ restoreFocus: false });
    dragTimeZone = column.dataset.tz; column.classList.add('dragging'); document.body.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragTimeZone);
  });
  column.addEventListener('dragend', () => {
    dragTimeZone = null; document.body.classList.remove('is-dragging');
    for (const item of $columns.children) item.classList.remove('dragging');
    clearTargets();
  });
  column.addEventListener('dragover', event => {
    if (!dragTimeZone || dragTimeZone === column.dataset.tz) return;
    event.preventDefault();
    // The dragged clock takes this clock's place, landing on the side it came from.
    const from = config.zones.findIndex(zone => zone.tz === dragTimeZone);
    const to = config.zones.findIndex(zone => zone.tz === column.dataset.tz);
    if (!column.classList.contains(from > to ? 'drop-before' : 'drop-after')) {
      clearTargets(); column.classList.add(from > to ? 'drop-before' : 'drop-after');
    }
  });
  column.addEventListener('dragleave', event => { if (!column.contains(event.relatedTarget)) column.classList.remove('drop-before', 'drop-after'); });
  column.addEventListener('drop', event => {
    event.preventDefault();
    clearTargets();
    reorderZone(dragTimeZone, column.dataset.tz);
  });
}

function createSmoothHorizontalGradient(targetContext, palette, width, mix = undefined) {
  const gradient = targetContext.createLinearGradient(0, 0, width, 0);
  for (const stop of getSmoothGradientStops(palette, 16, mix)) {
    const [r, g, b, alpha = 1] = stop.color;
    gradient.addColorStop(stop.offset, `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha.toFixed(3)})`);
  }
  return gradient;
}

// Paints a horizontal gradient into the blend canvas, keeps it only where the
// vertical mask is opaque, and composites the result onto the sky.
function paintMaskedLayer(fill, maskStops, operation, canvasWidth, canvasHeight, dpr, backingWidth, backingHeight) {
  if (blendCanvas.width !== backingWidth) blendCanvas.width = backingWidth;
  if (blendCanvas.height !== backingHeight) blendCanvas.height = backingHeight;
  blendContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  blendContext.clearRect(0, 0, canvasWidth, canvasHeight);
  blendContext.globalCompositeOperation = 'source-over';
  blendContext.fillStyle = fill;
  blendContext.fillRect(0, 0, canvasWidth, canvasHeight);
  blendContext.globalCompositeOperation = 'destination-in';
  const mask = blendContext.createLinearGradient(0, 0, 0, canvasHeight);
  for (const [offset, alpha] of maskStops) mask.addColorStop(offset, `rgba(0,0,0,${alpha})`);
  blendContext.fillStyle = mask;
  blendContext.fillRect(0, 0, canvasWidth, canvasHeight);
  blendContext.globalCompositeOperation = 'source-over';
  context.globalCompositeOperation = operation;
  context.drawImage(blendCanvas, 0, 0, backingWidth, backingHeight, 0, 0, canvasWidth, canvasHeight);
  context.globalCompositeOperation = 'source-over';
}

// Smoothstep keeps the 50% mix at mid-height, where text contrast is measured,
// while holding the zenith and horizon colors longer than a linear ramp.
const SKY_BLEND_MASK = [[0, 0], [0.25, 0.156], [0.5, 0.5], [0.75, 0.844], [1, 1]];
// Twilight deepens the top of the sky and lights the horizon; both stay clear
// of the clock text in the middle of the screen.
const ZENITH_MASK = [[0, 1], [0.18, 0.55], [0.38, 0]];
const HORIZON_MASK = [[0.6, 0], [0.8, 0.45], [0.93, 0.85], [1, 1]];
const ZENITH_COLOR = [20, 22, 70];

function paintContinuousGradient(skies, canvasWidth, canvasHeight, dpr, backingWidth, backingHeight) {
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = createSmoothHorizontalGradient(context, skies.map(sky => sky.top), canvasWidth);
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  const layer = (palette, mask, operation) => paintMaskedLayer(
    createSmoothHorizontalGradient(blendContext, palette, canvasWidth, mixColorAlpha),
    mask, operation, canvasWidth, canvasHeight, dpr, backingWidth, backingHeight);
  layer(skies.map(sky => [...sky.bottom, 1]), SKY_BLEND_MASK, 'source-over');
  if (skies.some(sky => sky.twilight > 0.02)) {
    layer(skies.map(sky => [...ZENITH_COLOR, sky.twilight * 0.3]), ZENITH_MASK, 'source-over');
  }
  if (skies.some(sky => sky.horizonAlpha > 0.01)) {
    layer(skies.map(sky => [...sky.horizon, sky.horizonAlpha]), HORIZON_MASK, 'screen');
  }
}

// A fixed star field, denser toward the zenith. Each star takes the night
// value interpolated between the clock columns on either side of it.
let starField = null;
function getStarField(canvasWidth, canvasHeight) {
  const key = `${canvasWidth}x${canvasHeight}`;
  if (starField?.key === key) return starField.stars;
  let seed = 0x2f6b9a1d;
  const random = () => { seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39 | 0; return ((seed >>> 0) % 100000) / 100000; };
  const count = Math.min(520, Math.round(canvasWidth * canvasHeight / 4200));
  const stars = Array.from({ length: count }, () => ({
    x: random() * canvasWidth,
    y: random() ** 1.7 * canvasHeight * 0.74,
    radius: 0.35 + random() ** 3 * 1.05,
    brightness: 0.25 + random() * 0.75,
    warm: random() < 0.18,
  }));
  starField = { key, stars };
  return stars;
}

function paintStars(skies, canvasWidth, canvasHeight, columnWidth) {
  if (!skies.some(sky => sky.night > 0.02)) return;
  const nightAt = x => {
    const position = Math.max(0, Math.min(skies.length - 1, x / columnWidth - 0.5));
    const index = Math.floor(position), next = Math.min(skies.length - 1, index + 1);
    return skies[index].night + (skies[next].night - skies[index].night) * (position - index);
  };
  for (const star of getStarField(canvasWidth, canvasHeight)) {
    const alpha = nightAt(star.x) * star.brightness * (1 - star.y / (canvasHeight * 0.8)) * 0.85;
    if (alpha < 0.03) continue;
    context.fillStyle = star.warm ? `rgba(255,226,196,${alpha.toFixed(3)})` : `rgba(226,232,255,${alpha.toFixed(3)})`;
    context.beginPath(); context.arc(star.x, star.y, star.radius, 0, Math.PI * 2); context.fill();
  }
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

function getPaletteHour(timeZone, time, date, fractionalMinute = time.minute24) {
  return config.visualTheme === 'solar'
    ? getSolarPaletteHour(timeZone, coordinates[timeZone], date)
    : time.hour24 + fractionalMinute / 60;
}

function getSky(timeZone, time, date, fractionalMinute = time.minute24) {
  const paletteHour = getPaletteHour(timeZone, time, date, fractionalMinute);
  const minutes = Math.round(paletteHour * 60) % 1440;
  return { ...getGradientColors(Math.floor(minutes / 60), minutes % 60), ...getSkyLight(paletteHour) };
}

// Paints the full sky for a list of columns: the dashboard, or the sample
// world shown behind onboarding.
function paintSky(skies, canvasWidth, canvasHeight, homeIndex = -1) {
  const dpr = Math.min(devicePixelRatio || 1, MAX_CANVAS_PIXEL_RATIO);
  const columnWidth = canvasWidth / skies.length;
  const backingWidth = Math.round(canvasWidth * dpr), backingHeight = Math.round(canvasHeight * dpr);
  if ($canvas.width !== backingWidth) $canvas.width = backingWidth;
  if ($canvas.height !== backingHeight) $canvas.height = backingHeight;
  $canvas.style.width = `${canvasWidth}px`; $canvas.style.height = `${canvasHeight}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, canvasWidth, canvasHeight);
  paintContinuousGradient(skies, canvasWidth, canvasHeight, dpr, backingWidth, backingHeight);
  paintStars(skies, canvasWidth, canvasHeight, columnWidth);
  context.globalCompositeOperation = 'lighter';
  skies.forEach(({ top, bottom }, index) => {
    const centerX = (index + .5) * columnWidth, centerY = canvasHeight * .45;
    const middle = lerpColorRound(top, bottom, .5);
    const bright = lerpColorRound(middle, [255,255,255], .35);
    const alpha = index === homeIndex ? .06 : .035;
    const radius = Math.max(columnWidth * .7, canvasHeight * .3);
    const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    glow.addColorStop(0, `rgba(${bright.join(',')},${alpha})`); glow.addColorStop(.5, `rgba(${bright.join(',')},${alpha * .4})`); glow.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = glow; context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  });
  context.globalCompositeOperation = 'source-over';
  applyGradientDither(backingWidth, backingHeight);
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

  const times = [], colors = [], offsets = [];
  for (const column of columnElements) {
    const timeZone = column.dataset.tz;
    const time = getTimeInZone(timeZone, date);
    times.push(time); offsets.push(getOffsetMinutes(timeZone, date));
    const fractionalMinute = time.minute24 + (config.atmosphericMotion && viewedOffsetMinutes === 0 ? Number(time.second) / 60 : 0);
    colors.push(getSky(timeZone, time, date, fractionalMinute));
  }

  const canvasKey = `${Math.floor(date.getTime() / (config.atmosphericMotion && viewedOffsetMinutes === 0 ? 5000 : 60000))}:${canvasWidth}:${canvasHeight}:${dpr}:${config.visualTheme}`;
  // A zero-height viewport (background or minimized tab) makes drawImage throw; repaint on resize.
  // Onboarding keeps the sky of the whole world behind it until it finishes.
  if (canvasKey !== lastCanvasKey && canvasHeight > 0 && $firstRunModal.classList.contains('hidden')) {
    lastCanvasKey = canvasKey;
    paintSky(colors, canvasWidth, canvasHeight, columnElements.findIndex(column => column.classList.contains('is-home')));
  }

  const homeOffset = config.home ? getOffsetMinutes(config.home.tz, date) : null;
  const timeSize = calculateTimeFontSize(columnWidth, config.use24h, config.showSeconds);
  columnElements.forEach((column, index) => {
    const timeZone = column.dataset.tz, time = times[index], color = colors[index];
    const textColor = getTextColor(color.top, color.bottom); column.style.color = textColor;
    column.dataset.tone = textColor === 'rgb(0, 0, 0)' ? 'light' : 'dark';
    column.dataset.night = color.night.toFixed(2);
    const timeElement = column.querySelector('.time-display'); timeElement.style.fontSize = `${timeSize}px`;
    setRolling(timeElement.querySelector('.time-hours'), config.use24h ? String(time.hour24).padStart(2, '0') : String(time.hour12));
    setRolling(timeElement.querySelector('.time-minutes'), time.minute);
    const seconds = timeElement.querySelector('.seconds'), period = timeElement.querySelector('.ampm');
    seconds.hidden = !config.showSeconds; seconds.textContent = config.showSeconds ? `:${time.second}` : '';
    period.hidden = config.use24h; period.textContent = config.use24h ? '' : time.ampm;
    setRolling(column.querySelector('.date-display'), time.dateLabel);
    // A brief celebration in each city as it reaches the new year.
    const parts = getZonedDateParts(timeZone, date);
    column.classList.toggle('is-new-year', parts.month === 1 && parts.day === 1 && parts.hour === 0 && parts.minute < 15);
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
  document.body.classList.toggle('motion-on', config.atmosphericMotion);
  document.body.classList.toggle('show-seconds', config.showSeconds);
  document.body.classList.toggle('time-traveling', viewedOffsetMinutes > 0);
  $skyEvents.style.width = `${canvasWidth}px`;
  const homeIndex = columnElements.findIndex(column => column.classList.contains('is-home'));
  if (homeIndex >= 0 && !viewedOffsetMinutes) updateTabIdentity(colors[homeIndex], date);
  updatePlanner(date);
  updateScrollHints();
}

// The tab shows the home time and a small disc of the home sky.
let faviconKey = '';
function updateTabIdentity(sky, date) {
  document.title = `${formatClock(date, config.home.tz)} · ${t('extensionName')}`;
  const [top, bottom] = [sky.top, sky.bottom].map(color => color.map(Math.round));
  const key = `${top}|${bottom}`;
  if (key === faviconKey || !$favicon) return;
  faviconKey = key;
  const icon = document.createElement('canvas'); icon.width = icon.height = 32;
  const iconContext = icon.getContext('2d');
  const fill = iconContext.createLinearGradient(0, 2, 0, 30);
  fill.addColorStop(0, `rgb(${top})`); fill.addColorStop(1, `rgb(${bottom})`);
  iconContext.beginPath(); iconContext.arc(16, 16, 14.5, 0, Math.PI * 2);
  iconContext.fillStyle = fill; iconContext.fill();
  iconContext.lineWidth = 1.5; iconContext.strokeStyle = 'rgba(255,255,255,.55)'; iconContext.stroke();
  $favicon.removeAttribute('sizes');
  $favicon.href = icon.toDataURL('image/png');
}

function updatePlanner(date) {
  if (!config.home) return;
  const now = new Date();
  const homeTime = formatClock(date, config.home.tz, true);
  const ahead = viewedOffsetMinutes ? formatRelativeOffset(Math.round((date - now) / 60000), 0) : '';
  $plannerTime.textContent = homeTime;
  $plannerOffset.textContent = ahead;
  $timeSlider.setAttribute('aria-valuetext', ahead ? `${homeTime} (${ahead})` : `${t('now')}, ${homeTime}`);
  $travelChip.classList.toggle('hidden', !ahead);
  if (ahead) $travelChipText.textContent = `${t('plannedTime')} · ${ahead}`;
  $planner.style.setProperty('--progress', String(viewedOffsetMinutes / PLANNER_RANGE_MINUTES));
  renderTimeline();
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

// The planner track is the home sky across the next 48 hours, with each
// home-timezone midnight marked and the shared-availability windows lit.
// Everything sits inside the thumb's travel, inset by half its 16px width.
let timelineWindowsKey = '';
function renderTimeline() {
  const origin = viewedOffsetMinutes ? planningOrigin : floorToStep(Date.now());
  const key = `${config.home.tz}:${origin}:${currentLocale}:${config.visualTheme}`;
  if (key !== timelineKey) {
    timelineKey = key;
    const samples = 96;
    const colors = Array.from({ length: samples + 1 }, (_, index) => {
      const at = new Date(origin + index * PLANNER_RANGE_MINUTES / samples * 60000);
      const { top, bottom } = getSky(config.home.tz, getTimeInZone(config.home.tz, at), at);
      return lerpColorRound(top, bottom, .5).join(',');
    });
    $timelineSky.style.background = `linear-gradient(90deg, ${colors.map((color, index) => `rgb(${color}) ${(index / samples * 100).toFixed(2)}%`).join(', ')})`;
    $timelineTrack.style.setProperty('--start-color', `rgb(${colors[0]})`);
    $timelineTrack.style.setProperty('--end-color', `rgb(${colors.at(-1)})`);

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
    $timelineTicks.replaceChildren(...days.map(({ fraction }) => {
      const tick = document.createElement('span'); tick.className = 'timeline-tick'; tick.style.left = `${fraction * 100}%`; return tick;
    }));
  }

  const schedules = config.availabilityEnabled ? JSON.stringify(config.zones.map(zone => [zone.tz, zone.workingHours])) : '';
  const windowsKey = `${origin}:${schedules}`;
  if (windowsKey === timelineWindowsKey) return;
  timelineWindowsKey = windowsKey;
  const range = PLANNER_RANGE_MINUTES * 60000;
  const windows = config.availabilityEnabled ? findAvailabilityWindows(config.zones, new Date(origin)) : [];
  $timelineWindows.replaceChildren(...windows.map(window => {
    const start = Math.max(0, (window.start - origin) / range), end = Math.min(1, (window.end - origin) / range);
    const element = document.createElement('span');
    element.className = 'timeline-window';
    element.style.left = `${start * 100}%`; element.style.width = `${(end - start) * 100}%`;
    return element;
  }).filter(element => parseFloat(element.style.width) > 0));
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
  saveConfig(); renderColumns({ animate: true }); highlightColumn(timeZone); return true;
}

// Brings a clock into view and rings it briefly, so an addition is never missed.
function highlightColumn(timeZone) {
  const column = $columns.querySelector(`[data-tz="${CSS.escape(timeZone)}"]`);
  if (!column) return;
  const rect = column.getBoundingClientRect();
  if (rect.left < 0 || rect.right > innerWidth) {
    $dashboard.scrollBy({ left: rect.left < 0 ? rect.left - 24 : rect.right - innerWidth + 24, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
  column.classList.remove('is-arriving'); void column.offsetWidth; column.classList.add('is-arriving');
  setTimeout(() => column.classList.remove('is-arriving'), 2000);
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
  rememberRemoved(removed);
  saveConfig(); renderColumns({ animate: true });
  const neighbor = config.zones[Math.min(index, config.zones.length - 1)];
  if (neighbor) focusColumn(neighbor.tz, '[data-action="more"]');
  showToast(t('timezoneRemoved', removed.cities.map(getLocalizedCityName).join(', ')), {
    label: t('undo'),
    run: () => {
      if (config.zones.some(zone => zone.tz === removed.tz)) return;
      if (config.zones.length >= MAX_TIMEZONES) { showToast(t('maxTimezones')); return; }
      config.zones.splice(Math.min(index, config.zones.length), 0, removed); saveConfig(); renderColumns({ animate: true });
      focusColumn(removed.tz, '[data-action="more"]');
    },
  });
}

// Search suggests clocks removed earlier in this tab.
const recentlyRemoved = [];
function rememberRemoved(zone) {
  for (const city of [...zone.cities].reverse()) {
    const index = recentlyRemoved.findIndex(item => item.tz === zone.tz);
    if (index >= 0) recentlyRemoved.splice(index, 1);
    recentlyRemoved.unshift({ ...city, tz: zone.tz });
  }
  recentlyRemoved.length = Math.min(recentlyRemoved.length, 3);
}

function setHome(city, country, timeZone, announce = false) {
  const existing = config.zones.find(zone => zone.tz === timeZone);
  if (!existing && config.zones.length >= MAX_TIMEZONES) { showToast(t('maxTimezones')); return false; }
  config.home = { city, country, tz: timeZone };
  if (!existing) config.zones = addZoneByUtcOffset(config.zones, { tz: timeZone, cities: [{ city, country }], workingHours: { ...DEFAULT_WORKING_HOURS } });
  else if (!existing.cities.some(item => item.city === city && item.country === country)) existing.cities.unshift({ city, country });
  saveConfig(); renderColumns({ animate: announce });
  if (announce) { showToast(t('homeChanged', getLocalizedCityName({ city, country }))); focusColumn(timeZone, '[data-action="more"]'); highlightColumn(timeZone); }
  return true;
}

function moveZone(timeZone, direction, focusSelector = null) {
  const index = config.zones.findIndex(zone => zone.tz === timeZone), target = index + direction;
  if (index < 0 || target < 0 || target >= config.zones.length) return;
  [config.zones[index], config.zones[target]] = [config.zones[target], config.zones[index]];
  saveConfig(); renderColumns({ animate: true });
  if (focusSelector) focusColumn(timeZone, focusSelector);
  else $columns.querySelector(`[data-tz="${CSS.escape(timeZone)}"]`)?.focus();
}

function reorderZone(sourceTimeZone, targetTimeZone) {
  const from = config.zones.findIndex(zone => zone.tz === sourceTimeZone);
  const to = config.zones.findIndex(zone => zone.tz === targetTimeZone);
  if (from < 0 || to < 0 || from === to) return;
  const [zone] = config.zones.splice(from, 1); config.zones.splice(to, 0, zone);
  saveConfig(); renderColumns({ animate: true });
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
  renderPresetSwitcher();
}

// Once presets exist, a switcher beside the toolbar changes between them.
function renderPresetSwitcher() {
  $presetSwitcher.classList.toggle('hidden', !config.presets.length);
  const active = config.presets.find(preset => preset.id === config.activePresetId);
  $presetSwitcherName.textContent = active ? active.name : t('currentClocks');
}

function openPresetMenu() {
  if (openMenuState?.anchor === $presetSwitcherBtn) { closeMenu(); return; }
  closeSettings();
  openMenu($presetMenu, $presetSwitcherBtn, [
    ...config.presets.map((preset, index) => ({
      label: preset.name, checked: preset.id === config.activePresetId, hint: index < 9 ? String(index + 1) : '',
      run: () => { if (preset.id !== config.activePresetId) activatePreset(preset.id); $presetSwitcherBtn.focus(); },
    })),
    { separator: true },
    { label: t('managePresets'), run: () => { openSettings(); $presetName.focus(); } },
  ], 'below');
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
  saveConfig(); renderColumns({ animate: true }); syncSettingsControls();
  showToast(t('presetLoaded', preset.name), {
    label: t('undo'),
    run: () => {
      config = normalizeConfig({ ...previous, presets: config.presets, storageMode: config.storageMode });
      saveConfig(); renderColumns({ animate: true }); syncSettingsControls();
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

function createSkyDot(timeZone, date = new Date(), className = 'sky-dot') {
  const { top, bottom } = getSky(timeZone, getTimeInZone(timeZone, date), date);
  const dot = document.createElement('span');
  dot.className = className; dot.setAttribute('aria-hidden', 'true');
  dot.style.background = `linear-gradient(rgb(${top.map(Math.round)}), rgb(${bottom.map(Math.round)}))`;
  return dot;
}

// `results` may include { heading } entries, which label the options after them.
function renderSearchResults(results, list, onSelect) {
  list.replaceChildren(); searchSelectedIndex = -1;
  const input = list === $homeResults ? $homeSearch : $searchInput;
  const empty = list === $homeResults ? $homeEmpty : $searchEmpty;
  const options = results.filter(result => !result.heading);
  input.removeAttribute('aria-activedescendant'); input.setAttribute('aria-expanded', String(options.length > 0));
  empty.textContent = options.length || !input.value.trim() ? '' : t('noSearchResults');
  const now = new Date();
  const homeOffset = config.home ? getOffsetMinutes(config.home.tz, now) : null;
  let index = 0;
  for (const city of results) {
    if (city.heading) {
      const heading = document.createElement('li');
      heading.className = 'result-group'; heading.role = 'presentation'; heading.ariaHidden = 'true'; heading.textContent = city.heading;
      list.append(heading);
      continue;
    }
    const item = document.createElement('li'); item.id = `${list.id}-option-${index++}`; item.role = 'option'; item.ariaSelected = 'false';
    const name = document.createElement('span'); name.className = 'city-name'; name.textContent = `${getLocalizedCityName(city)}, ${getCountryName(city.country)}`;
    const meta = document.createElement('span'); meta.className = 'city-meta';
    const time = document.createElement('span'); time.className = 'city-time';
    const relative = homeOffset === null ? '' : formatRelativeOffset(getOffsetMinutes(city.tz, now), homeOffset);
    time.textContent = relative ? `${formatClock(now, city.tz)} \u00b7 ${relative}` : formatClock(now, city.tz);
    const zone = document.createElement('span'); zone.className = 'city-tz'; zone.textContent = city.tz;
    meta.append(time, zone);
    item.append(createSkyDot(city.tz, now), name, meta); item.addEventListener('click', () => onSelect(city)); list.append(item);
  }
  // Highlight the best match so Enter picks it without arrowing first.
  if (options.length) navigateResults(list, 'down');
}

const SUGGESTED_CITIES = [
  ['Europe/London', 'London'], ['America/New_York', 'New York'], ['Asia/Tokyo', 'Tokyo'], ['Asia/Singapore', 'Singapore'],
  ['Australia/Sydney', 'Sydney'], ['Asia/Dubai', 'Dubai'], ['Asia/Kolkata', 'Mumbai'], ['America/Sao_Paulo', 'Sao Paulo'],
  ['Europe/Paris', 'Paris'], ['America/Los_Angeles', 'Los Angeles'], ['Asia/Hong_Kong', 'Hong Kong'], ['America/Chicago', 'Chicago'],
];

// Before anything is typed, search offers recently removed clocks and a few
// major cities that are not on screen yet.
function getSearchSuggestions() {
  const present = new Set(config.zones.map(zone => zone.tz));
  const recent = recentlyRemoved.filter(city => !present.has(city.tz));
  const shown = new Set(recent.map(city => city.tz));
  const popular = SUGGESTED_CITIES
    .filter(([tz]) => !present.has(tz) && !shown.has(tz))
    .map(([tz, city]) => getRepresentativeCity(cities, tz, city))
    .filter(Boolean).slice(0, 6 - Math.min(recent.length, 3));
  return [
    ...(recent.length ? [{ heading: t('recentlyRemoved') }, ...recent] : []),
    ...(popular.length ? [{ heading: t('suggestions') }, ...popular] : []),
  ];
}

function clearSearchResults(list) {
  list.replaceChildren();
  (list === $homeResults ? $homeEmpty : $searchEmpty).textContent = '';
}

function navigateResults(list, direction) {
  const items = [...list.querySelectorAll('li[role="option"]')]; if (!items.length) return;
  searchSelectedIndex = direction === 'down' ? Math.min(searchSelectedIndex + 1, items.length - 1) : Math.max(searchSelectedIndex - 1, 0);
  items.forEach((item, index) => { item.classList.toggle('selected', index === searchSelectedIndex); item.ariaSelected = String(index === searchSelectedIndex); });
  const input = list === $homeResults ? $homeSearch : $searchInput;
  input.setAttribute('aria-activedescendant', items[searchSelectedIndex].id); items[searchSelectedIndex].scrollIntoView({ block: 'nearest' });
}

function selectCurrentResult(list) { const items = list.querySelectorAll('li[role="option"]'); items[searchSelectedIndex]?.click(); }

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
  closeMenu({ restoreFocus: false }); closeHoursPopover({ restoreFocus: false });
  $searchOverlay.classList.remove('hidden'); setPageInert(true);
  // Focus at once so the first keystrokes are never lost.
  $searchInput.value = ''; $searchInput.focus();
  showSearchSuggestions();
  warmSearchIndex();
}

function showSearchSuggestions() {
  if (searchMode === 'add' || searchMode === 'onboarding') renderSearchResults(getSearchSuggestions(), $searchResults, selectSearchResult);
  else { clearSearchResults($searchResults); $searchInput.ariaExpanded = 'false'; }
}

function selectSearchResult(city) {
  if (searchMode === 'home') { if (setHome(city.city, city.country, city.tz, true)) closeSearch(); return; }
  const added = addZone(city.city, city.country, city.tz);
  if (searchMode === 'onboarding') {
    if (added) showToast(t('timezoneAdded', getLocalizedCityName(city)));
    $searchInput.value = ''; showSearchSuggestions(); updateMultiAddStatus(); $searchInput.focus();
  } else closeSearch();
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
    ? $columns.querySelector(`[data-tz="${CSS.escape(searchTargetTimeZone)}"] [data-action="more"]`)
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
  saveConfig(); renderColumns(); paintOnboardingSky();
  $onboardingGoalStep.classList.add('hidden'); $onboardingHomeStep.classList.remove('hidden');
  $homeSearch.value = ''; clearSearchResults($homeResults); $homeSearch.ariaExpanded = 'false';
  $homeSearch.focus();
}

function finishOnboarding(goal) {
  config.onboardingComplete = true;
  if (goal === 'sample') addDefaultZones(); else saveConfig();
  // The clocks rise out of the world sky.
  const snapshot = captureLayout();
  $firstRunModal.classList.add('hidden'); setPageInert(false); renderColumns(); playLayout(snapshot); startTimer();
  if (goal === 'people') openSearch('onboarding', byId('add-btn'));
}

// Behind onboarding, the sky over a band of cities around the world right now.
const ONBOARDING_SKY_ZONES = [
  'Pacific/Honolulu', 'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney',
];
function paintOnboardingSky() {
  if (!innerHeight) return;
  const date = new Date();
  const zones = sortZonesByUtcOffset(ONBOARDING_SKY_ZONES.map(tz => ({ tz })), date);
  $columns.style.width = `${innerWidth}px`;
  paintSky(zones.map(({ tz }) => getSky(tz, getTimeInZone(tz, date), date)), innerWidth, innerHeight);
}

function showFirstRun() {
  $firstRunModal.classList.remove('hidden'); setPageInert(true);
  paintOnboardingSky();
  const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const detected = getRepresentativeCity(cities, systemTimeZone);
  $homeDetected.replaceChildren();
  if (detected) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'detected-chip'; button.id = 'detected-home';
    button.setAttribute('aria-label', t('useDetectedLocation', [getLocalizedCityName(detected), getCountryName(detected.country), detected.tz]));
    const text = document.createElement('span'); text.className = 'detected-text';
    const name = document.createElement('strong'); name.textContent = `${getLocalizedCityName(detected)}, ${getCountryName(detected.country)}`;
    const hint = document.createElement('span'); hint.textContent = t('detectedHomeHint');
    text.append(name, hint);
    const time = document.createElement('span'); time.className = 'detected-time'; time.textContent = formatClock(new Date(), detected.tz);
    const enter = document.createElement('kbd'); enter.textContent = '↵';
    button.append(createSkyDot(detected.tz, new Date(), 'sky-dot large'), text, time, enter);
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
  closeMenu({ restoreFocus: false }); closeHoursPopover({ restoreFocus: false });
  $settingsPanel.classList.remove('hidden'); $settingsBtn.ariaExpanded = 'true'; syncSettingsControls();
}

function closeSettings({ restoreFocus = false } = {}) {
  const open = !$settingsPanel.classList.contains('hidden'); $settingsPanel.classList.add('hidden'); $settingsBtn.ariaExpanded = 'false';
  if (open && restoreFocus) $settingsBtn.focus();
}

function syncSettingsControls() {
  $toggle24h.checked = config.use24h; $toggleSeconds.checked = config.showSeconds; $toggleMotion.checked = config.atmosphericMotion;
  for (const input of $densityInputs) input.checked = input.value === config.infoDensity;
  for (const input of $themeInputs) input.checked = input.value === config.visualTheme;
  $storageSelect.value = config.storageMode;
  renderSettingsHome();
  $availabilityToggle.checked = config.availabilityEnabled; $settingsAvailability.checked = config.availabilityEnabled;
  document.body.classList.toggle('availability-mode', config.availabilityEnabled);
  renderPresets();
}

// Settings opens with the home city, its sky, and a preview of each theme.
function renderSettingsHome() {
  if (!config.home || $settingsPanel.classList.contains('hidden')) return;
  const now = new Date(), { tz } = config.home;
  byId('settings-home-name').textContent = getLocalizedCityName(config.home);
  byId('settings-home-time').textContent = `${formatClock(now, tz)} · ${tz}`;
  byId('settings-home-sky').replaceWith(Object.assign(createSkyDot(tz, now, 'sky-dot large'), { id: 'settings-home-sky' }));
  byId('theme-swatch-clock').style.background = createDayGradient(hour => getGradientColors(Math.floor(hour) % 24, (hour % 1) * 60));
  // Today's solar day in the home city: local midnight, then every half hour.
  const midnight = now.getTime() - (getLocalMinuteOfDay(tz, now) * 60 + now.getSeconds()) * 1000;
  byId('theme-swatch-solar').style.background = createDayGradient(hour => {
    const paletteHour = getSolarPaletteHour(tz, coordinates[tz], new Date(midnight + hour * 3600000));
    const minutes = Math.round(paletteHour * 60) % 1440;
    return getGradientColors(Math.floor(minutes / 60), minutes % 60);
  });
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
document.addEventListener('click', event => {
  if (!$settingsPanel.contains(event.target) && event.target !== $settingsBtn) closeSettings();
  if (openMenuState && !openMenuState.menu.contains(event.target) && !openMenuState.anchor.contains(event.target)) closeMenu({ restoreFocus: false });
  if (hoursState && !$hoursPopover.contains(event.target) && !hoursState.chip.contains(event.target)) closeHoursPopover({ restoreFocus: false });
});

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
  if (!$searchInput.value.trim()) { showSearchSuggestions(); return; }
  const results = searchCities($searchInput.value).filter(city => searchMode !== 'group' || city.tz === searchTargetTimeZone);
  renderSearchResults(results, $searchResults, selectSearchResult);
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
$homeSearch.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !$homeSearch.value.trim() && byId('detected-home')) { event.preventDefault(); byId('detected-home').click(); return; }
  searchKeydown(event, $homeResults);
});
byId('goal-people').addEventListener('click', () => finishOnboarding('people'));
byId('goal-sample').addEventListener('click', () => finishOnboarding('sample'));
byId('goal-home').addEventListener('click', () => finishOnboarding('home'));

for (const [control, key, transform = value => value] of [
  [$toggle24h, 'use24h', value => value], [$toggleSeconds, 'showSeconds', value => value], [$toggleMotion, 'atmosphericMotion', value => value],
]) {
  control.addEventListener('change', () => { config[key] = transform(control.checked); saveConfig(); lastCanvasKey = ''; updateDisplay(); startTimer(); });
}
for (const input of $densityInputs) input.addEventListener('change', () => { config.infoDensity = input.value; saveConfig(); updateDisplay(); });
for (const input of $themeInputs) {
  input.addEventListener('change', () => {
    const snapshot = captureLayout();
    config.visualTheme = input.value; saveConfig(); lastCanvasKey = ''; updateDisplay(); playLayout(snapshot);
  });
}
$storageSelect.addEventListener('change', () => changeStorageMode($storageSelect.value));
$presetSelect.addEventListener('change', () => activatePreset($presetSelect.value));
byId('save-preset-btn').addEventListener('click', savePreset);
byId('delete-preset-btn').addEventListener('click', deletePreset);
byId('change-home-btn').addEventListener('click', () => { closeSettings(); openSearch('home', $settingsBtn); });
$presetSwitcherBtn.addEventListener('click', event => { event.stopPropagation(); openPresetMenu(); });
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
    if (closeMenu() || closeHoursPopover()) return;
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
  else if (/^[1-9]$/.test(event.key) && config.presets[Number(event.key) - 1]) {
    event.preventDefault();
    const preset = config.presets[Number(event.key) - 1];
    if (preset.id !== config.activePresetId) activatePreset(preset.id);
  } else if (event.key === '*') launchShootingStar();
});

// While planning, scrolling moves through time: vertical scroll anywhere, or
// horizontal scroll over the planner. Every 40px is one 15-minute step.
let wheelRemainder = 0;
addEventListener('wheel', event => {
  if (!planningOpen || isModalOpen() || event.ctrlKey || $settingsPanel.contains(event.target)) return;
  const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
  const delta = vertical ? event.deltaY : $planner.contains(event.target) ? event.deltaX : 0;
  if (!delta) return;
  event.preventDefault();
  wheelRemainder += event.deltaMode === 1 ? delta * 40 : delta;
  const steps = Math.trunc(wheelRemainder / 40);
  if (!steps) return;
  wheelRemainder -= steps * 40;
  setViewedOffset(viewedOffsetMinutes + steps * 15);
}, { passive: false });

// Now and then a shooting star crosses a night sky.
let shootingStarTimer = null;
function scheduleShootingStar() {
  clearTimeout(shootingStarTimer);
  shootingStarTimer = setTimeout(() => { launchShootingStar(); scheduleShootingStar(); }, 45000 + Math.random() * 135000);
}

function launchShootingStar() {
  if (document.hidden || !decorativeMotion() || isModalOpen()) return;
  const nightColumns = [...$columns.querySelectorAll('.tz-column')].filter(column => Number(column.dataset.night) > 0.8);
  if (!nightColumns.length) return;
  const column = nightColumns[Math.floor(Math.random() * nightColumns.length)];
  const star = document.createElement('span');
  star.className = 'shooting-star';
  star.style.left = `${column.offsetLeft + column.offsetWidth * (0.35 + Math.random() * 0.55)}px`;
  star.style.top = `${innerHeight * (0.05 + Math.random() * 0.2)}px`;
  star.addEventListener('animationend', () => star.remove());
  $skyEvents.append(star);
}

// Lifecycle
function startTimer() {
  if (updateTimer) clearTimeout(updateTimer);
  const interval = config.showSeconds ? 1000 : config.atmosphericMotion && viewedOffsetMinutes === 0 ? 5000 : 60000;
  updateTimer = setTimeout(() => { try { updateDisplay(); } finally { startTimer(); } }, interval - Date.now() % interval + 20);
}

let resizeFrame = null;
addEventListener('resize', () => {
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null; lastCanvasKey = '';
    if ($columns.children.length) updateDisplay(); else if (!$firstRunModal.classList.contains('hidden')) paintOnboardingSky();
    if (hoursState) positionFloating($hoursPopover, hoursState.chip, 'above');
    closeMenu({ restoreFocus: false });
  });
});
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
  scheduleShootingStar();
}

init();
