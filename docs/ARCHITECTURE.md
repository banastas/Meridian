# Meridian architecture and feature contracts

Meridian is an offline-first Manifest V3 new-tab extension. Runtime code has no third-party dependencies, background process, content script, remote API, analytics endpoint, or location permission. `newtab.js` owns browser interaction, while `core.js` contains deterministic logic that is shared with the Node regression suite.

## Configuration schema

`normalizeConfig()` is the only entry point for saved, synced, preset, or imported configuration. Schema version 2 stores:

- the home city and ordered timezone list;
- up to three grouped cities and one working/waking schedule per timezone;
- 12/24-hour time, seconds, information density, gradient theme, smooth-transition, and availability preferences;
- up to 12 named preset snapshots;
- active preset, onboarding completion, and local/sync storage choice.

Normalization repairs a missing home column, removes duplicate or malformed zones, clamps schedules, limits collection sizes, and migrates the original unversioned configuration without reopening onboarding. Presets deliberately exclude presets and storage mode, preventing recursive data and ensuring that activating a clock layout cannot change privacy behavior.

New timezone columns are sorted by their UTC offset at the instant they are added, so the dashboard returns to a stable west-to-east current-time order. Timezones with the same current offset retain their relative order. Edit mode can then apply and persist an intentional manual order.

## Storage and portability

Local-only is the default. Installed extension pages use `chrome.storage.local`; optional sync uses `chrome.storage.sync`. A local mode pointer determines which area to load. `createConfigStore()` in `core.js` owns persistence against injected storage areas, so the Node suite exercises it with quota-enforcing fakes:

- Every save writes the full configuration to local storage immediately. In sync mode the same configuration is written to sync after a one-second debounce, which keeps rapid edits within Chrome's write-rate quotas; pending writes flush when the tab is hidden or closed.
- Sync allows 8,192 bytes per item. Configurations that fit keep the original single `meridian_config` item; larger ones store each preset as `meridian_preset_<n>` beside it and remove stale preset items.
- Each record carries `updatedAt` and a per-page `writer` ID. On load, a local copy newer than sync (an edit that never reached sync) wins and is re-queued.
- Enabling sync adopts a configuration already synced from another device instead of overwriting it, keeps presets from both, and offers a toast action to use this device's clocks instead. A fresh install with a synced record adopts it and skips onboarding.
- Switching back to local-only saves locally and then removes all of Meridian's sync items.
- `chrome.storage.onChanged` (or the `storage` event in previews) reloads configuration written by other tabs or devices, ignoring the page's own writes, so a stale tab never saves its old copy over newer changes.

Ordinary HTTP previews use origin-scoped `localStorage`, never a browser-provided Chrome shim.

Backup exports are versioned JSON envelopes. Imports, stored data, sync data, and preset activation all pass through the same normalization contract, which also drops timezones the runtime cannot render. An import keeps the browser's current storage mode, so a backup made on a synced browser never enables sync by itself. No city list is submitted to an application server.

## Planning and availability

Time travel is ephemeral and intentionally resets on a new tab. The planner covers 0–48 hours in exact 15-minute increments on a fixed quarter-hour grid: its origin is the quarter hour that was current when time travel began, so planned times land on :00, :15, :30, or :45 and stay put while real time passes. Its selected instant feeds time/date formatters, offsets, gradients, transition detail, and availability highlighting. The slider marks each home-timezone midnight with its weekday (found by sampling the grid, so DST days stay exact), the planned time shows its distance from now, and the slider's `aria-valuetext` announces both.

Availability supports conventional and overnight schedules plus working days. Each timezone's days default to its first city's CLDR work week through `Intl.Locale#getWeekInfo()`, so Tel Aviv works Sunday to Thursday; edit mode can change them. The early-morning part of an overnight shift belongs to the day it began. The core scans the next 48 hours in 15-minute increments and coalesces consecutive matching samples into windows. The planner summary names the next window after the planned time and moves the planner there when selected. Disabled schedules opt a timezone out of the constraint without removing its clock.

## Search

`searchEntries()` ranks a normalized index built once per page: exact city name first, then abbreviations and exact timezone names when typed in capitals (`IST`), city prefixes, lowercase abbreviations (so `ist` still starts Istanbul), later words of a city name, countries, localized timezone names, timezone IDs, and finally any substring. `TIMEZONE_ABBREVIATIONS` covers abbreviations that ICU only provides in some locales; each abbreviation's zones are listed by prominence and offer one representative city per zone before more cities in the first zone. The localized-name index fills in idle time once search opens, and each result shows its current local time and offset from home.

## Solar theme

`data/timezone-coordinates.json` contains a representative coordinate for every IANA timezone used by the 599-city catalog. It is generated from the operating system's IANA `zone.tab`, then `zone1970.tab`, then alias links in `tzdata.zi`:

```sh
npm run data:coordinates
```

Each zone keeps its own `zone.tab` location. Links only fill zones with no entry of their own, because a link target can be far away (`Atlantic/Reykjavik` links to `Africa/Abidjan`). The generator refuses incomplete output. Runtime sunrise and sunset calculations use only the selected date, timezone, and bundled coordinate. Local time maps onto the palette with sunrise at 5:00, solar noon at 12:00, sunset at 19:00, and solar midnight at 24:00, measured from sunrise so summer sunsets after local midnight stay continuous. Polar days/nights fall back to the predictable clock palette. The fixed clock palette remains the default.

## Gradient rendering

The canvas is composed from two continuous horizontal gradients: one for the top palette and one for the bottom palette. A vertical alpha mask blends them into a single two-dimensional field. Smoothstep-sampled color stops preserve the soft transitions between timezone centers without painting rounded one-pixel strips. A fixed, subpixel monochrome dither is then blended at very low opacity to prevent visible 8-bit bands in dark colors without introducing animated grain or external texture assets. Because the field has no edges, the backing store is painted at 1× and scaled by the browser, which keeps ten clocks on a 5K display at about a quarter of the full-resolution memory.

Fonts ship as WOFF2 converted losslessly from the Google Fonts TTFs by `fonts/download.sh`; the two faces needed for the first paint are preloaded.

## Accessibility and localization

- Every dialog is modal and every hidden advanced control is removed from the accessibility tree.
- Search follows combobox/listbox/option semantics with active-descendant keyboard navigation.
- Time travel uses a native range plus explicit 15-minute arrow and one-hour Page Up/Down contracts.
- Edit actions have visible focus, semantic labels, button-based keyboard reordering, and an accessible undo status.
- Context details are available on both hover and focus.
- Reduced motion and forced colors are first-class style modes.
- All interface keys must exist in English, Spanish, Latin American Spanish, and French; dates and country names use the browser's regional locale (`resolveLocale()` keeps `en-GB` day-month dates), and a fresh install starts with that locale's usual 12- or 24-hour clock.
- Gradient text is selected by measured WCAG contrast, not a guessed time-of-day rule.

## Release gate

`npm run verify` validates JavaScript syntax, manifest permissions, catalog parity, runtime privacy, offline coordinate completeness, accessibility primitives, DST edge cases, gradient contrast, all regression tests, packaged-file equality, and a deterministic root-correct Chrome Web Store ZIP. The build removes obsolete versioned ZIPs so `dist` retains only the current release. CI rebuilds the package and fails if committed artifacts differ.
