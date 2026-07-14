# Meridian product and experience review

> Implementation status: complete in the current build. The release-sequence sections below are preserved as the product rationale; every recommended planning, coordination, delight, portability, accessibility, and privacy item is now implemented and release-gated.

## Product north star

Meridian is already unusually clear: it turns abstract timezone arithmetic into a glanceable landscape. The best next version should preserve that calm, private, instant new-tab experience while helping users answer a more useful question:

> What is happening across my world now, and when is the best time for us to connect?

That framing keeps the gradient clock wall as the emotional center while giving future functionality a coherent purpose.

## What is already strong

- The continuous day-to-night landscape is distinctive and immediately understandable.
- The page is useful without an account, network request, tutorial, or recurring maintenance.
- Grouping cities that share a timezone prevents redundant columns.
- Home-relative offsets are easier to reason about than raw UTC offsets.
- Local fonts, data, and storage support a credible privacy promise.
- The interface remains attractive with one clock or many clocks.

## Highest-impact opportunities

### 1. Add a time-travel scrubber

**Implemented:** the planner covers the next 48 hours in 15-minute steps; the slider, arrow keys, `T`, `Escape`, and the explicit Now control update every clock, date, offset, availability state, and gradient together.

Let the user drag from now through the next 24–48 hours. Every clock, date, relative offset, and gradient should move together, with a clear “Now” return control.

This would be both the most useful and most enjoyable addition: planning a call becomes tactile, and watching the world move through sunrise and night reinforces Meridian's core visual idea.

Suggested interaction:

- Press `T` or click a subtle timeline affordance to enter time-travel mode.
- Drag in 15-minute increments; use arrow keys for accessible fine adjustment.
- Show the selected home time above the scrubber and preserve local dates in every column.
- Return to live time automatically only when the user explicitly exits or opens a new tab.

### 2. Add shared-availability mode

**Implemented:** every clock has an editable enabled/start/end schedule, including overnight hours. Meridian highlights current availability and calculates the next shared window locally over 48 hours.

Allow users to mark normal working or waking hours per timezone, then highlight the overlap across selected columns. A compact result such as “Best overlap: 16:00–18:00 Paris / 09:00–11:00 Los Angeles” turns Meridian into a real coordination tool.

Keep this optional and visually restrained: a translucent band or underline is enough. It should layer naturally onto the time-travel scrubber rather than becoming a separate scheduling application.

### 3. Replace generic defaults with goal-aware onboarding

**Implemented:** after setting home, people, sample, and home-only paths are offered. The people path keeps search open for rapid multi-add.

The canonical defaults make the first screen visually impressive but are unlikely to match a new user's actual world. After selecting home, offer three lightweight choices:

- Add my team or family cities
- Start with a world-clock sample
- Start with only my home timezone

The first option should keep the city search open for rapid multi-select. This improves relevance without turning onboarding into a questionnaire.

### 4. Add intentional ordering and presets

**Implemented:** the first-run world sample is sorted west-to-east by its current UTC offsets; after onboarding, saved order is authoritative. Edit mode supports native drag-and-drop plus keyboard/button movement. Named presets snapshot clocks, order, home, schedules, and display preferences. Local-only remains default, Chrome sync is optional, and returning to local-only clears the synced Meridian record.

UTC ordering is logical, but users also think in teams, trips, and relationships. Support drag or keyboard reordering, plus named presets such as “Work,” “Family,” and “Trip.” A preset should remember zones, order, home timezone, and display preferences.

Chrome storage sync could make those presets available across signed-in browsers while preserving the no-account product model. Local-only storage should remain a selectable privacy mode.

### 5. Make the gradients solar-aware

**Implemented:** an optional solar theme uses a checked-in coordinate for all 415 represented IANA timezones and a local sunrise/sunset calculation. It adds no API, runtime request, or permission.

