# Changelog

## v0.2.4 — CrusaderPope

Brings in most of [CrusaderPope](https://github.com/xwcg/CrusaderPope) by xwcg. The app is now licensed under the GNU GPL v3.0 with the Commons Clause (see LICENSE and NOTICE.md); earlier releases keep the MIT license.

- Index the game and the selected mod in the background, and show a References section in every editor: where the entry is defined, whether the mod adds or overrides it, and everything that uses it or that it uses — opening in its editor where there is one.
- Read any entry as plain language: events as a story (where they come from, texts, conditions, options and what they lead to), on_actions as what they fire, everything else as a summary card.
- Show a character's 3D portrait, built from their DNA and drawn with the game's own shaders, and change their looks gene by gene in the Barbershop, saved into the mod.
- Add a Map page: 2D and 3D, realms, de jure titles, cultures, faiths, terrain and more at any history date, with Show on map from titles, cultures, faiths and religions. Change a province's culture, faith, holding, development, holder, liege or colour from the map.
- Add a 3D Models page: every model of the game and the mod drawn with the game's shaders, with a Blender round trip (export as glTF, import back into the mod).
- Add a Mods page: launcher playsets, the game's mod list and the app's own lists — reorder, enable, write back (backed up first) and load into the game index — plus new mods, packing and unpacking.
- Undo every change the app makes to the mod (saves, map edits, Barbershop, Blender imports), kept across restarts.
- Add 3D graphics quality to Settings, and a switch to turn the game index off (it takes about 3 GB of memory).

## v0.2.3 — Scripted characters

- Show everything a mod does to a character in their editor, not just their history record: script run on them (`character:<id> = { … }` in scripted effects, on_actions, events), titles they hold, bookmarks, vassal/employer setup, and the parts of their record the form doesn't cover. Each statement shows how the game reaches it and under what conditions, and is editable in place — traits, perks, flags, sexuality and amounts as fields, everything else as script.
- Fold scripted traits, sexuality and skill changes into the character's own fields, marked with where they come from.
- Save script edits together with the form; a statement that changed on disk fails the save with nothing written, and a no-op save leaves every file byte-identical.
- Make every option in reference dropdowns reachable — lists stopped around "C" before.

## v0.2.2 — CK3 1.20 support

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
