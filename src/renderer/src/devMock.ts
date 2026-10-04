/**
 * Dev-only in-browser mock of the `window.ck3tools` preload bridge, so the
 * renderer can be previewed in a plain browser tab (where Electron's preload
 * doesn't run). Never active inside the real app: the preload defines
 * `window.ck3tools` before any renderer code executes.
 */
import type { Ck3ToolsApi } from '../../preload/index.d'
import type {
  AppSettings,
  CharacterDetail,
  CultureCharacter,
  CultureDef,
  DynastyCharacter,
  DynastyDef,
  FaithDef,
  HouseDef,
  RefEntry,
  ReligionDef,
  RiteDef,
  TitleDetail,
  TitleFlags,
  TitleHistoryEntry,
  TitleSummary
} from '@shared/types'
import { TITLE_FLAG_KEYS } from '@shared/types'

/** `{ id: name }` as reference entries; a null name means "no localization". */
const named = (entries: Record<string, string | null>): RefEntry[] =>
  Object.entries(entries).map(([id, name]) => ({ id, name }))

const rites: RiteDef[] = [
  {
    id: 'mock_rite',
    file: '00_mock_rites.txt',
    inMod: true,
    localizedName: 'Mock Rite',
    faith: 'orthodox',
    color: { hex: '#808080', raw: '{ 128 128 128 }', editable: true },
    icon: null,
    founder: null,
    create: null,
    convert: null,
    doctrines: ['doctrine_monogamy'],
    tenets: ['tenet_communion']
  }
]

const settings: AppSettings = {
  gameDir: 'C:\\Mock\\Crusader Kings III\\game',
  modDir: 'C:\\Mock\\mod',
  selectedModFile: 'MockMod.mod',
  recentEntries: {},
  favoriteEntries: {},
  entryDrafts: {},
  textEditorPath: null,
  useModFonts: true
}

const characters: CharacterDetail[] = [
  {
    id: '219',
    file: 'mock_characters.txt',
    name: 'Alexios',
    dynasty: 'dynn_Mock',
    house: null,
    birth: '1050.1.1',
    death: null,
    culture: 'greek',
    faith: 'orthodox',
    father: '218',
    mother: null,
    traits: ['brave', 'ambitious'],
    spouses: [
      { id: '1002', marriage: '1070.3.4', divorce: null, matrilineal: false, concubine: false }
    ],
    relations: [
      // One of each file shape: scalar form, and block form with a reason
      { type: 'rival', target: '218', prefixed: true, date: '1067.1.1', reason: null, extra: null },
      {
        type: 'lover',
        target: '1002',
        prefixed: true,
        date: '1069.2.3',
        reason: 'lover_historical',
        extra: null
      }
    ],
    stats: {
      diplomacy: 4,
      martial: 7,
      stewardship: 3,
      intrigue: 5,
      learning: 2,
      prowess: 6
    },
    female: null,
    sexuality: null,
    dna: null
  },
  {
    id: '218',
    file: 'mock_characters.txt',
    name: 'Ioannes',
    dynasty: 'dynn_Mock',
    house: null,
    birth: '1020.1.1',
    death: '1078.4.2',
    culture: 'greek',
    faith: 'orthodox',
    father: null,
    mother: null,
    traits: ['just'],
    spouses: [],
    relations: [],
    stats: {
      diplomacy: 6,
      martial: 3,
      stewardship: 5,
      intrigue: 2,
      learning: 4,
      prowess: 3
    },
    female: null,
    sexuality: null,
    dna: null
  },
  {
    id: '1002',
    file: 'mock_characters.txt',
    name: 'Eirene',
    dynasty: 'dynn_Mock',
    house: null,
    birth: '1052.6.3',
    death: '1099.2.14',
    culture: 'greek',
    faith: 'orthodox',
    father: null,
    mother: null,
    traits: ['shy'],
    spouses: [],
    relations: [],
    stats: {
      diplomacy: 6,
      martial: 2,
      stewardship: 7,
      intrigue: 3,
      learning: 5,
      prowess: 1
    },
    female: 'yes',
    sexuality: null,
    dna: null
  },
  {
    id: '77',
    file: 'mock_characters.txt',
    name: null,
    dynasty: null,
    house: null,
    birth: '1041.11.2',
    death: null,
    culture: 'greek',
    faith: 'orthodox',
    father: null,
    mother: null,
    traits: [],
    spouses: [],
    relations: [],
    stats: {
      diplomacy: null,
      martial: null,
      stewardship: null,
      intrigue: null,
      learning: null,
      prowess: null
    },
    female: null,
    sexuality: null,
    dna: null
  },
  {
    id: '3410',
    file: 'mock_norse.txt',
    name: 'Ragnvald',
    dynasty: 'dynn_Other',
    house: null,
    birth: '1044.3.20',
    death: null,
    culture: 'norse',
    faith: 'asatru',
    father: null,
    mother: null,
    traits: ['brave'],
    spouses: [],
    relations: [],
    stats: {
      diplomacy: 2,
      martial: 9,
      stewardship: 1,
      intrigue: 4,
      learning: 1,
      prowess: 8
    },
    female: null,
    sexuality: null,
    dna: null
  },
  {
    id: '3411',
    file: 'mock_norse.txt',
    name: 'Astrid',
    // The house-only case: no `dynasty =` line, lineage comes via the house
    dynasty: null,
    house: 'house_Mockington',
    birth: '1048.9.9',
    death: null,
    culture: 'norse',
    faith: 'lost_faith',
    father: null,
    mother: null,
    traits: ['ambitious', 'craven'],
    spouses: [],
    relations: [],
    stats: {
      diplomacy: 5,
      martial: 3,
      stewardship: 6,
      intrigue: 8,
      learning: 4,
      prowess: 2
    },
    female: 'yes',
    sexuality: null,
    dna: null
  }
]

