import { existsSync, readdirSync, readFileSync } from 'fs'
import { writeModText } from './modWrite'
import { basename, join } from 'path'
import { DATE_KEY } from './characters'
import {
  makeEditor,
  refresh,
  setBlockBody,
  setBlockList,
  setScalar,
  splitComment
} from '@shared/lineEditor'
import { readLocalization, resolveLocReferences } from './localization'
import { appendBlock, isTxtFileName, KEY_CHARS, listTxtFiles } from './scriptFile'
import { annotateLines, scanBlocks, scanScalarsCI } from '@shared/pdx'
import { effectiveFiles, isUnderDir } from './refdata'
import type { LineEditor } from '@shared/lineEditor'
import type {
  CultureCharacter,
  CultureColor,
  CultureColorFormat,
  CultureData,
  CultureDef,
  CultureEthnicity,
  CulturePatch,
  CulturePillarType,
  CultureTraditionEntry,
  NewCulture,
  RefEntry,
  SaveResult
} from '@shared/types'

/** Id comparison key: real files reference `Attic` as `attic`. */
export const normId = (id: string): string => id.trim().toLowerCase()

const CULTURE_DIR = 'common/culture/cultures'

// ---------- Colors ----------

/**
 * A `color = …` statement. The value is either a brace triple (optionally
 * tagged `rgb`/`hsv`/`hsv360`) or a named color from `common/named_colors`.
 * Braces are matched within the line: every color in the game and in real mods
 * is written on one line, and a multi-line one simply reads as unset.
 */
const COLOR_RE = /(^|[\s{}])color\s*=\s*(?:(rgb|hsv360|hsv)\s*)?(\{[^}]*\}|[A-Za-z0-9_.\-']+)/i

/** The same shape as COLOR_RE's value half, for the `name = value` lines of a named-color file. */
const NAMED_COLOR_RE = /([A-Za-z0-9_.\-']+)\s*=\s*(?:(rgb|hsv360|hsv)\s*)?(\{[^}]*\}|[A-Za-z0-9_.\-']+)/g

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

const toHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('')

/** HSV with every component in 0-1 → sRGB 0-255. */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const wrapped = (((h % 1) + 1) % 1) * 6
  const i = Math.floor(wrapped)
  const f = wrapped - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q]
  ][i % 6]
  return [r * 255, g * 255, b * 255]
}

/** sRGB 0-255 → HSV with every component in 0-1. */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    else if (max === gn) h = ((bn - rn) / d + 2) / 6
    else h = ((rn - gn) / d + 4) / 6
  }
  return [h, max === 0 ? 0 : d / max, max]
}

const numbersIn = (braced: string): number[] =>
  (braced.match(/-?\d*\.?\d+/g) ?? []).map(Number)

/**
 * Resolve a parsed color statement to hex. `named` values are looked up in the
 * caller's table; everything else is arithmetic on the brace triple.
 */
function colorHex(
  format: CultureColorFormat,
  value: string,
  named: Map<string, string>
): string | null {
  if (format === 'named') return named.get(normId(value)) ?? null
  const n = numbersIn(value)
  if (n.length < 3) return null
  const [a, b, c] = n
  switch (format) {
    case 'rgb':
    case 'int':
      return toHex(a, b, c)
    case 'float':
      return toHex(a * 255, b * 255, c * 255)
    case 'hsv':
      return toHex(...hsvToRgb(a, b, c))
    case 'hsv360':
      return toHex(...hsvToRgb(a / 360, b / 100, c / 100))
  }
}

/** Which of the five spellings a matched color statement uses. */
function colorFormat(tag: string | undefined, value: string): CultureColorFormat {
  if (tag) return tag.toLowerCase() as 'rgb' | 'hsv' | 'hsv360'
  if (!value.startsWith('{')) return 'named'
  // A bare brace triple is 0-255 when every component is a whole number, and
  // 0-1 otherwise — the game's own rule, and why `{ 161 67 0 }` and
  // `{ 0.8 0.2 0.2 }` can share a syntax.
  return /\./.test(value) ? 'float' : 'int'
}

