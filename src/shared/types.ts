import type {
  DefOrigin,
  GraphicsSettings,
  ModListEntry,
  ModTouch
} from '../crusaderpope/shared/api'

export interface AppSettings {
  /** Path to the CK3 `game` data directory (…\Crusader Kings III\game) */
  gameDir: string | null
  /** Path to the user's mod directory (…\Paradox Interactive\Crusader Kings III\mod) */
  modDir: string | null
  /** File name of the selected .mod descriptor within modDir, e.g. "Atlantis.mod" */
  selectedModFile: string | null
  /**
   * Recently visited entries per tool per mod (tool key → .mod file name →
   * most recent first, capped at 10)
   */
  recentEntries: Partial<Record<ToolKey, Record<string, EntryRef[]>>>
  /**
   * Favorited entries per tool per mod (tool key → .mod file name → refs in
   * the order they were starred)
   */
  favoriteEntries: Partial<Record<ToolKey, Record<string, EntryRef[]>>>
  /**
   * Unsaved edits per tool per mod, VS Code-style: everything stays draft
   * until saved or reverted, surviving navigation and app restarts.
   * Keyed tool key → .mod file name → `entryKey` of the row.
   */
  entryDrafts: Partial<Record<ToolKey, Record<string, Record<string, EntryDraft>>>>
  /** Absolute path to the preferred text editor executable; null = system Notepad */
  textEditorPath: string | null
  /** Render the app in the selected mod's own CK3 fonts (see ModFonts) */
  useModFonts: boolean
  /**
   * Build the game index (the game plus the selected mod) in the background,
   * for the References section of every editor. Costs ~10 s and ~3 GB of memory.
   */
  gameIndex: boolean
  /**
   * Quality of the 3D views (portraits, models, the map): a preset with
   * per-value overrides — CrusaderPope's graphics settings. Absent = high.
   */
  graphics?: GraphicsSettings
  /**
   * The mod manager's own settings (CrusaderPope's): the CK3 user folder when
   * not the mod folder's parent, the mod list the game index loads ('none' or
   * absent: just the selected mod), and the lists the app keeps itself.
   */
  modManager?: {
    userDir?: string
    modList?: string
    customModLists?: { id: string; name: string; mods: ModListEntry[] }[]
  }
}

/** The editors that remember favorites, recents and unsaved drafts of their rows. */
export type ToolKey =
  | 'characters'
  | 'dynasties'
  | 'cultures'
  | 'faiths'
  | 'faithHistory'
  | 'rites'
  | 'religions'
  | 'titles'

/**
 * One remembered row of an editor: enough to list it as a chip and to
 * navigate back to it. See `entryKey` in @shared/entries for how one is keyed.
 */
export interface EntryRef {
  id: string
  /** Display name at the time the ref was recorded, as a fallback label */
  name: string | null
  /**
   * The extra coordinate an id needs to name a row on its own: the history
   * file a character is defined in, `dynasty` or `house` for a lineage.
   * Absent for the tools whose ids stand alone.
   */
  scope?: string
}

/**
 * One row's unsaved edits. `draft` and `original` are the editing shape of
 * whichever tool holds them — a store spanning every editor can't name them
 * all, so the hook that reads a tool's drafts is what types them.
 */
export interface EntryDraft<T = unknown> {
  /** The edited, unsaved state */
  draft: T
  /**
   * Parse of the row at the time the draft was last touched, used to detect
   * that the file changed on disk (e.g. in an external editor) while the
   * draft was dormant.
   */
  original: T
  /** How the row reads in the "Unsaved" list, without re-scanning for it */
  ref: EntryRef
}

export interface CharacterDraft {
  /** The edited, unsaved state */
  draft: CharacterDetail
  /**
   * Parse of the character at the time the draft was last touched, used to
   * detect that the file changed on disk (e.g. in an external editor) while
   * the draft was dormant.
   */
  original: CharacterDetail
}

/**
 * An offset-calendar display convention, for total-conversion mods whose file
 * years aren't AD (CK3 can't store negative years). Hegemonia-style reckoning
 * with no year zero: file year 3220 under epochYear 4000 displays as "780 BC",
 * and 4000 displays as "1 AD".
 */
export interface CalendarConfig {
  /** File year that maps to year 1 of the "after" era (e.g. 4000 = 1 AD) */
  epochYear: number
  /** Era label for years before the epoch, e.g. "BC" */
  beforeLabel: string
  /** Era label for the epoch year onward, e.g. "AD" */
  afterLabel: string
}

/**
 * Per-mod display conventions, declared by a `ck3-tools.json` file the mod
 * ships at its content root. Purely declarative — display-only, never affects
 * what gets written to mod files.
 */
export interface ModProfile {
  calendar: CalendarConfig | null
}

/**
 * One font file of a CK3 font, resolved to something the renderer can install
 * as a `@font-face`. CK3 spells a font's variants as `fontstyle` blocks
 * (`regular`, `bold`, `italic`, `bold|italic`); each maps to one CSS
 * weight/style pair.
 */
