/* ============================================
   Meridian — New Tab Timezone Dashboard
   ============================================ */

'use strict';

// ---- Color Bands (12 x 2-hour bands) ----
// Each band: [topColor, bottomColor] as [r,g,b]
const COLOR_BANDS = [
  // 00:00–01:59  Deep navy / charcoal
  { top: [15, 15, 40],    bottom: [20, 18, 35] },
  // 02:00–03:59  Deep navy / charcoal
  { top: [20, 18, 35],    bottom: [25, 22, 50] },
  // 04:00–05:59  Dark indigo → pre-dawn purple
  { top: [30, 25, 60],    bottom: [55, 40, 80] },
  // 06:00–07:59  Dawn violet → soft peach/rose
  { top: [80, 55, 100],   bottom: [180, 120, 130] },
  // 08:00–09:59  Morning gold → warm amber
  { top: [200, 150, 100], bottom: [220, 180, 110] },
  // 10:00–11:59  Light yellow → warm white
  { top: [235, 210, 140], bottom: [245, 235, 190] },
  // 12:00–13:59  Bright pale yellow / cream
  { top: [250, 240, 200], bottom: [248, 238, 195] },
  // 14:00–15:59  Warm gold → soft orange
  { top: [240, 210, 150], bottom: [225, 180, 110] },
  // 16:00–17:59  Amber → deep peach / coral
  { top: [215, 160, 100], bottom: [200, 120, 95] },
  // 18:00–19:59  Sunset coral → dusky mauve
  { top: [180, 100, 90],  bottom: [120, 70, 100] },
  // 20:00–21:59  Twilight purple → slate blue
  { top: [80, 55, 95],    bottom: [45, 40, 75] },
  // 22:00–23:59  Deep slate → charcoal / navy
  { top: [35, 30, 65],    bottom: [18, 16, 42] },
];

// ---- State ----
let cities = [];
let config = {
  home: null,       // { city, country, tz }
  zones: [],        // [{ tz, cities: [{city, country}] }]
  use24h: false,
  showSeconds: false,
};
let updateTimer = null;
let searchSelectedIndex = -1;
let lastCanvasMinute = -1;

// ---- DOM refs ----
const $canvas = document.getElementById('gradient-canvas');
const ctx = $canvas.getContext('2d');
const $columns = document.getElementById('columns');
const $toolbar = document.getElementById('toolbar');
const $addBtn = document.getElementById('add-btn');
const $settingsBtn = document.getElementById('settings-btn');
const $settingsPanel = document.getElementById('settings-panel');
const $toggle24h = document.getElementById('toggle-24h');
const $toggleSeconds = document.getElementById('toggle-seconds');
const $searchOverlay = document.getElementById('search-overlay');
const $searchInput = document.getElementById('search-input');
const $searchResults = document.getElementById('search-results');
const $firstRunModal = document.getElementById('first-run-modal');
const $homeSearch = document.getElementById('home-search');
const $homeResults = document.getElementById('home-results');
const $homeDetected = document.getElementById('home-detected');

// ---- Gradient Engine ----

function lerpColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function lerpColorRound(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function getGradientColors(hour, minute) {
  const bandIndex = Math.floor(hour / 2);
  const nextBandIndex = (bandIndex + 1) % 12;
  const minutesIntoBand = (hour % 2) * 60 + minute;
  const t = minutesIntoBand / 120;

  const currentBand = COLOR_BANDS[bandIndex];
  const nextBand = COLOR_BANDS[nextBandIndex];

  const top = lerpColor(currentBand.top, nextBand.top, t);
  const bottom = lerpColor(currentBand.bottom, nextBand.bottom, t);

  return { top, bottom };
}

function rgb(c) {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function getTextColor(topColor, bottomColor) {
  const avg = [
    (topColor[0] + bottomColor[0]) / 2,
    (topColor[1] + bottomColor[1]) / 2,
    (topColor[2] + bottomColor[2]) / 2,
  ];
  const luminance = (avg[0] * 299 + avg[1] * 587 + avg[2] * 114) / 1000;
  return luminance > 128 ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.95)';
}

// ---- Time Utilities ----

function getTimeInZone(tz) {
  const now = new Date();
  const parts = {};
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  for (const { type, value } of formatter.formatToParts(now)) {
    parts[type] = value;
  }

  const hour24Formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const h24Parts = {};
  for (const { type, value } of hour24Formatter.formatToParts(now)) {
    h24Parts[type] = value;
  }

  return {
    hour12: parts.hour,
    minute: parts.minute,
    second: parts.second,
    ampm: parts.dayPeriod,
    weekday: parts.weekday,
    month: parts.month,
    day: parts.day,
    hour24: parseInt(h24Parts.hour, 10),
    minute24: parseInt(h24Parts.minute, 10),
  };
}

function getTzAbbreviation(tz) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'short',
  });
  const parts = formatter.formatToParts(new Date());
  const tzPart = parts.find(p => p.type === 'timeZoneName');
  return tzPart ? tzPart.value : '';
}

function getUtcOffset(tz) {
  const now = new Date();
  const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = now.toLocaleString('en-US', { timeZone: tz });
  const diffMs = new Date(tzStr) - new Date(utcStr);
  const diffMin = Math.round(diffMs / 60000);
  const h = Math.floor(Math.abs(diffMin) / 60);
  const m = Math.abs(diffMin) % 60;
  const sign = diffMin >= 0 ? '+' : '-';
  return m > 0 ? `UTC${sign}${h}:${String(m).padStart(2, '0')}` : `UTC${sign}${h}`;
}

function getRelativeOffset(tz, homeTz) {
  if (!homeTz || tz === homeTz) return '';
  const now = new Date();
  const homeStr = now.toLocaleString('en-US', { timeZone: homeTz });
  const tzStr = now.toLocaleString('en-US', { timeZone: tz });
  const diffMs = new Date(tzStr) - new Date(homeStr);
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin === 0) return 'same';
  const h = Math.floor(Math.abs(diffMin) / 60);
  const m = Math.abs(diffMin) % 60;
  const sign = diffMin > 0 ? '+' : '-';
  if (m > 0) return `${sign}${h}h ${m}m`;
  return `${sign}${h}h`;
}

function isDST(tz) {
  const jan = new Date(new Date().getFullYear(), 0, 1);
  const jul = new Date(new Date().getFullYear(), 6, 1);
  const janOffset = getOffsetMinutes(tz, jan);
  const julOffset = getOffsetMinutes(tz, jul);
  if (janOffset === julOffset) return false;
  const nowOffset = getOffsetMinutes(tz, new Date());
  return nowOffset !== Math.min(janOffset, julOffset);
}

function getOffsetMinutes(tz, date) {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: tz });
  return Math.round((new Date(tzStr) - new Date(utcStr)) / 60000);
}

// ---- Rendering ----

function renderColumns() {
  $columns.innerHTML = '';
  const sorted = getSortedZones();

  for (const zone of sorted) {
    const col = document.createElement('div');
    col.className = 'tz-column';
    col.dataset.tz = zone.tz;

    const isHome = config.home && zone.tz === config.home.tz;
    if (isHome) col.classList.add('is-home');

    // City label
    const cityNames = zone.cities.map(c => c.city).join(', ');
    const cityLabel = document.createElement('div');
    cityLabel.className = 'city-label';
    cityLabel.textContent = cityNames;

    // Time
    const timeDisplay = document.createElement('div');
    timeDisplay.className = 'time-display';

    // Date
    const dateDisplay = document.createElement('div');
    dateDisplay.className = 'date-display';

    // TZ info
    const tzInfo = document.createElement('div');
    tzInfo.className = 'tz-info';

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove timezone';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeZone(zone.tz);
    });

    // Wrap content in a fixed-position container for alignment
    const content = document.createElement('div');
    content.className = 'column-content';
    content.appendChild(cityLabel);
    content.appendChild(timeDisplay);
    content.appendChild(dateDisplay);
    content.appendChild(tzInfo);

    col.appendChild(removeBtn);
    col.appendChild(content);

    $columns.appendChild(col);
  }

  updateDisplay();
}

