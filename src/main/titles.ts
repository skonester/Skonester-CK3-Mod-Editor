import { existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { DATED_BLOCK_KEY } from './titleHistory'
import { makeEditor, setBlockBody, setScalar, splitComment } from '@shared/lineEditor'
import { readLocalization } from './localization'
import { annotateLines, scanBlocks, scanScalarsCI } from '@shared/pdx'
import { effectiveFiles, isUnderDir } from './refdata'
import {
  colorTriple,
  expandLocRefs,
  modFirst,
  norm,
  parseColor,
  readNamedColors,
  setColor
} from './religions'
import { KEY_CHARS, appendBlock, isTxtFileName, listTxtFiles } from './scriptFile'
import type { LineEditor } from '@shared/lineEditor'
import type {
  NewTitle,
  RefEntry,
  SaveResult,
  TitleCulturalName,
  TitleData,
  TitleDetail,
  TitleFlags,
  TitlePatch,
  TitleSummary,
  TitleTier
} from '@shared/types'
import { TITLE_FLAG_KEYS } from '@shared/types'

export const TITLE_DIR = 'common/landed_titles'
const GOVERNMENT_DIR = 'common/governments'
const LAW_DIR = 'common/laws'

/**
 * A landed-title key: tier prefix + at least one more character. Only the
 * prefix identifies a title — everything else inside a title block (color,
 * cultural_names, can_create, even pasted date-keyed history blocks) is a
 * property. The two-char prefixes don't collide with any property key.
 */
export const TITLE_KEY = /^[hekdcb]_./i

const TIER_BY_PREFIX: Record<string, TitleTier> = {
  h: 'hegemony',
  e: 'empire',
  k: 'kingdom',
  d: 'duchy',
  c: 'county',
  b: 'barony'
}

/** Rank for tier sanity checks: a child must sit strictly below its parent. */
const TIER_RANK: Record<TitleTier, number> = {
  hegemony: 5,
  empire: 4,
  kingdom: 3,
  duchy: 2,
  county: 1,
  barony: 0
}

export function titleTier(id: string): TitleTier | null {
  if (!TITLE_KEY.test(id)) return null
  return TIER_BY_PREFIX[id[0].toLowerCase()] ?? null
}

// ---------- Walking the de jure tree ----------

/** One title block found by the recursive walk, with absolute file offsets. */
interface TitleNode {
  id: string
  /** Offsets into the whole file text */
  absStart: number
  absBodyStart: number
  absBodyEnd: number
  absEnd: number
  /** Ancestor title ids, outermost first */
  path: string[]
  parent: string | null
  /** The block's body slice */
  body: string
}

/**
 * Visit every title block of a file, depth first in file order. Nesting is the
 * de jure hierarchy; offsets are composed by adding each ancestor's bodyStart,
 * so a visitor can splice its node's body with the rest of the file untouched.
 */
function walkTitles(text: string, visit: (node: TitleNode) => void): void {
  const recurse = (body: string, absBase: number, path: string[]): void => {
    for (const b of scanBlocks(body)) {
      if (!TITLE_KEY.test(b.key)) continue
      const childBody = body.slice(b.bodyStart, b.bodyEnd)
      visit({
        id: b.key,
        absStart: absBase + b.start,
        absBodyStart: absBase + b.bodyStart,
        absBodyEnd: absBase + b.bodyEnd,
        absEnd: absBase + b.end,
        path,
        parent: path.length > 0 ? path[path.length - 1] : null,
        body: childBody
      })
      recurse(childBody, absBase + b.bodyStart, [...path, b.key])
    }
  }
  recurse(text, 0, [])
}

/** The first title node matching `id` (normalized) in `text`, or null. */
function findTitleNode(text: string, id: string): TitleNode | null {
  let found: TitleNode | null = null
  walkTitles(text, (node) => {
    if (found === null && norm(node.id) === norm(id)) found = node
  })
  return found
}

// ---------- Reference lists ----------

function governmentIds(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): string[] {
  const ids = new Set<string>()
  for (const path of effectiveFiles(gameDir, modPath, replacePaths, GOVERNMENT_DIR)) {
    try {
      for (const block of scanBlocks(readFileSync(path, 'utf-8'))) ids.add(block.key)
    } catch {
      // skip unreadable files
    }
  }
  return [...ids].sort()
}

/**
 * Law ids from common/laws: top-level in 1.20, nested in groups in legacy
 * files. Succession laws spell their id *_law, which conveniently
 * excludes realm laws (crown_authority_2) and group settings — the list feeds
 * a suggestion picker, not validation, so a stray extra id is harmless.
 */
function successionLawIds(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): string[] {
  const ids = new Set<string>()
  for (const path of effectiveFiles(gameDir, modPath, replacePaths, LAW_DIR)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    for (const group of scanBlocks(text)) {
      // 1.20 moved law groups to common/law_groups; laws are now top-level.
      if (/_law$/i.test(group.key)) ids.add(group.key)
      const body = text.slice(group.bodyStart, group.bodyEnd)
      for (const law of scanBlocks(body)) {
        if (/_law$/i.test(law.key)) ids.add(law.key)
      }
    }
  }
  return [...ids].sort()
}

/**
 * Every title id (normalized) that at least one effective history file
 * records a dated entry for. An empty placeholder block (`d_x = {}`) counts
 * as no history — real mods keep those parked while authoring.
 */
function titlesWithHistory(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): Set<string> {
  const ids = new Set<string>()
  for (const path of effectiveFiles(gameDir, modPath, replacePaths, 'history/titles', true)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      if (ids.has(norm(block.key))) continue
      const body = text.slice(block.bodyStart, block.bodyEnd)
      if (scanBlocks(body).some((d) => DATED_BLOCK_KEY.test(d.key))) ids.add(norm(block.key))
    }
  }
  return ids
}