/**
 * A colour value the writers can turn into a triple. `formatColor` parseInts
 * the string blindly, so anything else would be written as `rgb { NaN NaN NaN }`.
 */
const HEX = /^#[0-9a-f]{6}$/i

/** Hex → the components a given format writes, formatted the way CK3 files do. */
function formatColor(format: CultureColorFormat, hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const round = (n: number, places: number): string => Number(n.toFixed(places)).toString()
  switch (format) {
    case 'float':
      return `{ ${[r, g, b].map((c) => round(c / 255, 3)).join(' ')} }`
    case 'hsv': {
      const [h, s, v] = rgbToHsv(r, g, b)
      return `hsv { ${[h, s, v].map((c) => round(c, 3)).join(' ')} }`
    }
    case 'hsv360': {
      const [h, s, v] = rgbToHsv(r, g, b)
      return `hsv360 { ${[round(h * 360, 0), round(s * 100, 0), round(v * 100, 0)].join(' ')} }`
    }
    case 'int':
      return `{ ${r} ${g} ${b} }`
    // A named color has no numeric form to preserve, so an edited one becomes
    // the most readable triple instead of inventing a palette entry.
    case 'named':
    case 'rgb':
      return `rgb { ${r} ${g} ${b} }`
  }
}

/** Named color palettes from `common/named_colors`, id → hex. */
function readNamedColors(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): Map<string, string> {
  const raw = new Map<string, { format: CultureColorFormat; value: string }>()
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, 'common/named_colors')) {
    let text: string
    try {
      text = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      if (block.key.toLowerCase() !== 'colors') continue
      const body = text.slice(block.bodyStart, block.bodyEnd)
      // Read the raw line rather than its top-level code: a palette entry's
      // value IS a brace triple, which a sub-block-eliding scan would swallow.
      for (const { text: line, depth } of annotateLines(body)) {
        if (depth !== 0) continue
        for (const m of splitComment(line)[0].matchAll(NAMED_COLOR_RE)) {
          raw.set(normId(m[1]), { format: colorFormat(m[2], m[3]), value: m[3] })
        }
      }
    }
  }
  // Two passes: an entry may alias another by name, and the target can appear later
  const hex = new Map<string, string>()
  for (const [id, { format, value }] of raw) {
    if (format !== 'named') {
      const h = colorHex(format, value, hex)
      if (h !== null) hex.set(id, h)
    }
  }
  for (const [id, { format, value }] of raw) {
    if (format === 'named') {
      const h = hex.get(normId(value))
      if (h !== undefined) hex.set(id, h)
    }
  }
  return hex
}

/** The culture body's `color = …`, or null when it has none. */
function parseColor(body: string, named: Map<string, string>): CultureColor | null {
  for (const { text, depth } of annotateLines(body)) {
    if (depth !== 0) continue
    const m = COLOR_RE.exec(splitComment(text)[0])
    if (!m) continue
    const format = colorFormat(m[2], m[3])
    return {
      format,
      raw: m[2] ? `${m[2]} ${m[3]}` : m[3],
      hex: colorHex(format, m[3], named)
    }
  }
  return null
}

// ---------- Culture definitions ----------

