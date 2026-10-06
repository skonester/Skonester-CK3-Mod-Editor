# Skonester CK3 Mod Editor

Skonester CK3 Mod Editor is a Windows-focused Electron application for
inspecting and editing Crusader Kings III game and mod data. It provides
dedicated editors for characters, dynasties, houses, faiths, rites, religions,
cultures, titles, and related history, along with map, model, portrait, and mod
management tools.

The editor is designed for mod authors who want structured forms without losing
the formatting, comments, ordering, or unknown data in their Paradox script
files.

## Features

- Character editing, including culture, faith, rite, dynasty, house, traits,
  skills, relationships, history, and DNA workflows.
- Dynasty and house creation and editing.
- Culture, faith, rite, and religion editors with CK3 1.20-aware schemas.
- Title definitions and title-history editing, including relative history
  subfolders.
- Faith-history editing with dated entries and full-script access.
- Mod discovery, selection, layered game/mod data, and settings persistence.
- Game indexing with references between definitions and their uses.
- Map, model, portrait, coat-of-arms, shader, and story views where the
  required game data is available.
- Undo support for editor, map, DNA, and other mutating operations.
- Byte-preserving saves for unchanged content and targeted edits for supported
  fields.

## Requirements

- Windows with Crusader Kings III installed.
- Node.js and npm for development.
- A CK3 game data directory and a local mod directory. The application can
  detect common Steam installations, or paths can be selected in Settings.

The game directory should point to the `game` data folder, for example:

```text
C:\Program Files (x86)\Steam\steamapps\common\Crusader Kings III\game
```

Workshop subscriptions and packed-only mods are not required for the normal
editing workflow. The editor works with local mods and their `.mod`
descriptors.

## Development

Install dependencies and start the Electron development environment:

```powershell
npm ci
npm run dev
```

Useful validation commands:

```powershell
npm run typecheck
npm test
npm run build
```

The production build is emitted to `out/`. Windows installers and zip archives
can be produced with:

```powershell
npm run dist
```

Build artifacts are written to `dist/`.

## Using the application

1. Start the application and open **Settings**.
2. Select or confirm the CK3 game data directory.
3. Add or select a local mod.
4. Choose an editor from the sidebar.
5. Select an existing definition or create a new one.
6. Save changes after reviewing the displayed file and field values.

New top-level characters, dynasties, houses, cultures, religions, rites, and
titles are appended to the selected file. New faiths are inserted into their
selected religion's faith collection. Existing content is edited in place where
the editor supports it. Use the application’s Undo action if a change needs to
be reverted.

The optional game index can take substantially more memory while it builds for
the first time. Its cache is kept in the application data directory and is
reused on later launches.

## Project layout

```text
src/main/       Electron main process, CK3 readers, writers, IPC, and workers
src/preload/    Sandboxed context bridge and renderer-facing type declarations
src/renderer/   React application, routes, pages, and UI components
src/shared/     Shared types, Paradox-script parsing, and editing helpers
src/crusaderpope/
                Ported CrusaderPope indexer, graphics, map, and mod facilities
docs/           Compatibility and feature documentation
```

See [architecture.md](architecture.md) for the process boundaries, data flow,
write guarantees, and extension points.

## Compatibility notes

The editor supports both legacy CK3 definition shapes and the CK3 1.20
standalone faith and rite databases where the selected game/mod data provides
those schemas. It does not simulate every runtime script condition, DLC
condition, bookmark override, or campaign state. Read
[docs/CK3-1.20.md](docs/CK3-1.20.md) for the supported 1.20 behavior and
known scope boundaries.

Always keep a backup or use source control for important mods. The editor
validates the expected source content before many writes, but it cannot verify
that every edited value is semantically valid to the game.

## Attribution

This project includes and adapts code from
[CrusaderPope](https://github.com/xwcg/CrusaderPope) by xwcg. The applicable
notices and upstream license are recorded in [NOTICE.md](NOTICE.md) and
[src/crusaderpope/LICENSE](src/crusaderpope/LICENSE).

Crusader Kings III and its content belong to Paradox Interactive. This project
is not affiliated with or endorsed by Paradox Interactive.

## License

The core project license is **GNU General Public License v3.0 (GPL-3.0)**.
This repository also applies the **Commons Clause** condition described in
[LICENSE](LICENSE). The complete terms in that file control; see
[NOTICE.md](NOTICE.md) for historical licensing and third-party attribution
details.
