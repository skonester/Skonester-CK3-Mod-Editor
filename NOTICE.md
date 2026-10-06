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
CrusaderPope's own `src/` layout, and is unmodified from upstream (CrusaderPope 0.2.0):

- `main/indexer/` — the tolerant Paradox-script parser and the game index: every
  definition of the game and the loaded mods, the references between them, how mods
  override, merge or remove entries, and the on-disk index cache
- `main/mods/gamefiles.ts`, `main/mods/zip.ts` — the game's files layered with mods
  (load order, `replace_path`, packed mods)
- `main/images/dds.ts`, `main/images/files.ts`, `main/describe/text.ts`,
  `main/gameDir.ts`, `main/cacheWriter.ts` — helpers the index uses
- `shared/api.ts`, `shared/scriptFormat.ts` — shared types and script formatting

Crusader Kings III and its content belong to Paradox Interactive. Neither this app nor
CrusaderPope is affiliated with or endorsed by Paradox Interactive.
