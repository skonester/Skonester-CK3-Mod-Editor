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

export interface Ck3ToolsApi {
  getFaithHistory: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    faithId: string
  ) => Promise<FaithHistoryEntry[]>
  listFaithHistoryFiles: (modPath: string) => Promise<string[]>
  prepareFaithHistoryScript: (
    script: string,
    patch?: Partial<FaithHistoryFields>
  ) => Promise<FaithHistoryPreview>
  saveFaithHistoryEntry: (
    modPath: string,
    faithId: string,
    target: FaithHistoryTarget,
    patch: FaithHistoryPatch
  ) => Promise<SaveResult>
  addFaithHistoryEntry: (
    modPath: string,
    file: string,
    faithId: string,
    patch: FaithHistoryPatch
  ) => Promise<SaveResult>
  deleteFaithHistoryEntry: (
    modPath: string,
    faithId: string,
    target: FaithHistoryTarget
  ) => Promise<SaveResult>
  getSettings: () => Promise<AppSettings>
  setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  detectPaths: () => Promise<DetectionResult>
  listMods: (modDir: string) => Promise<ModInfo[]>
  listCharacters: (modPath: string) => Promise<CharacterSummary[]>
  getCharacter: (modPath: string, file: string, id: string) => Promise<CharacterDetail | null>
  saveCharacter: (
    modPath: string,
    file: string,
    originalId: string,
    detail: CharacterDetail
  ) => Promise<SaveResult>
  listCharacterFiles: (modPath: string) => Promise<string[]>
  createCharacter: (modPath: string, file: string, detail: CharacterDetail) => Promise<SaveResult>
  /** File options and locks for the "Paste from Ruler Designer" dialog */
  getDnaPasteInfo: (modPath: string, file: string, id: string) => Promise<DnaPasteInfo>
  /**
   * Convert a Ruler Designer DNA export into scripted-character files: the DNA
   * block, the hair/beard portrait modifier, and the history wiring
   * (`dna =` plus the has_scripted_appearance flag).
   */
  applyRulerDesignerDna: (
    gameDir: string | null,
    modPath: string,
    replacePaths: string[],
    file: string,
    id: string,
    paste: string,
    dnaFile: string,
    modifierFile: string | null
  ) => Promise<SaveResult>
  getDynastyData: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ) => Promise<DynastyData>
  saveDynasty: (
    modPath: string,
    file: string,
    id: string,
    patch: DynastyPatch
  ) => Promise<SaveResult>
  saveHouse: (modPath: string, file: string, id: string, patch: HousePatch) => Promise<SaveResult>
  getCultureData: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ) => Promise<CultureData>
  /** Game paths included so a named colour resolves and survives an unrelated edit */
  saveCulture: (
    gameDir: string | null,
    modPath: string,
    replacePaths: string[],
    file: string,
    id: string,
    patch: CulturePatch
  ) => Promise<SaveResult>
  /** The mod's own common/dynasties and common/dynasty_houses .txt files */
  listDynastyFiles: (modPath: string) => Promise<DynastyFiles>
  createDynasty: (modPath: string, file: string, def: NewDynasty) => Promise<SaveResult>
  createHouse: (modPath: string, file: string, def: NewHouse) => Promise<SaveResult>
  getReligionData: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ) => Promise<ReligionData>
  saveFaith: (
    modPath: string,
    file: string,
    religionId: string,
    faithId: string,
    patch: FaithPatch
  ) => Promise<SaveResult>
  saveReligion: (
    modPath: string,
    file: string,
    religionId: string,
    patch: ReligionPatch
  ) => Promise<SaveResult>
  /** The mod's .txt files under common/religion/religion_types, for the create picker */
  listReligionFiles: (modPath: string) => Promise<string[]>
  createReligion: (modPath: string, file: string, def: NewReligion) => Promise<SaveResult>
  /** Creates a standalone 1.20 faith, or nests a legacy faith into a mod religion */
  createFaith: (modPath: string, religionId: string, def: NewFaith) => Promise<SaveResult>
  listRiteFiles: (modPath: string) => Promise<string[]>
  createRite: (modPath: string, file: string, def: NewRite) => Promise<SaveResult>
  saveRite: (modPath: string, file: string, id: string, patch: RitePatch) => Promise<SaveResult>
  /** The de jure title forest plus government/succession-law reference lists */
  getTitleData: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ) => Promise<TitleData>
  getTitle: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    id: string
  ) => Promise<TitleDetail | null>
  saveTitle: (modPath: string, file: string, id: string, patch: TitlePatch) => Promise<SaveResult>
  /** The mod's own .txt files under common/landed_titles */
  listTitleFiles: (modPath: string) => Promise<string[]>
  /**
   * With a parent, nests the new title into that title's block (the parent
   * must be mod-defined); without one, appends a top-level block to def.file.
   */
  createTitle: (modPath: string, def: NewTitle) => Promise<SaveResult>
  /** Every dated history entry for the title, across all effective history files */
  getTitleHistory: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    titleId: string
  ) => Promise<TitleHistoryEntry[]>
  /** The mod's own .txt files under history/titles */
  listTitleHistoryFiles: (modPath: string) => Promise<string[]>
  saveTitleHistoryEntry: (
    modPath: string,
    file: string,
    titleId: string,
    titleBlock: number,
    index: number,
    patch: TitleHistoryEntryPatch
  ) => Promise<SaveResult>
  addTitleHistoryEntry: (
    modPath: string,
    file: string,
    titleId: string,
    patch: TitleHistoryEntryPatch
  ) => Promise<SaveResult>
  deleteTitleHistoryEntry: (
    modPath: string,
    file: string,
    titleId: string,
    titleBlock: number,
    index: number
  ) => Promise<SaveResult>
  /** Faith icons from gfx/interface/icons/faith, keyed by the `icon =` value */
  getFaithIcons: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    icons: string[]
  ) => Promise<Record<string, string | null>>
  /** Every icon name a faith can point at, mod files layered over the game's */
  listFaithIcons: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ) => Promise<string[]>
  /** The mod's own .txt files under common/culture/cultures */
  listCultureFiles: (modPath: string) => Promise<string[]>
  createCulture: (modPath: string, file: string, def: NewCulture) => Promise<SaveResult>
  getTraitIcons: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    traits: string[]
  ) => Promise<Record<string, string | null>>
  /** Monochrome silhouette icons from gfx/interface/icons/flat_icons, by bare name */
  getFlatIcons: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    names: string[]
  ) => Promise<Record<string, string | null>>
  /** Skill icons (diplomacy, martial, …), by skill key */
  getSkillIcons: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    skills: string[]
  ) => Promise<Record<string, string | null>>
  getCoatsOfArms: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    ids: string[]
  ) => Promise<Record<string, string | null>>
  getReferenceData: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ) => Promise<ReferenceData>
  locateRef: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[],
    kind: RefKind,
    id: string
  ) => Promise<RefLocation | null>
  /** The mod's StandardGameFont and TitleFont; null when it ships none */
  getModFonts: (
    gameDir: string | null,
    modPath: string | null,
    replacePaths: string[]
  ) => Promise<ModFonts | null>
  validateGameDir: (dir: string) => Promise<DirValidation>
  validateModDir: (dir: string) => Promise<DirValidation>
  detectEditors: () => Promise<EditorInfo[]>
  openInEditor: (file: string, line?: number) => Promise<SaveResult>
  pickDirectory: (title: string, kind: 'game' | 'mod') => Promise<string | null>
  pickEditor: () => Promise<string | null>
}

declare global {
  interface Window {
    ck3tools: Ck3ToolsApi
  }
}

export {}
