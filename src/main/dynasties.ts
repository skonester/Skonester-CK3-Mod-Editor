import { existsSync, readdirSync, readFileSync } from 'fs'
import { writeModText } from './modWrite'
import { basename, join } from 'path'
import { DATE_KEY } from './characters'
import { makeEditor, setScalar } from '@shared/lineEditor'
import { readLocalization } from './localization'
import { annotateLines, scanBlocks, scanScalarsCI } from '@shared/pdx'
import { effectiveFiles, isUnderDir } from './refdata'
import { appendBlock, isTxtFileName, KEY_CHARS, listTxtFiles } from './scriptFile'
import type { BlockSpan } from '@shared/pdx'
import type {
  DynastyCharacter,
  DynastyData,
  DynastyDef,
  DynastyFiles,
  DynastyPatch,
  HouseDef,
  HousePatch,
  NewDynasty,
  NewHouse,
  SaveResult
} from '@shared/types'

/** Where each kind of definition lives, relative to the mod's content root. */
const DEF_DIR = {
  dynasty: 'common/dynasties',
  house: 'common/dynasty_houses'
} as const

/** Id comparison key: real files reference `Phokus` as `phokus`, `7` as `"7"`. */
function norm(id: string): string {
  return id.trim().toLowerCase()
}

// ---------- Characters ----------

function hasStatementCI(subBody: string, statement: string): boolean {
  const re = new RegExp(`(^|[\\s{])${statement}\\s*=`, 'i')
  for (const { text } of annotateLines(subBody)) {
    if (re.test(text.split('#')[0])) return true
  }
  return false
}

/** Date of the first date block containing a birth/death statement, cleaned of a trailing dot. */
function findDated(body: string, blocks: BlockSpan[], statement: 'birth' | 'death'): string | null {
  const block = blocks.find((b) => hasStatementCI(body.slice(b.bodyStart, b.bodyEnd), statement))
  return block ? block.key.replace(/\.$/, '') : null
}

const SPOUSE =
  /(^|[\s{])(?:add_matrilineal_spouse|add_spouse|add_concubine)\s*=\s*(?:"([^"]*)"|([^\s{}"#=]+))/gi

function collectSpouses(body: string, blocks: BlockSpan[]): string[] {
  const spouses: string[] = []
  for (const block of blocks) {
    for (const line of body.slice(block.bodyStart, block.bodyEnd).split('\n')) {
      for (const m of line.split('#')[0].matchAll(SPOUSE)) {
        const id = m[2] ?? m[3]
        if (!spouses.includes(id)) spouses.push(id)
      }
    }
  }
  return spouses
}

function parseCharacter(body: string, id: string, file: string): DynastyCharacter {
  const scalars = scanScalarsCI(body)
  const dateBlocks = scanBlocks(body).filter((b) => DATE_KEY.test(b.key))
  return {
    id,
    file,
    name: scalars.get('name') ?? null,
    birth: findDated(body, dateBlocks, 'birth'),
    death: findDated(body, dateBlocks, 'death'),
    father: scalars.get('father') ?? null,
    mother: scalars.get('mother') ?? null,
    female: (scalars.get('female') ?? '').toLowerCase() === 'yes',
    dynasty: scalars.get('dynasty') ?? null,
    house: scalars.get('dynasty_house') ?? null,
    spouses: collectSpouses(body, dateBlocks)
  }
}

function listDynastyCharacters(modPath: string): DynastyCharacter[] {
  const dir = join(modPath, 'history', 'characters')
  if (!existsSync(dir)) return []
  const characters: DynastyCharacter[] = []
  for (const entry of readdirSync(dir)) {
    if (!entry.toLowerCase().endsWith('.txt')) continue
    try {
      const text = readFileSync(join(dir, entry), 'utf-8')
      for (const block of scanBlocks(text)) {
        characters.push(parseCharacter(text.slice(block.bodyStart, block.bodyEnd), block.key, entry))
      }
    } catch {
      // skip unreadable files
    }
  }
  return characters
}

// ---------- Definitions ----------

interface RawDef {
  id: string
  file: string
  inMod: boolean
  scalars: Map<string, string>
}