export interface ModFontFace {
  weight: 'normal' | 'bold'
  style: 'normal' | 'italic'
  /** data: URL carrying the font file itself */
  src: string
  /** CSS `format()` hint for `src`, e.g. "truetype" or "opentype" */
  format: string
}

export interface ModFont {
  /** The `fontfiles` name the font's regular style points at, e.g. "Gitan-Regular" */
  name: string
  /** Resolved faces, at most one per weight/style pair */
  faces: ModFontFace[]
}

/**
 * The fonts a mod effectively loads, read from the `fonts/fonts.font` it
 * ships (falling back to the game's) and resolved against the font files
 * themselves, mod copies winning over game copies. Either font is null when
 * the definition names no file that exists on disk.
 */
export interface ModFonts {
  /** CK3's `StandardGameFont` — the app uses it for body text */
  standard: ModFont | null
  /** CK3's `TitleFont` — the app uses it for headings */
  title: ModFont | null
}

export interface ModInfo {
  /** Descriptor file name within the mod directory, e.g. "Atlantis.mod" — used as the stable id */
  file: string
  name: string
  version: string | null
  supportedVersion: string | null
  tags: string[]
  /** Absolute path to the mod's content folder */
  path: string | null
  replacePaths: string[]
  /** Whether the mod's content folder actually exists on disk */
  pathExists: boolean
  /** Contents of the mod's optional `ck3-tools.json`; null when absent or unreadable */
  profile: ModProfile | null
}

export interface CharacterSummary {
  /** Character id — the top-level key in the history file, e.g. "219" */
  id: string
  name: string | null
  /** Raw dynasty (or dynasty_house) value as written in the file */
  dynasty: string | null
  /** Birth date as written, e.g. "2410.1.1" */
  birth: string | null
  /** Character id of the father, as written in the file */
  father: string | null
  /** Character id of the mother, as written in the file */
  mother: string | null
  /** File name within history/characters, e.g. "HAAO_Attica.txt" */
  file: string
}

export interface CharacterStats {
  diplomacy: number | null
  martial: number | null
  stewardship: number | null
  intrigue: number | null
  learning: number | null
  prowess: number | null
}

/**
 * A marriage or concubinage recorded on a character, as the dated
 * `add_spouse` / `remove_spouse` (or `add_concubine` / `remove_concubine`)
 * effects that express it in the history file. `matrilineal` selects
 * `add_matrilineal_spouse`; a null `divorce` means the union is never
 * dissolved, and a null `marriage` a lone remove with no matching add (real
 * files carry these). `concubine` selects the concubine effect pair — the
 * game's one secondary-union mechanism ("consort" under Islam is the same
 * effect with different localization); it has no matrilineal variant.
 */
export interface CharacterSpouse {
  /** Spouse character id, as written in the file */
  id: string
  /** Date of the add_spouse/add_concubine effect, e.g. "1070.3.4" */
  marriage: string | null
  /** Date of the remove_spouse/remove_concubine effect; null while the union stands */
  divorce: string | null
  matrilineal: boolean
  concubine: boolean
}

/**
 * A scripted relation (lover, rival, friend, …) recorded on a character as a
 * dated `set_relation_<type>` effect. The file writes it either as a scalar
 * (`set_relation_rival = character:73815`) or as a block carrying a reason
 * (`set_relation_rival = { target = character:73818 reason = rival_historical }`).
 */
export interface CharacterRelation {
  /** Relation type without the set_relation_ prefix, e.g. "rival" */
  type: string
  /** Target character id, without the character: prefix when it had one */
  target: string
  /** Whether the file spelled the target with the character: prefix */
  prefixed: boolean
  /** Date of the containing date block */
  date: string
  /** reason = value from block form; null for scalar form */
  reason: string | null
  /**
   * Unrecognized inner lines of a block-form relation, verbatim; null if
   * none. Not editable, but re-emitted if the row has to be rewritten so
   * nothing the file carried is lost.
   */
  extra: string | null
}

export interface CharacterDetail {
  id: string
  file: string
  name: string | null
  /**
   * Raw `dynasty =` value. Distinct from `house`: a character joins a lineage
   * through either key, and a house already implies its parent dynasty, so
   * most characters carry one or the other rather than both.
   */
  dynasty: string | null
  /** Raw `dynasty_house =` value */
  house: string | null
  birth: string | null
  death: string | null
  culture: string | null
  /** Faith key; `religion =` is a legacy alias for this field */
  faith: string | null
  /** CK3 1.20 rite key, independent of the faith's main-rite fallback */
  rite?: string | null
  /** Character id of the father, as written in the file */
  father: string | null
  /** Character id of the mother, as written in the file */
  mother: string | null
  traits: string[]
  /** Marriages, in the order their effects appear in the file */
  spouses: CharacterSpouse[]
  /** Scripted relations, in the order their effects appear in the file */
  relations: CharacterRelation[]
  stats: CharacterStats
  /**
   * Raw `female =` value ("yes"/"no"; absent means male). Kept raw so an
   * explicit `female = no` in a file round-trips untouched.
   */
  female: string | null
  /** Raw `sexuality =` value (e.g. "heterosexual", "homosexual", "bisexual", "asexual"); null if unset */
  sexuality: string | null
  /** Raw `dna =` value: a key defined in common/dna_data; null if unset */
  dna: string | null
  /**
   * Everything else in the mod that shapes this character: the parts of their
   * own history record the fields above don't cover, script that runs on
   * them (`character:<id> = { … }` in scripted effects, on_actions, events)
   * and statements elsewhere that name them. Saved alongside the fields.
   * Absent from drafts older than the script view.
   */
  scripts?: ScriptSite[]
}