// ---------- Assembly ----------

export function getTitleData(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): TitleData {
  const named = readNamedColors(gameDir, modPath, replacePaths)
  const withHistory = titlesWithHistory(gameDir, modPath, replacePaths)
  const titles: TitleSummary[] = []
  // Mod definitions win on an id clash (vanilla itself ships a few duplicate
  // ids); children of a skipped duplicate still walk, so nothing disappears.
  const seen = new Set<string>()
  for (const path of modFirst(effectiveFiles(gameDir, modPath, replacePaths, TITLE_DIR), modPath)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    const file = basename(path)
    const inMod = isUnderDir(path, modPath)
    walkTitles(text, (node) => {
      if (seen.has(norm(node.id))) return
      seen.add(norm(node.id))
      const scalars = scanScalarsCI(node.body)
      titles.push({
        id: node.id,
        tier: titleTier(node.id)!,
        parent: node.parent,
        file,
        inMod,
        localizedName: null,
        color: parseColor(node.body, named)?.hex ?? null,
        landless: scalars.get('landless') ?? null,
        requireLandless: scalars.get('require_landless') ?? null,
        nobleFamily: scalars.get('noble_family') ?? null,
        province: scalars.get('province') ?? null,
        hasHistory: withHistory.has(norm(node.id))
      })
    })
  }

  const governments = governmentIds(gameDir, modPath, replacePaths)
  const laws = successionLawIds(gameDir, modPath, replacePaths)

  // Titles, governments and laws all localize under their own id. Loc keys are
  // written lowercase while script ids can be mixed-case, so both spellings go
  // into the wanted set and lookups fall back to the lowercased key.
  const wanted = new Set<string>()
  for (const list of [titles.map((t) => t.id), governments, laws]) {
    for (const id of list) {
      wanted.add(id)
      wanted.add(id.toLowerCase())
    }
  }
  const loc = readLocalization(gameDir, modPath, null, (key) => wanted.has(key))
  // Vanilla spells noble-family names as references ("$dynn_Su_82CF$ Family");
  // the referenced keys are fetched in a second pass and substituted in.
  expandLocRefs(loc, gameDir, modPath)
  const locName = (id: string): string | null => loc.get(id) ?? loc.get(id.toLowerCase()) ?? null

  for (const t of titles) t.localizedName = locName(t.id)

  // A noble-family title with no localization of its own is named in the game
  // after its holder's house — resolve that from the mod's own history.
  const unnamed = titles.filter(
    (t) => t.localizedName === null && t.inMod && t.nobleFamily?.trim().toLowerCase() === 'yes'
  )
  if (unnamed.length > 0 && modPath !== null) {
    const names = nobleFamilyNames(gameDir, modPath, replacePaths, unnamed.map((t) => t.id))
    for (const t of unnamed) t.localizedName = names.get(norm(t.id)) ?? null
  }

  const entries = (ids: string[]): RefEntry[] => ids.map((id) => ({ id, name: locName(id) }))
  return { titles, governments: entries(governments), successionLaws: entries(laws) }
}

