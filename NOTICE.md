# Notices

## License change

Up to v0.2.3, Skonester CK3 Mod Editor was released under the MIT license. From the
version that first includes CrusaderPope code, it is licensed under the **GNU General
Public License v3.0 with the Commons Clause** — see [LICENSE](LICENSE). Releases made
before that keep the license they were published under.

## CrusaderPope

This app includes code from **CrusaderPope**, an explorer and mod editor for Crusader
Kings III by xwcg — <https://github.com/xwcg/CrusaderPope> — licensed under the GNU
General Public License v3.0 with the Commons Clause. Its license is kept verbatim in
[src/crusaderpope/LICENSE](src/crusaderpope/LICENSE).

The included code lives under [src/crusaderpope/](src/crusaderpope/), mirroring
CrusaderPope's own `src/` layout, unmodified from upstream (CrusaderPope 0.2.0) except
for the lines listed in [src/crusaderpope/PATCHES.md](src/crusaderpope/PATCHES.md):

- `main/indexer/` — the tolerant Paradox-script parser and the game index: every
  definition of the game and the loaded mods, the references between them, how mods
  override, merge or remove entries, and the on-disk index cache
- `main/mods/gamefiles.ts`, `main/mods/zip.ts` — the game's files layered with mods
  (load order, `replace_path`, packed mods)
- `main/portraits/`, `main/history/` — 3D portraits built from a character's DNA, genes
  and portrait modifiers, the model browser, the history facts portraits read
- `main/shaders/`, `main/shaderWorker.ts`, `main/shaderLog.ts` — the game's gfx/FX
  shaders recompiled for WebGL on worker threads, their cache and error log
- `main/map/`, `main/map*Worker.ts` — the map's province raster, terrain, overlays and
  layers at any history date
- `main/coa/` — coats of arms
- `main/blender/`, `main/blenderWorker.ts` — glTF export and import of game meshes
- `main/images/`, `main/imageService.ts`, `main/imageWorker.ts` — DDS/PNG decoding and
  encoding, and the `ck3://` image protocol
- `main/describe/text.ts`, `main/gameDir.ts`, `main/cacheWriter.ts` — helpers
- `renderer/src/three/` — three.js materials, lights and the game-shader runtime
- `renderer/src/components/map/` (the `.ts` modules) — the 2D and 3D map renderers,
  camera, labels and overlays
- `renderer/src/components/coa-draw.ts`, `renderer/src/{api,img,revision,graphics,pending}`
  — the renderer-side helpers those use
- `shared/` — shared types, shader requests, map composition and script formatting

Code adapted from CrusaderPope outside that folder (rebuilt on this app's UI):
`src/renderer/src/lib/portraitStage.ts` and `components/CharacterPortrait.tsx` (its
PortraitViewer), `components/models/` (its ModelView and MeshViewer),
`components/map/` (its MapView, Map3DView, Legend, DateControl, Minimap, MapPanel and
mode bar), `src/main/blender.ts` (its blender/ipc.ts) and `src/main/gameIndexWorker.ts`
(its indexWorker.ts).

Crusader Kings III and its content belong to Paradox Interactive. Neither this app nor
CrusaderPope is affiliated with or endorsed by Paradox Interactive.
