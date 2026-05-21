# Meridian
![](https://github.com/banastas/Meridian/blob/main/1280x800.png?raw=true)
A Chrome extension that replaces your new tab with a beautiful multi-timezone dashboard.

Each timezone is a full-height column painted with a gradient that reflects the local time of day — pale creams at noon, warm ambers in the afternoon, deep corals at sunset, dark navies at midnight. Adjacent columns blend seamlessly into each other using a canvas-based gradient engine with smoothstep interpolation, creating one continuous color landscape across the world.

Inspired by [Figure It Out](https://www.producthunt.com/products/fio-figure-it-out-for-chrome).

## Features

- **Time-of-day gradients** — 12 color bands interpolated by the minute, painted onto a shared canvas
- **Seamless column blending** — no hard edges between timezones, colors flow naturally
- **600+ cities** across all major IANA timezones
- **Dynamic typography** — time display scales inversely with column count
- **Home timezone** — indicated with a subtle underline accent
- **Instant city search** — fuzzy matching with keyboard navigation
- **English, Argentine Spanish, and French (France)** — localized UI, dates, country names, and city search aliases
- **12h / 24h format** and optional seconds display
- **DST detection** — badge and UTC offset shown per column
- **Relative offset** — see how each timezone relates to your home
- **Persistent config** — your setup survives across sessions via `chrome.storage`
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

The gradient engine defines 12 color bands (one per 2-hour window) with top and bottom colors for each. Every minute, each column's band is interpolated based on the local time in that timezone. A full-viewport `<canvas>` element is painted pixel by pixel with smoothstep blending between adjacent columns and an ordered Bayer dither to eliminate banding. Text color automatically switches between light and dark based on the background luminance.

## Privacy

Meridian requests a single permission — `storage` — used to persist your timezone list and display preferences locally via `chrome.storage`. No analytics, no tracking, no network requests. Fonts are bundled with the extension.

## Stack

- Vanilla HTML / CSS / JS
- Bundled fonts: [Inter](https://fonts.google.com/specimen/Inter) + [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono)
- Chrome Extension Manifest V3
- Canvas 2D API for gradient rendering
- `Intl.DateTimeFormat` for all time/date formatting
- No build tools, no bundlers, no frameworks

## Releases

See [GitHub Releases](https://github.com/banastas/Meridian/releases) for the changelog.

## License

MIT
