import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { readLocalization } from './localization'
import { scanBlocks, scanScalars, scanScalarsCI } from '@shared/pdx'
import { FAITH_DIR, RITE_DIR, TENET_DIR, nestedBody } from './religionSchema'
import type { RefEntry, RefKind, RefLocation, ReferenceData } from '@shared/types'

/**
 * Is `file` inside `dir`? Compared separator- and case-insensitively: mod paths
 * come from .mod descriptors, which write them with forward slashes, while the
 * files we scan are built with native separators. A raw `startsWith` between
 * the two never matches, which would misreport every mod file as a game file.
 */
export function isUnderDir(file: string, dir: string | null): boolean {
  if (dir === null) return false
  const key = (p: string): string => p.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()
  return key(file).startsWith(key(dir) + '\\')
}

/**
 * How CK3 layers mod content over the base game, at the granularity we need:
 * - A mod file with the same relative path as a game file replaces it entirely.
 * - A `replace_path` in the .mod descriptor removes the whole game folder from
 *   loading — only the mod's files (if any) exist under that path.
 * Cross-file merging beyond that (same key in two files) doesn't matter for
 * collecting ids: we union keys from every effective file.
 */
export function effectiveFiles(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  relDir: string,
  recursive = false
): string[] {
  const files = new Map<string, string>() // file name -> full path
  const normalizedRel = relDir.replace(/\\/g, '/').toLowerCase()
  const isReplaced = (rel: string): boolean =>
    replacePaths.some((rp) => {
      const nrp = rp.replace(/\\/g, '/').toLowerCase()
      return rel.toLowerCase() === nrp || rel.toLowerCase().startsWith(nrp + '/')
    })
  const replaced = isReplaced(normalizedRel)
  const dirs: string[] = []
  if (gameDir && !replaced) dirs.push(join(gameDir, ...relDir.split('/')))
  if (modPath) dirs.push(join(modPath, ...relDir.split('/')))
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const visit = (folder: string, prefix: string): void => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const rel = prefix + entry.name
        if (
          !isUnderDir(folder, modPath) &&
          folder !== modPath &&
          isReplaced(normalizedRel + '/' + rel)
        )
          continue
        if (entry.isDirectory() && recursive) visit(join(folder, entry.name), rel + '/')
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
          files.set(rel.toLowerCase(), join(folder, entry.name))
      }
    }
    visit(dir, '')
  }
  return [...files.values()]
}

function topLevelKeys(path: string): string[] {
  try {
    return scanBlocks(readFileSync(path, 'utf-8')).map((b) => b.key)
  } catch {
    return []
  }
}

function listCultures(gameDir: string | null, modPath: string | null, replacePaths: string[]): string[] {
  const keys = new Set<string>()
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, 'common/culture/cultures')) {
    for (const key of topLevelKeys(file)) keys.add(key)
  }
  return [...keys].sort()
}

function listFaiths(gameDir: string | null, modPath: string | null, replacePaths: string[]): string[] {
  const keys = new Set<string>()
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, FAITH_DIR)) {
    for (const key of topLevelKeys(file)) keys.add(key)
  }
  for (const file of effectiveFiles(
    gameDir,
    modPath,
    replacePaths,
    'common/religion/religion_types'
  )) {
    try {
      const text = readFileSync(file, 'utf-8')
      for (const religion of scanBlocks(text)) {
        const body = text.slice(religion.bodyStart, religion.bodyEnd)
        for (const sub of scanBlocks(body)) {
          if (sub.key !== 'faiths') continue
          for (const faith of scanBlocks(body.slice(sub.bodyStart, sub.bodyEnd))) {
            keys.add(faith.key)
          }
        }
      }
    } catch {
      // skip unreadable files
    }
  }
  return [...keys].sort()
}

