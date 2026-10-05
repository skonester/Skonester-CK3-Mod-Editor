import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { readFileSync, unwatchFile, watchFile } from 'fs'
import icon from '../../resources/icon.png?asset'
import { loadSettings, saveSettings } from './settings'
import { detectPaths, listMods, normalizeGameDir, validateGameDir, validateModDir } from './ck3'
import {
  createCharacter,
  characterScripts,
  getCharacter,
  listCharacterFiles,
  listCharacters,
  saveCharacter
} from './characters'
import { applyRulerDesignerDna, getDnaPasteInfo } from './dna'
import { createCulture, getCultureData, listCultureFiles, saveCulture } from './cultures'
import {
  createDynasty,
  createHouse,
  getDynastyData,
  listDynastyFiles,
  saveDynasty,
  saveHouse
} from './dynasties'
import {
  createFaith,
  createReligion,
  createRite,
  getReligionData,
  listReligionFiles,
  listRiteFiles,
  saveFaith,
  saveReligion,
  saveRite
} from './religions'
import { getFaithIcons, listFaithIcons } from './faithIcons'
import {
  addFaithHistoryEntry,
  deleteFaithHistoryEntry,
  getFaithHistory,
  listFaithHistoryFiles,
  prepareFaithHistoryScript,
  saveFaithHistoryEntry
} from './faithHistory'
import { createTitle, getTitle, getTitleData, listTitleFiles, saveTitle } from './titles'
import {
  addTitleHistoryEntry,
  deleteTitleHistoryEntry,
  getTitleHistory,
  listTitleHistoryFiles,
  saveTitleHistoryEntry
} from './titleHistory'
import { getReferenceData, locateRef } from './refdata'
import { getTraitIcons } from './traitIcons'
import { getFlatIcons } from './icons'
import { getModFonts } from './fonts'
import { getSkillIcons } from './skillIcons'
import { getCoatsOfArms } from './coatOfArms'
import { detectEditors, openInEditor } from './editor'
import type {
  AppSettings,
  CharacterDetail,
  CulturePatch,
  DynastyPatch,
  FaithPatch,
  FaithHistoryFields,
  FaithHistoryPatch,
  FaithHistoryTarget,
  HousePatch,
  NewCulture,
  NewDynasty,
  NewFaith,
  NewHouse,
  NewReligion,
  NewRite,
  NewTitle,
  RefKind,
  ReligionPatch,
  RitePatch,
  TitleHistoryEntryPatch,
  TitlePatch
} from '@shared/types'

const APP_NAME = 'Skonester CK3 Mod Editor'