// ---------- Noble-family names ----------

/** Lenient date sort key (bare years included), for "who holds it last". */
function looseDateKey(date: string): number {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(date.trim())
  if (m === null) return -1
  return Number(m[1]) * 10000 + Number(m[2] ?? 1) * 100 + Number(m[3] ?? 1)
}

/** Top-level block key -> its `name` scalar, over one content dir, for `ids` only. */
function nameKeysFor(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  relDir: string,
  ids: Set<string>
): Map<string, string> {
  const names = new Map<string, string>()
  if (ids.size === 0) return names
  for (const path of modFirst(effectiveFiles(gameDir, modPath, replacePaths, relDir), modPath)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      const key = norm(block.key)
      if (!ids.has(key) || names.has(key)) continue
      const name = scanScalarsCI(text.slice(block.bodyStart, block.bodyEnd)).get('name')
      if (name !== undefined) names.set(key, name)
    }
  }
  return names
}

/**
 * Display names for noble-family titles that have no localization of their
 * own. The game names a family title after the holding house, which changes
 * over time — the editor shows the end of the recorded history: each title's
 * chronologically last holder, that character's house (or dynasty), and that
 * lineage's localized name. Titles whose chain breaks anywhere stay nameless.
 *
 * Only the mod's own history is scanned — a mod's family holders are its own
 * characters, and vanilla's family titles are localized under their ids.
 */
function nobleFamilyNames(
  gameDir: string | null,
  modPath: string,
  replacePaths: string[],
  ids: string[]
): Map<string, string> {
  const wanted = new Set(ids.map(norm))

  // The last holder recorded for each title; `holder = 0` is a destruction
  // marker, so the last real holder is the family the title is named after
  const holders = new Map<string, { key: number; holder: string }>()
  for (const path of effectiveFiles(null, modPath, [], 'history/titles')) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      const title = norm(block.key)
      if (!wanted.has(title)) continue
      const body = text.slice(block.bodyStart, block.bodyEnd)
      for (const d of scanBlocks(body)) {
        if (!DATED_BLOCK_KEY.test(d.key)) continue
        const holder = scanScalarsCI(body.slice(d.bodyStart, d.bodyEnd)).get('holder')
        if (holder === undefined || holder === '0') continue
        const key = looseDateKey(d.key)
        const prev = holders.get(title)
        if (prev === undefined || key >= prev.key) holders.set(title, { key, holder })
      }
    }
  }

  // Each last holder's lineage, from the mod's character history
  const holderIds = new Set([...holders.values()].map((h) => norm(h.holder)))
  const lineages = new Map<string, { house: string | null; dynasty: string | null }>()
  if (holderIds.size > 0) {
    for (const path of effectiveFiles(null, modPath, [], 'history/characters')) {
      let text: string
      try {
        text = readFileSync(path, 'utf-8')
      } catch {
        continue
      }
      for (const block of scanBlocks(text)) {
        const id = norm(block.key)
        if (!holderIds.has(id) || lineages.has(id)) continue
        const scalars = scanScalarsCI(text.slice(block.bodyStart, block.bodyEnd))
        lineages.set(id, {
          house: scalars.get('dynasty_house') ?? null,
          dynasty: scalars.get('dynasty') ?? null
        })
      }
    }
  }

  // Lineage ids -> their `name` loc keys (game+mod layered: a mod character
  // may sit in a base-game dynasty), houses preferred — they're the finer
  // lineage and what the game names a family title after
  const houseIds = new Set<string>()
  const dynastyIds = new Set<string>()
  for (const lineage of lineages.values()) {
    if (lineage.house !== null) houseIds.add(norm(lineage.house))
    else if (lineage.dynasty !== null) dynastyIds.add(norm(lineage.dynasty))
  }
  const houseNames = nameKeysFor(gameDir, modPath, replacePaths, 'common/dynasty_houses', houseIds)
  const dynastyNames = nameKeysFor(gameDir, modPath, replacePaths, 'common/dynasties', dynastyIds)

  const nameKeyOf = (title: string): string | null => {
    const holder = holders.get(title)
    if (holder === undefined) return null
    const lineage = lineages.get(norm(holder.holder))
    if (lineage === undefined) return null
    if (lineage.house !== null) return houseNames.get(norm(lineage.house)) ?? null
    if (lineage.dynasty !== null) return dynastyNames.get(norm(lineage.dynasty)) ?? null
    return null
  }

  const keys = new Set<string>()
  for (const title of wanted) {
    const key = nameKeyOf(title)
    if (key !== null) keys.add(key)
  }
  const loc =
    keys.size === 0
      ? new Map<string, string>()
      : readLocalization(gameDir, modPath, null, (key) => keys.has(key))
  expandLocRefs(loc, gameDir, modPath)

  const names = new Map<string, string>()
  for (const title of wanted) {
    const key = nameKeyOf(title)
    const name = key === null ? undefined : loc.get(key)
    if (name !== undefined) names.set(title, name)
  }
  return names
}

