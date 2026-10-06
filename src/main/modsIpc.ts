import { ipcMain, nativeImage, shell } from 'electron'
import { readFile } from 'fs/promises'
import type { ModListEntry, ModsState, NewModRequest } from '../crusaderpope/shared/api'
import {
  createMod,
  deleteList,
  modLocation,
  modsState,
  packMod,
  saveList,
  selectList,
  setActive,
  thumbnailFile,
  unpackMod,
  writeList
} from '../crusaderpope/main/mods/manager'
import { LOADED_LIST, modsHost } from './modsHost'
import { loadSettings } from './settings'

/**
 * The Mods page's IPC (`mods:*`, CrusaderPope's mods/ipc.ts on this app's
 * terms): mod lists — launcher playsets, the game's dlc_load.json, the app's
 * own lists — the active mod (our selected mod), new mods, packing and
 * unpacking. One operation at a time. The state it hands out is the user's:
 * `selected` is the list the game index loads ('none': just the selected
 * mod) and the editor's own synthetic loaded list is left out.
 */

/** The state as the Mods page shows it */
function userState(s: ModsState): ModsState {
  return {
    ...s,
    lists: s.lists.filter((l) => l.ref !== `custom:${LOADED_LIST}`),
    selected: loadSettings().modManager?.modList ?? 'none'
  }
}

/** Image type by signature (not by the file's extension) */
function imageType(b: Buffer): string | undefined {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (b.length >= 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif'
  return undefined
}

export function registerModsIpc(): void {
  // One operation at a time: each reads the state and may write files
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }
  const handle = <A extends unknown[]>(channel: string, fn: (...args: A) => Promise<unknown>): void => {
    ipcMain.handle(channel, (_e, ...args: unknown[]) => serial(() => fn(...(args as A))))
  }

  handle('mods:state', async () => userState(await modsState(modsHost)))
  handle('mods:select', async (ref: string) => {
    // 'none' here is "just the selected mod": no list
    if (ref === 'none') {
      modsHost.updateSettings({ modList: undefined })
      return userState(await modsState(modsHost))
    }
    return userState(await selectList(modsHost, ref))
  })
  handle('mods:saveList', async (list: { ref?: string; name: string; mods: ModListEntry[] }) =>
    userState(await saveList(modsHost, list))
  )
  handle('mods:deleteList', async (ref: string) => {
    const next = await deleteList(modsHost, ref)
    // The list the index loaded is gone: back to just the selected mod
    if (loadSettings().modManager?.modList === ref) modsHost.updateSettings({ modList: undefined })
    return userState(next)
  })
  handle(
    'mods:writeList',
    (ref: string, target: 'launcher' | 'game', mods: ModListEntry[], opts?: { launcherClosed?: boolean }) =>
      writeList(modsHost, ref, target, mods, opts)
  )
  handle('mods:setActive', async (id: string | null) => userState(await setActive(modsHost, id)))
  handle('mods:create', async (req: NewModRequest) => userState(await createMod(modsHost, req)))
  handle('mods:pack', (id: string, overwrite?: boolean) => packMod(modsHost, id, overwrite))
  handle('mods:unpack', (id: string) => unpackMod(modsHost, id))
  handle('mods:openFolder', async (id: string) => {
    const loc = await modLocation(modsHost, id)
    if (loc.folder) {
      const err = await shell.openPath(loc.folder)
      if (err) throw new Error(err)
    } else if (loc.file) shell.showItemInFolder(loc.file)
  })
  // Thumbnails are files anywhere on disk: only a discovered mod's preview, scaled down
  ipcMain.handle('mods:thumbnail', async (_e, id: string) => {
    const file = await thumbnailFile(modsHost, id)
    if (!file) return null
    const img = nativeImage.createFromPath(file)
    if (!img.isEmpty()) {
      return (img.getSize().width > 256 ? img.resize({ width: 256, quality: 'good' }) : img).toDataURL()
    }
    // Formats nativeImage can't decode (Workshop thumbnails that are WebP): the bytes, for the browser
    try {
      const buf = await readFile(file)
      const type = imageType(buf)
      return type && buf.length <= 3 << 20 ? `data:${type};base64,${buf.toString('base64')}` : null
    } catch {
      return null
    }
  })
}