/** Scripted rites plus faiths for which CK3 creates an implicit same-id rite. */
function listRites(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): Map<string, string> {
  const keys = new Map<string, string>() // rite id -> localization key
  const parents = new Set<string>()
  const seen = new Set<string>()
  const files = effectiveFiles(gameDir, modPath, replacePaths, RITE_DIR).sort(
    (a, b) => Number(isUnderDir(b, modPath)) - Number(isUnderDir(a, modPath))
  )
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      if (seen.has(block.key.toLowerCase())) continue
      seen.add(block.key.toLowerCase())
      const scalars = scanScalarsCI(text.slice(block.bodyStart, block.bodyEnd))
      keys.set(block.key, scalars.get('name') ?? block.key)
      const faith = scalars.get('faith')
      if (faith) parents.add(faith.toLowerCase())
    }
  }
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, FAITH_DIR)) {
    let text: string
    try {
      text = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      if (!parents.has(block.key.toLowerCase()) && !seen.has(block.key.toLowerCase()))
        keys.set(block.key, block.key)
    }
  }
  return keys
}

function listTraits(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): string[] {
  const keys = new Set<string>()
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, 'common/traits')) {
    for (const key of topLevelKeys(file)) keys.add(key)
  }
  return [...keys].sort()
}

function listPerks(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): string[] {
  const keys = new Set<string>()
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, 'common/lifestyle_perks')) {
    for (const key of topLevelKeys(file)) keys.add(key)
  }
  return [...keys].sort()
}

function listDnas(gameDir: string | null, modPath: string | null, replacePaths: string[]): string[] {
  const keys = new Set<string>()
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, 'common/dna_data')) {
    for (const key of topLevelKeys(file)) keys.add(key)
  }
  return [...keys].sort()
}

function listRelationTypes(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): string[] {
  const keys = new Set<string>()
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, 'common/scripted_relations')) {
    for (const key of topLevelKeys(file)) keys.add(key)
  }
  return [...keys].sort()
}

/**
 * Top-level id -> its `name` scalar, for definitions that point at a
 * localization key rather than carrying the display name inline (dynasties and
 * houses write `name = "dynn_Komnenos"`). Ids with no `name` line map to null.
 */
function listNameKeys(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  relDir: string
): Map<string, string | null> {
  const names = new Map<string, string | null>()
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, relDir)) {
    let text: string
    try {
      text = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    for (const block of scanBlocks(text)) {
      names.set(block.key, scanScalars(text.slice(block.bodyStart, block.bodyEnd)).get('name') ?? null)
    }
  }
  return names
}

/** The localization key a trait's display name lives under. */
const traitLocKey = (id: string): string => `trait_${id}`

/** The localization key a lifestyle perk's display name lives under. */
const perkLocKey = (id: string): string => `${id}_name`

export function getReferenceData(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): ReferenceData {
  const cultures = listCultures(gameDir, modPath, replacePaths)
  const faiths = listFaiths(gameDir, modPath, replacePaths)
  const rites = listRites(gameDir, modPath, replacePaths)
  const traits = listTraits(gameDir, modPath, replacePaths)
  const perks = listPerks(gameDir, modPath, replacePaths)
  // Kept apart: a character's `dynasty` and `dynasty_house` are separate
  // fields, each offering only the ids that are valid for it
  const dynastyNames = listNameKeys(gameDir, modPath, replacePaths, 'common/dynasties')
  const houseNames = listNameKeys(gameDir, modPath, replacePaths, 'common/dynasty_houses')

  // Cultures and faiths are localized under their own id; traits under
  // `trait_<id>`; dynasties and houses under whatever their `name` line names.
  // Those keys are spread across the whole english tree (DLC folders included),
  // so the scan is narrowed by key rather than by folder.
  const wanted = new Set<string>([
    ...cultures,
    ...faiths,
    ...rites.values(),
    ...traits.map(traitLocKey),
    ...perks.map(perkLocKey)
  ])
  for (const names of [dynastyNames, houseNames]) {
    for (const key of names.values()) if (key !== null) wanted.add(key)
  }
  const loc = readLocalization(gameDir, modPath, null, (key) => wanted.has(key))

  const entries = (ids: string[], locKey: (id: string) => string | null): RefEntry[] =>
    ids.map((id) => {
      const key = locKey(id)
      return { id, name: key === null ? null : (loc.get(key) ?? null) }
    })

  return {
    cultures: entries(cultures, (id) => id),
    faiths: entries(faiths, (id) => id),
    rites: entries([...rites.keys()].sort(), (id) => rites.get(id) ?? id),
    traits: entries(traits, traitLocKey),
    perks: entries(perks, perkLocKey),
    dynasties: entries([...dynastyNames.keys()].sort(), (id) => dynastyNames.get(id) ?? null),
    houses: entries([...houseNames.keys()].sort(), (id) => houseNames.get(id) ?? null),
    // DNAs have no localization — the id is the whole story
    dnas: listDnas(gameDir, modPath, replacePaths).map((id) => ({ id, name: null })),
    // Relation ids ("lover", "best_friend") are readable as-is — no loc scan
    relationTypes: listRelationTypes(gameDir, modPath, replacePaths).map((id) => ({
      id,
      name: null
    }))
  }
}