/** Entity kinds a script addresses as `<kind>:<id>` */
export type ScriptScopeKind = 'character' | 'title' | 'faith' | 'culture' | 'dynasty' | 'house'

/** One step of the way the game reaches a script site */
export interface ScriptHop {
  /** The on_action, scripted effect, event id, decision… */
  name: string
  kind:
    | 'on_action'
    | 'scripted_effect'
    | 'scripted_trigger'
    | 'event'
    | 'decision'
    | 'history'
    | 'bookmark'
    | 'other'
  /** The hop's own `trigger = { … }` gate (on_actions, events), compacted to one line */
  condition: string | null
}

/**
 * One statement in the mod's script that touches an entity, editable in place.
 * `text` is the whole statement as on disk — `character:205523 = { … }`,
 * `holder = 205523`, `tfc_set_liege_effect = { VASSAL = 145017 LIEGE = 205523 }`
 * — and replacing it (or emptying it, to delete) splices just that span.
 */
export interface ScriptSite {
  /** Unique within one read: file plus offset */
  id: string
  /** Path relative to the mod root, forward slashes */
  file: string
  /** 1-based line the statement starts on */
  line: number
  /** Keys of the enclosing blocks, outermost first, ending with the statement's own key */
  path: string[]
  /**
   * own: part of the entity's own record the form fields don't cover.
   * scope: a `<kind>:<id> = { … }` block — script run on (or tested against) the entity.
   * reference: a statement elsewhere that names the entity.
   */
  role: 'own' | 'scope' | 'reference'
  /** Whether the statement runs effects or sits in a condition */
  context: 'effect' | 'trigger'
  /** What the statement means for the entity, in a few words */
  summary: string
  /** Each way the game reaches this statement, entry point first */
  reachedFrom: ScriptHop[][]
  /** `limit`s of the `if`s the statement sits in, compacted to one line each */
  conditions: string[]
  /** Which of several identical statements under the same path this is */
  occurrence: number
  /** The statement exactly as read; the save finds it again by this */
  diskText: string
  /** The statement as edited; empty deletes it */
  text: string
}

/**
 * A dynasty definition block from `common/dynasties`. Field values are raw —
 * `name`/`prefix`/`motto` are usually `dynn_*` localization keys, with
 * `localizedName` resolved from localization files for display only.
 */
export interface DynastyDef {
  id: string
  /** File name within common/dynasties */
  file: string
  /** Whether the definition lives in the mod (editable) vs. the base game */
  inMod: boolean
  name: string | null
  prefix: string | null
  motto: string | null
  culture: string | null
  localizedName: string | null
}

/** A house definition block from `common/dynasty_houses`. */
export interface HouseDef {
  id: string
  /** File name within common/dynasty_houses */
  file: string
  inMod: boolean
  name: string | null
  prefix: string | null
  motto: string | null
  /** Parent dynasty id as written (numeric or string; may not resolve) */
  dynasty: string | null
  localizedName: string | null
}

/**
 * A character as needed for dynasty membership and family trees. Unlike
 * CharacterDetail this keeps `dynasty` and `dynasty_house` separate — a
 * character with only a dynasty behaves as if that dynasty were their house.
 */
export interface DynastyCharacter {
  id: string
  /** File name within history/characters */
  file: string
  name: string | null
  birth: string | null
  death: string | null
  father: string | null
  mother: string | null
  female: boolean
  /** Raw `dynasty =` value, if present */
  dynasty: string | null
  /** Raw `dynasty_house =` value, if present */
  house: string | null
  /** Partner ids from dated add_spouse/add_matrilineal_spouse/add_concubine lines */
  spouses: string[]
}

export interface DynastyData {
  /** Mod definitions, plus game definitions referenced by mod content */
  dynasties: DynastyDef[]
  houses: HouseDef[]
  /** Every character in the mod's history (ghost parents may be dynasty-less) */
  characters: DynastyCharacter[]
}

/** Editable dynasty fields; null clears the line */
export interface DynastyPatch {
  name: string | null
  prefix: string | null
  motto: string | null
  culture: string | null
}

/** Editable house fields; null clears the line */
export interface HousePatch {
  name: string | null
  prefix: string | null
  motto: string | null
  dynasty: string | null
}

