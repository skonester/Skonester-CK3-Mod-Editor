/**
 * Worker thread that owns the game index: CrusaderPope's GameIndex (ported
 * verbatim under src/crusaderpope), built over the game plus the selected mod.
 * A build parses every script and localization file (~10 s, ~3 GB), so it runs
 * here; the main process (gameIndex.ts) forwards queries and file changes.
 *
 * Besides the index it carries what CrusaderPope derives from it for the 3D
 * views — portraits (PortraitBuilder over the History of game-start facts),
 * the model browser, coats of arms, the map's data, and the store of game
 * shaders compiled for WebGL on a pool of threads — under the same method
 * names CrusaderPope's own worker uses, so its renderer code calls them as is —
 * and its StoryBuilder: script read as plain language (cards, event stories).
 */
import { parentPort, Worker } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { GameIndex, type Entity } from '../crusaderpope/main/indexer/gameIndex'
import { cacheParts, readIndexCache } from '../crusaderpope/main/indexer/cache'
import { GameFiles } from '../crusaderpope/main/mods/gamefiles'
import { PortraitBuilder } from '../crusaderpope/main/portraits/portrait'
import { History } from '../crusaderpope/main/portraits/modifiers'
import { ModelBrowser } from '../crusaderpope/main/portraits/models'
import { CharacterTable } from '../crusaderpope/main/history/characters'
import { MapData } from '../crusaderpope/main/map/mapData'
import { RASTER_VERSION, readRasterMeta, type RasterMeta } from '../crusaderpope/main/map/raster'
import { mapTerrain } from '../crusaderpope/main/map/terrain'
import { mapOverlays } from '../crusaderpope/main/map/overlays'
import { mapCharacter, mapCharacters } from '../crusaderpope/main/map/edit-characters'
import { coatOfArms } from '../crusaderpope/main/coa/coa'
import { fxFingerprint, ShaderStore } from '../crusaderpope/main/shaders/store'
import { ShaderPool } from '../crusaderpope/main/shaders/pool'
import { StoryBuilder } from '../crusaderpope/main/describe/stories'
import { LocExamples } from '../crusaderpope/main/describe/locExamples'
import type {
  CoaKind,
  IndexStatus,
  ModInfo as IndexMod,
  PortraitRequest,
  RefGroup,
  ShaderRequest
} from '../crusaderpope/shared/api'
import type {
  EntityReferences,
  IndexDef,
  IndexRefGroup,
  IndexRefItem,
  IndexSite
} from '@shared/types'

export interface BuildRequest {
  gameDir: string
  /** The mods over the game in load order (later wins), as the index's ModInfo */
  mods: IndexMod[]
  language: string
  /** The index cache: one file, keyed to the indexer's code version */
  cache: { file: string; code: string }
}

interface Request {
  id: number
  method: string
  params: unknown[]
}

let index: GameIndex | null = null
let vfs: GameFiles | null = null
let buildSeq = 0
/** Bumped by every build and incremental update: views keyed on it reload */
let revision = 0
let cache: BuildRequest['cache'] | null = null
/** What the current build layers over the game (the shader and map threads layer the same) */
let buildMods: IndexMod[] = []

// Derived from the index (rebuilt after a build and after updates; all lazy — the work happens on use)
let history: History | null = null
let stories: StoryBuilder | null = null
let portraits: PortraitBuilder | null = null
let characters: CharacterTable | null = null
let models: ModelBrowser | null = null
let mapData: MapData | null = null
let shaders: ShaderStore | null = null
/** Compiler threads of the current build (a newer build cancels the old pool) */
let pool: ShaderPool | null = null

const post = (status: IndexStatus): void => parentPort!.postMessage({ status })

/** An entry for the shader log (written by the main process) */
function logShader(kind: string, title: string, detail?: string): void {
  parentPort!.postMessage({ log: { kind, title, detail } })
}