// Synthetic dynasty data shaped like real mod files: disconnected islands
// centuries apart, cadet houses, a case-mismatched parent ref, a dangling
// house, external (ghost) parents, and a game-defined dynasty in use.
const cultures: CultureDef[] = [
  {
    id: 'greek',
    file: '00_mock_cultures.txt',
    inMod: true,
    localizedName: 'Greek',
    color: { format: 'rgb', raw: 'rgb { 20 85 150 }', hex: '#145596' },
    ethos: 'ethos_bellicose',
    heritage: 'heritage_hellenic',
    language: 'language_greek',
    martialCustom: 'martial_custom_male_only',
    headDetermination: null,
    traditions: ['tradition_philosopher_culture', 'tradition_seafaring'],
    nameList: 'name_list_greek',
    parents: [],
    created: null,
    coaGfx: ['greek_coa_gfx'],
    buildingGfx: ['mediterranean_building_gfx'],
    clothingGfx: ['greek_clothing_gfx'],
    unitGfx: ['eastern_unit_gfx'],
    houseCoaFrame: 'house_frame_05',
    ethnicities: [{ weight: '10', id: 'mediterranean' }]
  },
  {
    id: 'attic',
    file: '00_mock_cultures.txt',
    inMod: true,
    localizedName: 'Attic',
    color: { format: 'hsv', raw: 'hsv { 0.1 0.6 0.8 }', hex: '#cc8f29' },
    ethos: 'ethos_stoic',
    heritage: 'heritage_hellenic',
    language: 'language_greek',
    martialCustom: 'martial_custom_male_only',
    headDetermination: 'head_determination_domain',
    traditions: ['tradition_philosopher_culture'],
    nameList: 'name_list_greek',
    // Points at greek, so the relations panel has a lineage to draw
    parents: ['greek'],
    created: '1050.1.1',
    coaGfx: ['greek_coa_gfx'],
    buildingGfx: ['mediterranean_building_gfx'],
    clothingGfx: ['greek_clothing_gfx'],
    unitGfx: ['eastern_unit_gfx'],
    houseCoaFrame: 'house_frame_05',
    ethnicities: [
      { weight: '10', id: 'mediterranean' },
      { weight: '2', id: 'levantine' }
    ]
  },
  {
    id: 'norse',
    file: '00_mock_cultures.txt',
    inMod: true,
    // No localization and no colour: the bare-id and empty-swatch fallbacks
    localizedName: null,
    color: null,
    ethos: 'ethos_bellicose',
    heritage: 'heritage_north_germanic',
    language: null,
    martialCustom: null,
    headDetermination: null,
    traditions: [],
    nameList: null,
    parents: ['nonexistent_culture'],
    created: null,
    coaGfx: [],
    buildingGfx: [],
    clothingGfx: [],
    unitGfx: [],
    houseCoaFrame: null,
    ethnicities: []
  },
  {
    id: 'saxon',
    file: '01_game_cultures.txt',
    inMod: false,
    localizedName: 'Saxon',
    color: { format: 'named', raw: 'english', hex: '#cc3333' },
    ethos: 'ethos_communal',
    heritage: 'heritage_west_germanic',
    language: 'language_anglic',
    martialCustom: 'martial_custom_male_only',
    headDetermination: null,
    traditions: ['tradition_hill_dwellers'],
    nameList: 'name_list_saxon',
    parents: [],
    created: null,
    coaGfx: ['western_coa_gfx'],
    buildingGfx: ['western_building_gfx'],
    clothingGfx: ['western_clothing_gfx'],
    unitGfx: ['western_unit_gfx'],
    houseCoaFrame: 'house_frame_22',
    ethnicities: [{ weight: '100', id: 'caucasian_nordic' }]
  }
]

const dynasties: DynastyDef[] = [
  {
    id: 'mockidae',
    file: '00_dynasties.txt',
    inMod: true,
    name: 'dynn_Mockidae',
    prefix: null,
    motto: 'dynn_Mockidae_motto',
    culture: 'greek',
    localizedName: 'Mockidai'
  },
  {
    id: '7',
    file: '00_dynasties.txt',
    inMod: true,
    name: 'dynn_Heraclid',
    prefix: 'dynnp_of',
    motto: null,
    culture: 'greek',
    localizedName: 'Heraclids'
  },
  {
    id: 'vanity_game',
    file: '01_vanity_dynasties.txt',
    inMod: false,
    name: 'dynn_Gamefolk',
    prefix: null,
    motto: null,
    culture: 'saxon',
    localizedName: 'Gamefolk'
  }
]

const houses: HouseDef[] = [
  {
    id: 'house_Alpha',
    file: '00_dynasty_houses.txt',
    inMod: true,
    name: 'dynn_Alpha',
    prefix: null,
    motto: 'dynn_Alpha_motto',
    dynasty: 'mockidae',
    localizedName: 'Alphaids'
  },
  {
    id: 'house_Beta',
    file: '00_dynasty_houses.txt',
    inMod: true,
    name: 'dynn_Beta',
    prefix: null,
    motto: null,
    // Case mismatch on purpose — real mods reference `Phokus` as `phokus`
    dynasty: 'Mockidae',
    localizedName: null
  }
]

const dc = (partial: Partial<DynastyCharacter> & { id: string }): DynastyCharacter => ({
  file: 'mock_dynasty.txt',
  name: null,
  birth: null,
  death: null,
  father: null,
  mother: null,
  female: false,
  dynasty: null,
  house: null,
  spouses: [],
  ...partial
})