/**
 * How a culture's `color =` line is written, so an edit can be written back
 * the same way the file already reads. CK3 spells the same color five ways:
 * a named color from `common/named_colors`, an `rgb { 0-255 }` triple, `hsv`
 * (0-1) or `hsv360` (h 0-360, s/v 0-100), or a bare brace triple that is 0-255
 * when every component is an integer and 0-1 otherwise.
 */
export type CultureColorFormat = 'named' | 'rgb' | 'hsv' | 'hsv360' | 'int' | 'float'

export interface CultureColor {
  format: CultureColorFormat
  /** The value exactly as written, e.g. "italian" or "rgb { 128 149 72 }" */
  raw: string
  /** Resolved sRGB hex ("#809548"); null when a named color resolves nowhere */
  hex: string | null
}

/** One `<weight> = <ethnicity>` line of a culture's `ethnicities` block. */
export interface CultureEthnicity {
  /** Relative weight, as written (real files use whole numbers) */
  weight: string
  id: string
}

/**
 * A culture definition block from `common/culture/cultures`. Unlike dynasties,
 * cultures carry no `name` scalar — their display name is the localization of
 * the id itself, so `localizedName` is read-only here.
 */
export interface CultureDef {
  id: string
  /** File name within common/culture/cultures */
  file: string
  /** Whether the definition lives in the mod (editable) vs. the base game */
  inMod: boolean
  localizedName: string | null
  color: CultureColor | null
  ethos: string | null
  heritage: string | null
  language: string | null
  martialCustom: string | null
  headDetermination: string | null
  traditions: string[]
  nameList: string | null
  /** Cultures this one descends from, as written */
  parents: string[]
  /** Raw `created =` date, e.g. "476.11.4" */
  created: string | null
  coaGfx: string[]
  buildingGfx: string[]
  clothingGfx: string[]
  unitGfx: string[]
  houseCoaFrame: string | null
  ethnicities: CultureEthnicity[]
}

/** The five `type =` values a `common/culture/pillars` definition can carry. */
export type CulturePillarType =
  | 'ethos'
  | 'heritage'
  | 'language'
  | 'martial_custom'
  | 'head_determination'

/** A tradition, with the `category =` its definition declares (for grouping). */
export interface CultureTraditionEntry extends RefEntry {
  category: string | null
}

/**
 * A character as needed for a culture's member list. Only the mod's own
 * history is scanned — game characters aren't editable and would swamp it.
 */
export interface CultureCharacter {
  id: string
  /** File name within history/characters */
  file: string
  name: string | null
  birth: string | null
  death: string | null
  /** Raw `culture =` value, if present */
  culture: string | null
}

export interface CultureData {
  /** Every culture the mod effectively loads, mod definitions first */
  cultures: CultureDef[]
  /** Pillar options, keyed by the `type =` their definition declares */
  pillars: Record<CulturePillarType, RefEntry[]>
  traditions: CultureTraditionEntry[]
  /** Ids from `common/culture/name_lists` */
  nameLists: RefEntry[]
  /** Ids from `common/ethnicities` */
  ethnicities: RefEntry[]
  /**
   * Graphics-bundle ids, gathered from the values the effective culture files
   * actually use — these have no single definition folder to enumerate.
   */
  gfx: {
    coa: string[]
    building: string[]
    clothing: string[]
    unit: string[]
    houseCoaFrame: string[]
  }
  characters: CultureCharacter[]
}

/**
 * Editable culture fields. A null scalar clears its line, an empty list drops
 * the whole block, and `color` is a hex string written back in the format the
 * file already used (a named color becomes `rgb { … }`); a brand-new block has
 * no existing spelling to keep, so it writes `rgb { … }` too.
 */
export interface CulturePatch {
  color: string | null
  ethos: string | null
  heritage: string | null
  language: string | null
  martialCustom: string | null
  headDetermination: string | null
  traditions: string[]
  nameList: string | null
  parents: string[]
  created: string | null
  coaGfx: string[]
  buildingGfx: string[]
  clothingGfx: string[]
  unitGfx: string[]
  houseCoaFrame: string | null
  ethnicities: CultureEthnicity[]
}

/**
 * A faith's `color = …` value. CK3 writes it several ways — a `{ r g b }`
 * triple in either 0–1 floats or 0–255 integers, an `hsv`/`hsv360` triple, or
 * the name of a swatch from `common/named_colors` — and the editor only rewrites
 * the plain triples. Everything else is shown, with its swatch, and left alone.
 */
export interface FaithColor {
  /** Resolved swatch as "#rrggbb"; null when the value couldn't be resolved */
  hex: string | null
  /** The value exactly as the file wrote it, for the forms we don't rewrite */
  raw: string
  /** Whether saving can rewrite this value */
  editable: boolean
}

/**
 * A standalone CK3 1.20 faith or a legacy faith nested in a religion's faiths block.
 */
