/**
 * Worker thread that owns the game index: CrusaderPope's GameIndex (ported
 * verbatim under src/crusaderpope), built over the game plus the selected mod.
 * A build parses every script and localization file (~10 s, ~3 GB), so it runs
 * here; the main process (gameIndex.ts) forwards queries and file changes.
 *
 * Unlike CrusaderPope's own worker this one carries only the index — no
 * stories, portraits, map or shaders — so it stays a thin shell around
 * build / refreshFiles / references.
 */
import { parentPort, Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { GameIndex, type Entity } from '../crusaderpope/main/indexer/gameIndex'
import { cacheParts, readIndexCache } from '../crusaderpope/main/indexer/cache'
import { GameFiles } from '../crusaderpope/main/mods/gamefiles'
import type {
  IndexStatus,
  ModInfo as IndexMod,
  RefGroup
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
  /** The selected mod, as the index's ModInfo; null indexes the game alone */
  mod: IndexMod | null
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

const post = (status: IndexStatus): void => parentPort!.postMessage({ status })

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

function build(req: BuildRequest): void {
  const seq = ++buildSeq
  index = null
  cache = req.cache
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
    vfs = new GameFiles(req.gameDir, req.mod ? [req.mod] : [])
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
    post({ state: 'ready', stats: idx.stats, gameDir: req.gameDir, revision: ++revision })
  } catch (err) {
    post({ state: 'error', message: String((err as Error)?.stack ?? err), gameDir: req.gameDir })
  }
}

/**
 * Files of the mod folder that changed on disk — saved by an editor here or
 * elsewhere (absolute paths; a folder stands for everything below it) — taken
 * in without a full build. Returns a reason when a full build is needed instead.
 */
async function refreshFiles(paths: string[]): Promise<{ changed: boolean; fallback?: string }> {
  const idx = index
  if (!idx) return { changed: false, fallback: 'the index is not ready' }
  let changed = false
  let next: string[] | undefined = paths
  while (next) {
    const r = idx.refreshFiles(next)
    changed ||= r.changed
    if (r.fallback) return { changed, fallback: r.fallback }
    next = r.rest
    // Queries that came in meanwhile are answered between the parts
    if (next) {
      await new Promise((resolve) => setImmediate(resolve))
      if (index !== idx) return { changed }
    }
  }
  if (changed) {
    scheduleRecache()
    post({ state: 'ready', stats: idx.stats, gameDir: idx.gameDir, revision: ++revision })
  }
  return { changed }
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

const handlers: Record<string, (...args: never[]) => unknown> = {
  build: (req: BuildRequest) => build(req),
  refreshFiles: (paths: string[]) => refreshFiles(paths),
  references: (
    type: string,
    name: string,
    limit?: number,
    full?: { direction: 'incoming' | 'outgoing'; type: string }
  ) => references(type, name, limit, full)
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