/** Writes the cache on a thread of its own (crusaderpope/main/cacheWriter.ts) */
function saveCache(idx: GameIndex, fingerprint: string, state = idx.exportState()): void {
  const target = cache
  if (!target) return
  const { parts, transfer } = cacheParts(state)
  const w = new Worker(join(__dirname, 'cacheWriter.js'))
  w.once('message', () => void w.terminate())
  w.once('error', () => void w.terminate())
  w.postMessage({ file: target.file, fingerprint, parts }, transfer)
}

/**
 * After incremental updates the cache no longer matches the files, so the next
 * start would parse everything: a while after the last update the index is
 * written again, fingerprinted with the file versions it read.
 */
let recacheTimer: ReturnType<typeof setTimeout> | null = null
const RECACHE_DELAY = 8000
function scheduleRecache(): void {
  if (recacheTimer) clearTimeout(recacheTimer)
  recacheTimer = setTimeout(() => {
    recacheTimer = null
    const idx = index
    if (!idx || !cache) return
    const snap = idx.cacheSnapshot(cache.code)
    if (!snap) return
    saveCache(idx, snap.fingerprint, snap.state)
  }, RECACHE_DELAY)
}

/**
 * `lib`: the portrait asset library to keep (its mesh and texture caches) when
 * no gfx file changed; `characters` / `models`: false keeps those as they are.
 */
function derive(
  idx: GameIndex,
  what: { lib?: PortraitBuilder['lib']; characters?: boolean; models?: boolean } = {}
): void {
  mapData = new MapData(idx)
  history = new History(idx)
  stories = new StoryBuilder(idx)
  // What a text code prints for the sample character (the examples in faith cards' names)
  const h = history
  let examples: LocExamples | undefined
  stories.locExample = (chain) => (examples ??= new LocExamples(idx, h)).examples([chain])[chain]
  const builder = new PortraitBuilder(idx, history, what.lib)
  portraits = builder
  if (what.characters !== false || !characters) characters = new CharacterTable(idx, history)
  // Creatures' previews borrow the decal list of the first character showing them
  if (what.models !== false || !models)
    models = new ModelBrowser(idx, builder.lib, (mesh) => builder.previewDecals(mesh))
}

/**
 * The compiler threads and the store of compiled shaders for the loaded files:
 * programs of an earlier run with the same FX files come from the cache next to
 * the index cache. Replaces the running pool.
 */
function shaderStore(gameDir: string, files: GameFiles): ShaderStore {
  pool?.terminate()
  const threads = new ShaderPool(
    join(__dirname, 'shaderWorker.js'),
    { gameDir, mods: buildMods },
    Math.max(1, Math.min(4, Math.floor(availableParallelism() / 3)))
  )
  pool = threads
  const store = new ShaderStore(
    (req) => threads.compile(req),
    cache ? join(dirname(cache.file), 'shaders.json') : null,
    fxFingerprint(files, (cache?.code ?? '') + threads.version),
    (req, message) => logShader('COMPILE', `${req.file} · ${req.effect}`, message)
  )
  store.load()
  return store
}

/**
 * Every Effect the .asset files name, compiled on the shader threads once the
 * index is ready — a view asking meanwhile waits for the same compile.
 */
function precompileShaders(idx: GameIndex, store: ShaderStore, seq: number): void {
  const assets = idx.modelFiles().filter((m) => /\.asset$/i.test(m.rel))
  void store
    .precompile(assets, idx.vfs, {
      planned: () => {},
      progress: () => {},
      alive: () => seq === buildSeq && shaders === store
    })
    .then(() => {
      const { programs, failures } = store.list()
      logShader('SUMMARY', `${programs.length} shader programs compiled, ${failures.length} failed`)
    })
    .catch(() => {})
}