// userData (settings.json: favorites, recents, drafts) is named after the app, so
// the rename to Skonester CK3 Mod Editor would strand existing settings. Pin a
// packaged build to the folder the old "CK3 Tools" name used; dev keeps ck3-tools.
if (app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'CK3 Tools'))

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon,
    // The dark theme's --background, so the frame shown before first paint matches it
    backgroundColor: '#09090b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())

  // Dev only: label the window from .claude/dev-label.txt so several concurrent
  // sessions' Electron windows can be told apart on the desktop.
  if (!app.isPackaged) {
    const labelFile = join(app.getAppPath(), '.claude', 'dev-label.txt')
    const applyTitle = (): void => {
      let label = ''
      try {
        label = readFileSync(labelFile, 'utf8').split(/\r?\n/)[0].trim().slice(0, 120)
      } catch {
        // no label file — plain title
      }
      win.setTitle(label ? `${APP_NAME} — ${label}` : APP_NAME)
    }
    win.on('page-title-updated', (e) => e.preventDefault())
    applyTitle()
    watchFile(labelFile, { interval: 1000 }, applyTitle)
    win.on('closed', () => unwatchFile(labelFile, applyTitle))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle(
    'ck3:getFaithHistory',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[], faithId: string) =>
      getFaithHistory(gameDir, modPath, replacePaths, faithId)
  )
  ipcMain.handle('ck3:listFaithHistoryFiles', (_e, modPath: string) =>
    listFaithHistoryFiles(modPath)
  )
  ipcMain.handle(
    'ck3:prepareFaithHistoryScript',
    (_e, script: string, patch?: Partial<FaithHistoryFields>) =>
      prepareFaithHistoryScript(script, patch)
  )
  ipcMain.handle(
    'ck3:saveFaithHistoryEntry',
    (_e, modPath: string, faithId: string, target: FaithHistoryTarget, patch: FaithHistoryPatch) =>
      saveFaithHistoryEntry(modPath, faithId, target, patch)
  )
  ipcMain.handle(
    'ck3:addFaithHistoryEntry',
    (_e, modPath: string, file: string, faithId: string, patch: FaithHistoryPatch) =>
      addFaithHistoryEntry(modPath, file, faithId, patch)
  )
  ipcMain.handle(
    'ck3:deleteFaithHistoryEntry',
    (_e, modPath: string, faithId: string, target: FaithHistoryTarget) =>
      deleteFaithHistoryEntry(modPath, faithId, target)
  )
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => saveSettings(patch))

  ipcMain.handle('ck3:detectPaths', () => detectPaths())
  ipcMain.handle('ck3:listMods', (_e, modDir: string) => listMods(modDir))
  ipcMain.handle('ck3:listCharacters', (_e, modPath: string) => listCharacters(modPath))
  ipcMain.handle('ck3:getCharacter', (_e, modPath: string, file: string, id: string) => {
    const detail = getCharacter(modPath, file, id)
    return detail && { ...detail, scripts: characterScripts(modPath, file, id) }
  })
  ipcMain.handle(
    'ck3:saveCharacter',
    (_e, modPath: string, file: string, originalId: string, detail: CharacterDetail) =>
      saveCharacter(modPath, file, originalId, detail)
  )
  ipcMain.handle('ck3:listCharacterFiles', (_e, modPath: string) => listCharacterFiles(modPath))
  ipcMain.handle(
    'ck3:createCharacter',
    (_e, modPath: string, file: string, detail: CharacterDetail) =>
      createCharacter(modPath, file, detail)
  )
  ipcMain.handle('ck3:getDnaPasteInfo', (_e, modPath: string, file: string, id: string) =>
    getDnaPasteInfo(modPath, file, id)
  )
  ipcMain.handle(
    'ck3:applyRulerDesignerDna',
    (
      _e,
      gameDir: string | null,
      modPath: string,
      replacePaths: string[],
      file: string,
      id: string,
      paste: string,
      dnaFile: string,
      modifierFile: string | null
    ) =>
      applyRulerDesignerDna(gameDir, modPath, replacePaths, file, id, paste, dnaFile, modifierFile)
  )
  ipcMain.handle(
    'ck3:getDynastyData',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[]) =>
      getDynastyData(gameDir, modPath, replacePaths)
  )
  ipcMain.handle(
    'ck3:saveDynasty',
    (_e, modPath: string, file: string, id: string, patch: DynastyPatch) =>
      saveDynasty(modPath, file, id, patch)
  )
  ipcMain.handle(
    'ck3:saveHouse',
    (_e, modPath: string, file: string, id: string, patch: HousePatch) =>
      saveHouse(modPath, file, id, patch)
  )
  ipcMain.handle('ck3:listDynastyFiles', (_e, modPath: string) => listDynastyFiles(modPath))
  ipcMain.handle('ck3:createDynasty', (_e, modPath: string, file: string, def: NewDynasty) =>
    createDynasty(modPath, file, def)
  )
  ipcMain.handle('ck3:createHouse', (_e, modPath: string, file: string, def: NewHouse) =>
    createHouse(modPath, file, def)
  )
  ipcMain.handle(
    'ck3:getReligionData',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[]) =>
      getReligionData(gameDir, modPath, replacePaths)
  )
  ipcMain.handle(
    'ck3:saveFaith',
    (_e, modPath: string, file: string, religionId: string, faithId: string, patch: FaithPatch) =>
      saveFaith(modPath, file, religionId, faithId, patch)
  )
  ipcMain.handle(
    'ck3:saveReligion',
    (_e, modPath: string, file: string, religionId: string, patch: ReligionPatch) =>
      saveReligion(modPath, file, religionId, patch)
  )
  ipcMain.handle('ck3:listReligionFiles', (_e, modPath: string) => listReligionFiles(modPath))
  ipcMain.handle('ck3:listRiteFiles', (_e, modPath: string) => listRiteFiles(modPath))
  ipcMain.handle('ck3:createRite', (_e, modPath: string, file: string, def: NewRite) =>
    createRite(modPath, file, def)
  )
  ipcMain.handle(
    'ck3:saveRite',
    (_e, modPath: string, file: string, id: string, patch: RitePatch) =>
      saveRite(modPath, file, id, patch)
  )
  ipcMain.handle('ck3:createReligion', (_e, modPath: string, file: string, def: NewReligion) =>
    createReligion(modPath, file, def)
  )
  ipcMain.handle('ck3:createFaith', (_e, modPath: string, religionId: string, def: NewFaith) =>
    createFaith(modPath, religionId, def)
  )
  ipcMain.handle(
    'ck3:getTitleData',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[]) =>
      getTitleData(gameDir, modPath, replacePaths)
  )
  ipcMain.handle(
    'ck3:getTitle',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[], id: string) =>
      getTitle(gameDir, modPath, replacePaths, id)
  )
  ipcMain.handle(
    'ck3:saveTitle',
    (_e, modPath: string, file: string, id: string, patch: TitlePatch) =>
      saveTitle(modPath, file, id, patch)
  )
  ipcMain.handle('ck3:listTitleFiles', (_e, modPath: string) => listTitleFiles(modPath))
  ipcMain.handle('ck3:createTitle', (_e, modPath: string, def: NewTitle) =>
    createTitle(modPath, def)
  )
  ipcMain.handle(
    'ck3:getTitleHistory',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[], titleId: string) =>
      getTitleHistory(gameDir, modPath, replacePaths, titleId)
  )
  ipcMain.handle('ck3:listTitleHistoryFiles', (_e, modPath: string) =>
    listTitleHistoryFiles(modPath)
  )
  ipcMain.handle(
    'ck3:saveTitleHistoryEntry',
    (
      _e,
      modPath: string,
      file: string,
      titleId: string,
      titleBlock: number,
      index: number,
      patch: TitleHistoryEntryPatch
    ) => saveTitleHistoryEntry(modPath, file, titleId, titleBlock, index, patch)
  )
  ipcMain.handle(
    'ck3:addTitleHistoryEntry',
    (_e, modPath: string, file: string, titleId: string, patch: TitleHistoryEntryPatch) =>
      addTitleHistoryEntry(modPath, file, titleId, patch)
  )
  ipcMain.handle(
    'ck3:deleteTitleHistoryEntry',
    (_e, modPath: string, file: string, titleId: string, titleBlock: number, index: number) =>
      deleteTitleHistoryEntry(modPath, file, titleId, titleBlock, index)
  )
  ipcMain.handle(
    'ck3:getFaithIcons',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[], icons: string[]) =>
      getFaithIcons(gameDir, modPath, replacePaths, icons)
  )
  ipcMain.handle(
    'ck3:listFaithIcons',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[]) =>
      listFaithIcons(gameDir, modPath, replacePaths)
  )
  ipcMain.handle(
    'ck3:getCultureData',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[]) =>
      getCultureData(gameDir, modPath, replacePaths)
  )
  ipcMain.handle(
    'ck3:saveCulture',
    (
      _e,
      gameDir: string | null,
      modPath: string,
      replacePaths: string[],
      file: string,
      id: string,
      patch: CulturePatch
    ) => saveCulture(gameDir, modPath, replacePaths, file, id, patch)
  )
  ipcMain.handle('ck3:listCultureFiles', (_e, modPath: string) => listCultureFiles(modPath))
  ipcMain.handle('ck3:createCulture', (_e, modPath: string, file: string, def: NewCulture) =>
    createCulture(modPath, file, def)
  )
  ipcMain.handle(
    'ck3:getTraitIcons',
    (
      _e,
      gameDir: string | null,
      modPath: string | null,
      replacePaths: string[],
      traits: string[]
    ) => getTraitIcons(gameDir, modPath, replacePaths, traits)
  )
  ipcMain.handle(
    'ck3:getFlatIcons',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[], names: string[]) =>
      getFlatIcons(gameDir, modPath, replacePaths, names)
  )
  ipcMain.handle(
    'ck3:getSkillIcons',
    (
      _e,
      gameDir: string | null,
      modPath: string | null,
      replacePaths: string[],
      skills: string[]
    ) => getSkillIcons(gameDir, modPath, replacePaths, skills)
  )
  ipcMain.handle(
    'ck3:getCoatsOfArms',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[], ids: string[]) =>
      getCoatsOfArms(gameDir, modPath, replacePaths, ids)
  )
  ipcMain.handle(
    'ck3:getReferenceData',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[]) =>
      getReferenceData(gameDir, modPath, replacePaths)
  )
  ipcMain.handle(
    'ck3:locateRef',
    (
      _e,
      gameDir: string | null,
      modPath: string | null,
      replacePaths: string[],
      kind: RefKind,
      id: string
    ) => locateRef(gameDir, modPath, replacePaths, kind, id)
  )
  ipcMain.handle(
    'ck3:getModFonts',
    (_e, gameDir: string | null, modPath: string | null, replacePaths: string[]) =>
      getModFonts(gameDir, modPath, replacePaths)
  )
  ipcMain.handle('ck3:validateGameDir', (_e, dir: string) => validateGameDir(dir))
  ipcMain.handle('ck3:validateModDir', (_e, dir: string) => validateModDir(dir))

  ipcMain.handle('editor:detect', () => detectEditors())
  ipcMain.handle('editor:open', (_e, file: string, line?: number) =>
    openInEditor(loadSettings().textEditorPath, file, line)
  )
  ipcMain.handle('dialog:pickEditor', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Select your text editor',
      properties: ['openFile'],
      filters: [
        { name: 'Programs', extensions: ['exe', 'cmd', 'bat'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:pickDirectory', async (e, title: string, kind: 'game' | 'mod') => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title,
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const picked = result.filePaths[0]
    return kind === 'game' ? normalizeGameDir(picked) : picked
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