function readDefs(files: string[], modPath: string | null): RawDef[] {
  const defs: RawDef[] = []
  for (const path of files) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    const inMod = isUnderDir(path, modPath)
    for (const block of scanBlocks(text)) {
      defs.push({
        id: block.key,
        file: basename(path),
        inMod,
        scalars: scanScalarsCI(text.slice(block.bodyStart, block.bodyEnd))
      })
    }
  }
  return defs
}

/**
 * Every mod definition, plus game definitions whose id is referenced by mod
 * content. A mod definition beats a game one with the same (normalized) id.
 */
function layer(raw: RawDef[], referenced: Set<string>): RawDef[] {
  const seen = new Set<string>()
  const defs: RawDef[] = []
  for (const def of raw.filter((d) => d.inMod)) {
    if (seen.has(norm(def.id))) continue
    seen.add(norm(def.id))
    defs.push(def)
  }
  for (const def of raw.filter((d) => !d.inMod)) {
    if (seen.has(norm(def.id)) || !referenced.has(norm(def.id))) continue
    seen.add(norm(def.id))
    defs.push(def)
  }
  return defs
}

// ---------- Assembly ----------

export function getDynastyData(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): DynastyData {
  const characters = modPath ? listDynastyCharacters(modPath) : []
  const dynastyRaw = readDefs(
    effectiveFiles(gameDir, modPath, replacePaths, DEF_DIR.dynasty),
    modPath
  )
  const houseRaw = readDefs(effectiveFiles(gameDir, modPath, replacePaths, DEF_DIR.house), modPath)

  // Game definitions are only shown when mod content points at them. Houses
  // layer first so that a game house pulled in by a mod character can in turn
  // pull in its game parent dynasty.
  const referenced = new Set<string>()
  for (const c of characters) {
    if (c.dynasty !== null) referenced.add(norm(c.dynasty))
    if (c.house !== null) referenced.add(norm(c.house))
  }
  const layeredHouses = layer(houseRaw, referenced)
  for (const h of layeredHouses) {
    const parent = h.scalars.get('dynasty')
    if (parent !== undefined) referenced.add(norm(parent))
  }

  const loc = readLocalization(gameDir, modPath, 'dynasties')
  const localized = (name: string | undefined): string | null =>
    name !== undefined ? (loc.get(name) ?? null) : null

  const dynasties: DynastyDef[] = layer(dynastyRaw, referenced).map((d) => ({
    id: d.id,
    file: d.file,
    inMod: d.inMod,
    name: d.scalars.get('name') ?? null,
    prefix: d.scalars.get('prefix') ?? null,
    motto: d.scalars.get('motto') ?? null,
    culture: d.scalars.get('culture') ?? null,
    localizedName: localized(d.scalars.get('name'))
  }))
  const houses: HouseDef[] = layeredHouses.map((d) => ({
    id: d.id,
    file: d.file,
    inMod: d.inMod,
    name: d.scalars.get('name') ?? null,
    prefix: d.scalars.get('prefix') ?? null,
    motto: d.scalars.get('motto') ?? null,
    dynasty: d.scalars.get('dynasty') ?? null,
    localizedName: localized(d.scalars.get('name'))
  }))
  return { dynasties, houses, characters }
}
// ---------- Saving ----------

/** [written key, new value, quote style for a newly inserted line] */
type FieldPatch = [string, string | null, boolean]

/**
 * The written form of each editable field. `name`/`prefix`/`motto` point at
 * localization keys and are quoted the way the game files write them; the
 * `culture`/`dynasty` references are bare ids.
 */
function dynastyFields(patch: DynastyPatch): FieldPatch[] {
  return [
    ['name', patch.name, true],
    ['prefix', patch.prefix, true],
    ['motto', patch.motto, true],
    ['culture', patch.culture, false]
  ]
}

function houseFields(patch: HousePatch): FieldPatch[] {
  return [
    ['name', patch.name, true],
    ['prefix', patch.prefix, true],
    ['motto', patch.motto, true],
    ['dynasty', patch.dynasty, false]
  ]
}

/** Absolute path of one of the mod's definition files. */
function defPath(modPath: string, kind: 'dynasty' | 'house', file: string): string {
  return join(modPath, ...DEF_DIR[kind].split('/'), file)
}