/** The province raster of the loaded map files (built once per version of them, on a thread of its own) */
let rasterJob: { key: string; job: Promise<RasterMeta> } | null = null
function mapRaster(dir: string): Promise<RasterMeta> {
  const v = vfs
  if (!v || !mapData) return Promise.reject(new Error('Index not ready'))
  const files = mapData.mapFiles()
  const pf = v.get(files.provinces)
  const df = v.get(files.definitions)
  if (!pf || !df) return Promise.reject(new Error('The loaded game files have no map'))
  const key = createHash('sha1')
    .update(
      JSON.stringify([RASTER_VERSION, ...[pf, df].map((f) => [v.where(f), v.stat(f).size, v.stat(f).mtime])])
    )
    .digest('hex')
    .slice(0, 16)
  if (rasterJob?.key === key) return rasterJob.job
  const cached = readRasterMeta(dir, key)
  const job = cached
    ? Promise.resolve(cached)
    : new Promise<RasterMeta>((resolve, reject) => {
        const png = v.read(pf)
        const csv = v.readText(df)
        if (!png || csv === undefined) return reject(new Error('Cannot read the map files'))
        const worker = new Worker(join(__dirname, 'mapWorker.js'), { workerData: { png, csv, dir, key } })
        worker.once('message', (m: { meta?: RasterMeta; error?: string }) => {
          void worker.terminate()
          if (m.meta) resolve(m.meta)
          else reject(new Error(m.error ?? 'No province raster'))
        })
        worker.once('error', reject)
      })
  rasterJob = { key, job }
  // A failed build is tried again on the next request
  job.catch(() => {
    if (rasterJob?.job === job) rasterJob = null
  })
  return job
}

function build(req: BuildRequest): void {
  const seq = ++buildSeq
  index = null
  history = portraits = characters = models = mapData = shaders = stories = null
  rasterJob = null
  cache = req.cache
  buildMods = req.mods
  if (recacheTimer) clearTimeout(recacheTimer)
  recacheTimer = null

  let last = 0
  let lastPhase = ''
  const progress = (p: { phase: string; done: number; total: number }): void => {
    if (p.phase === 'Done') return
    const now = Date.now()
    if (now - last > 100 || p.phase !== lastPhase) {
      last = now
      lastPhase = p.phase
      post({ state: 'indexing', phase: p.phase, done: p.done, total: p.total, gameDir: req.gameDir })
    }
  }
  progress({ phase: 'Scanning files', done: 0, total: 1 })

  try {
    vfs?.close()
    vfs = new GameFiles(req.gameDir, buildMods)
    let idx = new GameIndex(vfs, req.language)
    idx.scan(progress)
    // Valid while every indexed file, the language and the indexer code are unchanged
    const fingerprint = idx.fingerprint(req.cache.code)
    const state = readIndexCache(req.cache.file, fingerprint)
    let loaded = false
    if (state) {
      progress({ phase: 'Loading the cached index', done: 0, total: 1 })
      try {
        idx.importState(state, progress)
        loaded = true
      } catch {
        idx = new GameIndex(vfs, req.language)
        idx.scan(progress)
      }
    }
    if (!loaded) idx.parseAll(progress)
    if (seq !== buildSeq) return
    index = idx
    if (!loaded) saveCache(idx, fingerprint)
    derive(idx)
    const store = shaderStore(req.gameDir, vfs)
    shaders = store
    post({ state: 'ready', stats: idx.stats, gameDir: req.gameDir, revision: ++revision })
    precompileShaders(idx, store, seq)
  } catch (err) {
    post({ state: 'error', message: String((err as Error)?.stack ?? err), gameDir: req.gameDir })
  }
}

/**
 * Files of the mod folder that changed on disk — saved by an editor here or
 * elsewhere (absolute paths; a folder stands for everything below it) — taken
 * in without a full build. Returns a reason when a full build is needed instead.
 */
