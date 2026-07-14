# Meridian icon system

The icon combines Meridian's day-to-night gradient with a globe and single vertical meridian. The dark center field keeps the warm-white mark legible across both the daylight and nighttime portions of the palette.

The SVGs are optically tuned rather than mechanically scaled:

- `icon16.svg` uses simplified geometry and heavier relative strokes for browser chrome.
- `icon48.svg` is the intermediate extension-management size.
- `icon.svg` is the canonical 128px store and package source.
- `icon240.svg` supports larger promotional and repository use.

The matching PNGs preserve transparent rounded corners. Chrome packages `icon16.png`, `icon48.png`, and `icon128.png`; `npm run validate` enforces their dimensions, 8-bit RGBA format, and the master globe/meridian source contract.
