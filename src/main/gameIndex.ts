import { app, BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'fs'
import { join, resolve } from 'path'
import { Worker } from 'worker_threads'
import { initImages, refreshImages } from '../crusaderpope/main/imageService'
import { logShader } from '../crusaderpope/main/shaderLog'
import type { ModInfo as IndexMod, ShaderLogEntry } from '../crusaderpope/shared/api'
import type { EntityReferences, IndexStatus, ModInfo } from '@shared/types'
import type { BuildRequest } from './gameIndexWorker'
import { modsOfList, readModsState } from '../crusaderpope/main/mods/manager'
import { cpSettings, modId, setIndexHooks, setLoadedMods } from './modsHost'
import { loadSettings } from './settings'

/**
 * Main-process side of the game index (gameIndexWorker.ts): one index at a
 * time, over the game plus the selected mod. `ensureGameIndex` builds it when
 * that pair changes; the mod folder is watched so saves — this app's and any
 * other editor's — are taken in incrementally, keeping references current.
 * Each build also restarts CrusaderPope's image workers (the `ck3://img/…`
 * protocol) over the same layering, so textures come from the same files.
 */

/** Hash of the indexer's code (electron.vite.config.ts `indexCodeHash`): a change invalidates the cache */
declare const __GAME_INDEX_CODE__: string

let worker: Worker | null = null
let status: IndexStatus = { state: 'idle' }
/** What the current index was built from; null = none (a crash or a disable clears it) */
let built: { key: string; gameDir: string; mod: ModInfo | null; mods: IndexMod[] } | null = null
let reqId = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function setStatus(next: IndexStatus): void {
  status = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('index:status', status)
  if (status.state === 'ready') void flushChanges()
}

function startWorker(): Worker {
  const w = new Worker(join(__dirname, 'gameIndexWorker.js'), {
    // The whole game's references take ~3 GB; big mods add to that
    resourceLimits: { maxOldGenerationSizeMb: 6144 }
  })
  type Message = {
    id?: number
    result?: unknown
    error?: string
    status?: IndexStatus
    log?: ShaderLogEntry
  }
  w.on('message', (msg: Message) => {
    if (msg.log) {
      logShader(msg.log)
      return
    }
    if (msg.status) {
      setStatus(msg.status)
      return
    }
    const p = pending.get(msg.id!)
    if (!p) return
    pending.delete(msg.id!)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
  })
  w.on('error', (err: unknown) => {
    // Out of memory, most likely: forget it so the next ensure starts afresh
    const error = err instanceof Error ? err : new Error(String(err))
    worker = null
    built = null
    for (const p of pending.values()) p.reject(error)
    pending.clear()
    setStatus({ state: 'error', message: `The game index stopped: ${error.message}` })
  })
  return w
}

function call<T>(method: string, ...params: unknown[]): Promise<T> {
  if (!worker) return Promise.reject(new Error('The game index is not running'))
  const w = worker
  return new Promise((resolve, reject) => {
    const id = ++reqId
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    w.postMessage({ id, method, params })
  })
}

/** The selected mod as the index layers it; its id is CrusaderPope's, `mod/<.mod file>` (ModTouch.mods) */
function indexMod(mod: ModInfo): IndexMod {
  return {
    id: modId(mod.file),
    name: mod.name,
    tags: mod.tags,
    root: mod.path ?? undefined,
    source: 'local',
    replacePaths: mod.replacePaths,
    status: mod.path && mod.pathExists ? 'ok' : 'missing',
    editable: true
  }
}

/**
 * What the index layers over the game: the selected mod — or, when a mod list
 * is chosen on the Mods page, that list's enabled mods in load order, with the
 * selected mod last if the list doesn't load it (its editors' files show).
 */
async function layeredMods(gameDir: string, mod: ModInfo | null): Promise<IndexMod[]> {
  const own = mod ? [indexMod(mod)] : []
  const s = loadSettings()
  const ref = s.modManager?.modList
  if (!ref || ref === 'none') return own
  try {
    const state = await readModsState({ ...cpSettings(s), modList: ref }, gameDir, app.getPath('documents'))
    const list = modsOfList(state, ref)
    const same = (a?: string, b?: string | null): boolean =>
      !!a && !!b && resolve(a).toLowerCase() === resolve(b).toLowerCase()
    return mod && !list.some((m) => same(m.root, mod.path)) ? [...list, ...own] : list
  } catch {
    return own
  }
}

/**
 * Builds the index for the game plus the selected mod (or the chosen mod
 * list) unless it is already built (or building) for exactly that — or
 * `force`d, to retry after an error. A null `gameDir` — or `enabled: false` —
 * stops the worker and frees its memory.
 */
export async function ensureGameIndex(
  gameDir: string | null,
  mod: ModInfo | null,
  enabled: boolean,
  force = false
): Promise<IndexStatus> {
  if (!gameDir || !enabled) {
    void worker?.terminate()
    worker = null
    built = null
    watchMod(null)
    setStatus({ state: 'idle' })
    return status
  }
  const mods = await layeredMods(gameDir, mod)
  setLoadedMods(mods.map((m) => m.id))
  const key = JSON.stringify([gameDir, mods.map((m) => [m.id, m.root ?? m.archive, m.replacePaths])])
  if (built?.key === key && !force) return status
  built = { key, gameDir, mod, mods }
  worker ??= startWorker()
  const req: BuildRequest = {
    gameDir,
    mods,
    language: 'english',
    cache: {
      file: join(app.getPath('userData'), 'index-cache', 'index.bin'),
      code: `${__GAME_INDEX_CODE__}|${app.getVersion()}`
    }
  }
  setStatus({ state: 'indexing', phase: 'Starting', done: 0, total: 1, gameDir })
  // Changes seen before the build read the files are part of it
  changed.clear()
  void call('build', req).catch(() => {})
  initImages(gameDir, undefined, mods)
  watchMod(mod?.path && mod.pathExists ? mod.path : null)
  return status
}

export const gameIndexStatus = (): IndexStatus => status

/**
 * What the current index layers: the game folder and the selected mod — as
 * the app's ModInfo and as the index's (CrusaderPope's) — or null when none.
 */
export function gameIndexLayering(): { gameDir: string; mod: ModInfo | null; mods: IndexMod[] } | null {
  if (!built) return null
  return { gameDir: built.gameDir, mod: built.mod, mods: built.mods }
}

/**
 * References of one entry (see the worker's `references`), or null when the
 * index isn't ready or doesn't know the entry.
 */
export function getReferences(
  type: string,
  name: string,
  limit?: number,
  full?: { direction: 'incoming' | 'outgoing'; type: string }
): Promise<EntityReferences | null> {
  if (status.state !== 'ready') return Promise.resolve(null)
  return call<EntityReferences | null>('references', type, name, limit, full)
}

/**
 * Any of the worker's CrusaderPope queries (portrait, shader, modelGeometry,
 * mapInfo, …) — what its renderer code reaches as `window.api.<method>`.
 */
export function callGameIndex<T>(method: string, ...params: unknown[]): Promise<T> {
  if (status.state !== 'ready') return Promise.reject(new Error('Index not ready'))
  return call<T>(method, ...params)
}

// CrusaderPope's mod manager reaches the index through these (modsHost.ts)
setIndexHooks({
  reindex: () => {
    if (built) void ensureGameIndex(built.gameDir, built.mod, true, true)
  },
  query: (method, ...params) => callGameIndex(method, ...params),
  refreshFiles: async (files) => {
    for (const f of files) changed.add(f)
    await flushChanges()
  }
})

// ---------------------------------------------------------------------------
// Taking in changes to the mod folder
// ---------------------------------------------------------------------------

let watcher: FSWatcher | null = null
const changed = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false
/** Saves come in bursts (one editor save can write several files) */
const DEBOUNCE_MS = 250

function watchMod(path: string | null): void {
  watcher?.close()
  watcher = null
  if (!path) return
  try {
    watcher = watch(path, { recursive: true }, (_event, file) => {
      if (!file) return
      changed.add(join(path, file.toString()))
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = setTimeout(() => void flushChanges(), DEBOUNCE_MS)
    })
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
    })
  } catch {
    // An unwatchable folder: references go stale until the next build
    watcher = null
  }
}

/** One update at a time, and never during a build (the build's end flushes what came meanwhile) */
async function flushChanges(): Promise<void> {
  if (flushing || status.state !== 'ready' || changed.size === 0) return
  flushing = true
  const paths = [...changed]
  changed.clear()
  try {
    const r = await call<{ changed: boolean; fallback?: string; gfx?: string[] }>(
      'refreshFiles',
      paths
    )
    if (r.gfx?.length) refreshImages(r.gfx)
    // Too much changed to take in piecemeal (or the layering itself changed): build afresh
    if (r.fallback && built) {
      const { gameDir, mod } = built
      void ensureGameIndex(gameDir, mod, true, true)
    }
  } catch {
    // The worker went away; its error handler reports that
  } finally {
    flushing = false
    if (changed.size > 0 && status.state === 'ready') void flushChanges()
  }
}