const dynastyCharacters: DynastyCharacter[] = [
  // Island 1: the founder era
  dc({ id: 'M1', name: 'Mockos', dynasty: 'mockidae', birth: '2669.1.1', death: '2716.1.1' }),
  dc({
    id: 'M2',
    name: 'Nestor',
    dynasty: 'mockidae',
    father: 'M1',
    birth: '2691.1.1',
    death: '2779.1.1',
    spouses: ['E1']
  }),
  dc({ id: 'M3', name: 'Antilochus', dynasty: 'mockidae', father: 'M2', birth: '2728.1.1.', death: '2757.1.1' }),
  dc({ id: 'M4', name: 'Thrasymedes', dynasty: 'mockidae', father: 'M2', birth: '2735.1', death: '2807.1.1' }),
  dc({ id: 'M5', name: 'Peryclemus', dynasty: 'mockidae', father: 'M2', birth: '2739.1.1', death: '2788.1.1' }),
  dc({ id: 'M6', name: 'Polycaste', dynasty: 'mockidae', father: 'M2', female: true, birth: '2741.1.1' }),
  // Island 2: 257+ years later, no parent chain back to island 1
  dc({ id: 'M10', name: 'Neomockos', dynasty: 'mockidae', birth: '3040.1.1', death: '3101.1.1' }),
  dc({
    id: 'M11',
    name: 'Alphaion',
    house: 'house_Alpha',
    father: 'M10',
    birth: '3067.1.1',
    death: '3130.1.1',
    spouses: ['O1']
  }),
  dc({
    id: 'M12',
    name: 'Alphaides',
    house: 'house_Alpha',
    father: 'M11',
    mother: 'O1',
    birth: '3095.1.1'
  }),
  dc({ id: 'B1', name: 'Betaion', house: 'house_Beta', father: 'X7', birth: '3070.1.1', death: '3141.1.1' }),
  dc({ id: 'B2', name: 'Betaides', house: 'house_Beta', father: 'B1', birth: '3103.1.1' }),
  // Members of a house that is defined nowhere (dangling ref)
  dc({ id: 'G1', name: 'Ghostly', house: 'house_ghostly', birth: '3075.1.1', death: '3129.1.1' }),
  // External context characters (ghost parents / spouses)
  dc({ id: 'X7', name: 'Herakles', dynasty: '7', birth: '3041.1.1', death: '3099.1.1' }),
  dc({ id: 'O1', name: 'Omphale', dynasty: '7', female: true, birth: '3072.1.1' }),
  dc({ id: 'E1', name: 'Eurydike', dynasty: 'vanity_game', female: true, birth: '2695.1.1', death: '2760.1.1' }),
  dc({ id: 'L1', name: 'Lowborn Larry', birth: '3050.1.1' })
]


// ---------- Religions & faiths ----------

const religions: ReligionDef[] = [
  {
    id: 'christianity_religion',
    file: 'mock_christian.txt',
    inMod: false,
    family: 'rf_abrahamic',
    graphicalFaith: 'catholic_gfx',
    pietyIconGroup: null,
    doctrines: ['doctrine_spiritual_head', 'doctrine_monogamy'],
    localizedName: 'Christianity'
  },
  {
    id: 'hellenism_religion',
    file: 'mock_hellenic.txt',
    inMod: true,
    family: 'rf_pagan',
    graphicalFaith: 'pagan_gfx',
    pietyIconGroup: 'pagan',
    doctrines: ['doctrine_no_head', 'doctrine_monogamy'],
    localizedName: 'Hellenism'
  },
  {
    id: 'germanic_religion',
    file: 'mock_germanic.txt',
    inMod: true,
    family: 'rf_pagan',
    graphicalFaith: 'pagan_gfx',
    pietyIconGroup: null,
    doctrines: ['doctrine_no_head'],
    localizedName: null
  }
]

const faith = (
  id: string,
  religion: string,
  file: string,
  over: Partial<FaithDef> = {}
): FaithDef => ({
  id,
  file,
  inMod: file !== 'mock_christian.txt',
  religion,
  color: { hex: '#8a5a3c', raw: '{ 0.54 0.35 0.24 }', editable: true },
  icon: null,
  reformedIcon: null,
  religiousHead: null,
  doctrines: [],
  holySites: [],
  localizedName: null,
  ...over
})

const faiths: FaithDef[] = [
  faith('orthodox', 'christianity_religion', 'mock_christian.txt', {
    // A named-colour reference: shown with its swatch, but not rewritable
    color: { hex: '#6a4fbb', raw: 'mock_purple', editable: false },
    icon: 'orthodox',
    religiousHead: 'k_orthodox',
    doctrines: ['tenet_communion', 'doctrine_spiritual_head'],
    holySites: ['mock_jerusalem'],
    localizedName: 'Orthodoxy'
  }),
  faith('catholic', 'christianity_religion', 'mock_christian.txt', {
    color: { hex: '#b9a24a', raw: '{ 0.73 0.64 0.29 }', editable: true },
    icon: 'orthodox',
    localizedName: 'Catholicism'
  }),
  faith('olympian', 'hellenism_religion', 'mock_hellenic.txt', {
    color: { hex: '#a3312a', raw: '{ 0.64 0.19 0.16 }', editable: true },
    icon: 'hellenic',
    doctrines: ['tenet_hero_cult', 'tenet_astrology', 'doctrine_no_head'],
    holySites: ['mock_delphi', 'mock_olympia'],
    localizedName: 'Olympian'
  }),
  // No localization, and no adherents yet: a faith mid-authoring
  faith('delian', 'hellenism_religion', 'mock_hellenic.txt', {
    color: { hex: '#1f96af', raw: '{ 31 150 175 }', editable: true },
    icon: 'delos_palm',
    reformedIcon: 'hellenic_reformed',
    religiousHead: 'd_mock_delos',
    doctrines: ['tenet_adaptive', 'tenet_hero_cult'],
    holySites: ['mock_delphi']
  }),
  faith('asatru', 'germanic_religion', 'mock_germanic.txt', {
    // No colour line at all
    color: null,
    doctrines: ['tenet_adaptive'],
    localizedName: null
  })
]

