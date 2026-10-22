import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative } from 'path'
import { Worker } from 'worker_threads'
import type {
  AssetOverride,
  ImageSource,
  ModelExportResult,
  ModelImportPlan,
  ModelImportResult,
  PickedImage
} from '../crusaderpope/shared/api'
import type { ModInfo } from '@shared/types'
import type { ImportOutcome, ModelExportPlan } from '../crusaderpope/main/blender/types'
import { decodeDds } from '../crusaderpope/main/images/dds'
import { encodePng } from '../crusaderpope/main/images/png'
import { callGameIndex, gameIndexLayering } from './gameIndex'
import { recordRemove, recordWrite } from '../crusaderpope/main/mods/undo'
import { modId, modsHost, undoable } from './modsHost'

/**
 * The Blender round trip of a model (CrusaderPope's blender/ipc.ts, on this
 * app's terms): "Export for Blender" writes a .mesh — or an .asset's pdxmesh —
 * as glTF 2.0 with PNG textures into a folder the user picks; "Import from
 * Blender" converts an edited glTF/GLB back into the mesh and the textures that
 * changed, written into the selected mod at their game paths (a mod's file of
 * the same path replaces the game's). The conversion runs on CrusaderPope's
 * blenderWorker thread; an import is one undoable change.
 *
 * Also an asset's menu (textures, meshes): export its file as it is (a texture
 * as PNG), replace it in the selected mod with a file of the user's —
 * converted to the asset's format, saved under its path and name — or move
 * the mod's own copy to the recycle bin so the game's counts again.
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

/** The selected mod as an import target, or why there is none */
function targetMod(): { root: string; mod: ModInfo } {
  const { mod } = layering()
  if (!mod?.path || !mod.pathExists) throw new Error('Select a mod to write into.')
  return { root: mod.path, mod }
}

/**
 * Writes a conversion's files into the selected mod at their game paths —
 * every path checked before the first write, each write recorded for undo.
 * The mod folder's watcher hands the files to the game index.
 */
function writeIntoMod(root: string, mod: ModInfo, source: string, out: ImportOutcome): ModelImportResult {
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
  return {
    mod: { id: modId(mod.file), name: mod.name, loaded: true },
    source,
    files,
    shapes: out.shapes,
    removed: out.removed,
    notes: out.notes,
    warnings: out.warnings,
    reindex: true
  }
}

/** "Import from Blender": a glTF/GLB — chosen now, or `given` — converted into the model's mesh and textures */
async function importGltf(
  e: Electron.IpcMainInvokeEvent,
  path: string,
  pdxmesh?: string,
  given?: string
): Promise<ModelImportResult | null> {
  const { gameDir, mods, mod: selected } = layering()
  const { plan, root, model } = await importPlan(path, pdxmesh)
  if (plan.problem || !root || !model || !selected) throw new Error(plan.problem ?? 'Nothing to import into.')
  let source = given
  if (!source) {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      title: `Import from Blender into ${selected.name} — ${model.mesh}`,
      defaultPath: lastImportDir || lastExportDir || app.getPath('documents'),
      filters: [{ name: 'glTF 2.0', extensions: ['glb', 'gltf'] }],
      properties: ['openFile']
    })
    source = r.canceled ? undefined : r.filePaths[0]
  }
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
  return writeIntoMod(root, selected, source, out)
}

// ---------------------------------------------------------------------------
// An asset's menu (textures, meshes): export it, replace it in the mod with a
// file of one's own, or take the mod's copy away again
// ---------------------------------------------------------------------------

/** The file an asset stands for: an image or a .mesh as it is, an .asset's pdxmesh's .mesh */
const fileOf = async (path: string, pdxmesh?: string): Promise<string> =>
  /\.asset$/i.test(path) ? (await exportPlan(path, pdxmesh)).mesh : path

