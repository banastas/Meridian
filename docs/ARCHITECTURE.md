# Meridian architecture and feature contracts

Meridian is an offline-first Manifest V3 new-tab extension. Runtime code has no third-party dependencies, background process, content script, remote API, analytics endpoint, or location permission. `newtab.js` owns browser interaction, while `core.js` contains deterministic logic that is shared with the Node regression suite.

## Configuration schema

`normalizeConfig()` is the only entry point for saved, synced, preset, or imported configuration. Schema version 2 stores:

- the home city and ordered timezone list;
- up to three grouped cities and one working/waking schedule per timezone;
- 12/24-hour time, seconds, information density, gradient theme, atmosphere, and availability preferences;
- up to 12 named preset snapshots;
- active preset, onboarding completion, and local/sync storage choice.

Normalization repairs a missing home column, removes duplicate or malformed zones, clamps schedules, limits collection sizes, and migrates the original unversioned configuration without reopening onboarding. Presets deliberately exclude presets and storage mode, preventing recursive data and ensuring that activating a clock layout cannot change privacy behavior.

## Storage and portability

Local-only is the default. Installed extension pages use `chrome.storage.local`; optional sync uses `chrome.storage.sync`. A local mode pointer determines which area to load. Switching back to local-only first saves the current configuration locally and then removes Meridian's sync record. Ordinary HTTP previews use origin-scoped `localStorage`, never a browser-provided Chrome shim.

Backup exports are versioned JSON envelopes. Imports, stored data, sync data, and preset activation all pass through the same normalization contract. No city list is submitted to an application server.

## Planning and availability

Time travel is ephemeral and intentionally resets on a new tab. The planner covers 0–48 hours in exact 15-minute increments. Its selected instant feeds time/date formatters, offsets, gradients, celestial cues, transition detail, and availability highlighting.

Availability supports conventional and overnight schedules. The core scans the next 48 hours in 15-minute increments and coalesces consecutive matching samples into windows. Disabled schedules opt a timezone out of the constraint without removing its clock.

## Solar theme

`data/timezone-coordinates.json` contains a representative coordinate for every IANA timezone used by the 599-city catalog. It is generated from the operating system's IANA `zone.tab` plus alias links in `tzdata.zi`:

```sh
npm run data:coordinates
```

The generator refuses incomplete output. Runtime sunrise and sunset calculations use only the selected date, timezone, and bundled coordinate. Polar days/nights fall back to the predictable clock palette. The fixed clock palette remains the default.

## Accessibility and localization

- Every dialog is modal and every hidden advanced control is removed from the accessibility tree.
- Search follows combobox/listbox/option semantics with active-descendant keyboard navigation.
- Time travel uses a native range plus explicit 15-minute arrow and one-hour Page Up/Down contracts.
- Edit actions have visible focus, semantic labels, button-based keyboard reordering, and an accessible undo status.
- Context details are available on both hover and focus.
- Reduced motion and forced colors are first-class style modes.
- All interface keys must exist in English, Spanish, Latin American Spanish, and French; dates and country names use the active locale.
- Gradient text is selected by measured WCAG contrast, not a guessed time-of-day rule.

## Release gate

`npm run verify` validates manifest permissions, catalog parity, runtime privacy, offline coordinate completeness, accessibility primitives, DST edge cases, gradient contrast, all regression tests, packaged-file equality, and a deterministic root-correct Chrome Web Store ZIP. CI rebuilds the package and fails if committed `dist` artifacts differ.