export interface FaithDef {
  options?: FaithOptions
  id: string
  /** File name within faith_types (1.20) or religion_types (legacy) */
  file: string
  /** Whether the definition lives in the mod (editable) vs. the base game */
  inMod: boolean
  /** Parent religion id, from faith_details in 1.20 or the containing legacy block */
  religion: string
  /** Absent in older mocks and stored data; the parser always supplies it */
  format?: ReligionFormat
  mainRite?: string | null
  tenets?: string[]
  eminentHolySites?: string[]
  color: FaithColor | null
  /** `icon =` value: a file name (sans .dds) under gfx/interface/icons/faith */
  icon: string | null
  reformedIcon: string | null
  /** `religious_head =` landed title id, e.g. "d_karaism" */
  religiousHead: string | null
  /**
   * Values of doctrines = { ... } in 1.20, or repeated doctrine scalars in
   * legacy files (where tenets are included). Duplicates are kept as written.
   */
  doctrines: string[]
  /** Ordinary holy_sites block (1.20) or repeated holy_site scalars (legacy) */
  holySites: string[]
  /** Display name from localization (faiths localize under their own id) */
  localizedName: string | null
}

/** A religion definition: a top-level block in common/religion/religion_types. */
export interface ReligionDef {
  options?: ReligionOptions
  id: string
  file: string
  inMod: boolean
  format?: ReligionFormat
  /** `family =` value, an id from common/religion/religion_family_types */
  family: string | null
  graphicalFaith: string | null
  pietyIconGroup: string | null
  /** Doctrines every faith of the religion inherits unless it overrides them */
  doctrines: string[]
  localizedName: string | null
}

/**
 * A doctrine group from `common/religion/doctrine_group_types`: the set of
 * mutually exclusive doctrines a faith picks from. `picks` is how many of them
 * a faith may hold at once — one for most groups, three for core tenets.
 */
export interface DoctrineGroup {
  id: string
  /** `category =` value: "main_group", "marriage", "crimes", "clergy", "core_tenets", … */
  category: string | null
  /** `number_of_picks`; 1 when the group doesn't say */
  picks: number
  /** The group's doctrines, in file order, with display names */
  doctrines: RefEntry[]
  name: string | null
}

/** A character in the mod's history that professes a faith. */
export interface FaithAdherent {
  id: string
  /** File name within history/characters */
  file: string
  name: string | null
  /** Faith resolved from the character's rite, or its faith/religion fallback */
  faith: string
  /** Raw rite key, resolved to its parent faith for the faith member lists */
  rite?: string | null
}

export type ReligionFormat = 'legacy' | '1.20'

/** A scripted rite from common/religion/rite_types. */
export interface RiteDef {
  options?: RiteOptions
  /** Dynamic name/description blocks remain script rather than localization keys. */
  dynamicName?: boolean
  dynamicDescription?: boolean
  id: string
  file: string
  inMod: boolean
  localizedName: string | null
  faith: string | null
  color: FaithColor | null
  icon: string | null
  founder: string | null
  create: string | null
  convert: string | null
  doctrines: string[]
  tenets: string[]
}

export interface RitePatch {
  options?: RiteOptions
  faith: string | null
  color: string | null
  icon: string | null
  founder: string | null
  create: string | null
  convert: string | null
  doctrines: string[]
  tenets: string[]
}

export interface NewRite extends RitePatch {
  id: string
}

export interface ReligionData {
  religions: ReligionDef[]
  faiths: FaithDef[]
  format?: ReligionFormat
  rites?: RiteDef[]
  tenets?: RefEntry[]
  /** Doctrine groups, mod definitions layered over the game's */
  groups: DoctrineGroup[]
  /** Doctrines that belong to no scanned group, so nothing is hidden from view */
  ungroupedDoctrines: RefEntry[]
  holySites: RefEntry[]
  families: RefEntry[]
  adherents: FaithAdherent[]
}

/** Editable faith fields; null clears the line, [] clears every repeat */
export interface FaithPatch {
  options?: FaithOptions
  format?: ReligionFormat
  mainRite?: string | null
  tenets?: string[]
  eminentHolySites?: string[]
  /** "#rrggbb"; ignored when the file's colour isn't a rewritable triple */
  color: string | null
  icon: string | null
  reformedIcon: string | null
  religiousHead: string | null
  doctrines: string[]
  holySites: string[]
}

/** Editable religion fields; null clears the line */
export interface ReligionPatch {
  options?: ReligionOptions
  family: string | null
  graphicalFaith: string | null
  pietyIconGroup: string | null
  doctrines: string[]
}

/** Optional fields let older drafts/API clients leave newly supported settings untouched. */
export interface FaithOptions {
  headOfRite?: string | null
  graphicalFaith?: string | null
  theocracyGovernmentType?: string | null
  origin?: string | null
  historical?: string | null
  cultures?: string[]
  reservedMaleNames?: string[]
  reservedFemaleNames?: string[]
}

export interface ReligionOptions {
  tenetBackgroundIcon?: string | null
  theocracyGovernmentType?: string | null
  mainHolySite?: string | null
  paganRoots?: string | null
  eminentHolySitesMin?: string | null
  eminentHolySitesMax?: string | null
  holySitesMin?: string | null
  holySitesMax?: string | null
  reservedMaleNames?: string[]
  reservedFemaleNames?: string[]
  customFaithIcons?: string[]
  /** Exact inner script, supporting bare traits, multipliers and scale/weight blocks. */
  traitsScript?: string | null
}

