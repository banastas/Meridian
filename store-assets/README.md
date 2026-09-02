# Chrome Web Store assets

Release artwork for Meridian 1.2.2:

| Asset | Dimensions | Format |
| --- | ---: | --- |
| `meridian-screenshot-1280x800.png` | 1280×800 | 24-bit RGB PNG |
| `meridian-promo-small-440x280.png` | 440×280 | 24-bit RGB PNG |
| `meridian-promo-marquee-1400x560.png` | 1400×560 | 24-bit RGB PNG |

`promo-small.html`, `promo-marquee.html`, and `promo.css` are the editable promotional sources. `capture-seed.html` supplies a deterministic west-to-east clock arrangement for capturing the real built extension without changing application behavior or a contributor's stored configuration.

To refresh the product screenshot, run `npm run build`, serve the repository locally, open `store-assets/capture-seed.html` at a 1280×800 viewport, wait for the bundled fonts and canvas to render, and capture the viewport as `meridian-screenshot-1280x800.png`.

`npm run validate` verifies each file's PNG signature, exact dimensions, 8-bit RGB channels, and lack of alpha or palette data. The root README references the store screenshot directly so there is only one canonical copy.