// ---------- Landed titles & their history ----------

const noFlags = (over: Partial<TitleFlags> = {}): TitleFlags => {
  const flags = {} as TitleFlags
  for (const key of TITLE_FLAG_KEYS) flags[key] = null
  return { ...flags, ...over }
}

const titleSummary = (partial: Partial<TitleSummary> & { id: string }): TitleSummary => ({
  tier: 'duchy',
  parent: null,
  file: 'mock_titles.txt',
  inMod: true,
  localizedName: null,
  color: null,
  landless: null,
  requireLandless: null,
  nobleFamily: null,
  province: null,
  // Recomputed from titleHistories by the getTitleData mock, like the backend
  hasHistory: false,
  ...partial
})

// A small de jure tree with the edge cases the tree browser has to survive: a
// game-defined empire, a dangling parent, special-kind flags, a titular duchy.
const titles: TitleSummary[] = [
  titleSummary({ id: 'e_mockia', tier: 'empire', localizedName: 'Mockia', color: '#a03030' }),
  titleSummary({
    id: 'k_hellas',
    tier: 'kingdom',
    parent: 'e_mockia',
    localizedName: 'Hellás',
    color: '#3a5f9f'
  }),
  titleSummary({
    id: 'd_athens',
    tier: 'duchy',
    parent: 'k_hellas',
    localizedName: 'Athens',
    color: '#4f8f4f'
  }),
  titleSummary({
    id: 'c_athens',
    tier: 'county',
    parent: 'd_athens',
    localizedName: 'Attica',
    color: '#5f9f5f'
  }),
  titleSummary({
    id: 'b_athens',
    tier: 'barony',
    parent: 'c_athens',
    localizedName: 'Athens',
    color: '#6faf6f',
    province: '100'
  }),
  titleSummary({
    id: 'b_piraeus',
    tier: 'barony',
    parent: 'c_athens',
    color: '#7fbf7f',
    province: '101'
  }),
  // Titular and landless (but no adventurer flag) — the plain-circle glyph
  titleSummary({ id: 'd_oracle', parent: 'k_hellas', color: '#646464', landless: 'yes' }),
  titleSummary({
    id: 'd_laamp_wanderers',
    localizedName: 'The Wanderers',
    color: '#646464',
    landless: 'yes',
    requireLandless: 'yes'
  }),
  titleSummary({
    id: 'c_nf_mockidae',
    tier: 'county',
    localizedName: 'Mockidae',
    color: '#646464',
    landless: 'yes',
    nobleFamily: 'yes'
  }),
  titleSummary({
    id: 'e_game',
    tier: 'empire',
    file: '00_game_titles.txt',
    inMod: false,
    localizedName: 'Gamelandia',
    color: '#907030'
  }),
  titleSummary({ id: 'd_dangling', parent: 'k_missing', color: '#556677' })
]

const titleDetails = new Map<string, TitleDetail>(
  titles.map((t) => {
    const children = titles.filter((c) => c.parent === t.id).map((c) => c.id)
    const path: string[] = []
    for (let p = t.parent; p !== null; ) {
      const parent = titles.find((x) => x.id === p)
      if (!parent) break
      path.unshift(parent.id)
      p = parent.parent
    }
    return [
      t.id.toLowerCase(),
      {
        id: t.id,
        tier: t.tier,
        file: t.file,
        inMod: t.inMod,
        dejurePath: path,
        parent: t.parent,
        children,
        color: t.color === null ? null : { hex: t.color, raw: `{ ${t.color} }`, editable: true },
        capital: t.tier === 'barony' ? null : (children.find((c) => c.startsWith('c_')) ?? null),
        province: t.province,
        flags: noFlags(
          t.nobleFamily === 'yes'
            ? {
                definite_form: 'yes',
                landless: 'yes',
                ruler_uses_title_name: 'no',
                no_automatic_claims: 'yes',
                noble_family: 'yes',
                destroy_if_invalid_heir: 'yes'
              }
            : t.landless === 'yes'
              ? { landless: 'yes', require_landless: 'yes', definite_form: 'yes' }
              : {}
        ),
        culturalNames:
          t.id === 'c_athens'
            ? [
                { key: 'name_list_attic', value: 'cn_athenai' },
                { key: 'name_list_doric', value: 'cn_athana' }
              ]
            : [],
        scriptBlocks: t.id === 'd_laamp_wanderers' ? ['can_create', 'ai_primary_priority'] : []
      }
    ]
  })
)

const historyEntry = (
  partial: Partial<TitleHistoryEntry> & { date: string }
): TitleHistoryEntry => ({
  file: 'mock_history.txt',
  inMod: true,
  titleBlock: 0,
  index: 0,
  holder: null,
  liege: null,
  deJureLiege: null,
  government: null,
  changeDevelopmentLevel: null,
  developmentLevel: null,
  name: null,
  resetName: null,
  insertTitleHistory: null,
  removeSuccessionLaws: null,
  holderIgnoreHeadOfFaithRequirement: null,
  successionLaws: null,
  opaqueBlocks: [],
  extra: [],
  ...partial
})

