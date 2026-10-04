import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  CharacterDetail,
  CharacterSummary,
  CultureData,
  CulturePatch,
  DetectionResult,
  DirValidation,
  DnaPasteInfo,
  DynastyData,
  DynastyFiles,
  DynastyPatch,
  EditorInfo,
  FaithPatch,
  FaithHistoryEntry,
  FaithHistoryFields,
  FaithHistoryPatch,
  FaithHistoryPreview,
  FaithHistoryTarget,
  HousePatch,
  ModFonts,
  ModInfo,
  NewCulture,
  NewDynasty,
  NewFaith,
  NewHouse,
  NewReligion,
  NewRite,
  NewTitle,
  RefKind,
  RefLocation,
  ReferenceData,
  ReligionData,
  ReligionPatch,
  RitePatch,
  SaveResult,
  TitleData,
  TitleDetail,
  TitleHistoryEntry,
  TitleHistoryEntryPatch,
  TitlePatch
} from '@shared/types'

const api = {
  getFaithHistory: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    faithId: string
  ): Promise<FaithHistoryEntry[]> =>
    ipcRenderer.invoke('ck3:getFaithHistory', gameDir, modPath, replacePaths, faithId),
  listFaithHistoryFiles: (modPath: string): Promise<string[]> =>
    ipcRenderer.invoke('ck3:listFaithHistoryFiles', modPath),
  prepareFaithHistoryScript: (
    script: string,
    patch?: Partial<FaithHistoryFields>
  ): Promise<FaithHistoryPreview> =>
    ipcRenderer.invoke('ck3:prepareFaithHistoryScript', script, patch),
  saveFaithHistoryEntry: (
    modPath: string,
    faithId: string,
    target: FaithHistoryTarget,
    patch: FaithHistoryPatch
  ): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:saveFaithHistoryEntry', modPath, faithId, target, patch),
  addFaithHistoryEntry: (
    modPath: string,
    file: string,
    faithId: string,
    patch: FaithHistoryPatch
  ): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:addFaithHistoryEntry', modPath, file, faithId, patch),
  deleteFaithHistoryEntry: (
    modPath: string,
    faithId: string,
    target: FaithHistoryTarget
  ): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:deleteFaithHistoryEntry', modPath, faithId, target),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', patch),

  detectPaths: (): Promise<DetectionResult> => ipcRenderer.invoke('ck3:detectPaths'),
  listMods: (modDir: string): Promise<ModInfo[]> => ipcRenderer.invoke('ck3:listMods', modDir),
  listCharacters: (modPath: string): Promise<CharacterSummary[]> =>
    ipcRenderer.invoke('ck3:listCharacters', modPath),
  getCharacter: (modPath: string, file: string, id: string): Promise<CharacterDetail | null> =>
    ipcRenderer.invoke('ck3:getCharacter', modPath, file, id),
  saveCharacter: (
    modPath: string,
    file: string,
    originalId: string,
    detail: CharacterDetail
  ): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:saveCharacter', modPath, file, originalId, detail),
  listCharacterFiles: (modPath: string): Promise<string[]> =>
    ipcRenderer.invoke('ck3:listCharacterFiles', modPath),
  getDnaPasteInfo: (modPath: string, file: string, id: string): Promise<DnaPasteInfo> =>
    ipcRenderer.invoke('ck3:getDnaPasteInfo', modPath, file, id),
  applyRulerDesignerDna: (
    gameDir: string | null,
    modPath: string,
    replacePaths: string[],
    file: string,
    id: string,
    paste: string,
    dnaFile: string,
    modifierFile: string | null
  ): Promise<SaveResult> =>
    ipcRenderer.invoke(
      'ck3:applyRulerDesignerDna',
      gameDir,
      modPath,
      replacePaths,
      file,
      id,
      paste,
      dnaFile,
      modifierFile
    ),
  createCharacter: (modPath: string, file: string, detail: CharacterDetail): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:createCharacter', modPath, file, detail),
  getDynastyData: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ): Promise<DynastyData> =>
    ipcRenderer.invoke('ck3:getDynastyData', gameDir, modPath, replacePaths),
  saveDynasty: (
    modPath: string,
    file: string,
    id: string,
    patch: DynastyPatch
  ): Promise<SaveResult> => ipcRenderer.invoke('ck3:saveDynasty', modPath, file, id, patch),
  saveHouse: (modPath: string, file: string, id: string, patch: HousePatch): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:saveHouse', modPath, file, id, patch),
  getCultureData: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ): Promise<CultureData> =>
    ipcRenderer.invoke('ck3:getCultureData', gameDir, modPath, replacePaths),
  saveCulture: (
    gameDir: string | null,
    modPath: string,
    replacePaths: string[],
    file: string,
    id: string,
    patch: CulturePatch
  ): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:saveCulture', gameDir, modPath, replacePaths, file, id, patch),
  listDynastyFiles: (modPath: string): Promise<DynastyFiles> =>
    ipcRenderer.invoke('ck3:listDynastyFiles', modPath),
  createDynasty: (modPath: string, file: string, def: NewDynasty): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:createDynasty', modPath, file, def),
  createHouse: (modPath: string, file: string, def: NewHouse): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:createHouse', modPath, file, def),
  getReligionData: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ): Promise<ReligionData> =>
    ipcRenderer.invoke('ck3:getReligionData', gameDir, modPath, replacePaths),
  saveFaith: (
    modPath: string,
    file: string,
    religionId: string,
    faithId: string,
    patch: FaithPatch
  ): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:saveFaith', modPath, file, religionId, faithId, patch),
  saveReligion: (
    modPath: string,
    file: string,
    religionId: string,
    patch: ReligionPatch
  ): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:saveReligion', modPath, file, religionId, patch),
  listReligionFiles: (modPath: string): Promise<string[]> =>
    ipcRenderer.invoke('ck3:listReligionFiles', modPath),
  createReligion: (modPath: string, file: string, def: NewReligion): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:createReligion', modPath, file, def),
  createFaith: (modPath: string, religionId: string, def: NewFaith): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:createFaith', modPath, religionId, def),
  listRiteFiles: (modPath: string): Promise<string[]> =>
    ipcRenderer.invoke('ck3:listRiteFiles', modPath),
  createRite: (modPath: string, file: string, def: NewRite): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:createRite', modPath, file, def),
  saveRite: (modPath: string, file: string, id: string, patch: RitePatch): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:saveRite', modPath, file, id, patch),
  getTitleData: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ): Promise<TitleData> => ipcRenderer.invoke('ck3:getTitleData', gameDir, modPath, replacePaths),
  getTitle: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    id: string
  ): Promise<TitleDetail | null> =>
    ipcRenderer.invoke('ck3:getTitle', gameDir, modPath, replacePaths, id),
  saveTitle: (modPath: string, file: string, id: string, patch: TitlePatch): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:saveTitle', modPath, file, id, patch),
  listTitleFiles: (modPath: string): Promise<string[]> =>
    ipcRenderer.invoke('ck3:listTitleFiles', modPath),
  createTitle: (modPath: string, def: NewTitle): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:createTitle', modPath, def),
  getTitleHistory: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    titleId: string
  ): Promise<TitleHistoryEntry[]> =>
    ipcRenderer.invoke('ck3:getTitleHistory', gameDir, modPath, replacePaths, titleId),
  listTitleHistoryFiles: (modPath: string): Promise<string[]> =>
    ipcRenderer.invoke('ck3:listTitleHistoryFiles', modPath),
  saveTitleHistoryEntry: (
    modPath: string,
    file: string,
    titleId: string,
    titleBlock: number,
    index: number,
    patch: TitleHistoryEntryPatch
  ): Promise<SaveResult> =>
    ipcRenderer.invoke(
      'ck3:saveTitleHistoryEntry',
      modPath,
      file,
      titleId,
      titleBlock,
      index,
      patch
    ),
  addTitleHistoryEntry: (
    modPath: string,
    file: string,
    titleId: string,
    patch: TitleHistoryEntryPatch
  ): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:addTitleHistoryEntry', modPath, file, titleId, patch),
  deleteTitleHistoryEntry: (
    modPath: string,
    file: string,
    titleId: string,
    titleBlock: number,
    index: number
  ): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:deleteTitleHistoryEntry', modPath, file, titleId, titleBlock, index),
  getFaithIcons: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    icons: string[]
  ): Promise<Record<string, string | null>> =>
    ipcRenderer.invoke('ck3:getFaithIcons', gameDir, modPath, replacePaths, icons),
  listFaithIcons: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ): Promise<string[]> => ipcRenderer.invoke('ck3:listFaithIcons', gameDir, modPath, replacePaths),
  listCultureFiles: (modPath: string): Promise<string[]> =>
    ipcRenderer.invoke('ck3:listCultureFiles', modPath),
  createCulture: (modPath: string, file: string, def: NewCulture): Promise<SaveResult> =>
    ipcRenderer.invoke('ck3:createCulture', modPath, file, def),
  getTraitIcons: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    traits: string[]
  ): Promise<Record<string, string | null>> =>
    ipcRenderer.invoke('ck3:getTraitIcons', gameDir, modPath, replacePaths, traits),
  getFlatIcons: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    names: string[]
  ): Promise<Record<string, string | null>> =>
    ipcRenderer.invoke('ck3:getFlatIcons', gameDir, modPath, replacePaths, names),
  getSkillIcons: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    skills: string[]
  ): Promise<Record<string, string | null>> =>
    ipcRenderer.invoke('ck3:getSkillIcons', gameDir, modPath, replacePaths, skills),
  getCoatsOfArms: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    ids: string[]
  ): Promise<Record<string, string | null>> =>
    ipcRenderer.invoke('ck3:getCoatsOfArms', gameDir, modPath, replacePaths, ids),
  getReferenceData: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ): Promise<ReferenceData> =>
    ipcRenderer.invoke('ck3:getReferenceData', gameDir, modPath, replacePaths),
  locateRef: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    kind: RefKind,
    id: string
  ): Promise<RefLocation | null> =>
    ipcRenderer.invoke('ck3:locateRef', gameDir, modPath, replacePaths, kind, id),
  getModFonts: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ): Promise<ModFonts | null> =>
    ipcRenderer.invoke('ck3:getModFonts', gameDir, modPath, replacePaths),
  validateGameDir: (dir: string): Promise<DirValidation> =>
    ipcRenderer.invoke('ck3:validateGameDir', dir),
  validateModDir: (dir: string): Promise<DirValidation> =>
    ipcRenderer.invoke('ck3:validateModDir', dir),

  detectEditors: (): Promise<EditorInfo[]> => ipcRenderer.invoke('editor:detect'),
  openInEditor: (file: string, line?: number): Promise<SaveResult> =>
    ipcRenderer.invoke('editor:open', file, line),

  pickDirectory: (title: string, kind: 'game' | 'mod'): Promise<string | null> =>
    ipcRenderer.invoke('dialog:pickDirectory', title, kind),
  pickEditor: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickEditor')
}

export type Ck3ToolsApi = typeof api

contextBridge.exposeInMainWorld('ck3tools', api)
