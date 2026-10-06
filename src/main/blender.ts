import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdirSync, renameSync, writeFileSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative } from 'path'
import { Worker } from 'worker_threads'
import type {
  ModelExportResult,
  ModelImportPlan,
  ModelImportResult
} from '../crusaderpope/shared/api'
import type { ImportOutcome, ModelExportPlan } from '../crusaderpope/main/blender/types'
import { callGameIndex, gameIndexLayering } from './gameIndex'
import { recordWrite } from '../crusaderpope/main/mods/undo'
import { modId, modsHost, undoable } from './modsHost'

/**
 * The Blender round trip of a model (CrusaderPope's blender/ipc.ts, on this
 * app's terms): "Export for Blender" writes a .mesh — or an .asset's pdxmesh —
 * as glTF 2.0 with PNG textures into a folder the user picks; "Import from
 * Blender" converts an edited glTF/GLB back into the mesh and the textures that
 * changed, written into the selected mod at their game paths (a mod's file of
 * the same path replaces the game's). The conversion runs on CrusaderPope's
 * blenderWorker thread; an import is one undoable change.
 */

/** Folders used last this session: exports go there again, imports start there */
let lastExportDir = ''
let lastImportDir = ''

function runJob<T>(job: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = new Worker(join(__dirname, 'blenderWorker.js'), {
      workerData: job,
      resourceLimits: { maxOldGenerationSizeMb: 4096 }
    })
    let done = false
    w.once('message', (m: { result?: T; error?: string }) => {
      done = true
      void w.terminate()
      if (m.error !== undefined) reject(new Error(m.error))
      else resolve(m.result as T)
    })
    w.once('error', (err: unknown) => {
      done = true
      reject(err instanceof Error ? err : new Error(String(err)))
    })
    w.once('exit', (code) => {
      if (!done) reject(new Error(`The conversion stopped (exit code ${code}).`))
    })
  })
}

function layering(): NonNullable<ReturnType<typeof gameIndexLayering>> {
  const l = gameIndexLayering()
  if (!l) throw new Error('The game index is not running — turn it on in Settings.')
  return l
}

async function exportPlan(path: string, pdxmesh?: string): Promise<ModelExportPlan> {
  const p = await callGameIndex<ModelExportPlan | null>('modelExportPlan', path, pdxmesh)
  if (!p) throw new Error(`${path}: no mesh to convert (the model has no .mesh file).`)
  return p
}

/** A game path inside the mod's folder, or undefined when it would leave it */
function modFile(root: string, rel: string): string | undefined {
  const abs = join(root, ...rel.split('/'))
  const r = relative(root, abs)
  return r && !r.startsWith('..') && !isAbsolute(r) ? abs : undefined
}

async function importPlan(
  path: string,
  pdxmesh?: string
): Promise<{ plan: ModelImportPlan; root?: string; model?: ModelExportPlan }> {
  const { mod: selected } = layering()
  if (!selected?.path || !selected.pathExists) {
    return { plan: { problem: 'Select a mod to import into.' } }
  }
  const mod = { id: modId(selected.file), name: selected.name, loaded: true }
  let model: ModelExportPlan
  try {
    model = await exportPlan(path, pdxmesh)
  } catch (e) {
    return { plan: { mod, problem: (e as Error).message } }
  }
  if (!modFile(selected.path, model.mesh)) {
    return { plan: { mod, problem: `${model.mesh} is not a path inside the mod folder.` } }
  }
  return { plan: { mod, mesh: model.mesh }, root: selected.path, model }
}

/** Writes through a temporary file, so a failed write never leaves half a file */
function writeAtomic(file: string, data: Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.ck3tools-tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

async function exportGltf(
  e: Electron.IpcMainInvokeEvent,
  path: string,
  pdxmesh?: string
): Promise<ModelExportResult | null> {
  const { gameDir, mods } = layering()
  const model = await exportPlan(path, pdxmesh)
  const name = basename(model.mesh).replace(/\.mesh$/i, '')
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showSaveDialog(win, {
    title: 'Export for Blender — the .gltf, its .bin, the textures as PNG and a manifest go into this folder',
    defaultPath: join(lastExportDir || app.getPath('documents'), `${name}.gltf`),
    filters: [{ name: 'glTF 2.0 (separate files)', extensions: ['gltf'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (r.canceled || !r.filePath) return null
  const file = /\.gltf$/i.test(r.filePath) ? r.filePath : `${r.filePath.replace(/\.glb$/i, '')}.gltf`
  lastExportDir = dirname(file)
  return runJob<ModelExportResult>({ op: 'export', gameDir, mods, plan: model, file })
}

async function importGltf(
  e: Electron.IpcMainInvokeEvent,
  path: string,
  pdxmesh?: string
): Promise<ModelImportResult | null> {
  const { gameDir, mods, mod: selected } = layering()
  const { plan, root, model } = await importPlan(path, pdxmesh)
  if (plan.problem || !root || !model || !selected) throw new Error(plan.problem ?? 'Nothing to import into.')
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showOpenDialog(win, {
    title: `Import from Blender into ${selected.name} — ${model.mesh}`,
    defaultPath: lastImportDir || lastExportDir || app.getPath('documents'),
    filters: [{ name: 'glTF 2.0', extensions: ['glb', 'gltf'] }],
    properties: ['openFile']
  })
  const source = r.canceled ? undefined : r.filePaths[0]
  if (!source) return null
  lastImportDir = dirname(source)
  const out = await runJob<ImportOutcome>({
    op: 'import',
    gameDir,
    mods,
    plan: model,
    file: source,
    activeMod: modId(selected.file)
  })

  // Every path checked before the first write
  const files: ModelImportResult['files'] = out.writes.map((w) => {
    const abs = modFile(root, w.rel)
    if (!abs) throw new Error(`${w.rel} is not a path inside the mod folder.`)
    return { rel: w.rel, abs, what: w.what }
  })
  out.writes.forEach((w, i) =>
    recordWrite(modsHost, files[i].abs, () => {
      writeAtomic(files[i].abs, w.data)
      return w.data
    })
  )
  // (the mod folder's watcher hands the files to the game index)
  return {
    mod: { id: modId(selected.file), name: selected.name, loaded: true },
    source,
    files,
    shapes: out.shapes,
    removed: out.removed,
    notes: out.notes,
    warnings: out.warnings,
    reindex: true
  }
}

export function registerBlenderIpc(): void {
  ipcMain.handle('model:export', (e, path: string, pdxmesh?: string) => exportGltf(e, path, pdxmesh))
  ipcMain.handle(
    'model:importPlan',
    async (_e, path: string, pdxmesh?: string) => (await importPlan(path, pdxmesh)).plan
  )
  ipcMain.handle('model:import', (e, path: string, pdxmesh?: string) =>
    undoable(`Import into ${basename(path)}`, () => importGltf(e, path, pdxmesh))
  )
  ipcMain.handle('shell:revealFile', (_e, file: string) => shell.showItemInFolder(file))
}