// Out of order on purpose (dev lines first, the vanilla house style), with a
// duplicate date, a typo'd date, a vacancy and an opaque effect block.
const titleHistories = new Map<string, TitleHistoryEntry[]>([
  [
    'k_hellas',
    [
      historyEntry({ date: '3200.1.1', index: 0, changeDevelopmentLevel: '2' }),
      historyEntry({ date: '3400.1.1', index: 1, changeDevelopmentLevel: '5' }),
      historyEntry({
        date: '3254.1.1',
        index: 2,
        holder: '219',
        liege: 'e_mockia',
        government: 'aristocratic_government',
        successionLaws: ['male_only_law']
      }),
      historyEntry({ date: '3254.1.1', index: 3, opaqueBlocks: ['effect'] }),
      historyEntry({ date: '3300.1', index: 4, holder: '0' }),
      historyEntry({
        date: '800.1.1',
        file: '00_game_history.txt',
        inMod: false,
        holder: '9999'
      })
    ]
  ],
  ['d_laamp_wanderers', [historyEntry({ date: '3254.1.1', holder: '218', liege: '0' })]]
])

const mock: Ck3ToolsApi = {
  getSettings: async () => structuredClone(settings),
  setSettings: async (patch) => Object.assign(settings, patch) && structuredClone(settings),
  detectPaths: async () => ({ gameDir: settings.gameDir, modDir: settings.modDir }),
  listMods: async () => [
    {
      file: 'MockMod.mod',
      name: 'Mock Mod',
      version: '1.0',
      supportedVersion: '1.13.*',
      tags: ['Total Conversion'],
      path: 'C:\\Mock\\mod\\MockMod',
      replacePaths: [],
      pathExists: true,
      profile: { calendar: { epochYear: 4000, beforeLabel: 'BC', afterLabel: 'AD' } }
    }
  ],
  listCharacters: async () =>
    characters.map(({ id, name, dynasty, birth, father, mother, file }) => ({
      id,
      name,
      dynasty,
      birth,
      father,
      mother,
      file
    })),
  getCharacter: async (_modPath, file, id) =>
    structuredClone(characters.find((c) => c.file === file && c.id === id) ?? null),
  saveCharacter: async (_modPath, file, originalId, detail) => {
    const i = characters.findIndex((c) => c.file === file && c.id === originalId)
    if (i >= 0) characters[i] = structuredClone(detail)
    return { ok: true }
  },
  listCharacterFiles: async () => [...new Set(characters.map((c) => c.file))].sort(),
  getDnaPasteInfo: async (_modPath, _file, id) => ({
    dnaKey: `${id}_dna`,
    dnaFiles: ['00_mock_dna.txt'],
    modifierFiles: ['mock_scripted_appearances.txt'],
    lockedDnaFile: null,
    lockedModifierFile: null
  }),
  applyRulerDesignerDna: async (_g, _modPath, _r, file, id, _paste, dnaFile) => {
    const c = characters.find((x) => x.file === file && x.id === id)
    if (!c) return { ok: false, error: `Character ${id} not found in ${file}` }
    c.dna = `${id}_dna`
    console.info(`[devMock] applyRulerDesignerDna → ${dnaFile}`)
    return { ok: true }
  },
  createCharacter: async (_modPath, file, detail) => {
    if (characters.some((c) => c.id === detail.id)) {
      return { ok: false, error: `ID ${detail.id} already exists in the mod` }
    }
    characters.push(structuredClone({ ...detail, file }))
    return { ok: true }
  },
  getCultureData: async () => ({
    cultures: structuredClone(cultures),
    pillars: {
      ethos: named({ ethos_bellicose: 'Bellicose', ethos_stoic: 'Stoic', ethos_communal: 'Communal' }),
      heritage: named({
        heritage_hellenic: 'Hellenic',
        heritage_north_germanic: 'North Germanic',
        heritage_west_germanic: null
      }),
      language: named({ language_greek: 'Greek', language_anglic: 'Anglic' }),
      martial_custom: named({ martial_custom_male_only: 'Men Only' }),
      head_determination: named({ head_determination_domain: 'Determine by largest domain' })
    },
    traditions: [
      { id: 'tradition_philosopher_culture', name: 'Philosopher Culture', category: 'societal' },
      { id: 'tradition_seafaring', name: 'Seafaring', category: 'regional' },
      { id: 'tradition_hill_dwellers', name: 'Hill Dwellers', category: 'regional' },
      { id: 'tradition_unnamed', name: null, category: null }
    ],
    nameLists: named({ name_list_greek: 'Greek', name_list_saxon: 'Saxon' }),
    ethnicities: named({ mediterranean: null, levantine: null, caucasian_nordic: null }),
    gfx: {
      coa: ['greek_coa_gfx', 'western_coa_gfx'],
      building: ['mediterranean_building_gfx', 'western_building_gfx'],
      clothing: ['greek_clothing_gfx', 'western_clothing_gfx'],
      unit: ['eastern_unit_gfx', 'western_unit_gfx'],
      houseCoaFrame: ['house_frame_05', 'house_frame_22']
    },
    characters: characters.map(
      (c): CultureCharacter => ({
        id: c.id,
        file: c.file,
        name: c.name,
        birth: c.birth,
        death: c.death,
        culture: c.culture
      })
    )
  }),
  saveCulture: async (_g, _modPath, _r, file, id, patch) => {
    const c = cultures.find((x) => x.file === file && x.id === id)
    if (!c) return { ok: false, error: `Culture ${id} not found in ${file}` }
    Object.assign(c, patch, {
      color: patch.color === null ? null : { ...(c.color ?? { format: 'rgb' as const, raw: '' }), hex: patch.color }
    })
    return { ok: true }
  },
  listCultureFiles: async () =>
    [...new Set(cultures.filter((c) => c.inMod).map((c) => c.file))].sort(),
  createCulture: async (_modPath, file, def) => {
    // Mod-only, like the backend: overriding a base-game culture is legal
    const taken = cultures.find((c) => c.inMod && c.id.toLowerCase() === def.id.toLowerCase())
    if (taken) return { ok: false, error: `ID ${def.id} already exists in ${taken.file}` }
    const { id, color, ...rest } = def
    // Spelled the way the real writer spells a new culture's colour
    const triple = (hex: string): string =>
      `rgb { ${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ')} }`
    cultures.push({
      ...rest,
      id,
      file,
      inMod: true,
      localizedName: null,
      color: color === null ? null : { format: 'rgb', raw: triple(color), hex: color }
    })
    return { ok: true }
  },
  getDynastyData: async () => ({
    dynasties: structuredClone(dynasties),
    houses: structuredClone(houses),
    characters: structuredClone(dynastyCharacters)
  }),
  saveDynasty: async (_modPath, file, id, patch) => {
    const d = dynasties.find((x) => x.file === file && x.id === id)
    if (!d) return { ok: false, error: `Dynasty ${id} not found in ${file}` }
    Object.assign(d, patch)
    return { ok: true }
  },
  saveHouse: async (_modPath, file, id, patch) => {
    const h = houses.find((x) => x.file === file && x.id === id)
    if (!h) return { ok: false, error: `House ${id} not found in ${file}` }
    Object.assign(h, patch)
    return { ok: true }
  },
  listDynastyFiles: async () => ({
    dynasties: [...new Set(dynasties.filter((d) => d.inMod).map((d) => d.file))].sort(),
    houses: [...new Set(houses.filter((h) => h.inMod).map((h) => h.file))].sort()
  }),
  createDynasty: async (_modPath, file, def) => {
    const taken = [...dynasties, ...houses]
      .filter((x) => x.inMod)
      .find((x) => x.id.toLowerCase() === def.id.toLowerCase())
    if (taken) return { ok: false, error: `ID ${def.id} already exists in ${taken.file}` }
    dynasties.push({ ...def, file, inMod: true, localizedName: null })
    return { ok: true }
  },
  createHouse: async (_modPath, file, def) => {
    const taken = [...dynasties, ...houses]
      .filter((x) => x.inMod)
      .find((x) => x.id.toLowerCase() === def.id.toLowerCase())
    if (taken) return { ok: false, error: `ID ${def.id} already exists in ${taken.file}` }
    houses.push({ ...def, file, inMod: true, localizedName: null })
    return { ok: true }
  },
  getReligionData: async () => ({
    format: '1.20',
    rites: structuredClone(rites),
    tenets: named({ tenet_communion: 'Communion', tenet_astrology: 'Astrology' }),
    religions: structuredClone(religions),
    faiths: structuredClone(faiths),
    groups: [
      {
        id: 'doctrine_head_of_faith',
        category: 'main_group',
        picks: 1,
        name: 'Head of Faith',
        doctrines: named({
          doctrine_no_head: 'No Head of Faith',
          doctrine_spiritual_head: 'Spiritual Head of Faith',
          doctrine_temporal_head: null
        })
      },
      {
        id: 'doctrine_marriage_type',
        category: 'marriage',
        picks: 1,
        name: 'Marriage Type',
        doctrines: named({ doctrine_monogamy: 'Monogamous', doctrine_polygamy: 'Polygamous' })
      },
      {
        id: 'doctrine_core_tenets',
        category: 'core_tenets',
        picks: 3,
        name: 'Core Tenets',
        doctrines: named({
          tenet_hero_cult: 'Hero Cult',
          tenet_astrology: 'Astrology',
          tenet_adaptive: 'Adaptive',
          tenet_communion: 'Communion',
          tenet_unnamed: null
        })
      }
    ],
    ungroupedDoctrines: named({ special_doctrine_mock: null }),
    holySites: named({
      mock_delphi: 'Delphi',
      mock_olympia: 'Olympia',
      mock_jerusalem: 'Jerusalem',
      mock_unnamed: null
    }),
    families: named({ rf_pagan: 'Pagan', rf_abrahamic: 'Abrahamic', rf_mock: null }),
    adherents: characters
      .filter((c) => c.faith !== null || !!c.rite)
      .map((c) => ({ id: c.id, file: c.file, name: c.name,
        faith: (c.rite ? rites.find((r) => r.id === c.rite)?.faith : null) ?? c.faith ?? c.rite!, rite: c.rite ?? null }))
  }),
  saveFaith: async (_modPath, file, _religionId, faithId, patch) => {
    const f = faiths.find((x) => x.file === file && x.id === faithId)
    if (!f) return { ok: false, error: `Faith ${faithId} not found in ${file}` }
    Object.assign(f, {
      ...patch,
      icon: patch.icon,
      reformedIcon: patch.reformedIcon,
      religiousHead: patch.religiousHead,
      doctrines: patch.doctrines,
      holySites: patch.holySites,
      color: f.color && patch.color ? { ...f.color, hex: patch.color } : f.color
    })
    return { ok: true }
  },
  saveReligion: async (_modPath, file, religionId, patch) => {
    const r = religions.find((x) => x.file === file && x.id === religionId)
    if (!r) return { ok: false, error: `Religion ${religionId} not found in ${file}` }
    Object.assign(r, patch)
    return { ok: true }
  },
  listReligionFiles: async () =>
    [...new Set(religions.filter((r) => r.inMod).map((r) => r.file))].sort(),
  createReligion: async (_modPath, file, def) => {
    if (!def.family?.trim()) return { ok: false, error: 'Family is required' }
    // Mod definitions only, like the real backend: shadowing a game id is legal
    const clash = [...religions, ...faiths]
      .filter((x) => x.inMod)
      .find((x) => x.id.toLowerCase() === def.id.toLowerCase())
    if (clash) return { ok: false, error: `ID ${def.id} already exists in ${clash.file}` }
    religions.push({ ...def, file, inMod: true, localizedName: null })
    return { ok: true }
  },
  createFaith: async (_modPath, religionId, def) => {
    const parent = religions.find((r) => r.id.toLowerCase() === religionId.toLowerCase())
    if (!parent || (!parent.inMod && def.format !== '1.20')) {
      return { ok: false, error: `Religion ${religionId} isn't defined in the mod` }
    }
    const clash = [...religions, ...faiths]
      .filter((x) => x.inMod)
      .find((x) => x.id.toLowerCase() === def.id.toLowerCase())
    if (clash) return { ok: false, error: `ID ${def.id} already exists in ${clash.file}` }
    faiths.push({
      ...def,
      file: def.format === '1.20' ? (def.file ?? `${def.id}.txt`) : parent.file,
      inMod: true,
      religion: parent.id,
      color: def.color === null ? null : { hex: def.color, raw: def.color, editable: true },
      localizedName: null
    })
    return { ok: true }
  },
  listRiteFiles: async () => [...new Set(rites.filter((r) => r.inMod).map((r) => r.file))],
  createRite: async (_modPath, file, def) => {
    if (rites.some((r) => r.inMod && r.id.toLowerCase() === def.id.toLowerCase()))
      return { ok: false, error: 'Rite already exists' }
    rites.push({
      ...def,
      file,
      inMod: true,
      localizedName: null,
      color: def.color ? { hex: def.color, raw: def.color, editable: true } : null
    })
    return { ok: true }
  },
  saveRite: async (_modPath, file, id, patch) => {
    const rite = rites.find((r) => r.file === file && r.id === id)
    if (!rite) return { ok: false, error: 'Rite not found' }
    Object.assign(rite, {
      ...patch,
      color: patch.color && rite.color ? { ...rite.color, hex: patch.color } : rite.color
    })
    return { ok: true }
  },
  getTitleData: async () => ({
    titles: structuredClone(titles).map((t) => ({
      ...t,
      hasHistory: (titleHistories.get(t.id.toLowerCase()) ?? []).length > 0
    })),
    governments: named({
      feudal_government: 'Feudal',
      aristocratic_government: 'Aristocratic',
      tribal_government: null
    }),
    successionLaws: named({
      male_only_law: 'Male Only',
      equal_law: 'Equal',
      noble_family_succession_law: null,
      landless_adventurer_succession_law: null
    })
  }),
  getTitle: async (_g, _m, _r, id) =>
    structuredClone(titleDetails.get(id.trim().toLowerCase()) ?? null),
  saveTitle: async (_modPath, file, id, patch) => {
    const detail = titleDetails.get(id.trim().toLowerCase())
    const summary = titles.find((t) => t.id.toLowerCase() === id.trim().toLowerCase())
    if (!detail || !summary || detail.file !== file) {
      return { ok: false, error: `${id} not found in ${file}` }
    }
    Object.assign(detail, {
      capital: patch.capital,
      province: patch.province,
      flags: structuredClone(patch.flags),
      culturalNames: structuredClone(patch.culturalNames),
      color:
        detail.color !== null && patch.color !== null
          ? { ...detail.color, hex: patch.color }
          : detail.color
    })
    summary.color = detail.color?.hex ?? null
    summary.landless = patch.flags.landless
    summary.nobleFamily = patch.flags.noble_family
    summary.province = patch.province
    return { ok: true }
  },
  listTitleFiles: async () =>
    [...new Set(titles.filter((t) => t.inMod).map((t) => t.file))].sort(),
  createTitle: async (_modPath, def) => {
    // Mod-only, like the backend: shadowing a base-game title is legal
    const taken = titles.find(
      (t) => t.inMod && t.id.toLowerCase() === def.id.trim().toLowerCase()
    )
    if (taken) return { ok: false, error: `ID ${def.id} already exists in ${taken.file}` }
    const tier =
      ({ h: 'hegemony', e: 'empire', k: 'kingdom', d: 'duchy', c: 'county', b: 'barony' } as const)[
        def.id.trim()[0]?.toLowerCase() as 'h' | 'e' | 'k' | 'd' | 'c' | 'b'
      ] ?? 'duchy'
    const parent = def.parent?.trim() || null
    if (parent !== null && !titles.some((t) => t.inMod && t.id.toLowerCase() === parent.toLowerCase())) {
      return { ok: false, error: `Title ${parent} isn't defined in the mod` }
    }
    const file = parent === null ? (def.file ?? 'mock_titles.txt') : 'mock_titles.txt'
    titles.push(
      titleSummary({
        id: def.id.trim(),
        tier,
        parent,
        file,
        color: def.color,
        province: def.province,
        landless: def.flags.landless,
        requireLandless: def.flags.require_landless,
        nobleFamily: def.flags.noble_family
      })
    )
    const path: string[] = []
    for (let p = parent; p !== null; ) {
      const up = titles.find((x) => x.id.toLowerCase() === p!.toLowerCase())
      if (!up) break
      path.unshift(up.id)
      p = up.parent
    }
    titleDetails.set(def.id.trim().toLowerCase(), {
      id: def.id.trim(),
      tier,
      file,
      inMod: true,
      dejurePath: path,
      parent,
      children: [],
      color: def.color === null ? null : { hex: def.color, raw: `{ ${def.color} }`, editable: true },
      capital: def.capital,
      province: def.province,
      flags: structuredClone(def.flags),
      culturalNames: [],
      scriptBlocks: []
    })
    if (parent !== null) {
      titleDetails.get(parent.toLowerCase())?.children.push(def.id.trim())
    }
    return { ok: true }
  },
  getTitleHistory: async (_g, _m, _r, titleId) =>
    structuredClone(titleHistories.get(titleId.trim().toLowerCase()) ?? []),
  listTitleHistoryFiles: async () => ['mock_history.txt'],
  saveTitleHistoryEntry: async (_modPath, file, titleId, titleBlock, index, patch) => {
    const entries = titleHistories.get(titleId.trim().toLowerCase()) ?? []
    const at = entries.findIndex(
      (e) => e.file === file && e.titleBlock === titleBlock && e.index === index
    )
    if (at < 0) return { ok: false, error: `History entry not found in ${file}` }
    entries[at] = { ...entries[at], ...structuredClone(patch) }
    return { ok: true }
  },
  addTitleHistoryEntry: async (_modPath, file, titleId, patch) => {
    const key = titleId.trim().toLowerCase()
    const entries = titleHistories.get(key) ?? []
    const inFile = entries.filter((e) => e.file === file)
    const titleBlock = inFile.length > 0 ? Math.max(...inFile.map((e) => e.titleBlock)) : 0
    const index =
      inFile.filter((e) => e.titleBlock === titleBlock).length > 0
        ? Math.max(...inFile.filter((e) => e.titleBlock === titleBlock).map((e) => e.index)) + 1
        : 0
    entries.push(historyEntry({ ...structuredClone(patch), file, titleBlock, index }))
    titleHistories.set(key, entries)
    return { ok: true }
  },
  deleteTitleHistoryEntry: async (_modPath, file, titleId, titleBlock, index) => {
    const entries = titleHistories.get(titleId.trim().toLowerCase()) ?? []
    const at = entries.findIndex(
      (e) => e.file === file && e.titleBlock === titleBlock && e.index === index
    )
    if (at < 0) return { ok: false, error: `History entry not found in ${file}` }
    entries.splice(at, 1)
    // Later entries of the same block shift down, the way a re-scan would see them
    for (const e of entries) {
      if (e.file === file && e.titleBlock === titleBlock && e.index > index) e.index--
    }
    return { ok: true }
  },
  getFaithIcons: async (_g, _m, _r, icons) => Object.fromEntries(icons.map((i) => [i, null])),
  listFaithIcons: async () => ['delos_palm', 'hellenic', 'hellenic_reformed', 'orthodox'],
  getTraitIcons: async (_g, _m, _r, traits) =>
    Object.fromEntries(traits.map((t) => [t, null])),
  // Initial-letter stand-ins for the game's silhouettes: opaque black on
  // transparent like the real .dds files, so the mask tinting is exercised in
  // browser-mode dev. Real icons need Electron (game files + main process).
  getFlatIcons: async (_g, _m, _r, names) =>
    Object.fromEntries(
      names.map((n) => [
        n,
        'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
              '<text x="8" y="13" text-anchor="middle" font-size="14"' +
              ' font-family="sans-serif" fill="#000">' +
              n[0].toUpperCase() +
              '</text></svg>'
          )
      ])
    ),
  getSkillIcons: async (_g, _m, _r, skills) =>
    Object.fromEntries(skills.map((s) => [s, null])),
  // A quartered stand-in so browser-mode dev shows the layout; real rendering
  // needs Electron (game files + main process). Only some ids get one, so the
  // "no coat of arms" placeholder is reachable here too.
  getCoatsOfArms: async (_g, _m, _r, ids) =>
    Object.fromEntries(
      ids.map((id) => [
        id,
        !['mockidae', 'house_Alpha', 'dynn_Mock', 'e_mockia', 'k_hellas', 'd_athens'].includes(id)
          ? null
          : 'data:image/svg+xml,' +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2">' +
                '<rect width="2" height="2" fill="#883333"/>' +
                '<rect width="1" height="1" fill="#ccc2a8"/>' +
                '<rect x="1" y="1" width="1" height="1" fill="#ccc2a8"/></svg>'
            )
      ])
    ),
  // A couple of entries per kind are deliberately name-less, so the bare-id
  // fallback in the reference pickers is reachable in browser-mode dev too.
  getReferenceData: async () => ({
    cultures: named({ greek: 'Greek', norse: 'Norse', saxon: null }),
    faiths: named({ orthodox: 'Orthodoxy', catholic: 'Catholicism', asatru: null }),
    rites: rites.map((r) => ({ id: r.id, name: r.localizedName })),
    traits: named({ brave: 'Brave', ambitious: 'Ambitious', craven: 'Craven', shy: null }),
    dynasties: named({ dynn_Mock: 'Mockidae', dynn_Other: null }),
    houses: named({ house_Mockington: 'Mockington', house_Other: null }),
    dnas: named({ '163112_halfdan_whiteshirt': null, mock_dna: null }),
    relationTypes: named({
      best_friend: null,
      bully: null,
      crush: null,
      friend: null,
      grudge: null,
      guardian: null,
      lover: null,
      mentor: null,
      nemesis: null,
      rival: null,
      soulmate: null,
      student: null,
      victim: null,
      ward: null
    })
  }),
  locateRef: async (_g, _m, _r, kind, id) =>
    id.includes('missing')
      ? null
      : { path: `C:\\Mock\\common\\${kind}\\00_${kind}.txt`, line: 42, inMod: true },
  // No real CK3 files in the browser, so the mock mod ships no fonts
  getModFonts: async () => null,
  validateGameDir: async () => ({ valid: true, reason: null }),
  validateModDir: async () => ({ valid: true, reason: null }),
  detectEditors: async () => [
    { name: 'Notepad', path: 'C:\\Windows\\notepad.exe' },
    { name: 'VS Code', path: 'C:\\Mock\\Code.exe' }
  ],
  openInEditor: async (file, line) => {
    console.info(`[devMock] openInEditor(${file}, ${line})`)
    return { ok: true }
  },
  pickDirectory: async () => null,
  pickEditor: async () => null
}

export function installDevMock(): void {
  window.ck3tools = mock
  console.info('[devMock] window.ck3tools mock installed (browser preview)')
}
