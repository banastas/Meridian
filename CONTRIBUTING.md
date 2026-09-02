# Contributing to Meridian

Thanks for helping improve Meridian. Focused bug fixes, accessibility improvements, localization corrections, and well-scoped product refinements are welcome.

## Before opening a change

1. Search existing issues and pull requests to avoid duplicate work.
2. For a substantial behavior or interface change, open an issue first so the product direction can be discussed before implementation.
3. Keep Meridian offline-first and dependency-free at runtime. New permissions, remote requests, analytics, or third-party runtime code require an explicit product and privacy review.

## Local workflow

Use Node.js 20 or newer.

```sh
git clone https://github.com/banastas/Meridian.git
cd Meridian
npm run check
```

Load the repository root through `chrome://extensions` with Developer mode enabled. Open a new tab to exercise the extension in its real browser context.

Before submitting a pull request, run the complete release gate:

```sh
npm run verify
```

This checks JavaScript syntax, the extension manifest, localization parity, bundled data, privacy and accessibility contracts, deterministic logic, generated package contents, and the release ZIP.

## Change expectations

- Add or update regression tests when shared logic changes.
- Update all four locale catalogs when interface copy changes.
- Preserve keyboard behavior, visible focus, reduced motion, forced colors, and text contrast.
- Keep configuration changes backward-compatible through `normalizeConfig()`.
- Do not hand-edit `dist/meridian`; run `npm run build` after changing runtime source.
- Keep generated release artifacts limited to the current version.
- Update relevant documentation when a user-facing or architectural contract changes.

## Reporting bugs

Include the browser and version, Meridian version, operating system, reproduction steps, expected behavior, and actual behavior. Screenshots are useful for visual issues, but remove personal clock arrangements or other private information first.

Security reports should follow [SECURITY.md](SECURITY.md) rather than a public issue.