async function refreshFiles(
  paths: string[]
): Promise<{ changed: boolean; fallback?: string; gfx?: string[] }> {
  const idx = index
  if (!idx) return { changed: false, fallback: 'the index is not ready' }
  let changed = false
  const files: string[] = []
  const gfx: string[] = []
  let shaderFiles = false
  let next: string[] | undefined = paths
  while (next) {
    const r = idx.refreshFiles(next)
    changed ||= r.changed
    files.push(...r.files)
    gfx.push(...r.gfx)
    shaderFiles ||= !!r.shaders?.length
    if (r.fallback) return { changed, fallback: r.fallback }
    next = r.rest
    // Queries that came in meanwhile are answered between the parts
    if (next) {
      await new Promise((resolve) => setImmediate(resolve))
      if (index !== idx) return { changed }
    }
  }
  // Shader files aren't the index's: their programs compile again on demand
  if (shaderFiles) shaders = shaderStore(idx.gameDir, idx.vfs)
  if (changed) {
    derive(idx, {
      // A new asset library forgets the meshes and textures read so far: only when a gfx file changed
      lib: gfx.length ? undefined : (portraits?.lib ?? undefined),
      characters: files.some(
        (f) => /^(history|localization)\//i.test(f) || /^common\/(dynast|religion|culture|traits)/i.test(f)
      ),
      models: gfx.length > 0
    })
    scheduleRecache()
  }
  if (changed || shaderFiles) {
    post({
      state: 'ready',
      stats: idx.stats,
      gameDir: idx.gameDir,
      revision: ++revision,
      changedFiles: files.slice(0, 500)
    })
  }
  // (gfx: the image service drops its decoded copies of those files)
  return { changed, gfx }
}

function siteOf(file: string, line: number): IndexSite {
  const f = vfs?.get(file)
  return { file, path: f?.abs ?? null, line }
}

/** Where an entry's winning definition lives — what an editor needs to open it */
function defOf(idx: GameIndex, e: Entity | undefined): IndexDef | undefined {
  const d = e && idx.winningDef(e)
  const f = d && idx.files[d.file]
  if (!d || !f) return undefined
  return { file: f.rel, path: f.gf.abs ?? null, line: d.line, inMod: f.source > 0 }
}

function groupOf(idx: GameIndex, g: RefGroup, limit: number): IndexRefGroup {
  const items = g.items.slice(0, limit).map(
    (it): IndexRefItem => ({
      type: it.type,
      name: it.name,
      display: it.display,
      contexts: it.contexts,
      sites: it.sites.map((s) => siteOf(s.file, s.line)),
      count: it.count,
      def: defOf(idx, idx.get(it.type, it.name)),
      mod: it.mod
    })
  )
  return { type: g.type, typeLabel: g.typeLabel, total: g.items.length, items }
}

/**
 * What the index knows about one entry. `limit` caps the items per group — a
 * culture or rite is referenced by tens of thousands of characters — and each
 * group's `total` says how many there are; ask again with a group's `type` in
 * `full` to get all of that group.
 */
function references(
  type: string,
  name: string,
  limit = 50,
  full?: { direction: 'incoming' | 'outgoing'; type: string }
): EntityReferences | null {
  const idx = index
  const d = idx?.detail(type, name)
  if (!idx || !d) return null
  const groups = (gs: RefGroup[], direction: 'incoming' | 'outgoing'): IndexRefGroup[] =>
    gs.map((g) =>
      groupOf(idx, g, full?.direction === direction && full.type === g.type ? Infinity : limit)
    )
  return {
    type: d.type,
    typeLabel: d.typeLabel,
    name: d.name,
    display: d.display,
    mod: d.mod,
    defs: d.defs.map((def) => ({
      file: def.file,
      path: def.absPath,
      line: def.line,
      origin: def.origin,
      overridden: def.overridden
    })),
    incoming: groups(d.incoming, 'incoming'),
    outgoing: groups(d.outgoing, 'outgoing')
  }
}

const entity = (type: string, name: string): Entity | undefined => index?.get(type, name)