export interface RiteOptions {
  nameKey?: string | null
  descriptionKey?: string | null
  cultures?: string[]
}

export interface FaithHistoryFields {
  created: string | null
  mainRite: string | null
  religiousHead: string | null
  known: string[]
  permitted: string[]
  prohibited: string[]
}

export interface FaithHistoryEntry extends FaithHistoryFields {
  file: string
  inMod: boolean
  faithBlock: number
  index: number
  date: string
  /** Exact dated block body, including comments and unknown scripted settings. */
  script: string
  /** Includes both the modern rites = { id = {} } and repeated rite = {} syntax. */
  rites: string[]
}

export interface FaithHistoryPatch {
  date: string
  script: string
}

export interface FaithHistoryPreview {
  script: string
  fields: FaithHistoryFields
  error: string | null
}

/** Address plus expected bytes prevents a changed file from redirecting an edit. */
export interface FaithHistoryTarget {
  file: string
  faithBlock: number
  index: number
  date: string
  script: string
}

/**
 * A brand-new religion definition: an id for the top-level block plus the
 * same editable fields a patch carries. `family` is mandatory (the game
 * requires one); null or blank fields are simply not written. The block is
 * created with religion_details in 1.20, or an empty faiths block in legacy format.
 */
export interface NewReligion extends ReligionPatch {
  /** Top-level key of the new block, e.g. "hellenism_religion" */
  id: string
  format?: ReligionFormat
}

/**
 * A new standalone 1.20 faith, or a legacy faith nested into a mod religion.
 * Standalone faiths may use a base-game religion without editing that religion.
 */
export interface NewFaith extends FaithPatch {
  id: string
  /** Target file for a standalone 1.20 definition; defaults to <id>.txt */
  file?: string
}

/**
 * A brand-new dynasty definition: an id for the block plus the same editable
 * fields a patch carries. Null (or blank) fields are simply not written.
 */
export interface NewDynasty extends DynastyPatch {
  /** Top-level key of the new block, e.g. "dynn_Komnenos" or "25061" */
  id: string
}

/**
 * A brand-new culture definition: an id for the block plus the same editable
 * fields a patch carries. Null (or blank) scalars and empty lists are simply
 * not written.
 */
export interface NewCulture extends CulturePatch {
  /** Top-level key of the new block, e.g. "attic" */
  id: string
}

/** A brand-new house definition; `dynasty` (the parent) is mandatory. */
export interface NewHouse extends HousePatch {
  id: string
}

/** The .txt files a new dynasty or house definition can be written to. */
export interface DynastyFiles {
  /** File names within common/dynasties */
  dynasties: string[]
  /** File names within common/dynasty_houses */
  houses: string[]
}

// ---------- Landed titles ----------

/** Tier of a landed title, read off its id prefix (h_ e_ k_ d_ c_ b_). */
export type TitleTier = 'hegemony' | 'empire' | 'kingdom' | 'duchy' | 'county' | 'barony'

/**
 * The yes/no flag keys a landed title block can carry. Values are kept raw
 * ("yes"/"no" as written; null when the key is absent) so an untouched save
 * round-trips byte-for-byte — the game treats absence as each flag's default.
 *
 * A runtime list in a types file is unusual here, but the key set is needed by
 * the parser, the writer, the form and the dev mock alike — one source of truth.
 */
export const TITLE_FLAG_KEYS = [
  'definite_form',
  'ruler_uses_title_name',
  'landless',
  'require_landless',
  'no_automatic_claims',
  'always_follows_primary_heir',
  'destroy_if_invalid_heir',
  'destroy_on_succession',
  'delete_on_destroy',
  'delete_on_gain_same_tier',
  'noble_family',
  'can_be_named_after_dynasty',
  'can_use_nomadic_naming',
  'de_jure_drift_disabled',
  'allow_domicile',
  'figurehead',
  'disable_regnal_numbers',
  'ignore_titularity_for_title_weighting'
] as const

export type TitleFlagKey = (typeof TITLE_FLAG_KEYS)[number]

/** Raw flag values by key; null = the key is absent from the block. */
export type TitleFlags = Record<TitleFlagKey, string | null>

/**
 * One title of the de jure tree. Landed titles nest to arbitrary depth
 * (hegemony > empire > kingdom > duchy > county > barony, tiers skippable), so
 * the whole database is a forest reconstructed from `parent` pointers.
 */
export interface TitleSummary {
  id: string
  tier: TitleTier
  /** Id of the enclosing title block (the de jure liege); null at top level */
  parent: string | null
  /** File name within common/landed_titles */
  file: string
  inMod: boolean
  localizedName: string | null
  /** Resolved map-color swatch as "#rrggbb"; null when unresolvable/absent */
  color: string | null
  /** Raw `landless =` value */
  landless: string | null
  /** Raw `require_landless =` value — what marks a landless-adventurer title */
  requireLandless: string | null
  /** Raw `noble_family =` value */
  nobleFamily: string | null
  /** Raw `province =` value (baronies) */
  province: string | null
  /**
   * Whether any effective history file records at least one dated entry for
   * the title (an empty placeholder block doesn't count).
   */
  hasHistory: boolean
}