The fixed time bands are attractive, but sunrise and sunset vary by latitude and season. The city dataset could include coordinates and calculate solar events locally, with no weather API or location permission. Optional solar-aware gradients would make Meridian feel alive in winter, summer, and high-latitude cities.

This should be a theme rather than a silent behavioral change: the existing predictable palette is worth preserving.

## Experience and delight improvements

### Simplify secondary information

**Implemented:** home-relative offset is the persistent secondary datum. Abbreviation, UTC offset, IANA identifier, and only nearby DST transitions live in a hover/focus detail card. Standard and compact density are available.

The current `PDT · UTC−7`, relative offset, and `DST` stack is accurate but visually busy, especially when nearly every northern-hemisphere clock shows a DST badge. Consider:

- Make the relative offset the primary secondary datum.
- Move abbreviation and UTC offset into a hover/focus detail card.
- Show DST only near a transition, with useful copy such as “Clocks move forward in 6 days.”
- Offer a compact information-density setting.

### Add a deliberate edit mode

**Implemented:** `E` or the edit control reveals reordering, home, removal, and per-clock schedule actions. Removal has a six-second accessible undo action.

Faint remove buttons keep the canvas calm but remain visually ambiguous. An “Edit clocks” mode could reveal remove, reorder, set-home, and grouping actions together. Always keep keyboard-accessible shortcuts and an undo toast for destructive actions.

### Add restrained motion

**Implemented:** the gradient interpolates below minute precision and smooth transitions remain optional. Explicit sun/moon markers were removed after visual review because they were too abstract. Reduced-motion and forced-color preferences override decorative behavior.

Small touches could increase delight without making a new tab distracting:

- Cross-fade gradients at minute boundaries instead of visibly stepping.
- Animate entry into time-travel mode and shared-availability mode.
- Respect reduced-motion and forced-colors preferences, as the current build now does.

### Add power-user shortcuts

**Implemented:** `/` and `A`, `T`, `E`, comma, and `Escape` are active and documented in settings. Shortcuts do not fire while typing.

Useful defaults would be `/` or `A` to add a timezone, `T` for time travel, `E` for edit mode, comma for settings, and Escape to close or return to now. A small shortcut reference can live in settings.

### Provide backup and portability

**Implemented:** JSON export/import includes clocks, home, order, schedules, presets, and preferences. Import passes through the same versioned normalization and repair contract as stored data.

Add JSON export/import for zones, presets, and preferences. It is inexpensive, supports privacy-conscious users, and gives a recovery path independent of browser sync.

## Recommended release sequence

All four phases were delivered together as a coherent interaction model. The planner is shared by time travel and availability; advanced controls are contained in edit mode and settings; the default canvas remains calm.

1. **Planning release:** smarter onboarding, manual ordering, undo removal, and storage sync/export.
2. **Coordination release:** time-travel scrubber plus shared-availability highlighting.
3. **Delight release:** optional solar-aware gradients, smooth transitions, and themes.
4. **Ongoing polish:** contextual DST information, compact density, more locales, and keyboard refinements.

## Product guardrails

These are enforced by repository validation: runtime files cannot contain external URLs, the manifest may request only `storage`, all represented timezones require offline coordinates, locale key parity is mandatory, accessibility primitives are checked, pure planning logic has regression tests, and release artifacts must be deterministic copies of source.

- Keep the default new-tab load instant and fully useful offline.
- Do not require an account or transmit the user's city list.
- Make every visual mode optional and preserve the calm default.
- Treat accessibility, localization, and deterministic release validation as feature contracts.
- Prefer functionality that deepens the timezone use case over generic new-tab widgets such as weather, quotes, tasks, or news.

## Success signals

If privacy-preserving product analytics are ever added as an explicit opt-in, the most useful measures would be preset creation, time-travel use, shared-window discovery, and retention of user-selected zones. Without analytics, store reviews and structured feedback prompts can answer the same questions without weakening Meridian's current privacy position.