function saveDef(path: string, file: string, id: string, fields: FieldPatch[]): SaveResult {
  try {
    if (!existsSync(path)) return { ok: false, error: `File not found: ${file}` }
    const text = readFileSync(path, 'utf-8')
    const block = scanBlocks(text).find((b) => b.key === id)
    if (!block) return { ok: false, error: `${id} not found in ${file}` }
    const ed = makeEditor(text.slice(block.bodyStart, block.bodyEnd))
    for (const [key, value, quoteNew] of fields) {
      setScalar(ed, [key], value, { quoteNew, ignoreCase: true })
    }
    const updated = text.slice(0, block.bodyStart) + ed.lines.join('\n') + text.slice(block.bodyEnd)
    writeModText(path, updated)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function saveDynasty(
  modPath: string,
  file: string,
  id: string,
  patch: DynastyPatch
): SaveResult {
  return saveDef(defPath(modPath, 'dynasty', file), file, id, dynastyFields(patch))
}

export function saveHouse(modPath: string, file: string, id: string, patch: HousePatch): SaveResult {
  return saveDef(defPath(modPath, 'house', file), file, id, houseFields(patch))
}

// ---------- Creating ----------

/** The mod's own definition files — the targets a new block can be written to. */
export function listDynastyFiles(modPath: string): DynastyFiles {
  return {
    dynasties: listTxtFiles(join(modPath, ...DEF_DIR.dynasty.split('/'))),
    houses: listTxtFiles(join(modPath, ...DEF_DIR.house.split('/')))
  }
}

/**
 * Every id the mod itself defines under `kind`, normalized, mapped to the file
 * it lives in. Only the mod's own files: shadowing a base-game id is a legal
 * way to override it, so that stays the caller's call.
 */
function modDefFiles(modPath: string, kind: 'dynasty' | 'house'): Map<string, string> {
  const ids = new Map<string, string>()
  for (const path of effectiveFiles(null, modPath, [], DEF_DIR[kind])) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      if (!ids.has(norm(block.key))) ids.set(norm(block.key), basename(path))
    }
  }
  return ids
}

/**
 * Append a brand-new definition block to one of the mod's files (created if
 * missing). Existing content is preserved byte-for-byte; the block follows a
 * separating blank line, in the file's own line-ending style.
 */
function createDef(
  modPath: string,
  kind: 'dynasty' | 'house',
  file: string,
  rawId: string,
  fields: FieldPatch[]
): SaveResult {
  try {
    const id = rawId.trim()
    if (!id) return { ok: false, error: 'ID must not be empty' }
    if (!KEY_CHARS.test(id)) {
      return { ok: false, error: `Invalid ID "${id}" (letters, digits, _ . - ' only)` }
    }
    if (!isTxtFileName(file)) {
      return { ok: false, error: `Invalid file name "${file}" (expected a .txt file name)` }
    }
    // Dynasties and houses are separate databases in the game, but the editor
    // resolves an id against both lists, so a cross-kind clash is ambiguous here
    for (const other of ['dynasty', 'house'] as const) {
      const clash = modDefFiles(modPath, other).get(norm(id))
      if (clash === undefined) continue
      return {
        ok: false,
        error:
          other === kind
            ? `ID ${id} already exists in ${clash}`
            : `ID ${id} is already a ${other}, defined in ${clash}`
      }
    }

    const lines = [`${id} = {`]
    for (const [key, value, quoteNew] of fields) {
      if (value === null || value.trim() === '') continue
      lines.push(`\t${key} = ${quoteNew ? `"${value}"` : value}`)
    }
    lines.push('}')
    appendBlock(join(modPath, ...DEF_DIR[kind].split('/')), file, lines)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function createDynasty(modPath: string, file: string, def: NewDynasty): SaveResult {
  if (!def.name?.trim()) return { ok: false, error: 'Name is required' }
  return createDef(modPath, 'dynasty', file, def.id, dynastyFields(def))
}

export function createHouse(modPath: string, file: string, def: NewHouse): SaveResult {
  if (!def.name?.trim()) return { ok: false, error: 'Name is required' }
  // A house with no parent dynasty is rejected by the game itself
  if (!def.dynasty?.trim()) return { ok: false, error: 'Dynasty is required' }
  return createDef(modPath, 'house', file, def.id, houseFields(def))
}
