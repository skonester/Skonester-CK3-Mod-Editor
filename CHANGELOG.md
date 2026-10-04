# Changelog

## Unreleased — CK3 1.20 support

- Add dated faith-history editing with complete-script access to rite/DLC setups and popularity, persistent drafts, and stale-file protection.
- Expand faith, rite, and religion settings with culture associations, reserved names, rite heads, origins, government overrides, holy-site limits, and weighted virtues/sins.
- Read and edit standalone faiths and nested religion details while preserving legacy definitions.
- Add a Rite Editor with parent faith links, core tenets, doctrines, founder titles, and persistent drafts.
- Add independent character rite fields, main-rite selectors, and eminent holy sites.
- Resolve doctrine membership from 1.20 declarations and keep tenets in their own database.
- Read top-level succession laws and nested ecclesiastical title history.
- Verify every religion, faith, rite, and faith-history entry in the supplied 1.20.0.3 data round-trips byte-for-byte on a no-op save.

## v0.1.0 — first release

First packaged build of CK3 Tools: an Electron desktop app for editing Crusader
Kings III mod data. Windows installer (NSIS) and portable zip.

### Setup

- Auto-detects the CK3 install (Steam registry + `libraryfolders.vdf`) and your
  mod folder; both paths can be set by hand.
- Lists local mods by parsing their `.mod` descriptors (Workshop subscriptions
  are excluded). Mod switcher lives in the sidebar header.
- Settings persist to `%APPDATA%/ck3-tools/settings.json`.

### Character Editor

- Browse a mod's characters in a sortable, per-column-filterable table,
  including a birth-date range filter.
- Detail panel with grouped form sections: name, ID (display-only), culture,
  faith/religion, dynasty and house (separate fields), traits, birth and death
  dates, father and mother.
- Create new characters, add a child, or add a member to a dynasty/house from
  the panel; reference fields link straight to the referenced record.
- Trait picker with real CK3 trait icons (DDS decoded in-app).
- Family tree showing parents, children, and spouses; coats of arms render in
  the detail header.
- Favorites, recents, and persistent drafts, so unsaved edits survive
  navigation instead of being discarded.
- Ctrl/Cmd+S saves, Esc closes. Selection lives in the URL, so Back returns to
  the list.

### Dynasty & House Editor

- Browse and filter dynasties and houses, edit their fields, and see members
  and rendered coats of arms.

### Editing safety

- Saves are surgical: only the edited block's byte span is rewritten, so the
  rest of the file stays byte-identical. A no-op save round-trips exactly.
- Parsers tolerate the quirks found in real mod files (mixed quoting, malformed
  dates) and preserve each line's existing style.
- Reference data (cultures, faiths, traits) layers mod files over game files,
  honouring `replace_path`.

### Mod profiles

- A mod can ship a `ck3-tools.json` at its content root. Currently supports an
  offset calendar (e.g. Hegemonia's file year 3220 shown as "780 BC"), with
  BC/AD date entry. Display-only — converted values are never written to files.

### Known limitations

- Windows only; the app is unsigned, so SmartScreen will warn on first run.
- Culture and Faith editors are placeholders.