/** Bare words inside every depth-0 `key = { … }` block of `body`, in file order. */
function blockWords(body: string, key: string): string[] {
  const wanted = key.toLowerCase()
  const words: string[] = []
  for (const block of scanBlocks(body)) {
    if (block.key.toLowerCase() !== wanted) continue
    for (const { text, depth } of annotateLines(body.slice(block.bodyStart, block.bodyEnd))) {
      if (depth !== 0) continue
      for (const w of splitComment(text)[0].match(/[A-Za-z0-9_.\-']+/g) ?? []) {
        if (!words.includes(w)) words.push(w)
      }
    }
  }
  return words
}

/** The `<weight> = <ethnicity>` lines of the `ethnicities` block, in file order. */
function parseEthnicities(body: string): CultureEthnicity[] {
  const entries: CultureEthnicity[] = []
  for (const block of scanBlocks(body)) {
    if (block.key.toLowerCase() !== 'ethnicities') continue
    for (const { text, depth } of annotateLines(body.slice(block.bodyStart, block.bodyEnd))) {
      if (depth !== 0) continue
      for (const m of splitComment(text)[0].matchAll(
        /([0-9]+(?:\.[0-9]+)?)\s*=\s*([A-Za-z0-9_.\-']+)/g
      )) {
        entries.push({ weight: m[1], id: m[2] })
      }
    }
  }
  return entries
}

function parseCulture(
  body: string,
  id: string,
  file: string,
  inMod: boolean,
  named: Map<string, string>
): CultureDef {
  const scalars = scanScalarsCI(body)
  return {
    id,
    file,
    inMod,
    localizedName: null,
    color: parseColor(body, named),
    ethos: scalars.get('ethos') ?? null,
    heritage: scalars.get('heritage') ?? null,
    language: scalars.get('language') ?? null,
    martialCustom: scalars.get('martial_custom') ?? null,
    headDetermination: scalars.get('head_determination') ?? null,
    traditions: blockWords(body, 'traditions'),
    nameList: scalars.get('name_list') ?? null,
    parents: blockWords(body, 'parents'),
    created: scalars.get('created') ?? null,
    coaGfx: blockWords(body, 'coa_gfx'),
    buildingGfx: blockWords(body, 'building_gfx'),
    clothingGfx: blockWords(body, 'clothing_gfx'),
    unitGfx: blockWords(body, 'unit_gfx'),
    houseCoaFrame: scalars.get('house_coa_frame') ?? null,
    ethnicities: parseEthnicities(body)
  }
}

/**
 * Every culture the mod effectively loads. Unlike dynasties (where the game
 * ships tens of thousands) the whole set is small enough to list, so game
 * cultures appear alongside the mod's own — read-only, and badged as such.
 * A mod definition wins over a game one with the same id.
 */
function readCultures(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  named: Map<string, string>
): CultureDef[] {
  const defs: CultureDef[] = []
  for (const path of effectiveFiles(gameDir, modPath, replacePaths, CULTURE_DIR)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    const inMod = isUnderDir(path, modPath)
    for (const block of scanBlocks(text)) {
      defs.push(
        parseCulture(
          text.slice(block.bodyStart, block.bodyEnd),
          block.key,
          basename(path),
          inMod,
          named
        )
      )
    }
  }
  const seen = new Set<string>()
  const layered: CultureDef[] = []
  for (const def of [...defs.filter((d) => d.inMod), ...defs.filter((d) => !d.inMod)]) {
    if (seen.has(normId(def.id))) continue
    seen.add(normId(def.id))
    layered.push(def)
  }
  return layered
}

// ---------- Pillars, traditions and other reference lists ----------

const PILLAR_TYPES: CulturePillarType[] = [
  'ethos',
  'heritage',
  'language',
  'martial_custom',
  'head_determination'
]

interface RawEntry {
  id: string
  /** `type` for pillars, `category` for traditions */
  tag: string | null
}

/** Top-level blocks of a folder, each with one scalar of interest read off it. */
function readTagged(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  relDir: string,
  tagKey: string
): RawEntry[] {
  const entries: RawEntry[] = []
  const seen = new Set<string>()
  for (const path of effectiveFiles(gameDir, modPath, replacePaths, relDir)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      if (seen.has(normId(block.key))) continue
      seen.add(normId(block.key))
      entries.push({
        id: block.key,
        tag: scanScalarsCI(text.slice(block.bodyStart, block.bodyEnd)).get(tagKey) ?? null
      })
    }
  }
  return entries
}

function topLevelIds(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  relDir: string
): string[] {
  const ids = new Set<string>()
  for (const path of effectiveFiles(gameDir, modPath, replacePaths, relDir)) {
    try {
      for (const block of scanBlocks(readFileSync(path, 'utf-8'))) ids.add(block.key)
    } catch {
      // skip unreadable files
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

// ---------- Characters ----------

/** Does a dated block carry a `birth`/`death` statement (not just the word)? */
function hasStatement(subBody: string, statement: string): boolean {
  const re = new RegExp(`(^|[\\s{])${statement}\\s*=`, 'i')
  for (const { text } of annotateLines(subBody)) {
    if (re.test(splitComment(text)[0])) return true
  }
  return false
}

/** Mod characters, for the "used by" list on a culture. */
function listCultureCharacters(modPath: string): CultureCharacter[] {
  const dir = join(modPath, 'history', 'characters')
  if (!existsSync(dir)) return []
  const characters: CultureCharacter[] = []
  for (const entry of readdirSync(dir)) {
    if (!entry.toLowerCase().endsWith('.txt')) continue
    let text: string
    try {
      text = readFileSync(join(dir, entry), 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      const body = text.slice(block.bodyStart, block.bodyEnd)
      const scalars = scanScalarsCI(body)
      const dated = scanBlocks(body).filter((b) => DATE_KEY.test(b.key))
      const dateOf = (statement: 'birth' | 'death'): string | null => {
        const hit = dated.find((b) => hasStatement(body.slice(b.bodyStart, b.bodyEnd), statement))
        return hit ? hit.key.replace(/\.$/, '') : null
      }
      // A culture set at the top of the block is the character's starting one;
      // failing that, the first one a dated block establishes still says which
      // culture the character belongs to.
      let culture = scalars.get('culture') ?? null
      for (const b of dated) {
        if (culture !== null) break
        culture = scanScalarsCI(body.slice(b.bodyStart, b.bodyEnd)).get('culture') ?? null
      }
      characters.push({
        id: block.key,
        file: entry,
        name: scalars.get('name') ?? null,
        birth: dateOf('birth'),
        death: dateOf('death'),
        culture
      })
    }
  }
  return characters
}

// ---------- Assembly ----------

/**
 * A pillar's or tradition's display name lives under `<id>_name`, except for
 * head determination, which localizes the bare id. Both keys are requested and
 * the suffixed one wins.
 */
const nameKeys = (id: string): [string, string] => [`${id}_name`, id]

export function getCultureData(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): CultureData {
  const named = readNamedColors(gameDir, modPath, replacePaths)
  const cultures = readCultures(gameDir, modPath, replacePaths, named)
  const rawPillars = readTagged(gameDir, modPath, replacePaths, 'common/culture/pillars', 'type')
  const rawTraditions = readTagged(
    gameDir,
    modPath,
    replacePaths,
    'common/culture/traditions',
    'category'
  )
  const nameLists = topLevelIds(gameDir, modPath, replacePaths, 'common/culture/name_lists')
  const ethnicities = topLevelIds(gameDir, modPath, replacePaths, 'common/ethnicities')

  // Cultures localize under their own id; pillars and traditions under
  // `<id>_name`. Those keys are scattered across the whole english tree
  // (DLC folders included), so the scan is narrowed by key rather than folder.
  const wanted = new Set<string>([...cultures.map((c) => c.id), ...nameLists])
  for (const e of [...rawPillars, ...rawTraditions]) for (const k of nameKeys(e.id)) wanted.add(k)
  const loc = readLocalization(gameDir, modPath, null, (key) => wanted.has(key))
  resolveLocReferences(loc, gameDir, modPath)

  const entry = (id: string): RefEntry => ({
    id,
    name: loc.get(`${id}_name`) ?? loc.get(id) ?? null
  })

  const pillars = Object.fromEntries(
    PILLAR_TYPES.map((type) => [
      type,
      rawPillars
        .filter((p) => p.tag !== null && p.tag.toLowerCase() === type)
        .map((p) => entry(p.id))
        .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
    ])
  ) as Record<CulturePillarType, RefEntry[]>

  const traditions: CultureTraditionEntry[] = rawTraditions
    .map((t) => ({ ...entry(t.id), category: t.tag }))
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))

  // Graphics bundles have no folder of definitions to enumerate, so the option
  // lists are the values the effective culture files actually use.
  const distinct = (pick: (c: CultureDef) => string[]): string[] =>
    [...new Set(cultures.flatMap(pick))].sort()

  return {
    cultures: cultures.map((c) => ({ ...c, localizedName: loc.get(c.id) ?? null })),
    pillars,
    traditions,
    nameLists: nameLists.map((id) => ({ id, name: loc.get(id) ?? null })),
    ethnicities: ethnicities.map((id) => ({ id, name: null })),
    gfx: {
      coa: distinct((c) => c.coaGfx),
      building: distinct((c) => c.buildingGfx),
      clothing: distinct((c) => c.clothingGfx),
      unit: distinct((c) => c.unitGfx),
      houseCoaFrame: [
        ...new Set(cultures.map((c) => c.houseCoaFrame).filter((v): v is string => v !== null))
      ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    },
    characters: modPath ? listCultureCharacters(modPath) : []
  }
}

// ---------- Saving ----------

/**
 * Rewrite the culture's `color = …` in whatever spelling the file already
 * used, or append an `rgb` triple when it had none. Only the value's own span
 * changes, so a comment on the line survives.
 */
function setColor(ed: LineEditor, hex: string | null): void {
  for (let i = 0; i < ed.lines.length; i++) {
    if (ed.depths[i] !== 0) continue
    const [code, comment] = splitComment(ed.lines[i])
    const m = COLOR_RE.exec(code)
    if (!m) continue
    const start = m.index + m[1].length
    const end = m.index + m[0].length
    if (hex === null) {
      const rest = code.slice(0, start) + code.slice(end)
      if (rest.trim() === '' && comment === '') ed.lines.splice(i, 1)
      else ed.lines[i] = rest + comment
      refresh(ed)
    } else {
      const written = `color = ${formatColor(colorFormat(m[2], m[3]), hex)}`
      ed.lines[i] = code.slice(0, start) + written + code.slice(end) + comment
    }
    return
  }
  if (hex !== null) setScalar(ed, ['color'], formatColor('rgb', hex))
}

/** `ethnicities` is a weighted map rather than a word list, so it writes its own lines. */
function setEthnicities(ed: LineEditor, entries: CultureEthnicity[]): void {
  setBlockBody(
    ed,
    'ethnicities',
    entries.length === 0
      ? null
      : (indent) => ({
          single: ` ${entries.map((e) => `${e.weight} = ${e.id}`).join(' ')} `,
          multi: entries.map((e) => `${indent}${e.weight} = ${e.id}`)
        })
  )
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

/**
 * Write a culture's edited fields back into its file.
 *
 * The game paths are needed to resolve named colours: without the palette a
 * `color = english` would read as "no colour" and every save would rewrite it
 * as an rgb triple, even when the user never touched it.
 */
export function saveCulture(
  gameDir: string | null,
  modPath: string,
  replacePaths: string[],
  file: string,
  id: string,
  patch: CulturePatch
): SaveResult {
  const path = join(modPath, ...CULTURE_DIR.split('/'), file)
  try {
    if (!existsSync(path)) return { ok: false, error: `File not found: ${file}` }
    // Trimmed once and used from here on: `formatColor` slices fixed offsets,
    // so writing an untrimmed value would put the guard and the writer out of
    // step and emit `rgb { NaN … }` for exactly the input the guard accepted.
    const color = patch.color === null ? null : patch.color.trim()
    if (color !== null && !HEX.test(color)) {
      return { ok: false, error: `Invalid colour "${patch.color}" (expected #rrggbb)` }
    }
    const text = readFileSync(path, 'utf-8')
    const block = scanBlocks(text).find((b) => b.key === id)
    if (!block) return { ok: false, error: `${id} not found in ${file}` }

    const body = text.slice(block.bodyStart, block.bodyEnd)
    // Rewriting a block normalizes its layout (and drops duplicate blocks of
    // the same key), so every field is compared against what the file already
    // says and only actually-changed ones are written. That keeps a no-op save
    // byte-for-byte identical, comments and hand formatting included.
    const current = parseCulture(body, id, file, true, readNamedColors(gameDir, modPath, replacePaths))
    const ed = makeEditor(body)

    // Every value here is a bare id or a date, so nothing is ever quoted
    const scalar = (key: string, value: string | null): void =>
      setScalar(ed, [key], value, { ignoreCase: true })
    const list = (key: string, was: string[], now: string[]): void => {
      if (!sameList(was, now)) setBlockList(ed, key, now)
    }

    if (color !== (current.color?.hex ?? null)) setColor(ed, color)
    scalar('ethos', patch.ethos)
    scalar('heritage', patch.heritage)
    scalar('language', patch.language)
    scalar('martial_custom', patch.martialCustom)
    scalar('head_determination', patch.headDetermination)
    scalar('name_list', patch.nameList)
    scalar('created', patch.created)
    scalar('house_coa_frame', patch.houseCoaFrame)
    list('parents', current.parents, patch.parents)
    list('traditions', current.traditions, patch.traditions)
    list('coa_gfx', current.coaGfx, patch.coaGfx)
    list('building_gfx', current.buildingGfx, patch.buildingGfx)
    list('clothing_gfx', current.clothingGfx, patch.clothingGfx)
    list('unit_gfx', current.unitGfx, patch.unitGfx)
    if (
      !sameList(
        current.ethnicities.map((e) => `${e.weight}=${e.id}`),
        patch.ethnicities.map((e) => `${e.weight}=${e.id}`)
      )
    ) {
      setEthnicities(ed, patch.ethnicities)
    }

    const updated = text.slice(0, block.bodyStart) + ed.lines.join('\n') + text.slice(block.bodyEnd)
    writeModText(path, updated)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------- Creating ----------

/** The mod's own culture files — the targets a new definition can be written to. */
export function listCultureFiles(modPath: string): string[] {
  return listTxtFiles(join(modPath, ...CULTURE_DIR.split('/')))
}

/**
 * Every culture id the mod itself defines, normalized, mapped to the file it
 * lives in. Only the mod's own files: shadowing a base-game culture is the
 * normal way to override one, so that stays the caller's call.
 */
function modCultureFiles(modPath: string): Map<string, string> {
  const ids = new Map<string, string>()
  for (const path of effectiveFiles(null, modPath, [], CULTURE_DIR)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      if (!ids.has(normId(block.key))) ids.set(normId(block.key), basename(path))
    }
  }
  return ids
}

/**
 * The lines of a new culture block, in the order the game's own files write
 * them. List blocks are emitted multi-line with double-tab items — byte for
 * byte what `setBlockList` splices into a tab-indented body — so the first
 * edit of a new culture is a minimal diff rather than a reflow.
 */
function cultureBlockLines(id: string, def: NewCulture): string[] {
  const lines = [`${id} = {`]
  const scalar = (key: string, value: string | null): void => {
    if (value !== null && value.trim() !== '') lines.push(`\t${key} = ${value.trim()}`)
  }
  // Duplicates are dropped: for the word lists `blockWords` dedupes on read, so
  // writing them would break the round-trip, and a repeated ethnicity line says
  // nothing the single line doesn't.
  const block = (key: string, items: string[]): void => {
    const kept = [...new Set(items.map((v) => v.trim()).filter((v) => v !== ''))]
    if (kept.length === 0) return
    lines.push(`\t${key} = {`, ...kept.map((v) => `\t\t${v}`), '\t}')
  }

  if (def.color !== null) lines.push(`\tcolor = ${formatColor('rgb', def.color.trim())}`)
  scalar('created', def.created)
  block('parents', def.parents)
  scalar('ethos', def.ethos)
  scalar('heritage', def.heritage)
  scalar('language', def.language)
  scalar('martial_custom', def.martialCustom)
  scalar('head_determination', def.headDetermination)
  block('traditions', def.traditions)
  scalar('name_list', def.nameList)
  block('coa_gfx', def.coaGfx)
  block('building_gfx', def.buildingGfx)
  block('clothing_gfx', def.clothingGfx)
  block('unit_gfx', def.unitGfx)
  scalar('house_coa_frame', def.houseCoaFrame)
  block(
    'ethnicities',
    def.ethnicities
      .filter((e) => e.id.trim() !== '')
      .map((e) => `${e.weight.trim()} = ${e.id.trim()}`)
  )
  lines.push('}')
  return lines
}

/**
 * Append a brand-new culture to one of the mod's files (created if missing).
 * Existing content is preserved byte-for-byte; the block follows a separating
 * blank line, in the file's own line-ending style.
 *
 * The required fields are the ones every hand-authored culture on disk sets —
 * vanilla's 244 and the mod's own — without which the culture isn't playable.
 * The graphics bundles are deliberately not among them: they're free-form tags
 * with no registry to validate against, and requiring them would make writing
 * the FIRST culture into a replace_path'd folder impossible.
 */
export function createCulture(modPath: string, file: string, def: NewCulture): SaveResult {
  try {
    const id = def.id.trim()
    if (!id) return { ok: false, error: 'ID must not be empty' }
    if (!KEY_CHARS.test(id)) {
      return { ok: false, error: `Invalid ID "${id}" (letters, digits, _ . - ' only)` }
    }
    if (!isTxtFileName(file)) {
      return { ok: false, error: `Invalid file name "${file}" (expected a .txt file name)` }
    }
    const required: [string, string | null][] = [
      ['Colour', def.color],
      ['Ethos', def.ethos],
      ['Heritage', def.heritage],
      ['Language', def.language],
      ['Martial custom', def.martialCustom],
      ['Name list', def.nameList]
    ]
    for (const [label, value] of required) {
      if (!value?.trim()) return { ok: false, error: `${label} is required` }
    }
    if (!HEX.test(def.color!.trim())) {
      return { ok: false, error: `Invalid colour "${def.color}" (expected #rrggbb)` }
    }
    // Portrait generation reads this block, and no culture on disk omits it
    const ethnicities = def.ethnicities.filter((e) => e.id.trim() !== '')
    if (ethnicities.length === 0) return { ok: false, error: 'At least one ethnicity is required' }
    for (const e of ethnicities) {
      if (!/^\d+(\.\d+)?$/.test(e.weight.trim())) {
        return { ok: false, error: `Invalid weight "${e.weight}" for ethnicity ${e.id}` }
      }
      if (!KEY_CHARS.test(e.id.trim())) {
        return { ok: false, error: `Invalid ethnicity "${e.id}"` }
      }
    }
    // Lenient like every other date here: real files carry "3212.1" and "3220.1.1."
    const created = def.created?.trim() ?? ''
    if (created !== '' && !DATE_KEY.test(created)) {
      return { ok: false, error: `Invalid date "${def.created}" (expected Y.M.D)` }
    }
    const clash = modCultureFiles(modPath).get(normId(id))
    if (clash !== undefined) return { ok: false, error: `ID ${id} already exists in ${clash}` }

    appendBlock(join(modPath, ...CULTURE_DIR.split('/')), file, cultureBlockLines(id, def))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