// ---------- Detail ----------

/** All `key = value` statements of a cultural_names body, in order, duplicates kept. */
function parseCulturalNames(inner: string): TitleCulturalName[] {
  const names: TitleCulturalName[] = []
  const statement = /(^|\s)([A-Za-z0-9_.\-']+)\s*=\s*(?:"([^"]*)"|([^\s{}"#=]+))/g
  for (const { text, depth } of annotateLines(inner)) {
    if (depth !== 0) continue
    const [code] = splitComment(text)
    for (const m of code.matchAll(statement)) names.push({ key: m[2], value: m[3] ?? m[4] })
  }
  return names
}

/**
 * The title's cultural names across EVERY cultural_names block — real files
 * carry duplicate blocks, and the parse and the save-time diff must read them
 * identically or an untouched save would rewrite (and collapse) them.
 */
function titleCulturalNames(body: string): TitleCulturalName[] {
  const names: TitleCulturalName[] = []
  for (const b of scanBlocks(body)) {
    if (b.key.toLowerCase() !== 'cultural_names') continue
    names.push(...parseCulturalNames(body.slice(b.bodyStart, b.bodyEnd)))
  }
  return names
}

function parseDetail(
  node: TitleNode,
  file: string,
  inMod: boolean,
  named: Map<string, string>
): TitleDetail {
  const body = node.body
  const scalars = scanScalarsCI(body)
  const flags = {} as TitleFlags
  for (const key of TITLE_FLAG_KEYS) flags[key] = scalars.get(key) ?? null

  const children: string[] = []
  const scriptBlocks = new Set<string>()
  for (const b of scanBlocks(body)) {
    if (TITLE_KEY.test(b.key)) {
      children.push(b.key)
      continue
    }
    const key = b.key.toLowerCase()
    if (key === 'color' || key === 'cultural_names') continue
    scriptBlocks.add(b.key)
  }

  return {
    id: node.id,
    tier: titleTier(node.id)!,
    file,
    inMod,
    dejurePath: node.path,
    parent: node.parent,
    children,
    color: parseColor(body, named),
    capital: scalars.get('capital') ?? null,
    province: scalars.get('province') ?? null,
    flags,
    culturalNames: titleCulturalNames(body),
    scriptBlocks: [...scriptBlocks]
  }
}

export function getTitle(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  id: string
): TitleDetail | null {
  const named = readNamedColors(gameDir, modPath, replacePaths)
  for (const path of modFirst(effectiveFiles(gameDir, modPath, replacePaths, TITLE_DIR), modPath)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    const node = findTitleNode(text, id)
    if (node !== null) return parseDetail(node, basename(path), isUnderDir(path, modPath), named)
  }
  return null
}

// ---------- Saving ----------

/**
 * Line index of the first depth-0 sub-block that isn't a property (a child
 * title, or a pasted date-keyed history block), or -1 when there is none.
 * Inserted scalars land above it, with the title's other properties, instead
 * of dangling after the last child.
 */
function firstSubBlockLine(ed: LineEditor): number {
  for (let i = 0; i < ed.lines.length; i++) {
    if (ed.depths[i] !== 0) continue
    const [code] = splitComment(ed.lines[i])
    const m = code.match(/^\s*([A-Za-z0-9_.\-']+)\s*=\s*\{/)
    if (m && (TITLE_KEY.test(m[1]) || DATED_BLOCK_KEY.test(m[1]))) return i
  }
  return -1
}

const sameNames = (a: TitleCulturalName[], b: TitleCulturalName[]): boolean =>
  a.length === b.length && a.every((n, i) => n.key === b[i].key && n.value === b[i].value)

export function saveTitle(
  modPath: string,
  file: string,
  id: string,
  patch: TitlePatch
): SaveResult {
  try {
    const path = join(modPath, ...TITLE_DIR.split('/'), file)
    if (!existsSync(path)) return { ok: false, error: `File not found: ${file}` }
    const text = readFileSync(path, 'utf-8')
    if (text.includes('�')) {
      return { ok: false, error: `${file} isn't valid UTF-8 — edit it in a text editor instead` }
    }
    const node = findTitleNode(text, id)
    if (node === null) return { ok: false, error: `${id} not found in ${file}` }

    // Like saveFaith: the named-color palette isn't needed for the diff, since
    // a named color parses as editable: false and is never rewritten.
    const current = parseColor(node.body, new Map())
    const ed = makeEditor(setColor(node.body, patch.color, current))
    const set = (keys: string[], value: string | null): void => {
      const anchor = firstSubBlockLine(ed)
      setScalar(ed, keys, value, {
        ignoreCase: true,
        ...(anchor >= 0 ? { insertAt: anchor } : {})
      })
    }
    set(['capital'], patch.capital)
    set(['province'], patch.province)
    for (const key of TITLE_FLAG_KEYS) set([key], patch.flags[key])

    // cultural_names rewrites normalize the block's layout (dropping comments
    // inside it, collapsing duplicate blocks), so only an actually changed
    // list is written at all — read here exactly as the parse read it.
    if (!sameNames(titleCulturalNames(node.body), patch.culturalNames)) {
      setBlockBody(
        ed,
        'cultural_names',
        patch.culturalNames.length === 0
          ? null
          : (indent) => ({
              single: ` ${patch.culturalNames.map((n) => `${n.key} = ${n.value}`).join(' ')} `,
              multi: patch.culturalNames.map((n) => `${indent}${n.key} = ${n.value}`)
            })
      )
    }

    const updated =
      text.slice(0, node.absBodyStart) + ed.lines.join('\n') + text.slice(node.absBodyEnd)
    writeFileSync(path, updated, 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------- Creating ----------

/** .txt files under the mod's landed_titles folder, for the create panel's picker. */
export function listTitleFiles(modPath: string): string[] {
  return listTxtFiles(join(modPath, ...TITLE_DIR.split('/')))
}

/** The mod file (name) already defining `id` at any depth, or null. */
function findModTitleFile(modPath: string, id: string): string | null {
  for (const path of effectiveFiles(null, modPath, [], TITLE_DIR)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    if (findTitleNode(text, id) !== null) return basename(path)
  }
  return null
}

/** Leading whitespace of the line `offset` sits on. */
function lineIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  return text.slice(lineStart).match(/^[ \t]*/)![0]
}

/** One indentation unit, as the file's first indented line writes it. */
function fileIndentUnit(text: string): string {
  for (const line of text.split('\n')) {
    const m = line.match(/^([ \t]+)\S/)
    if (m) return m[1]
  }
  return '\t'
}

/** The property lines of a new title body, unindented. */
function newTitleLines(def: NewTitle): string[] {
  const lines: string[] = []
  if (def.color !== null && /^#[0-9a-fA-F]{6}$/.test(def.color)) {
    lines.push(`color = ${colorTriple(def.color)}`)
  }
  if (def.capital?.trim()) lines.push(`capital = ${def.capital.trim()}`)
  if (def.province?.trim()) lines.push(`province = ${def.province.trim()}`)
  for (const key of TITLE_FLAG_KEYS) {
    const value = def.flags[key]
    if (value !== null && value.trim() !== '') lines.push(`${key} = ${value.trim()}`)
  }
  return lines
}

/**
 * Create a brand-new title: nested into a mod-defined parent's block (de jure
 * membership comes from nesting, and CK3 offers no way to add children to a
 * block from outside it), or appended to `def.file` as a top-level block.
 * Everything outside the splice point survives byte-for-byte; nested inserts
 * follow the file's own indentation unit and line-ending style.
 */
export function createTitle(modPath: string, def: NewTitle): SaveResult {
  try {
    const id = def.id.trim()
    if (!id) return { ok: false, error: 'ID must not be empty' }
    if (!KEY_CHARS.test(id)) {
      return { ok: false, error: `Invalid ID "${id}" (letters, digits, _ . - ' only)` }
    }
    const tier = titleTier(id)
    if (tier === null) {
      return {
        ok: false,
        error: `Invalid ID "${id}" — a title id starts with its tier prefix (e_, k_, d_, c_, b_ or h_)`
      }
    }
    if (def.province?.trim() && tier !== 'barony') {
      return { ok: false, error: 'Only a barony title can carry a province' }
    }
    const clash = findModTitleFile(modPath, id)
    if (clash !== null) return { ok: false, error: `ID ${id} already exists in ${clash}` }

    const lines = newTitleLines(def)
    const parentId = def.parent?.trim() ?? ''

    if (parentId === '') {
      if (def.file === null || !isTxtFileName(def.file)) {
        return { ok: false, error: `Invalid file name "${def.file ?? ''}" (expected a .txt file name)` }
      }
      // appendBlock re-reads and rewrites the whole file, so the same
      // decode-loss guard the save paths use applies here too
      const target = join(modPath, ...TITLE_DIR.split('/'), def.file)
      if (existsSync(target) && readFileSync(target, 'utf-8').includes('�')) {
        return { ok: false, error: `${def.file} isn't valid UTF-8 — edit it in a text editor instead` }
      }
      appendBlock(join(modPath, ...TITLE_DIR.split('/')), def.file, [
        `${id} = {`,
        ...lines.map((l) => `\t${l}`),
        `}`
      ])
      return { ok: true }
    }

    let found: { path: string; text: string; node: TitleNode } | null = null
    for (const path of effectiveFiles(null, modPath, [], TITLE_DIR)) {
      let text: string
      try {
        text = readFileSync(path, 'utf-8')
      } catch {
        continue
      }
      const node = findTitleNode(text, parentId)
      if (node !== null) {
        found = { path, text, node }
        break
      }
    }
    if (found === null) {
      return {
        ok: false,
        error: `Title ${parentId} isn't defined in the mod — copy it into the mod before nesting new titles under it`
      }
    }
    const parentTier = titleTier(found.node.id)
    if (parentTier !== null && TIER_RANK[tier] >= TIER_RANK[parentTier]) {
      return {
        ok: false,
        error: `A ${tier} can't be de jure part of a ${parentTier} — pick a higher-tier parent`
      }
    }
    if (found.text.includes('�')) {
      return {
        ok: false,
        error: `${basename(found.path)} isn't valid UTF-8 — edit it in a text editor instead`
      }
    }

    const { path, text, node } = found
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const unit = fileIndentUnit(text)
    const parentIndent = lineIndentAt(text, node.absStart)
    const childIndent = parentIndent + unit
    const block = [
      `${childIndent}${id} = {`,
      ...lines.map((l) => `${childIndent}${unit}${l}`),
      `${childIndent}}`
    ]
    const inner = text.slice(node.absBodyStart, node.absBodyEnd)
    const trailing = inner.match(/\s*$/)![0]
    const content = inner.slice(0, inner.length - trailing.length)
    const closingIndent = trailing.includes('\n')
      ? trailing.slice(trailing.lastIndexOf('\n') + 1)
      : parentIndent
    const sep = content === '' ? eol : eol + eol
    const newInner = content + sep + block.join(eol) + eol + closingIndent
    writeFileSync(
      path,
      text.slice(0, node.absBodyStart) + newInner + text.slice(node.absBodyEnd),
      'utf-8'
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