/** Directories a given kind of reference data is defined in */
const KIND_DIRS: Record<RefKind, string[]> = {
  culture: ['common/culture/cultures'],
  faith: [FAITH_DIR, 'common/religion/religion_types'],
  rite: [RITE_DIR, FAITH_DIR],
  tenet: [TENET_DIR],
  trait: ['common/traits'],
  dynasty: ['common/dynasties', 'common/dynasty_houses'],
  dna: ['common/dna_data'],
  // Culture-editor references. Pillars of every type share one folder, so a
  // single 'pillar' kind covers ethos, heritage, language and the rest.
  pillar: ['common/culture/pillars'],
  tradition: ['common/culture/traditions'],
  name_list: ['common/culture/name_lists'],
  ethnicity: ['common/ethnicities'],
  religion: ['common/religion/religion_types'],
  doctrine: ['common/religion/doctrine_types', 'common/religion/doctrine_group_types'],
  holy_site: ['common/religion/holy_site_types'],
  title: ['common/landed_titles'],
  government: ['common/governments']
}

/** A landed-title key: tier prefix (h e k d c b) + at least one more char. */
const TITLE_KEY = /^[hekdcb]_./i

/** Offset of title `id` anywhere in the de jure nesting of `text`, or null. */
function findTitleDefinition(text: string, id: string): number | null {
  const recurse = (body: string, base: number): number | null => {
    for (const b of scanBlocks(body)) {
      if (!TITLE_KEY.test(b.key)) continue
      if (b.key === id) return base + b.start
      const hit = recurse(body.slice(b.bodyStart, b.bodyEnd), base + b.bodyStart)
      if (hit !== null) return hit
    }
    return null
  }
  return recurse(text, 0)
}

function lineOf(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++
  }
  return line
}

/** Offset of `id`'s definition within the file, or null. Faiths are nested two levels deep. */
function findDefinition(text: string, kind: RefKind, id: string): number | null {
  if (kind === 'title') return findTitleDefinition(text, id)
  if (kind === 'faith') {
    const standalone = scanBlocks(text).find(
      (b) =>
        b.key === id && nestedBody(text.slice(b.bodyStart, b.bodyEnd), 'faith_details') !== null
    )
    if (standalone) return standalone.start
    for (const religion of scanBlocks(text)) {
      const body = text.slice(religion.bodyStart, religion.bodyEnd)
      for (const sub of scanBlocks(body)) {
        if (sub.key !== 'faiths') continue
        for (const faith of scanBlocks(body.slice(sub.bodyStart, sub.bodyEnd))) {
          if (faith.key === id) return religion.bodyStart + sub.bodyStart + faith.start
        }
      }
    }
    return null
  }
  const block = scanBlocks(text).find((b) => b.key === id)
  return block ? block.start : null
}

/**
 * Find where a reference id is defined, preferring a mod definition over the
 * base game's when both exist (matching how CK3 layers content).
 */
export function locateRef(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  kind: RefKind,
  id: string
): RefLocation | null {
  let gameHit: RefLocation | null = null
  for (const relDir of KIND_DIRS[kind]) {
    for (const file of effectiveFiles(gameDir, modPath, replacePaths, relDir)) {
      let text: string
      try {
        text = readFileSync(file, 'utf-8')
      } catch {
        continue
      }
      const offset = findDefinition(text, kind, id)
      if (offset === null) continue
      const inMod = isUnderDir(file, modPath)
      const hit = { path: file, line: lineOf(text, offset), inMod }
      if (inMod) return hit
      gameHit ??= hit
    }
  }
  return gameHit
}