function updateDisplay() {
  const columnEls = $columns.querySelectorAll('.tz-column');
  const count = columnEls.length;
  if (count === 0) return;

  // Dynamic font size — scales inversely with column count
  const timeSizeVw = Math.max(3, Math.min(7, 18 / count));
  const timeSizePx = Math.max(32, Math.min(88, 360 / count));

  // ---- Paint continuous gradient canvas ----
  const canvasW = window.innerWidth;
  const canvasH = window.innerHeight;
  // Collect each column's gradient colors and time data
  const colColors = [];
  const colTimes = [];
  for (const col of columnEls) {
    const tz = col.dataset.tz;
    const time = getTimeInZone(tz);
    colColors.push(getGradientColors(time.hour24, time.minute24));
    colTimes.push(time);
  }

  // Only repaint canvas when minute changes (gradients don't shift per-second)
  const currentMinute = new Date().getMinutes();
  const needsCanvasRepaint = currentMinute !== lastCanvasMinute ||
    $canvas.width !== canvasW || $canvas.height !== canvasH;

  const colWidth = canvasW / count;
  // For each pixel column, figure out which two zone columns it sits between
  // and blend their top/bottom colors, then draw a vertical gradient
  if (needsCanvasRepaint) {
  if ($canvas.width !== canvasW || $canvas.height !== canvasH) {
    $canvas.width = canvasW;
    $canvas.height = canvasH;
  }
  lastCanvasMinute = currentMinute;

  // Paint pixel-perfect gradient with dithering to eliminate banding
  const imageData = ctx.createImageData(canvasW, canvasH);
  const pixels = imageData.data;

  // Precompute horizontal top/bottom colors (float precision)
  const hTopColors = new Float32Array(canvasW * 3);
  const hBottomColors = new Float32Array(canvasW * 3);
  for (let x = 0; x < canvasW; x++) {
    const frac = (x + 0.5) / canvasW;
    const centerPos = frac * count - 0.5;
    const leftIdx = Math.max(0, Math.min(count - 1, Math.floor(centerPos)));
    const rightIdx = Math.min(count - 1, leftIdx + 1);
    const t = leftIdx === rightIdx ? 0 : Math.max(0, Math.min(1, centerPos - leftIdx));
    const smooth = t * t * (3 - 2 * t);

    const topColor = lerpColor(colColors[leftIdx].top, colColors[rightIdx].top, smooth);
    const bottomColor = lerpColor(colColors[leftIdx].bottom, colColors[rightIdx].bottom, smooth);
    const i3 = x * 3;
    hTopColors[i3] = topColor[0]; hTopColors[i3 + 1] = topColor[1]; hTopColors[i3 + 2] = topColor[2];
    hBottomColors[i3] = bottomColor[0]; hBottomColors[i3 + 1] = bottomColor[1]; hBottomColors[i3 + 2] = bottomColor[2];
  }

  // Fill pixel buffer with vertical interpolation + ordered dithering
  // 4x4 Bayer matrix for dither (normalized to -0.5..+0.5 range)
  const bayer4 = [
    -0.5,    0.0,   -0.375,  0.125,
     0.25,  -0.25,   0.375, -0.125,
    -0.3125, 0.1875,-0.4375, 0.0625,
     0.4375,-0.0625, 0.3125,-0.1875,
  ];

  for (let y = 0; y < canvasH; y++) {
    const vt = y / (canvasH - 1);
    const rowOffset = y * canvasW * 4;
    const by = (y & 3) << 2; // bayer row: (y % 4) * 4
    for (let x = 0; x < canvasW; x++) {
      const i3 = x * 3;
      const dither = bayer4[by + (x & 3)]; // ordered dither value
      const pi = rowOffset + x * 4;
      pixels[pi]     = Math.max(0, Math.min(255, Math.round(hTopColors[i3]     + (hBottomColors[i3]     - hTopColors[i3])     * vt + dither)));
      pixels[pi + 1] = Math.max(0, Math.min(255, Math.round(hTopColors[i3 + 1] + (hBottomColors[i3 + 1] - hTopColors[i3 + 1]) * vt + dither)));
      pixels[pi + 2] = Math.max(0, Math.min(255, Math.round(hTopColors[i3 + 2] + (hBottomColors[i3 + 2] - hTopColors[i3 + 2]) * vt + dither)));
      pixels[pi + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // Paint radial glows onto canvas — one per column center
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const cx = (i + 0.5) * colWidth;
    const cy = canvasH * 0.45;
    const rx = colWidth * 0.7;
    const ry = canvasH * 0.3;
    const { top, bottom } = colColors[i];
    const mid = lerpColorRound(top, bottom, 0.5);
    const bright = lerpColorRound(mid, [255, 255, 255], 0.35);
    const isHome = columnEls[i].classList.contains('is-home');
    const alpha = isHome ? 0.06 : 0.035;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    grad.addColorStop(0, `rgba(${bright[0]}, ${bright[1]}, ${bright[2]}, ${alpha})`);
    grad.addColorStop(0.5, `rgba(${bright[0]}, ${bright[1]}, ${bright[2]}, ${alpha * 0.4})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  } // end needsCanvasRepaint

  // ---- Update each column's text ----
  for (let i = 0; i < count; i++) {
    const col = columnEls[i];
    const tz = col.dataset.tz;
    const time = getTimeInZone(tz);
    const { top, bottom } = colColors[i];

    // Text color
    const textColor = getTextColor(top, bottom);
    col.style.color = textColor;

    // Dynamic time size + time content
    const timeEl = col.querySelector('.time-display');
    timeEl.style.fontSize = `clamp(${timeSizePx * 0.6}px, ${timeSizeVw}vw, ${timeSizePx}px)`;
    if (config.use24h) {
      const h = String(time.hour24).padStart(2, '0');
      const m = time.minute;
      if (config.showSeconds) {
        timeEl.innerHTML = `${h}:${m}<span class="seconds">:${time.second}</span>`;
      } else {
        timeEl.textContent = `${h}:${m}`;
      }
    } else {
      const h = time.hour12;
      const m = time.minute;
      if (config.showSeconds) {
        timeEl.innerHTML = `${h}:${m}<span class="seconds">:${time.second}</span><span class="ampm">${time.ampm}</span>`;
      } else {
        timeEl.innerHTML = `${h}:${m}<span class="ampm">${time.ampm}</span>`;
      }
    }

    // Date
    const dateEl = col.querySelector('.date-display');
    dateEl.textContent = `${time.weekday}, ${time.month} ${time.day}`;

    // TZ info
    const tzInfoEl = col.querySelector('.tz-info');
    const abbr = getTzAbbreviation(tz);
    const utc = getUtcOffset(tz);
    const relative = config.home ? getRelativeOffset(tz, config.home.tz) : '';
    const dst = isDST(tz);

    let infoHTML = `${abbr} · ${utc}`;
    if (relative && relative !== 'same') {
      infoHTML += `<span class="offset-relative">${relative}</span>`;
    }
    if (dst) {
      infoHTML += `<br><span class="dst-badge">DST</span>`;
    }
    tzInfoEl.innerHTML = infoHTML;

    // DST badge coloring
    const badge = tzInfoEl.querySelector('.dst-badge');
    if (badge) {
      const avgLum = ((top[0] + bottom[0]) / 2 * 299 + (top[1] + bottom[1]) / 2 * 587 + (top[2] + bottom[2]) / 2 * 114) / 1000;
      badge.style.background = avgLum > 128 ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)';
    }
  }
}

function getSortedZones() {
  if (config.zones.length === 0) return config.zones;
  const now = new Date();
  return [...config.zones].sort((a, b) => {
    return getOffsetMinutes(a.tz, now) - getOffsetMinutes(b.tz, now);
  });
}

// ---- Zone Management ----

function addZone(city, country, tz) {
  const existing = config.zones.find(z => z.tz === tz);
  if (existing) {
    if (existing.cities.length >= 3) return;
    if (existing.cities.some(c => c.city === city && c.country === country)) return;
    existing.cities.push({ city, country });
  } else {
    if (config.zones.length >= 10) return;
    config.zones.push({ tz, cities: [{ city, country }] });
  }
  saveConfig();
  renderColumns();
}

function removeZone(tz) {
  config.zones = config.zones.filter(z => z.tz !== tz);
  saveConfig();
  renderColumns();
}

function setHome(city, country, tz) {
  config.home = { city, country, tz };
  // Ensure home zone is in the zones list
  const existing = config.zones.find(z => z.tz === tz);
  if (!existing) {
    config.zones.push({ tz, cities: [{ city, country }] });
  }
  saveConfig();
}

// ---- Storage ----

async function loadConfig() {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['meridian_config'], (result) => {
        if (result.meridian_config) {
          config = { ...config, ...result.meridian_config };
        }
        resolve();
      });
    } else {
      // Fallback for non-extension context (testing)
      const stored = localStorage.getItem('meridian_config');
      if (stored) {
        config = { ...config, ...JSON.parse(stored) };
      }
      resolve();
    }
  });
}

function saveConfig() {
  const data = {
    home: config.home,
    zones: config.zones,
    use24h: config.use24h,
    showSeconds: config.showSeconds,
  };
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ meridian_config: data });
  } else {
    localStorage.setItem('meridian_config', JSON.stringify(data));
  }
}

// ---- City Search ----

async function loadCities() {
  const resp = await fetch('data/cities.json');
  cities = await resp.json();
}

function searchCities(query) {
  if (!query || query.length < 1) return [];
  const q = query.toLowerCase();
  const matches = cities.filter(c =>
    c.city.toLowerCase().includes(q) ||
    c.country.toLowerCase().includes(q) ||
    c.tz.toLowerCase().includes(q)
  );

  // Deduplicate and prioritize starts-with
  const seen = new Set();
  const startsWith = [];
  const includes = [];

  for (const c of matches) {
    const key = `${c.city}-${c.country}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.city.toLowerCase().startsWith(q)) {
      startsWith.push(c);
    } else {
      includes.push(c);
    }
  }

  return [...startsWith, ...includes].slice(0, 12);
}

function renderSearchResults(results, $list, onSelect) {
  $list.innerHTML = '';
  searchSelectedIndex = -1;

  for (const city of results) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="city-name">${city.city}, ${city.country}</span>
      <span class="city-tz">${city.tz}</span>
    `;
    li.addEventListener('click', () => onSelect(city));
    $list.appendChild(li);
  }
}

function navigateResults($list, direction) {
  const items = $list.querySelectorAll('li');
  if (items.length === 0) return;

  if (direction === 'down') {
    searchSelectedIndex = Math.min(searchSelectedIndex + 1, items.length - 1);
  } else {
    searchSelectedIndex = Math.max(searchSelectedIndex - 1, 0);
  }

  items.forEach((li, i) => {
    li.classList.toggle('selected', i === searchSelectedIndex);
  });

  items[searchSelectedIndex].scrollIntoView({ block: 'nearest' });
}

function selectCurrentResult($list, onSelect) {
  const items = $list.querySelectorAll('li');
  if (searchSelectedIndex >= 0 && searchSelectedIndex < items.length) {
    items[searchSelectedIndex].click();
  }
}

// ---- Search Overlay ----

function openSearch() {
  $searchOverlay.classList.remove('hidden');
  $searchInput.value = '';
  $searchResults.innerHTML = '';
  searchSelectedIndex = -1;
  setTimeout(() => $searchInput.focus(), 50);
}

function closeSearch() {
  $searchOverlay.classList.add('hidden');
  $searchInput.value = '';
  $searchResults.innerHTML = '';
}

$addBtn.addEventListener('click', openSearch);

$searchOverlay.addEventListener('click', (e) => {
  if (e.target === $searchOverlay) closeSearch();
});

$searchInput.addEventListener('input', () => {
  const results = searchCities($searchInput.value);
  renderSearchResults(results, $searchResults, (city) => {
    addZone(city.city, city.country, city.tz);
    closeSearch();
  });
});

$searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSearch();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    navigateResults($searchResults, 'down');
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    navigateResults($searchResults, 'up');
  } else if (e.key === 'Enter') {
    e.preventDefault();
    selectCurrentResult($searchResults);
  }
});

// ---- Settings ----

$settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  $settingsPanel.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!$settingsPanel.contains(e.target) && e.target !== $settingsBtn) {
    $settingsPanel.classList.add('hidden');
  }
});

$toggle24h.addEventListener('change', () => {
  config.use24h = $toggle24h.checked;
  saveConfig();
  updateDisplay();
});

$toggleSeconds.addEventListener('change', () => {
  config.showSeconds = $toggleSeconds.checked;
  saveConfig();
  updateDisplay();
});

// ---- First-Run ----

function showFirstRun() {
  $firstRunModal.classList.remove('hidden');

  const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const detected = cities.find(c => c.tz === systemTz);

  if (detected) {
    $homeDetected.innerHTML = '';
    const btn = document.createElement('button');
    btn.textContent = `Use ${detected.city}, ${detected.country} (${systemTz})`;
    btn.addEventListener('click', () => {
      setHome(detected.city, detected.country, detected.tz);
      completeFirstRun();
    });
    $homeDetected.appendChild(btn);
  } else {
    // Try to find any city in the same timezone
    const anyMatch = cities.find(c => c.tz === systemTz);
    if (!anyMatch) {
      $homeDetected.innerHTML = `<p style="color: rgba(255,255,255,0.5); font-size: 13px;">Detected: ${systemTz} — search to select your city</p>`;
    }
  }

  $homeSearch.addEventListener('input', () => {
    const results = searchCities($homeSearch.value);
    renderSearchResults(results, $homeResults, (city) => {
      setHome(city.city, city.country, city.tz);
      completeFirstRun();
    });
  });

  $homeSearch.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateResults($homeResults, 'down');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateResults($homeResults, 'up');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectCurrentResult($homeResults);
    }
  });

  setTimeout(() => $homeSearch.focus(), 100);
}

function completeFirstRun() {
  $firstRunModal.classList.add('hidden');
  addDefaultZones();
  renderColumns();
  startTimer();
}

function addDefaultZones() {
  const defaults = [
    'America/Los_Angeles',
    'America/New_York',
    'Europe/London',
    'Europe/Berlin',
    'Asia/Tokyo',
  ];

  for (const tz of defaults) {
    if (tz === config.home.tz) continue;
    const city = cities.find(c => c.tz === tz);
    if (city && config.zones.length < 10) {
      addZone(city.city, city.country, city.tz);
    }
  }
}

// ---- Timer ----

function startTimer() {
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = setInterval(updateDisplay, 1000);
}

// ---- Resize handling ----
window.addEventListener('resize', () => updateDisplay());

// ---- Keyboard Shortcuts ----

document.addEventListener('keydown', (e) => {
  // Escape closes overlays
  if (e.key === 'Escape') {
    if (!$searchOverlay.classList.contains('hidden')) {
      closeSearch();
    }
    if (!$settingsPanel.classList.contains('hidden')) {
      $settingsPanel.classList.add('hidden');
    }
  }
});

// ---- Init ----

async function init() {
  await loadCities();
  await loadConfig();

  $toggle24h.checked = config.use24h;
  $toggleSeconds.checked = config.showSeconds;

  if (!config.home) {
    showFirstRun();
  } else {
    renderColumns();
    startTimer();
  }
}

init();
