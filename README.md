# Meridian
![](https://github.com/banastas/Meridian/blob/main/1280x800.png?raw=true)
A Chrome extension that replaces your new tab with a beautiful multi-timezone dashboard.

Each timezone is a full-height column painted with a gradient that reflects the local time of day — pale creams at noon, warm ambers in the afternoon, deep corals at sunset, dark navies at midnight. Adjacent columns blend seamlessly into each other using a canvas-based gradient engine with smoothstep interpolation, creating one continuous color landscape across the world.

Inspired by [Figure It Out](https://www.producthunt.com/products/fio-figure-it-out-for-chrome).

## Features

- **Time-of-day gradients** — 12 color bands interpolated by the minute, painted onto a shared canvas
- **Time travel** — scrub every clock, date, offset, and gradient up to 48 hours ahead in 15-minute steps
- **Shared availability** — set per-timezone working or waking hours and find the next common window
- **Solar-aware theme** — optional offline sunrise/sunset timing for all 415 included timezones
- **Seamless column blending** — no hard edges between timezones, colors flow naturally
- **599 cities** across all major IANA timezones
- **Dynamic typography** — time display scales inversely with column count
- **Home timezone** — indicated with a subtle underline accent
- **Instant city search** — fuzzy matching with keyboard navigation
- **English, Argentine Spanish, and French (France)** — localized UI, dates, country names, and city search aliases
- **12h / 24h format** and optional seconds display
- **Contextual timezone detail** — relative offsets stay primary; UTC, abbreviation, IANA name, and nearby clock changes appear on hover or focus
- **Purposeful onboarding** — start with your people, a world-clock sample, or only home
- **Edit mode** — drag or keyboard-reorder clocks, change home, edit working hours, remove, and undo
- **Named presets** — save separate Work, Family, Trip, or other clock arrangements
- **Private portability** — choose local-only or Chrome sync storage, and export/import a complete JSON backup
- **Power shortcuts** — `A` or `/` add, `T` plans, `E` edits, `,` opens settings, and `Escape` closes or returns to now
- **Accessible by contract** — keyboard-first controls, localized date order, reduced motion, forced colors, live feedback, and WCAG-aware text contrast
- **Zero dependencies** — vanilla HTML, CSS, and JS with no build step

## Install

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/meridian/jldjgjlnkhfngchiaehmmeneipcolafp).

Or load it unpacked:

1. Clone this repo
2. Open `chrome://extensions` (or `brave://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked** and select the `Meridian` folder
5. Open a new tab

## How It Works

The gradient engine defines 12 color bands (one per 2-hour window) with top and bottom colors for each. Each column's band is continuously interpolated from its selected local time, including time travel. The optional solar theme remaps the palette to locally calculated sunrise, solar noon, and sunset using checked-in IANA timezone coordinates—no location permission or service call. A high-DPI canvas uses browser-native vertical gradients with smoothstep blending between adjacent columns. Text automatically switches between black and white using WCAG relative-luminance contrast calculations.

Shared availability is calculated locally in 15-minute increments across each clock's configured hours. Presets are self-contained snapshots of clock order, home, working hours, and display settings; changing presets never changes the selected storage privacy mode.

## Privacy

Meridian requests a single permission — `storage`. Local-only mode is the default. Chrome sync is optional and uses the browser's own signed-in storage; switching back to local-only removes Meridian's synced configuration. JSON export/import provides an account-independent backup path. No analytics, tracking, application servers, weather APIs, location permission, or runtime network requests are used. Fonts, city search data, localization, and timezone coordinates are bundled with the extension.

## Stack

- Vanilla HTML / CSS / JS
- Bundled fonts: [Inter](https://fonts.google.com/specimen/Inter) + [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono)
- Chrome Extension Manifest V3
- Canvas 2D API for gradient rendering
- `Intl.DateTimeFormat` for all time/date formatting
- No runtime dependencies, bundlers, or frameworks

## Development and QA

Meridian remains dependency-free at runtime. Node's built-in test runner and small repository scripts provide repeatable QA and deterministic packaging:

```sh
npm run check          # source/data/i18n validation + regression tests
npm run data:coordinates # regenerate solar coordinates from local IANA tzdata
npm run build          # rebuild dist/meridian and the root-correct release ZIP
npm run validate:dist  # verify packaged files and ZIP contents against source
npm run verify         # run the complete local release gate
```

The release ZIP is written to `dist/meridian-<version>.zip` with `manifest.json` at its root, ready for Chrome Web Store upload. CI runs the same checks and fails if committed release artifacts are stale.

## Releases

See [GitHub Releases](https://github.com/banastas/Meridian/releases) for the changelog.

## Product design

See [the product and experience review](docs/PRODUCT_REVIEW.md) for the north star, design rationale, and implementation record behind Meridian's planning features. [Architecture and feature contracts](docs/ARCHITECTURE.md) documents the configuration, privacy, solar-data, accessibility, and release invariants.

## License

MIT
