import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { makeEditor, setBlockList, setRepeatedScalar, setScalar } from '@shared/lineEditor'
import { KEY_CHARS, appendBlock, isTxtFileName } from './scriptFile'
import {
  applyFaithOptions,
  applyReligionOptions,
  applyRiteOptions,
  readFaithOptions,
  readReligionOptions,
  readRiteOptions
} from './religionOptions'
import { readLocalization } from './localization'
import { annotateLines, scanBlocks, scanRepeatedScalarCI, scanScalarsCI } from '@shared/pdx'
import { effectiveFiles, isUnderDir } from './refdata'
import {
  FAITH_DIR,
  RITE_DIR,
  TENET_DIR,
  blockList,
  nestedBody,
  religionFormat
} from './religionSchema'
import type { BlockSpan } from '@shared/pdx'
import type {
  FaithAdherent,
  FaithColor,
  FaithDef,
  FaithPatch,
  NewFaith,
  NewReligion,
  NewRite,
  RefEntry,
  ReligionData,
  ReligionDef,
  ReligionPatch,
  RiteDef,
  RitePatch,
  SaveResult
} from '@shared/types'

const RELIGION_DIR = 'common/religion/religion_types'
const DOCTRINE_DIR = 'common/religion/doctrine_types'
const DOCTRINE_GROUP_DIR = 'common/religion/doctrine_group_types'
const HOLY_SITE_DIR = 'common/religion/holy_site_types'
const FAMILY_DIR = 'common/religion/religion_family_types'
const NAMED_COLOR_DIR = 'common/named_colors'

/** Id comparison key, matching how the rest of the app compares raw file ids. */
export const norm = (id: string): string => id.trim().toLowerCase()

// ---------- Colors ----------

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))

const toHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')

/**
 * The three numbers of a `{ a b c }` body, or null when it isn't three numbers.
 */