/** An asset's file as it is, a texture as PNG, or a mesh as glTF for Blender (save dialog; null: cancelled) */
async function exportAsset(
  e: Electron.IpcMainInvokeEvent,
  path: string,
  as: 'original' | 'png' | 'gltf',
  pdxmesh?: string
): Promise<{ file: string; gltf?: ModelExportResult } | null> {
  if (as === 'gltf') {
    const r = await exportGltf(e, path, pdxmesh)
    return r && { file: r.gltf, gltf: r }
  }
  const { gameDir, mods } = layering()
  const rel = await fileOf(path, pdxmesh)
  const name = as === 'png' ? basename(rel).replace(/\.\w+$/, '.png') : basename(rel)
  const ext = as === 'png' ? 'png' : extname(rel).slice(1) || '*'
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showSaveDialog(win, {
    title: as === 'png' ? `Export ${basename(rel)} as PNG` : `Export ${basename(rel)}`,
    defaultPath: join(lastExportDir || app.getPath('documents'), name),
    filters: [{ name: as === 'png' ? 'PNG image' : `${ext.toUpperCase()} file`, extensions: [ext] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (r.canceled || !r.filePath) return null
  lastExportDir = dirname(r.filePath)
  await runJob({ op: 'exportFile', gameDir, mods, rel, as, file: r.filePath })
  return { file: r.filePath }
}

/** The selected mod's own file for the asset, if it has one (null: no mod to write into) */
async function assetOverride(path: string, pdxmesh?: string): Promise<AssetOverride | null> {
  let target: ReturnType<typeof targetMod>
  try {
    target = targetMod()
  } catch {
    return null
  }
  const rel = await fileOf(path, pdxmesh)
  const abs = modFile(target.root, rel)
  return { rel, mod: target.mod.name, file: abs && existsSync(abs) ? abs : undefined }
}

/** Removes the selected mod's file for the asset (to the recycle bin): the game's counts again */
async function removeAssetOverride(
  path: string,
  pdxmesh?: string
): Promise<AssetOverride & { loaded: boolean }> {
  const { root, mod } = targetMod()
  const rel = await fileOf(path, pdxmesh)
  const abs = modFile(root, rel)
  if (!abs || !existsSync(abs)) throw new Error(`${mod.name} has no file ${rel}.`)
  await recordRemove(modsHost, abs, async () => {
    try {
      await shell.trashItem(abs)
    } catch {
      unlinkSync(abs)
    }
  })
  return { rel, mod: mod.name, file: abs, loaded: true }
}

/**
 * An image of the user's for the crop dialog: a DDS comes decoded to PNG (the
 * renderer can't show one), PNG / JPEG / WebP as they are.
 */
async function pickImage(e: Electron.IpcMainInvokeEvent, title?: string): Promise<PickedImage | null> {
  const win = BrowserWindow.fromWebContents(e.sender)!
  const r = await dialog.showOpenDialog(win, {
    title: title ?? 'An image',
    defaultPath: lastImportDir || app.getPath('pictures'),
    filters: [{ name: 'Images (PNG, DDS, JPEG, WebP)', extensions: ['png', 'dds', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile']
  })
  const file = r.canceled ? undefined : r.filePaths[0]
  if (!file) return null
  lastImportDir = dirname(file)
  const bytes = new Uint8Array(readFileSync(file))
  const name = basename(file)
  if (bytes[0] === 0x44 && bytes[1] === 0x44 && bytes[2] === 0x53 && bytes[3] === 0x20) {
    const d = await decodeDds(bytes)
    return { file, name, mime: 'image/png', data: new Uint8Array(encodePng(d.rgba, d.width, d.height)) }
  }
  const mime = /\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.webp$/i.test(name) ? 'image/webp' : 'image/png'
  return { file, name, mime, data: bytes }
}

/** A cropped image (PNG bytes from the crop dialog) as a file the conversion reads */
function croppedFile(source: ImageSource): string {
  const dir = join(app.getPath('temp'), 'ck3tools-crops')
  mkdirSync(dir, { recursive: true })
  const stem = (source.name ?? 'image').replace(/\.\w+$/, '').replace(/[^\w.-]+/g, '_')
  const file = join(dir, `${stem}.png`)
  writeFileSync(file, source.png!)
  return file
}

/**
 * Replaces an asset in the selected mod with a file of the user's — the crop
 * dialog's PNG, a picked file, or one chosen now — converted to the asset's
 * format and saved under its path and name. A glTF/GLB for a mesh is a Blender
 * import.
 */
async function replaceAsset(
  e: Electron.IpcMainInvokeEvent,
  path: string,
  pdxmesh?: string,
  source?: ImageSource
): Promise<ModelImportResult | null> {
  const { gameDir, mods } = layering()
  const { root, mod } = targetMod()
  const rel = await fileOf(path, pdxmesh)
  if (!modFile(root, rel)) throw new Error(`${rel} is not a path inside the mod folder.`)
  const mesh = /\.mesh$/i.test(rel)
  let file = source?.png ? croppedFile(source) : source?.file
  if (!file) {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      title: `Replace ${rel} in ${mod.name} — saved under that name, converted where needed`,
      defaultPath: lastImportDir || lastExportDir || app.getPath('documents'),
      filters: mesh
        ? [{ name: 'Meshes (.mesh, glTF 2.0)', extensions: ['mesh', 'gltf', 'glb'] }]
        : [{ name: 'Images (PNG, DDS)', extensions: ['png', 'dds'] }],
      properties: ['openFile']
    })
    file = r.canceled ? undefined : r.filePaths[0]
  }
  if (!file) return null
  lastImportDir = dirname(file)
  if (mesh && /\.(gltf|glb)$/i.test(file)) {
    return importGltf(e, /\.asset$/i.test(path) ? path : rel, pdxmesh, file)
  }
  const out = await runJob<ImportOutcome>({ op: 'replaceFile', gameDir, mods, rel, file })
  return writeIntoMod(root, mod, file, out)
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
  ipcMain.handle('asset:export', (e, path: string, as: 'original' | 'png' | 'gltf', pdxmesh?: string) =>
    exportAsset(e, path, as, pdxmesh)
  )
  ipcMain.handle('asset:override', (_e, path: string, pdxmesh?: string) => assetOverride(path, pdxmesh))
  ipcMain.handle('asset:removeOverride', (_e, path: string, pdxmesh?: string) =>
    undoable(`Removed ${basename(path)}`, () => removeAssetOverride(path, pdxmesh), 'asset')
  )
  ipcMain.handle('asset:pickImage', (e, title?: string) => pickImage(e, title))
  ipcMain.handle('asset:replace', (e, path: string, pdxmesh?: string, source?: ImageSource) =>
    undoable(`Replaced ${basename(path)}`, () => replaceAsset(e, path, pdxmesh, source), 'asset')
  )
  ipcMain.handle('shell:revealFile', (_e, file: string) => shell.showItemInFolder(file))
}
