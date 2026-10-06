import { app, BrowserWindow } from 'electron'
import { basename, dirname } from 'path'
import type { ModsHost } from '../crusaderpope/main/mods/manager'
import {
  change,
  describeChange,
  forgetChange,
  journalOf,
  recordWrite,
  undoChange
} from '../crusaderpope/main/mods/undo'
import { defaultUserDir } from '../crusaderpope/main/mods/discover'
import { resolveGameDir } from '../crusaderpope/main/gameDir'
import type { Settings as CpSettings, UndoResult } from '../crusaderpope/shared/api'
import type { AppSettings } from '@shared/types'
import { loadSettings, saveSettings } from './settings'
import { listMods } from './ck3'
import { setModWriteRecorder } from './modWrite'

/**
 * CrusaderPope's view of this app (its ModsHost): its settings derived from
 * ours, the index, and where undo steps are kept. Its "active mod" — the one
 * it edits — is our selected mod; its mod lists and user folder live in our
 * settings under `modManager`. Script formatting is off: this app's saves keep
 * a file byte-identical but for what changed.
 */

/** A `.mod` file name in the user's mod folder as CrusaderPope's mod id: `mod/<file>` */
export const modId = (file: string): string => `mod/${file}`

/** The `.mod` file name behind a CrusaderPope mod id, when it is a descriptor of the mod folder */
const fileOfModId = (id: string): string | null => {
  const m = /^mod\/([^/]+\.mod)$/i.exec(id.replace(/\\/g, '/'))
  return m ? m[1] : null
}

/** The user folder (…/Paradox Interactive/Crusader Kings III): set, else the mod folder's parent */
export function userDirOf(s: AppSettings): string {
  if (s.modManager?.userDir) return s.modManager.userDir
  if (s.modDir && /^mod$/i.test(basename(s.modDir))) return dirname(s.modDir)
  return defaultUserDir(app.getPath('documents'))
}

/** CrusaderPope's settings, as ours have them */
export function cpSettings(s: AppSettings = loadSettings()): CpSettings {
  return {
    gameDir: s.gameDir ?? '',
    language: 'english',
    userDir: userDirOf(s),
    modList: s.modManager?.modList,
    customModLists: s.modManager?.customModLists,
    activeMod: s.selectedModFile ? modId(s.selectedModFile) : undefined,
    formatScripts: false,
    graphics: s.graphics
  }
}

/** Tells the windows our settings changed under them (the Mods page set the active mod, a list …) */
function broadcastSettings(s: AppSettings): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings:changed', s)
}

/** Tells the windows files of the mod changed under the editors (an undo, an edit from the map …) */
export function broadcastModFiles(files: string[]): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('mod:filesChanged', files)
}

let hooks: {
  reindex: () => void
  query: <T>(method: string, ...params: unknown[]) => Promise<T>
  refreshFiles: (files: string[]) => Promise<void>
} = {
  reindex: () => {},
  query: () => Promise.reject(new Error('The game index is not running')),
  refreshFiles: async () => {}
}

/** The game index's side of the host, set by gameIndex.ts (which imports this module) */
export function setIndexHooks(h: typeof hooks): void {
  hooks = h
}

export const modsHost: ModsHost = {
  settings: () => cpSettings(),
  updateSettings: (patch) => {
    const s = loadSettings()
    const next: Partial<AppSettings> = {}
    if ('activeMod' in patch) next.selectedModFile = patch.activeMod ? fileOfModId(patch.activeMod) : null
    if ('userDir' in patch || 'modList' in patch || 'customModLists' in patch) {
      next.modManager = {
        ...s.modManager,
        ...('userDir' in patch ? { userDir: patch.userDir } : {}),
        ...('modList' in patch ? { modList: patch.modList } : {}),
        ...('customModLists' in patch ? { customModLists: patch.customModLists } : {})
      }
    }
    if (Object.keys(next).length > 0) broadcastSettings(saveSettings(next))
  },
  gameDir: () => resolveGameDir(loadSettings().gameDir ?? ''),
  documents: () => app.getPath('documents'),
  reindex: () => hooks.reindex(),
  query: (method, ...params) => hooks.query(method, ...params),
  // (the mod folder's watcher takes every write in; nothing to tell it beforehand)
  wrote: () => {},
  refreshFiles: async (files) => {
    await hooks.refreshFiles(files)
    broadcastModFiles(files)
  },
  dataDir: () => app.getPath('userData')
}

// Every editor's write (modWrite.ts) is recorded for undo: part of the running
// undoable change, or a change of its own
setModWriteRecorder((path, write) => {
  recordWrite(modsHost, path, write)
})

/**
 * Runs a save of the selected mod as one undoable step: every file it writes
 * through `writeModText` (modWrite.ts) can be taken back together.
 */
export function undoable<T>(label: string, fn: () => T | Promise<T>, kind = 'edit'): Promise<T> {
  return change(modsHost, label, kind, async () => {
    const s = loadSettings()
    if (s.selectedModFile && s.modDir) {
      // (the step is the selected mod's: its list, and paths shown relative to its folder)
      const root = listMods(s.modDir).find((m) => m.file === s.selectedModFile)?.path ?? undefined
      describeChange({ mod: { id: modId(s.selectedModFile), name: s.selectedModFile.replace(/\.mod$/i, '') }, root })
    }
    return fn()
  }).finally(broadcastUndo)
}

/** Tells the windows the selected mod's undo steps changed */
export function broadcastUndo(): void {
  const steps = undoSteps()
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('undo:changed', steps)
}

/**
 * Undoes one of the selected mod's steps (its last when `id` is absent): the
 * files go back as they were, when they are still what it wrote. The editors
 * are told to read them again.
 */
export async function undo(id?: number): Promise<UndoResult | null> {
  const s = loadSettings()
  const r = await undoChange(modsHost, id !== undefined ? { id } : { mod: s.selectedModFile ? modId(s.selectedModFile) : '' })
  broadcastUndo()
  return r
}

/** Drops a step that can't be undone any more (its files changed since) */
export function forgetUndo(id: number): boolean {
  const r = forgetChange(modsHost, id)
  broadcastUndo()
  return r
}

/** The selected mod's undo steps, newest first */
export function undoSteps(): { id: number; label: string; kind: string; at: number }[] {
  const s = loadSettings()
  return s.selectedModFile ? journalOf(modsHost).list(modId(s.selectedModFile)) : []
}
