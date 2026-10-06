# Architecture

Skonester CK3 Mod Editor is an Electron application split into a privileged
main process, a sandboxed preload bridge, and a React renderer. CK3 file access
and all mutation remain outside the renderer. Shared parsing and editing
modules are used by the processes that need them so reads and writes follow the
same rules.

## Process boundaries

### Main process: `src/main/`

The main process owns filesystem access, application lifecycle, window
creation, IPC handlers, settings, mod discovery, and all CK3 reads and writes.
The main process:

- Detects CK3 installations and parses local `.mod` descriptors.
- Layers game files and selected mod files, including `replace_path`
  behavior.
- Reads and writes characters, dynasties, houses, cultures, faiths, rites,
  religions, titles, and history entries.
- Starts and coordinates the game-index worker and graphics/map workers.
- Owns undo recording and broadcasts file-change revisions to the renderer.
- Registers the `ck3://` protocol for decoded game images and map data.

`src/main/index.ts` is the IPC composition point. A new renderer capability
normally requires a main-process handler, a preload method, and a matching
declaration in `src/preload/index.d.ts`.

### Preload: `src/preload/`

The preload runs with context isolation and exposes the narrow
`window.ck3tools` API through Electron’s `contextBridge`. It is the only
supported renderer entry point for application-specific privileged operations.
The upstream-compatible `window.api` surface is also exposed for ported
CrusaderPope renderer code.

Keep the preload API typed and minimal. Do not move filesystem or CK3 access
into the renderer to avoid adding a second, less-controlled access path.

### Renderer: `src/renderer/src/`

The renderer is a React 19 application. TanStack Router uses a code-based route
tree with hash history so packaged `file://` builds can navigate correctly.
`AppContext.tsx` loads settings, tracks the selected mod, starts the optional
game index, and exposes data revisions to editor pages.

Pages compose shared application components and shadcn/ui primitives. The
renderer owns form state, lists, navigation, and presentation; it does not own
the authoritative file contents.

## Data and editing flow

1. A page requests data through `window.ck3tools`.
2. The preload forwards the typed request to a main-process IPC handler.
3. A reader layers game and mod files, parses the relevant Paradox script, and
   returns typed data plus file/source information where applicable.
4. The page displays the data and keeps a draft. Persisted drafts, favorites,
   and recents are stored through the settings API.
5. On save, the main process verifies the expected source content, computes
   targeted edits, records an undo step, and writes through the mod writer.
6. A `mod:filesChanged` notification increments the renderer data revision.
   Pages reload their source data so references and drafts reflect the saved
   files.

## Parsing and preservation

The shared parser/writer layer in `src/shared/` is central to the editor’s
non-destructive behavior:

- `pdx.ts` scans comments, quotes, blocks, and exact byte spans.
- `lineEditor.ts` changes scalar, repeated-scalar, and block-valued fields
  while preserving existing layout where possible.
- `scriptFile.ts` appends validated top-level blocks without reformatting
  existing content.
- `scriptTree.ts` parses deeply nested script used by scripted effects,
  on-actions, and events.
- `scopeEffects.ts` handles common effects in character scope blocks.

Readers should tolerate the spelling and formatting found in real CK3 files.
Writers should preserve line endings, quote style, comments, ordering, and
unknown fields. A no-op save is expected to be byte-identical for supported
editors.

Script-site support extends character editing beyond the character’s primary
history record. `scriptSites.ts` locates references, scope blocks, and owned
statements across mod script files, and applies all changes only after every
site has been found and validated.

## Game index and worker architecture

`src/main/gameIndex.ts` hosts one index for the game and the selected/layered
mods. `src/main/gameIndexWorker.ts` owns the worker-side index. The index
provides definitions, origins, references, overrides, removal state, and
incremental refreshes when mod files change. Its cache lives under the
application’s `userData/index-cache`; the indexer code hash invalidates stale
caches.

Ported CrusaderPope workers handle expensive or specialized work:

- portraits and model geometry
- shader compilation
- map composition and map edits
- image decoding
- coat-of-arms rendering
- Blender import/export
- cache writing

The main process forwards these requests to workers and injects application
paths where needed. Renderer modules that import the ported API are lazy-loaded
so the main renderer bundle does not eagerly load all 3D dependencies.

## Persistence, undo, and safety

Settings are stored as JSON under Electron’s `userData` directory. Packaged
builds retain the historical `CK3 Tools` user-data folder so upgrades do not
strand existing settings.

Mutating IPC handlers use `undoable(...)`. Mod text writes go through
`writeModText`, which records the original content when the undo recorder is
installed. Upstream map, DNA, and related operations retain their own undo
integration.

Before a targeted save, readers and writers use expected paths, block
locations, dates, or original bodies as appropriate. If a file moved or its
content changed unexpectedly, the operation fails instead of silently writing
to a different definition.

## Adding an editor or capability

For a new editor:

1. Define shared request, response, and patch types in `src/shared/types.ts`.
2. Add a main-process reader/writer and focused tests using scratch files.
3. Register IPC handlers in `src/main/index.ts`.
4. Add typed methods to `src/preload/index.ts` and `src/preload/index.d.ts`.
5. Add a route and page under `src/renderer/src/`.
6. Reuse existing form, history, draft, reference, and UI components.
7. Wire the save through `undoable` and `writeModText`.
8. Trigger or consume the normal file-change revision so open pages refresh.
9. Run `npm run typecheck`, the relevant tests, and `npm run build`.

For a new port from CrusaderPope, keep upstream files under
`src/crusaderpope/` verbatim whenever possible. Adapt the surrounding
Skonester code instead, and record unavoidable upstream changes in
`src/crusaderpope/PATCHES.md`.

## Build structure

`electron.vite.config.ts` builds separate main, preload, renderer, and worker
entries. `vite.config.ts` exists as a tooling stub for shadcn and related
configuration discovery; build changes belong in `electron.vite.config.ts`.
The Electron Builder configuration packages `out/`, the application metadata,
and the license/notice files into Windows installers and zip archives.