/** One `<key> = <loc_key>` line of a title's `cultural_names` block. */
export interface TitleCulturalName {
  /** Usually a name-list id (`name_list_norse`), but real mods use bare words too */
  key: string
  /** Localization key of the cultural name */
  value: string
}

/** Full parse of one title block. Display names come from the TitleSummary. */
export interface TitleDetail {
  id: string
  tier: TitleTier
  /** File name within common/landed_titles */
  file: string
  inMod: boolean
  /** De jure ancestor ids, outermost first; [] at top level */
  dejurePath: string[]
  parent: string | null
  /** Child title ids, in file order */
  children: string[]
  color: FaithColor | null
  /** `capital =` county id, as written */
  capital: string | null
  /** Raw `province =` value (baronies) */
  province: string | null
  flags: TitleFlags
  culturalNames: TitleCulturalName[]
  /**
   * Keys of block-valued properties the editor leaves untouched (can_create,
   * ai_primary_priority, …), for display only.
   */
  scriptBlocks: string[]
}

/**
 * Editable title fields; null clears a scalar, [] drops the cultural_names
 * block. `color` is "#rrggbb", rewritten only when the file's form is a plain
 * triple. Flags write `yes`/`no` as given and null removes the line.
 */
export interface TitlePatch {
  color: string | null
  capital: string | null
  province: string | null
  flags: TitleFlags
  culturalNames: TitleCulturalName[]
}

/**
 * A brand-new landed title. With a `parent` it nests into that title's block
 * (the parent must be mod-defined), becoming de jure part of it; without one
 * it is appended to `file` as a top-level block.
 */
export interface NewTitle {
  /** Tier-prefixed id, e.g. "d_athens" — the prefix decides the tier */
  id: string
  parent: string | null
  /** Target file within common/landed_titles; required when parent is null */
  file: string | null
  /** "#rrggbb"; written as a `{ r g b }` triple */
  color: string | null
  capital: string | null
  province: string | null
  flags: TitleFlags
}

export interface TitleData {
  /** Every title the mod effectively loads, mod definitions first, file order kept */
  titles: TitleSummary[]
  /** Government ids from common/governments */
  governments: RefEntry[]
  /** Law ids from common/laws groups (open vocabulary — history files carry typos) */
  successionLaws: RefEntry[]
}

/**
 * The editable fields of one dated block of a title's history. Values are raw
 * strings as written (holder ids may be words, `0` means vacant; dates carry
 * tolerated typos). `successionLaws` is null when the block has no
 * succession_laws at all, [] when it is present but empty.
 */
export interface TitleHistoryEntryPatch {
  /** The block's date key, exactly as written */
  date: string
  holder: string | null
  liege: string | null
  deJureLiege: string | null
  government: string | null
  changeDevelopmentLevel: string | null
  developmentLevel: string | null
  name: string | null
  resetName: string | null
  insertTitleHistory: string | null
  removeSuccessionLaws: string | null
  holderIgnoreHeadOfFaithRequirement: string | null
  successionLaws: string[] | null
}

/**
 * One dated block of a title's history. A title's entries can be spread over
 * several blocks in one file and over several files (vanilla does both), so an
 * entry is addressed by (file, titleBlock, index) — the ordinals of its title
 * block within the file and of the dated block within that title block.
 */
export interface TitleHistoryEntry extends TitleHistoryEntryPatch {
  /** File name within history/titles */
  file: string
  inMod: boolean
  /** Ordinal of the containing title block among the file's blocks for this title */
  titleBlock: number
  /** Ordinal of this dated block among the title block's dated blocks */
  index: number
  /** Keys of opaque block values (effect, tributary_of, …), preserved untouched */
  opaqueBlocks: string[]
  /** Unrecognized scalar statements, verbatim, display-only */
  extra: string[]
}

/**
 * A reference id paired with its display name. `name` is the localized name
 * when one could be resolved (cultures/faiths key off the id, traits off
 * `trait_<id>`, dynasties/houses off their `name` scalar), and null for
 * references that have none — an unlocalized id, or a kind with no names at
 * all (history files, character ids).
 */
export interface RefEntry {
  id: string
  name: string | null
}

export interface ReferenceData {
  cultures: RefEntry[]
  faiths: RefEntry[]
  rites?: RefEntry[]
  traits: RefEntry[]
  /** Ids from `common/lifestyle_perks` */
  perks?: RefEntry[]
  /** Ids from `common/dynasties` */
  dynasties: RefEntry[]
  /** Ids from `common/dynasty_houses` */
  houses: RefEntry[]
  /** Ids from `common/dna_data` (no display names — DNAs aren't localized) */
  dnas: RefEntry[]
  /**
   * Top-level keys of `common/scripted_relations` (no display names — ids
   * like "best_friend" are readable as-is)
   */
  relationTypes: RefEntry[]
}

