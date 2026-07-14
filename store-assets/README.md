# Chrome Web Store assets

Release artwork for Meridian 1.2.1:

| Asset | Dimensions | Format |
| --- | ---: | --- |
| `meridian-screenshot-1280x800.png` | 1280×800 | 24-bit RGB PNG |
| `meridian-promo-small-440x280.png` | 440×280 | 24-bit RGB PNG |
| `meridian-promo-marquee-1400x560.png` | 1400×560 | 24-bit RGB PNG |

`promo-small.html`, `promo-marquee.html`, and `promo.css` are the editable promotional sources. `capture-seed.html` supplies a deterministic west-to-east clock arrangement for capturing the real built extension without changing application behavior or stored user configurations.

`npm run validate` verifies each file's PNG signature, exact dimensions, 8-bit RGB channels, lack of alpha/palette data, and that the repository's README screenshot matches the current store screenshot.