function triple(body: string): number[] | null {
  const parts = body
    .replace(/#[^\n]*/g, ' ')
    .trim()
    .split(/\s+/)
  if (parts.length !== 3) return null
  const nums = parts.map(Number)
  return nums.some((n) => Number.isNaN(n)) ? null : nums
}

/**
 * CK3 reads an all-integer triple as 0-255 and anything with a decimal point
 * as 0-1, which is also how the game's own files mix the two.
 */
function isFloatTriple(body: string): boolean {
  return /\d*\.\d/.test(body.replace(/#[^\n]*/g, ' '))
}

function rgbHex(body: string): string | null {
  const nums = triple(body)
  if (nums === null) return null
  const scale = isFloatTriple(body) ? 255 : 1
  return toHex(nums[0] * scale, nums[1] * scale, nums[2] * scale)
}

/** h, s, v each 0-1 -> "#rrggbb". */
function hsvHex(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = v - c
  const sector = Math.floor(h * 6) % 6
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x]
  ][sector < 0 ? sector + 6 : sector]
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

/**
 * Swatches from `common/named_colors`, which real files reference by bare name
 * (`color = basque`). Entries written as `hsv{ … }` aren't blocks and are
 * skipped — they resolve to no swatch rather than a wrong one.
 */
export function readNamedColors(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): Map<string, string> {
  const colors = new Map<string, string>()
  for (const path of effectiveFiles(gameDir, modPath, replacePaths, NAMED_COLOR_DIR)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    for (const outer of scanBlocks(text)) {
      const body = text.slice(outer.bodyStart, outer.bodyEnd)
      for (const entry of scanBlocks(body)) {
        const hex = rgbHex(body.slice(entry.bodyStart, entry.bodyEnd))
        if (hex !== null) colors.set(norm(entry.key), hex)
      }
    }
  }
  return colors
}

/**
 * The depth-0 `color = …` statement of a body, stripped of its comment and of
 * the `\r` a CRLF file leaves on every line.
 */
function colorStatement(body: string): string | null {
  for (const { text, depth } of annotateLines(body)) {
    if (depth !== 0) continue
    const m = text.split('#')[0].match(/^\s*color\s*=\s*(\S.*)/i)
    if (m) return m[1].trim()
  }
  return null
}

export function parseColor(body: string, named: Map<string, string>): FaithColor | null {
  // A plain `color = { … }` is a depth-0 block, so it is read from the span
  // rather than the line — real files wrap long triples across lines.
  const block = scanBlocks(body).find((b) => b.key.toLowerCase() === 'color')
  if (block) {
    const inner = body.slice(block.bodyStart, block.bodyEnd)
    const hex = rgbHex(inner)
    return { hex, raw: `{${inner}}`.replace(/\s+/g, ' '), editable: hex !== null }
  }

  const statement = colorStatement(body)
  if (statement === null) return null

  const hsv = statement.match(/^(hsv360|hsv)\s*\{([^}]*)\}/i)
  if (hsv) {
    const nums = triple(hsv[2])
    const scale = hsv[1].toLowerCase() === 'hsv360' ? [360, 100, 100] : [1, 1, 1]
    return {
      hex:
        nums === null ? null : hsvHex(nums[0] / scale[0], nums[1] / scale[1], nums[2] / scale[2]),
      raw: statement,
      editable: false
    }
  }

  const name = statement.match(/^([A-Za-z0-9_.\-']+)/)
  return {
    hex: name === null ? null : (named.get(norm(name[1])) ?? null),
    raw: statement,
    editable: false
  }
}

// ---------- Reference lists ----------

/** Localization key a doctrine (or doctrine group) puts its display name under. */
const doctrineLocKey = (id: string): string => `${id}_name`

/** A `$other_key$` reference, which localization uses to alias one entry to another. */
const LOC_REF = /\$([A-Za-z0-9_.\-']+)\$/g

/**
 * Substitute `$other_key$` references in the values already collected.
 *
 * Half the special doctrine groups name themselves by aliasing another entry
 * (`$special_doctrine_is_christian_faith_name$`), and the by-key scan that
 * fetched them didn't know to fetch what they point at — so the referenced keys
 * are read in a second pass. One round only: what a substituted value refers to
 * in turn is left as written, the way raw values read elsewhere in the app.
 */
export function expandLocRefs(
  loc: Map<string, string>,
  gameDir: string | null,
  modPath: string | null
): void {
  const missing = new Set<string>()
  for (const value of loc.values()) {
    for (const m of value.matchAll(LOC_REF)) if (!loc.has(m[1])) missing.add(m[1])
  }
  const extra =
    missing.size === 0
      ? new Map<string, string>()
      : readLocalization(gameDir, modPath, null, (key) => missing.has(key))
  for (const [key, value] of loc) {
    const expanded = value.replace(
      LOC_REF,
      (whole, ref: string) => loc.get(ref) ?? extra.get(ref) ?? whole
    )
    if (expanded !== value) loc.set(key, expanded)
  }
}

/** Holy sites localize as `holy_site_<id>_name`. */
const holySiteLocKey = (id: string): string => `holy_site_${id}_name`

/**
 * `effectiveFiles` order with the mod's files first, so a "first definition of
 * this id wins" scan lets mod content beat the game's. (Files of the same name
 * are already resolved in the mod's favour; this covers ids the mod moved into
 * a file of its own.)
 */
export function modFirst(files: string[], modPath: string | null): string[] {
  return [...files].sort((a, b) => Number(isUnderDir(b, modPath)) - Number(isUnderDir(a, modPath)))
}

function topLevelKeys(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  relDir: string
): string[] {
  const keys = new Set<string>()
  for (const path of effectiveFiles(gameDir, modPath, replacePaths, relDir)) {
    try {
      for (const block of scanBlocks(readFileSync(path, 'utf-8'))) keys.add(block.key)
    } catch {
      // skip unreadable files
    }
  }
  return [...keys].sort()
}

interface RawGroup {
  id: string
  category: string | null
  picks: number
  doctrines: string[]
}

function readDoctrineGroups(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): RawGroup[] {
  const groups: RawGroup[] = []
  const seen = new Set<string>()
  for (const path of modFirst(
    effectiveFiles(gameDir, modPath, replacePaths, DOCTRINE_GROUP_DIR),
    modPath
  )) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      if (seen.has(block.key)) continue
      seen.add(block.key)
      const body = text.slice(block.bodyStart, block.bodyEnd)
      const scalars = scanScalarsCI(body)
      const list = scanBlocks(body).find((b) => b.key === 'doctrine_types')
      const doctrines =
        list === undefined
          ? []
          : body
              .slice(list.bodyStart, list.bodyEnd)
              .replace(/#[^\n]*/g, ' ')
              .trim()
              .split(/\s+/)
              .filter((t) => t !== '')
      const picks = Number(scalars.get('number_of_picks'))
      groups.push({
        id: block.key,
        category: scalars.get('category') ?? null,
        picks: Number.isFinite(picks) && picks > 0 ? picks : 1,
        doctrines
      })
    }
  }
  // Since 1.20, doctrines declare their group and index instead of the group
  // listing members. Resolve effective definitions first so mod overrides win.
  const members = new Map<string, { id: string; group: string; index: number }>()
  const seenDoctrines = new Set<string>()
  for (const path of modFirst(
    effectiveFiles(gameDir, modPath, replacePaths, DOCTRINE_DIR),
    modPath
  )) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      if (seenDoctrines.has(norm(block.key))) continue
      seenDoctrines.add(norm(block.key))
      const scalars = scanScalarsCI(text.slice(block.bodyStart, block.bodyEnd))
      const group = scalars.get('doctrine_group_type')
      if (group)
        members.set(norm(block.key), {
          id: block.key,
          group,
          index: Number(scalars.get('index') ?? 0)
        })
    }
  }
  for (const group of groups) {
    const declared = [...members.values()]
      .filter((d) => norm(d.group) === norm(group.id))
      .sort((a, b) => a.index - b.index)
      .map((d) => d.id)
    group.doctrines = [
      ...group.doctrines,
      ...declared.filter((d) => !group.doctrines.some((old) => norm(old) === norm(d)))
    ]
  }
  return groups
}

// ---------- Definitions ----------

/** The `faiths = { … }` sub-block of a religion body, if it has one. */
function faithsBlock(religionBody: string): BlockSpan | null {
  return scanBlocks(religionBody).find((b) => b.key.toLowerCase() === 'faiths') ?? null
}

function parseReligion(body: string, id: string, file: string, inMod: boolean): ReligionDef {
  const details = nestedBody(body, 'religion_details')
  const scalars = scanScalarsCI(details ?? body)
  return {
    options: readReligionOptions(body),
    id,
    file,
    inMod,
    format: details === null ? 'legacy' : '1.20',
    family: scalars.get('family') ?? null,
    graphicalFaith: scalars.get('graphical_faith') ?? null,
    pietyIconGroup: scalars.get('piety_icon_group') ?? null,
    doctrines: scanRepeatedScalarCI(body, 'doctrine'),
    localizedName: null
  }
}

function parseFaith(
  body: string,
  id: string,
  religion: string,
  file: string,
  inMod: boolean,
  named: Map<string, string>
): FaithDef {
  const details = nestedBody(body, 'faith_details')
  const scalars = scanScalarsCI(details ?? body)
  const modern = details !== null
  return {
    options: readFaithOptions(body),
    id,
    file,
    inMod,
    religion: modern ? (scalars.get('religion') ?? '') : religion,
    format: modern ? '1.20' : 'legacy',
    mainRite: modern ? (scanScalarsCI(body).get('main_rite') ?? null) : null,
    tenets: modern ? blockList(body, 'tenets') : [],
    eminentHolySites: modern ? blockList(body, 'eminent_holy_sites') : [],
    color: parseColor(details ?? body, named),
    icon: scalars.get('icon') ?? null,
    reformedIcon: scalars.get('reformed_icon') ?? null,
    religiousHead: scalars.get('religious_head') ?? null,
    doctrines: modern ? blockList(body, 'doctrines') : scanRepeatedScalarCI(body, 'doctrine'),
    holySites: modern ? blockList(body, 'holy_sites') : scanRepeatedScalarCI(body, 'holy_site'),
    localizedName: null
  }
}

// ---------- Adherents ----------

/** Character id -> the faith its history entry professes, over the whole mod. */
function listAdherents(modPath: string, rites: RiteDef[]): FaithAdherent[] {
  const dir = join(modPath, 'history', 'characters')
  if (!existsSync(dir)) return []
  const adherents: FaithAdherent[] = []
  for (const entry of readdirSync(dir)) {
    if (!entry.toLowerCase().endsWith('.txt')) continue
    let text: string
    try {
      text = readFileSync(join(dir, entry), 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      const scalars = scanScalarsCI(text.slice(block.bodyStart, block.bodyEnd))
      // `faith` and `religion` are the same field under two spellings
      const rite = scalars.get('rite')
      const parent = rite ? rites.find((r) => norm(r.id) === norm(rite))?.faith : null
      const faith = parent ?? scalars.get('faith') ?? scalars.get('religion') ?? rite
      if (faith === undefined) continue
      adherents.push({
        id: block.key,
        file: entry,
        name: scalars.get('name') ?? null,
        faith,
        rite: rite ?? null
      })
    }
  }
  return adherents
}

// ---------- Assembly ----------

export function getReligionData(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): ReligionData {
  const named = readNamedColors(gameDir, modPath, replacePaths)

  const religions: ReligionDef[] = []
  const faiths: FaithDef[] = []
  // Unlike dynasties (where the game ships tens of thousands), the whole set of
  // religions and faiths is small enough to list outright, and the game's are
  // the reference a modder copies from. Mod definitions win on a clash.
  const seenReligions = new Set<string>()
  const seenFaiths = new Set<string>()
  // Scan standalone and nested definitions together, always mod first.
  const standalonePaths = new Set(effectiveFiles(gameDir, modPath, replacePaths, FAITH_DIR))
  for (const path of modFirst(
    [...standalonePaths, ...effectiveFiles(gameDir, modPath, replacePaths, RELIGION_DIR)],
    modPath
  )) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    const file = basename(path)
    const inMod = isUnderDir(path, modPath)
    for (const block of scanBlocks(text)) {
      if (standalonePaths.has(path)) {
        if (!seenFaiths.has(norm(block.key))) {
          seenFaiths.add(norm(block.key))
          faiths.push(
            parseFaith(
              text.slice(block.bodyStart, block.bodyEnd),
              block.key,
              '',
              file,
              inMod,
              named
            )
          )
        }
        continue
      }
      if (seenReligions.has(norm(block.key))) continue
      seenReligions.add(norm(block.key))
      const body = text.slice(block.bodyStart, block.bodyEnd)
      religions.push(parseReligion(body, block.key, file, inMod))
      const list = faithsBlock(body)
      if (list === null) continue
      const listBody = body.slice(list.bodyStart, list.bodyEnd)
      for (const faith of scanBlocks(listBody)) {
        if (seenFaiths.has(norm(faith.key))) continue
        seenFaiths.add(norm(faith.key))
        faiths.push(
          parseFaith(
            listBody.slice(faith.bodyStart, faith.bodyEnd),
            faith.key,
            block.key,
            file,
            inMod,
            named
          )
        )
      }
    }
  }

  const rawGroups = readDoctrineGroups(gameDir, modPath, replacePaths)
  const allDoctrines = topLevelKeys(gameDir, modPath, replacePaths, DOCTRINE_DIR)
  const holySites = topLevelKeys(gameDir, modPath, replacePaths, HOLY_SITE_DIR)
  const families = topLevelKeys(gameDir, modPath, replacePaths, FAMILY_DIR)
  const tenets = topLevelKeys(gameDir, modPath, replacePaths, TENET_DIR)
  const rites: RiteDef[] = []
  const riteNames = new Map<string, string>()
  const seenRites = new Set<string>()
  for (const path of modFirst(effectiveFiles(gameDir, modPath, replacePaths, RITE_DIR), modPath)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      if (seenRites.has(norm(block.key))) continue
      seenRites.add(norm(block.key))
      const body = text.slice(block.bodyStart, block.bodyEnd)
      const scalars = scanScalarsCI(body)
      riteNames.set(block.key, scalars.get('name') ?? block.key)
      rites.push({
        options: readRiteOptions(body),
        dynamicName: nestedBody(body, 'name') !== null,
        dynamicDescription: nestedBody(body, 'desc') !== null,
        id: block.key,
        file: basename(path),
        inMod: isUnderDir(path, modPath),
        localizedName: null,
        faith: scalars.get('faith') ?? null,
        color: parseColor(body, named),
        icon: scalars.get('icon') ?? null,
        founder: scalars.get('founder') ?? null,
        create: scalars.get('create') ?? null,
        convert: scalars.get('convert') ?? null,
        doctrines: blockList(body, 'doctrines'),
        tenets: blockList(body, 'tenets')
      })
    }
  }

  // Religions, faiths and families localize under their own id; doctrines and
  // doctrine groups under `<id>_name`; holy sites under `holy_site_<id>_name`.
  // Those keys are scattered across the whole english tree (DLC folders
  // included), so the scan is narrowed by key rather than by folder.
  const wanted = new Set<string>([
    ...religions.map((r) => r.id),
    ...faiths.map((f) => f.id),
    ...riteNames.values(),
    ...tenets.map(doctrineLocKey),
    ...families,
    ...allDoctrines.map(doctrineLocKey),
    ...rawGroups.map((g) => doctrineLocKey(g.id)),
    ...holySites.map(holySiteLocKey)
  ])
  const loc = readLocalization(gameDir, modPath, null, (key) => wanted.has(key))
  expandLocRefs(loc, gameDir, modPath)
  const locName = (key: string): string | null => loc.get(key) ?? null

  for (const r of religions) r.localizedName = locName(r.id)
  for (const f of faiths) f.localizedName = locName(f.id)
  for (const r of rites) r.localizedName = locName(riteNames.get(r.id) ?? r.id)

  const grouped = new Set(rawGroups.flatMap((g) => g.doctrines))
  const doctrineEntry = (id: string): RefEntry => ({ id, name: locName(doctrineLocKey(id)) })

  return {
    religions,
    faiths,
    format: religionFormat(gameDir, modPath),
    rites,
    tenets: tenets.map(doctrineEntry),
    groups: rawGroups.map((g) => ({
      id: g.id,
      category: g.category,
      picks: g.picks,
      name: locName(doctrineLocKey(g.id)),
      doctrines: g.doctrines.map(doctrineEntry)
    })),
    ungroupedDoctrines: allDoctrines.filter((d) => !grouped.has(d)).map(doctrineEntry),
    holySites: holySites.map((id) => ({ id, name: locName(holySiteLocKey(id)) })),
    families: families.map((id) => ({ id, name: locName(id) })),
    adherents: modPath ? listAdherents(modPath, rites) : []
  }
}

// ---------- Saving ----------

/** Block lists are only rewritten after an edit, preserving comments on no-op saves. */
function setListIfChanged(
  ed: ReturnType<typeof makeEditor>,
  key: string,
  values: string[] | undefined
): void {
  if (
    values !== undefined &&
    JSON.stringify(blockList(ed.lines.join('\n'), key)) !== JSON.stringify(values)
  ) {
    setBlockList(ed, key, values)
  }
}

function saveModernFaithBody(body: string, patch: FaithPatch): string {
  const details = scanBlocks(body).find((b) => norm(b.key) === 'faith_details')
  if (!details) throw new Error('Faith has no faith_details block')
  const inner = body.slice(details.bodyStart, details.bodyEnd)
  const ed = makeEditor(setColor(inner, patch.color, parseColor(inner, new Map())))
  setScalar(ed, ['icon'], patch.icon, { ignoreCase: true })
  setScalar(ed, ['reformed_icon'], patch.reformedIcon, { ignoreCase: true })
  setScalar(ed, ['religious_head'], patch.religiousHead, { ignoreCase: true })
  const outer = makeEditor(spliceBody(body, details, ed.lines.join('\n')))
  if (patch.mainRite !== undefined)
    setScalar(outer, ['main_rite'], patch.mainRite, { ignoreCase: true })
  setListIfChanged(outer, 'holy_sites', patch.holySites)
  setListIfChanged(outer, 'eminent_holy_sites', patch.eminentHolySites)
  setListIfChanged(outer, 'doctrines', patch.doctrines)
  setListIfChanged(outer, 'tenets', patch.tenets)
  return applyFaithOptions(outer.lines.join('\n'), patch.options)
}

/** Rewrite a block's body in place, leaving the rest of the file byte-identical. */
function spliceBody(text: string, block: BlockSpan, body: string): string {
  return text.slice(0, block.bodyStart) + body + text.slice(block.bodyEnd)
}

/**
 * Set the `color = { r g b }` triple from a "#rrggbb" value, keeping the
 * numeric style the line already used. Writes nothing when the colour is
 * unchanged or the file's form isn't a rewritable triple, so an untouched save
 * round-trips exactly.
 */
export function setColor(body: string, hex: string | null, current: FaithColor | null): string {
  if (hex === null || current === null || !current.editable) return body
  if (current.hex !== null && current.hex.toLowerCase() === hex.toLowerCase()) return body
  const block = scanBlocks(body).find((b) => b.key.toLowerCase() === 'color')
  if (!block) return body
  const inner = body.slice(block.bodyStart, block.bodyEnd)
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const written = isFloatTriple(inner)
    ? [r, g, b].map((c) => (c / 255).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0')).join(' ')
    : [r, g, b].join(' ')
  return spliceBody(body, block, ` ${written} `)
}

function saveFaithBody(body: string, patch: FaithPatch, current: FaithColor | null): string {
  const ed = makeEditor(setColor(body, patch.color, current))
  setScalar(ed, ['icon'], patch.icon, { ignoreCase: true })
  setScalar(ed, ['reformed_icon'], patch.reformedIcon, { ignoreCase: true })
  setScalar(ed, ['religious_head'], patch.religiousHead, { ignoreCase: true })
  setRepeatedScalar(ed, 'holy_site', patch.holySites, { ignoreCase: true })
  setRepeatedScalar(ed, 'doctrine', patch.doctrines, { ignoreCase: true })
  return ed.lines.join('\n')
}

/**
 * Locate `<religionId> = { faiths = { <faithId> = { … } } }` and rewrite the
 * faith's body. Offsets are composed rather than the file re-scanned, so the
 * splice is exact.
 */
export function saveFaith(
  modPath: string,
  file: string,
  religionId: string,
  faithId: string,
  patch: FaithPatch
): SaveResult {
  try {
    if (!isTxtFileName(file)) return { ok: false, error: 'Invalid file name' }
    const modernPath = join(modPath, ...FAITH_DIR.split('/'), file)
    if (
      patch.format === '1.20' ||
      (patch.format === undefined &&
        existsSync(modernPath) &&
        !existsSync(join(modPath, ...RELIGION_DIR.split('/'), file)))
    ) {
      if (!existsSync(modernPath)) return { ok: false, error: `File not found: ${file}` }
      const text = readFileSync(modernPath, 'utf-8')
      const faith = scanBlocks(text).find((b) => norm(b.key) === norm(faithId))
      if (!faith) return { ok: false, error: `${faithId} not found in ${file}` }
      const body = text.slice(faith.bodyStart, faith.bodyEnd)
      const parent = scanScalarsCI(nestedBody(body, 'faith_details') ?? '').get('religion')
      if (norm(parent ?? '') !== norm(religionId))
        return { ok: false, error: 'Faith parent religion changed; reload before saving' }
      if (patch.eminentHolySites?.some((s) => patch.holySites.some((h) => norm(s) === norm(h)))) {
        return { ok: false, error: 'A holy site cannot be both ordinary and eminent' }
      }
      writeFileSync(modernPath, spliceBody(text, faith, saveModernFaithBody(body, patch)), 'utf-8')
      return { ok: true }
    }
    const path = join(modPath, ...RELIGION_DIR.split('/'), file)
    if (!existsSync(path)) return { ok: false, error: `File not found: ${file}` }
    const text = readFileSync(path, 'utf-8')
    const religion = scanBlocks(text).find((b) => norm(b.key) === norm(religionId))
    if (!religion) return { ok: false, error: `${religionId} not found in ${file}` }
    const religionBody = text.slice(religion.bodyStart, religion.bodyEnd)
    const list = faithsBlock(religionBody)
    if (!list) return { ok: false, error: `${religionId} has no faiths block in ${file}` }
    const listBody = religionBody.slice(list.bodyStart, list.bodyEnd)
    const faith = scanBlocks(listBody).find((b) => norm(b.key) === norm(faithId))
    if (!faith) return { ok: false, error: `${faithId} not found in ${religionId}` }

    const body = listBody.slice(faith.bodyStart, faith.bodyEnd)
    const start = religion.bodyStart + list.bodyStart + faith.bodyStart
    const end = religion.bodyStart + list.bodyStart + faith.bodyEnd
    const updated =
      text.slice(0, start) +
      applyFaithOptions(saveFaithBody(body, patch, parseColor(body, new Map())), patch.options) +
      text.slice(end)
    writeFileSync(path, updated, 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function saveReligion(
  modPath: string,
  file: string,
  religionId: string,
  patch: ReligionPatch
): SaveResult {
  try {
    if (!isTxtFileName(file)) return { ok: false, error: 'Invalid file name' }
    const path = join(modPath, ...RELIGION_DIR.split('/'), file)
    if (!existsSync(path)) return { ok: false, error: `File not found: ${file}` }
    const text = readFileSync(path, 'utf-8')
    const religion = scanBlocks(text).find((b) => norm(b.key) === norm(religionId))
    if (!religion) return { ok: false, error: `${religionId} not found in ${file}` }

    const body = text.slice(religion.bodyStart, religion.bodyEnd)
    const details = scanBlocks(body).find((b) => norm(b.key) === 'religion_details')
    const ed = makeEditor(details ? body.slice(details.bodyStart, details.bodyEnd) : body)
    setScalar(ed, ['family'], patch.family, { ignoreCase: true })
    setScalar(ed, ['graphical_faith'], patch.graphicalFaith, { ignoreCase: true })
    setScalar(ed, ['piety_icon_group'], patch.pietyIconGroup, { quoteNew: true, ignoreCase: true })
    const outer = details ? makeEditor(spliceBody(body, details, ed.lines.join('\n'))) : ed
    setRepeatedScalar(outer, 'doctrine', patch.doctrines, { ignoreCase: true })
    writeFileSync(
      path,
      spliceBody(text, religion, applyReligionOptions(outer.lines.join('\n'), patch.options)),
      'utf-8'
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------- Creating ----------

/** .txt files under the mod's religion_types folder, for the create panel's picker. */
export function listReligionFiles(modPath: string): string[] {
  const dir = join(modPath, ...RELIGION_DIR.split('/'))
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.txt'))
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Every religion and faith id the mod itself defines, normalized, mapped to
 * the file it lives in. Only the mod's own files: shadowing a base-game id is
 * a legal way to override it, so that stays the caller's call.
 */
function modDefinitions(modPath: string): {
  religions: Map<string, string>
  faiths: Map<string, string>
} {
  const religions = new Map<string, string>()
  const faiths = new Map<string, string>()
  for (const path of effectiveFiles(null, modPath, [], FAITH_DIR)) {
    for (const faith of scanBlocks(readFileSync(path, 'utf-8')))
      faiths.set(norm(faith.key), basename(path))
  }
  for (const path of effectiveFiles(null, modPath, [], RELIGION_DIR)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    const file = basename(path)
    for (const religion of scanBlocks(text)) {
      if (!religions.has(norm(religion.key))) religions.set(norm(religion.key), file)
      const body = text.slice(religion.bodyStart, religion.bodyEnd)
      const list = faithsBlock(body)
      if (list === null) continue
      for (const faith of scanBlocks(body.slice(list.bodyStart, list.bodyEnd))) {
        if (!faiths.has(norm(faith.key))) faiths.set(norm(faith.key), file)
      }
    }
  }
  return { religions, faiths }
}

/**
 * Reject an id the mod already uses. Religions and faiths are separate
 * databases in the game, but the editor resolves a deep-linked id against
 * both, so a cross-kind clash is ambiguous here and rejected too.
 */
function newIdError(modPath: string, kind: 'religion' | 'faith', rawId: string): string | null {
  const id = rawId.trim()
  if (!id) return 'ID must not be empty'
  if (!KEY_CHARS.test(id)) return `Invalid ID "${id}" (letters, digits, _ . - ' only)`
  const defs = modDefinitions(modPath)
  for (const other of ['religion', 'faith'] as const) {
    const clash = (other === 'religion' ? defs.religions : defs.faiths).get(norm(id))
    if (clash === undefined) continue
    return other === kind
      ? `ID ${id} already exists in ${clash}`
      : `ID ${id} is already a ${other}, defined in ${clash}`
  }
  return null
}

/** "#rrggbb" -> "{ r g b }" in 0-255 integers, the unambiguous triple form. */
export function colorTriple(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `{ ${r} ${g} ${b} }`
}

/**
 * The scalar and repeated lines of a new faith body, unindented — the caller
 * prefixes each line with where the block lands.
 */
function newFaithLines(def: NewFaith): string[] {
  const lines: string[] = []
  if (def.color !== null && /^#[0-9a-fA-F]{6}$/.test(def.color)) {
    lines.push(`color = ${colorTriple(def.color)}`)
  }
  const scalar = (key: string, value: string | null): void => {
    if (value !== null && value.trim() !== '') lines.push(`${key} = ${value.trim()}`)
  }
  scalar('icon', def.icon)
  scalar('reformed_icon', def.reformedIcon)
  scalar('religious_head', def.religiousHead)
  for (const site of def.holySites) lines.push(`holy_site = ${site}`)
  for (const doctrine of def.doctrines) lines.push(`doctrine = ${doctrine}`)
  return def.options ? applyFaithOptions(lines.join('\n'), def.options).split('\n') : lines
}

function optionsOnLines(lines: string[], apply: (body: string) => string): string[] {
  const text = lines.join('\n')
  const block = scanBlocks(text)[0]
  return spliceBody(text, block, apply(text.slice(block.bodyStart, block.bodyEnd))).split('\n')
}

/**
 * Append a brand-new religion block to one of the mod's files (created if
 * missing), with an empty `faiths = { }` ready to take faiths. Existing
 * content is preserved byte-for-byte; the block follows a separating blank
 * line, in the file's own line-ending style.
 */
export function createReligion(modPath: string, file: string, def: NewReligion): SaveResult {
  try {
    const idError = newIdError(modPath, 'religion', def.id)
    if (idError !== null) return { ok: false, error: idError }
    if (!isTxtFileName(file)) {
      return { ok: false, error: `Invalid file name "${file}" (expected a .txt file name)` }
    }
    if (!def.family?.trim()) return { ok: false, error: 'Family is required' }

    const id = def.id.trim()
    if (
      def.format === '1.20' ||
      (def.format === undefined && religionFormat(null, modPath) === '1.20')
    ) {
      const lines = [`${id} = {`, '\treligion_details = {', `\t\tfamily = ${def.family.trim()}`]
      if (def.graphicalFaith?.trim())
        lines.push(`\t\tgraphical_faith = ${def.graphicalFaith.trim()}`)
      if (def.pietyIconGroup?.trim())
        lines.push(`\t\tpiety_icon_group = "${def.pietyIconGroup.trim()}"`)
      lines.push('\t}')
      for (const doctrine of def.doctrines) lines.push(`\tdoctrine = ${doctrine}`)
      lines.push('}')
      appendBlock(
        join(modPath, ...RELIGION_DIR.split('/')),
        file,
        optionsOnLines(lines, (body) => applyReligionOptions(body, def.options))
      )
      return { ok: true }
    }
    const lines = [`${id} = {`, `\tfamily = ${def.family.trim()}`]
    if (def.graphicalFaith?.trim()) lines.push(`\tgraphical_faith = ${def.graphicalFaith.trim()}`)
    if (def.pietyIconGroup?.trim()) {
      lines.push(`\tpiety_icon_group = "${def.pietyIconGroup.trim()}"`)
    }
    for (const doctrine of def.doctrines) lines.push(`\tdoctrine = ${doctrine}`)
    lines.push('', '\tfaiths = {', '\t}', '}')
    appendBlock(
      join(modPath, ...RELIGION_DIR.split('/')),
      file,
      optionsOnLines(lines, (body) => applyReligionOptions(body, def.options))
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Leading whitespace of the line `offset` sits on. */
function lineIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  return text.slice(lineStart).match(/^[ \t]*/)![0]
}

export function listRiteFiles(modPath: string): string[] {
  return effectiveFiles(null, modPath, [], RITE_DIR)
    .map((path) => basename(path))
    .sort()
}

export function saveRite(modPath: string, file: string, id: string, patch: RitePatch): SaveResult {
  try {
    if (!isTxtFileName(file)) return { ok: false, error: 'Invalid file name' }
    const path = join(modPath, ...RITE_DIR.split('/'), file)
    const text = readFileSync(path, 'utf-8')
    const block = scanBlocks(text).find((b) => norm(b.key) === norm(id))
    if (!block) return { ok: false, error: `${id} not found in ${file}` }
    const body = text.slice(block.bodyStart, block.bodyEnd)
    const ed = makeEditor(setColor(body, patch.color, parseColor(body, new Map())))
    for (const [key, value] of [
      ['faith', patch.faith],
      ['icon', patch.icon],
      ['founder', patch.founder],
      ['create', patch.create],
      ['convert', patch.convert]
    ] as const) {
      setScalar(ed, [key], value, { ignoreCase: true })
    }
    setListIfChanged(ed, 'doctrines', patch.doctrines)
    setListIfChanged(ed, 'tenets', patch.tenets)
    writeFileSync(
      path,
      spliceBody(text, block, applyRiteOptions(ed.lines.join('\n'), patch.options)),
      'utf-8'
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function createRite(modPath: string, file: string, def: NewRite): SaveResult {
  try {
    const id = def.id.trim()
    if (!KEY_CHARS.test(id)) return { ok: false, error: 'Invalid rite id' }
    if (!isTxtFileName(file)) return { ok: false, error: 'Invalid file name' }
    for (const path of effectiveFiles(null, modPath, [], RITE_DIR)) {
      if (scanBlocks(readFileSync(path, 'utf-8')).some((b) => norm(b.key) === norm(id))) {
        return { ok: false, error: `Rite ${id} already exists in ${basename(path)}` }
      }
    }
    const lines = [`${id} = {`]
    for (const [key, value] of [
      ['faith', def.faith],
      ['icon', def.icon],
      ['founder', def.founder],
      ['create', def.create],
      ['convert', def.convert]
    ] as const) {
      if (value?.trim()) lines.push(`\t${key} = ${value.trim()}`)
    }
    if (def.color && /^#[0-9a-fA-F]{6}$/.test(def.color))
      lines.push(`\tcolor = ${colorTriple(def.color)}`)
    if (def.tenets.length) lines.push(`\ttenets = { ${def.tenets.join(' ')} }`)
    if (def.doctrines.length) lines.push(`\tdoctrines = { ${def.doctrines.join(' ')} }`)
    lines.push('}')
    appendBlock(
      join(modPath, ...RITE_DIR.split('/')),
      file,
      optionsOnLines(lines, (body) => applyRiteOptions(body, def.options))
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Nest a brand-new faith block into `religionId`'s `faiths = { … }` block —
 * created at the end of the religion's body when it doesn't exist yet. The
 * religion must be defined in the mod: game files can't be edited, and CK3
 * offers no way to extend a religion's faith list from outside its block, so
 * a game religion has to be copied into the mod first.
 *
 * Everything outside the splice point survives byte-for-byte; inserted lines
 * follow the file's own indentation unit and line-ending style.
 */
export function createFaith(modPath: string, religionId: string, def: NewFaith): SaveResult {
  try {
    const idError = newIdError(modPath, 'faith', def.id)
    if (idError !== null) return { ok: false, error: idError }
    if (!KEY_CHARS.test(religionId.trim()))
      return { ok: false, error: 'Invalid parent religion id' }
    if (
      def.format === '1.20' ||
      (def.format === undefined && religionFormat(null, modPath) === '1.20')
    ) {
      const file = def.file ?? `${def.id.trim()}.txt`
      if (!isTxtFileName(file)) return { ok: false, error: 'Invalid faith file name' }
      if (def.eminentHolySites?.some((s) => def.holySites.some((h) => norm(s) === norm(h)))) {
        return { ok: false, error: 'A holy site cannot be both ordinary and eminent' }
      }
      const lines = [
        `${def.id.trim()} = {`,
        '\tfaith_details = {',
        `\t\treligion = ${religionId.trim()}`
      ]
      if (def.color && /^#[0-9a-fA-F]{6}$/.test(def.color))
        lines.push(`\t\tcolor = ${colorTriple(def.color)}`)
      for (const [key, value] of [
        ['icon', def.icon],
        ['reformed_icon', def.reformedIcon],
        ['religious_head', def.religiousHead]
      ] as const) {
        if (value?.trim()) lines.push(`\t\t${key} = ${value.trim()}`)
      }
      lines.push('\t}')
      if (def.mainRite?.trim()) lines.push(`\tmain_rite = ${def.mainRite.trim()}`)
      for (const [key, values] of [
        ['holy_sites', def.holySites],
        ['eminent_holy_sites', def.eminentHolySites],
        ['doctrines', def.doctrines],
        ['tenets', def.tenets]
      ] as const) {
        if (values?.length) lines.push(`\t${key} = { ${values.join(' ')} }`)
      }
      lines.push('}')
      appendBlock(
        join(modPath, ...FAITH_DIR.split('/')),
        file,
        optionsOnLines(lines, (body) => applyFaithOptions(body, def.options))
      )
      return { ok: true }
    }

    let found: { path: string; text: string; religion: BlockSpan } | null = null
    for (const path of effectiveFiles(null, modPath, [], RELIGION_DIR)) {
      let text: string
      try {
        text = readFileSync(path, 'utf-8')
      } catch {
        continue
      }
      const religion = scanBlocks(text).find((b) => norm(b.key) === norm(religionId))
      if (religion) {
        found = { path, text, religion }
        break
      }
    }
    if (found === null) {
      return {
        ok: false,
        error: `Religion ${religionId} isn't defined in the mod — copy a game religion into the mod before adding faiths to it`
      }
    }

    const { path, text, religion } = found
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const body = text.slice(religion.bodyStart, religion.bodyEnd)
    // One indentation level, as the file writes it (religion children sit one
    // level in); faiths' children sit two, their scalars three
    const unit = makeEditor(body).indent
    const id = def.id.trim()
    const block = [
      `${unit}${unit}${id} = {`,
      ...newFaithLines(def).map((l) => `${unit}${unit}${unit}${l}`),
      `${unit}${unit}}`
    ]

    const list = faithsBlock(body)
    let newBody: string
    if (list !== null) {
      // Splice before the faiths block's closing brace, after its last content
      const inner = body.slice(list.bodyStart, list.bodyEnd)
      const trailing = inner.match(/\s*$/)![0]
      const content = inner.slice(0, inner.length - trailing.length)
      const closingIndent = trailing.includes('\n')
        ? trailing.slice(trailing.lastIndexOf('\n') + 1)
        : lineIndentAt(body, list.start)
      const sep = content === '' ? eol : eol + eol
      const newInner = content + sep + block.join(eol) + eol + closingIndent
      newBody = body.slice(0, list.bodyStart) + newInner + body.slice(list.bodyEnd)
    } else {
      // No faiths block at all — append one at the end of the religion's body
      const trailing = body.match(/\s*$/)![0]
      const content = body.slice(0, body.length - trailing.length)
      const closingIndent = trailing.includes('\n')
        ? trailing.slice(trailing.lastIndexOf('\n') + 1)
        : lineIndentAt(text, religion.start)
      const faithsLines = [`${unit}faiths = {`, ...block, `${unit}}`]
      const sep = content === '' ? eol : eol + eol
      newBody = content + sep + faithsLines.join(eol) + eol + closingIndent
    }
    writeFileSync(path, spliceBody(text, religion, newBody), 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