/** Kinds of reference data whose definition site can be located on disk */
export type RefKind =
  | 'culture'
  | 'faith'
  | 'rite'
  | 'tenet'
  | 'trait'
  | 'dynasty'
  | 'dna'
  | 'pillar'
  | 'tradition'
  | 'name_list'
  | 'ethnicity'
  | 'religion'
  | 'doctrine'
  | 'holy_site'
  | 'title'
  | 'government'

export interface RefLocation {
  /** Absolute path of the file containing the definition */
  path: string
  /** 1-based line of the definition */
  line: number
  /** Whether the definition comes from the mod (vs. the base game) */
  inMod: boolean
}

export interface EditorInfo {
  name: string
  /** Absolute path to the editor executable */
  path: string
}

export type SaveResult = { ok: true } | { ok: false; error: string }

/**
 * What the "Paste from Ruler Designer" dialog needs to offer its file pickers.
 * A locked file means the mod already carries the character's DNA definition
 * (or a portrait modifier for the character) there, so the paste must land in
 * that same file rather than scatter duplicates.
 */
export interface DnaPasteInfo {
  /** DNA key the paste will define: the character's existing `dna =` value, or `<id>_dna` */
  dnaKey: string
  /** .txt files under the mod's common/dna_data */
  dnaFiles: string[]
  /** .txt files under the mod's gfx/portraits/portrait_modifiers */
  modifierFiles: string[]
  /** Mod file already defining the DNA key; locks the DNA file picker */
  lockedDnaFile: string | null
  /** Mod file already carrying a portrait modifier for this character; locks that picker */
  lockedModifierFile: string | null
}

export interface DetectionResult {
  gameDir: string | null
  modDir: string | null
}

export interface DirValidation {
  valid: boolean
  reason: string | null
}

// ---------------------------------------------------------------------------
// Game index — CrusaderPope's cross-reference index (src/crusaderpope), built
// over the game plus the selected mod in a worker thread (main/gameIndex.ts)
// ---------------------------------------------------------------------------

export type {
  DefOrigin,
  GraphicsSettings,
  IndexStatus,
  ModTouch,
  UndoResult,
  ModList,
  ModListEntry,
  ModsState,
  NewModRequest,
  ModInfo as LoadOrderMod
} from '../crusaderpope/shared/api'

/** What writing a mod list back did (CrusaderPope's WriteListResult) */
export interface WriteListResult {
  /** the copy of the file taken first */
  backup?: string
  /** launcher: local mods the app registered in the launcher to put them into the playset */
  registered?: string[]
  /** launcher: nothing written — whether the launcher runs couldn't be checked; the reason */
  unchecked?: string
}

/** One undoable change of the selected mod (CrusaderPope's undo journal) */
export interface UndoStep {
  id: number
  label: string
  kind: string
  /** ms since 1970 */
  at: number
}

/**
 * The index's type ids for the entities the editors edit. Any other index type
 * (events, decisions, scripted effects, …) can appear among their references.
 */
export type IndexType =
  | 'characters'
  | 'dynasties'
  | 'dynasty_houses'
  | 'culture/cultures'
  | 'faith'
  | 'religion/religion_types'
  | 'religion/rite_types'
  | 'landed_titles'

/** A place in a file: game-relative path, the file the game loads for it, 1-based line */
export interface IndexSite {
  /** Game-relative path, e.g. "events/decision_events/malta_events.txt" */
  file: string
  /** Absolute path of the loaded file; null when it can't be opened (inside a zip) */
  path: string | null
  line: number
}

/** Where an entry's winning definition lives */
export interface IndexDef extends IndexSite {
  /** The definition is in the selected mod (so the mod's editors can open it) */
  inMod: boolean
}

/** One entry referencing, or referenced by, the entry asked about */
export interface IndexRefItem {
  type: string
  name: string
  display?: string
  /** Script key paths the reference sits under, e.g. "option › if › title:k_malte.holder" */
  contexts: string[]
  sites: IndexSite[]
  count: number
  /** The entry's own winning definition, when it has one (flags and localization keys don't) */
  def?: IndexDef
  mod?: ModTouch
}

export interface IndexRefGroup {
  type: string
  typeLabel: string
  /** Items in the full group; `items` may hold fewer (see the `limit` of getReferences) */
  total: number
  items: IndexRefItem[]
}

/** What the index knows about one entry: where it's defined and what links to and from it */
export interface EntityReferences {
  type: string
  typeLabel: string
  name: string
  display?: string
  /** How the selected mod touches the entry; absent when it's the game's, untouched */
  mod?: ModTouch
  /** Every definition, the winning one last, with where it comes from */
  defs: (IndexSite & { origin?: DefOrigin; overridden?: boolean })[]
  /** Entries that reference this one ("Used by") */
  incoming: IndexRefGroup[]
  /** Entries this one references ("Uses") */
  outgoing: IndexRefGroup[]
}