const handlers: Record<string, (...args: never[]) => unknown> = {
  build: (req: BuildRequest) => build(req),
  refreshFiles: (paths: string[]) => refreshFiles(paths),
  references: (
    type: string,
    name: string,
    limit?: number,
    full?: { direction: 'incoming' | 'outgoing'; type: string }
  ) => references(type, name, limit, full),

  // CrusaderPope's own queries (its indexWorker.ts), for its 3D and map code
  fileFolders: (type: string) => index?.fileFolders(type) ?? [],
  filesIn: (type: string, folder: string) => index?.filesIn(type, folder) ?? [],
  portrait: (type: string, name: string, opts?: PortraitRequest) => {
    const e = entity(type, name)
    return e && portraits ? portraits.build(e, opts) : null
  },
  portraitReport: (type: string, name: string, opts?: PortraitRequest) => {
    const e = entity(type, name)
    return e && portraits ? portraits.report(e, opts) : null
  },
  modelFolder: (folder: string) => models?.folder(folder) ?? [],
  modelInfo: (path: string) => models?.info(path) ?? null,
  modelGeometry: (path: string, pdxmesh?: string) => models?.geometry(path, pdxmesh) ?? null,
  textureUsers: (path: string) => models?.textureUsers(path) ?? [],
  // The Blender round trip: the mesh file and each sub-mesh's material
  modelExportPlan: (path: string, pdxmesh?: string) => models?.exportPlan(path, pdxmesh) ?? null,
  shader: (req: ShaderRequest) => {
    if (!shaders) throw new Error('Index not ready')
    return shaders.compile(req)
  },
  shaderPrograms: () => shaders?.list() ?? { programs: [], failures: [] },
  textureData: async (path: string, maxSize?: number) => {
    const t = await portraits?.lib.texture(path, maxSize ?? 0)
    return t ? { width: t.width, height: t.height, rgba: t.rgba } : null
  },
  coatOfArms: (kind: CoaKind, key: string, date?: string) =>
    index ? coatOfArms(index, kind, key, date) : null,
  // The map: its province raster is built into the map cache folder `dir` (served as ck3://map/<key>.bin)
  mapInfo: async (dir: string, date?: string) => {
    const meta = await mapRaster(dir)
    return mapData ? mapData.info(meta, date) : null
  },
  mapStatic: async (dir: string) => {
    const meta = await mapRaster(dir)
    return mapData ? mapData.static(meta) : null
  },
  mapDated: async (dir: string, date?: string) => {
    const meta = await mapRaster(dir)
    return mapData ? mapData.dated(meta, date) : null
  },
  mapTerrain: (dir: string) => (vfs && mapData ? mapTerrain(vfs, mapData.mapFiles(), dir) : null),
  mapOverlays: (dir: string) => (vfs && mapData ? mapOverlays(vfs, mapData.mapFiles(), dir) : null),
  mapCharacters: (q: string, date: string) =>
    index && characters ? mapCharacters(index, characters, q, date) : [],
  mapCharacter: (id: string, date: string) =>
    index && characters ? mapCharacter(index, characters, id, date) : undefined,
  searchCharacters: (q: string, limit?: number) => characters?.search(q, limit) ?? [],
  // Script read as plain language: an entry's card (with its event or on_action story)
  card: (type: string, name: string) => {
    const e = entity(type, name)
    return e && stories ? stories.card(e) : null
  },
  story: (type: string, name: string) => {
    const e = entity(type, name)
    if (!e || !stories) return null
    return type === 'on_action' ? stories.onActionStory(e) : type === 'events' ? stories.eventStory(e) : null
  },
  tooltip: (type: string, name: string) => {
    const e = entity(type, name)
    return e && stories ? stories.tooltip(e) : null
  },
  usageAll: (type: string, name: string, userType: string) => {
    const e = entity(type, name)
    return e && stories ? stories.usageAll(e, userType) : []
  }
}

parentPort!.on('message', async (req: Request) => {
  try {
    const fn = handlers[req.method]
    if (!fn) throw new Error(`Unknown game index method: ${req.method}`)
    const result = await (fn as (...args: unknown[]) => unknown)(...req.params)
    parentPort!.postMessage({ id: req.id, result })
  } catch (err) {
    parentPort!.postMessage({ id: req.id, error: String((err as Error)?.message ?? err) })
  }
})
