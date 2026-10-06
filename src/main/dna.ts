import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { writeModText } from './modWrite'
import { join } from 'path'
import { getCharacter, setCharacterDna } from './characters'
import { scanBlocks, scanScalars } from '@shared/pdx'
import { effectiveFiles } from './refdata'
import { listTxtFiles } from './scriptFile'
import type { DnaPasteInfo, SaveResult } from '@shared/types'

/**
 * Converting a Ruler Designer DNA export into proper scripted-character files,
 * following the base game's own pattern (e.g. Charles the Bald, 90104):
 *
 * - The genes go into a `common/dna_data` block as
 *   `<key> = { portrait_info = { genes = { … } } enabled = yes }`. The Ruler
 *   Designer's `hairstyles`/`beards`/`clothes` genes are its own outfit picks
 *   and are NOT part of a scripted DNA; `type`/`id`/`random_seed`/`entity`
 *   are dropped too.
 * - The chosen hair and beard (the export's `portrait_modifier_overrides`)
 *   become a per-character entry in a `gfx/portraits/portrait_modifiers` file,
 *   adding those accessories with a huge weight gated on `character:<id>`.
 * - The character's history gets `dna = <key>` and, when modifiers pin the
 *   appearance, `add_character_flag = has_scripted_appearance` in the birth
 *   block — the flag the base game's random hair/beard weights check to stand
 *   down for scripted characters.
 */

const DNA_DIR = ['common', 'dna_data'] as const
const MODIFIER_DIR = ['gfx', 'portraits', 'portrait_modifiers'] as const

/** RD genes that describe the outfit picker, not the person; never copied. */
const RULER_DESIGNER_ONLY_GENES = new Set(['clothes'])

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `character:<id>` appearing as a value, the way modifier weights reference one. */
const characterRef = (id: string): RegExp =>
  new RegExp(`character:${escapeRe(id)}(?![A-Za-z0-9_.\\-'])`)

// ---------- Parsing the Ruler Designer export ----------

export interface ParsedRulerDna {
  /** Gene sub-blocks in paste order, inner content collapsed to single spaces */
  genes: { key: string; value: string }[]
  /** Accessory names from portrait_modifier_overrides, when the user styled them */
  customHair: string | null
  customBeards: string | null
}

export function parseRulerDesignerDna(paste: string): ParsedRulerDna | { error: string } {
  const top = scanBlocks(paste)[0]
  if (!top) return { error: 'No DNA block found — paste the whole ruler_designer_… block' }
  const body = paste.slice(top.bodyStart, top.bodyEnd)
  const genesBlock =
    top.key === 'genes' ? top : scanBlocks(body).find((b) => b.key === 'genes')
  if (!genesBlock) return { error: 'No genes block found in the pasted DNA' }
  const genesBody =
    top.key === 'genes' ? body : body.slice(genesBlock.bodyStart, genesBlock.bodyEnd)

  const genes = scanBlocks(genesBody).map((g) => ({
    key: g.key,
    value: genesBody.slice(g.bodyStart, g.bodyEnd).replace(/\s+/g, ' ').trim()
  }))
  if (genes.length === 0) return { error: 'The genes block in the pasted DNA is empty' }

  let customHair: string | null = null
  let customBeards: string | null = null
  const override = scanBlocks(body).find((b) => b.key === 'override')
  if (override) {
    const overrideBody = body.slice(override.bodyStart, override.bodyEnd)
    const pmo = scanBlocks(overrideBody).find((b) => b.key === 'portrait_modifier_overrides')
    if (pmo) {
      const scalars = scanScalars(overrideBody.slice(pmo.bodyStart, pmo.bodyEnd))
      customHair = scalars.get('custom_hair') ?? null
      customBeards = scalars.get('custom_beards') ?? null
    }
  }
  return { genes, customHair, customBeards }
}

// ---------- Template lookup in common/genes ----------

/** Body of the first block named `key`, searching nested blocks breadth-first. */
function findBlockBody(text: string, key: string, depth = 4): string | null {
  const blocks = scanBlocks(text)
  for (const b of blocks) {
    if (b.key === key) return text.slice(b.bodyStart, b.bodyEnd)
  }
  if (depth === 0) return null
  for (const b of blocks) {
    const hit = findBlockBody(text.slice(b.bodyStart, b.bodyEnd), key, depth - 1)
    if (hit !== null) return hit
  }
  return null
}

/**
 * The accessory-gene template a portrait modifier must name alongside a raw
 * accessory. Any template of the gene that contains the accessory is valid;
 * the base game's own scripted-character entries prefer the frozen
 * `scripted_character_*` templates, so those win when the accessory is in one.
 */
export function findAccessoryTemplate(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  gene: 'hairstyles' | 'beards',
  accessory: string
): string | null {
  const inTemplate = new RegExp(`=\\s*"?${escapeRe(accessory)}"?(?![A-Za-z0-9_])`)
  let first: string | null = null
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, 'common/genes')) {
    let text: string
    try {
      text = readFileSync(file, 'utf-8')
    } catch {
      continue
    }
    const geneBody = findBlockBody(text, gene)
    if (geneBody === null) continue
    for (const template of scanBlocks(geneBody)) {
      if (!inTemplate.test(geneBody.slice(template.bodyStart, template.bodyEnd))) continue
      if (template.key.startsWith('scripted_character_')) return template.key
      first ??= template.key
    }
  }
  return first
}

// ---------- Writing the DNA block ----------

/** Replace the block for `key` in the file, or append a new one at the end. */
function upsertBlock(path: string, key: string, renderLines: (eol: string) => string[]): void {
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : null
  const eol = existing !== null && existing.includes('\r\n') ? '\r\n' : '\n'
  const block = renderLines(eol).join(eol)
  const hit = existing === null ? undefined : scanBlocks(existing).find((b) => b.key === key)
  if (existing !== null && hit) {
    writeModText(path, existing.slice(0, hit.start) + block + existing.slice(hit.end))
    return
  }
  let prefix = existing ?? ''
  if (prefix !== '' && !prefix.endsWith('\n')) prefix += eol
  if (prefix !== '' && !/(\r?\n){2}$/.test(prefix)) prefix += eol
  writeModText(path, prefix + block + eol)
}

function writeDnaBlock(
  modPath: string,
  file: string,
  key: string,
  genes: { key: string; value: string }[]
): void {
  const dir = join(modPath, ...DNA_DIR)
  mkdirSync(dir, { recursive: true })
  upsertBlock(join(dir, file), key, () => [
    `${key} = {`,
    '\tportrait_info = {',
    '\t\tgenes = {',
    ...genes.map((g) => `\t\t\t${g.key} = { ${g.value} }`),
    '\t\t}',
    '\t}',
    '\tenabled = yes',
    '}'
  ])
}

// ---------- Writing the portrait modifier ----------

interface AccessoryPick {
  gene: 'hairstyles' | 'beards'
  template: string
  accessory: string
}

/** The per-character modifier entry, one indent level in (inside its group). */
function modifierEntryLines(entryKey: string, characterId: string, picks: AccessoryPick[]): string[] {
  const lines = [`\t${entryKey} = {`, '\t\tdna_modifiers = {']
  for (const pick of picks) {
    lines.push(
      '\t\t\taccessory = {',
      '\t\t\t\tmode = add',
      `\t\t\t\tgene = ${pick.gene}`,
      `\t\t\t\ttemplate = ${pick.template}`,
      `\t\t\t\taccessory = ${pick.accessory}`,
      '\t\t\t}'
    )
  }
  lines.push(
    '\t\t}',
    '\t\tweight = {',
    '\t\t\tbase = 0',
    '\t\t\tmodifier = {',
    '\t\t\t\tadd = 1000',
    '\t\t\t\texists = this',
    `\t\t\t\texists = character:${characterId}`,
    `\t\t\t\tthis = character:${characterId}`,
    '\t\t\t}',
    '\t\t}',
    '\t}'
  )
  return lines
}

/**
 * Put the character's accessory entry into a portrait-modifier file. Any
 * existing entries for the character (in any group of the file) are removed
 * first, and the new entry lands in the group that held them — or the file's
 * first `usage = game` / `selection_behavior = max` group, or a brand-new
 * group named after the file (also covering a missing or comment-only file,
 * and one whose groups serve another purpose, like barbershop customization).
 */
function writeModifierEntry(
  modPath: string,
  file: string,
  characterId: string,
  picks: AccessoryPick[]
): void {
  const dir = join(modPath, ...MODIFIER_DIR)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, file)
  // Same charset restriction the character id itself obeys, so this is a valid key
  const entryKey = `${characterId}_scripted_appearance`
  const ref = characterRef(characterId)

  const newGroupLines = (name: string): string[] => [
    `${name} = {`,
    '\tusage = game',
    '\tselection_behavior = max',
    '\tpriority = 2',
    '',
    ...modifierEntryLines(entryKey, characterId, picks),
    '}'
  ]
  const groupName = (taken: Set<string>): string => {
    let name = file
      .replace(/\.txt$/i, '')
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toLowerCase()
    while (taken.has(name)) name += '_scripted'
    return name
  }

  if (!existsSync(path)) {
    writeModText(path, newGroupLines(groupName(new Set())).join('\n') + '\n')
    return
  }

  let text = readFileSync(path, 'utf-8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'

  // Cut every existing entry for this character, remembering its group's key
  let targetGroup: string | null = null
  for (;;) {
    let cut = false
    for (const group of scanBlocks(text)) {
      const body = text.slice(group.bodyStart, group.bodyEnd)
      for (const entry of scanBlocks(body)) {
        if (!ref.test(body.slice(entry.bodyStart, entry.bodyEnd))) continue
        targetGroup ??= group.key
        let from = group.bodyStart + entry.start
        while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === '\t')) from--
        let to = group.bodyStart + entry.end
        if (text[to] === '\r') to++
        if (text[to] === '\n') to++
        text = text.slice(0, from) + text.slice(to)
        cut = true
        break
      }
      if (cut) break
    }
    if (!cut) break
  }

  const groups = scanBlocks(text)
  const group =
    (targetGroup !== null ? groups.find((g) => g.key === targetGroup) : null) ??
    groups.find((g) => {
      const scalars = scanScalars(text.slice(g.bodyStart, g.bodyEnd))
      return scalars.get('usage') === 'game' && scalars.get('selection_behavior') === 'max'
    })
  if (!group) {
    let prefix = text
    if (prefix !== '' && !prefix.endsWith('\n')) prefix += eol
    if (prefix !== '' && !/(\r?\n){2}$/.test(prefix)) prefix += eol
    const name = groupName(new Set(groups.map((g) => g.key)))
    writeModText(path, prefix + newGroupLines(name).join(eol) + eol)
    return
  }
  const body = text.slice(group.bodyStart, group.bodyEnd)
  const newBody =
    body.replace(/\s+$/, '') + eol + eol + modifierEntryLines(entryKey, characterId, picks).join(eol) + eol
  writeModText(path, text.slice(0, group.bodyStart) + newBody + text.slice(group.bodyEnd))
}

// ---------- The dialog's info + apply entry points ----------

export function getDnaPasteInfo(modPath: string, file: string, id: string): DnaPasteInfo {
  try {
    return getDnaPasteInfoInner(modPath, file, id)
  } catch (err) {
    // Rethrown so the renderer's invoke rejects and the dialog can show it
    console.error(`[ck3-tools] getDnaPasteInfo failed for ${id} in ${file}:`, err)
    throw err
  }
}

function getDnaPasteInfoInner(modPath: string, file: string, id: string): DnaPasteInfo {
  const detail = getCharacter(modPath, file, id)
  const dnaKey = detail?.dna ?? `${id}_dna`
  const dnaFiles = listTxtFiles(join(modPath, ...DNA_DIR))
  const modifierFiles = listTxtFiles(join(modPath, ...MODIFIER_DIR))

  let lockedDnaFile: string | null = null
  if (detail?.dna) {
    for (const f of dnaFiles) {
      try {
        const text = readFileSync(join(modPath, ...DNA_DIR, f), 'utf-8')
        if (scanBlocks(text).some((b) => b.key === dnaKey)) {
          lockedDnaFile = f
          break
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  let lockedModifierFile: string | null = null
  const ref = characterRef(id)
  for (const f of modifierFiles) {
    try {
      if (ref.test(readFileSync(join(modPath, ...MODIFIER_DIR, f), 'utf-8'))) {
        lockedModifierFile = f
        break
      }
    } catch {
      // skip unreadable files
    }
  }

  return { dnaKey, dnaFiles, modifierFiles, lockedDnaFile, lockedModifierFile }
}

const FILE_NAME = /^[^\\/:*?"<>|]+\.txt$/i

export function applyRulerDesignerDna(
  gameDir: string | null,
  modPath: string,
  replacePaths: string[],
  file: string,
  id: string,
  paste: string,
  dnaFile: string,
  modifierFile: string | null
): SaveResult {
  const result = applyRulerDesignerDnaInner(
    gameDir,
    modPath,
    replacePaths,
    file,
    id,
    paste,
    dnaFile,
    modifierFile
  )
  if (!result.ok) {
    console.error(
      `[ck3-tools] Ruler Designer DNA paste failed for ${id} in ${file} ` +
        `(dna file: ${dnaFile}, modifier file: ${modifierFile ?? 'none'}): ${result.error}`
    )
  }
  return result
}

function applyRulerDesignerDnaInner(
  gameDir: string | null,
  modPath: string,
  replacePaths: string[],
  file: string,
  id: string,
  paste: string,
  dnaFile: string,
  modifierFile: string | null
): SaveResult {
  try {
    const detail = getCharacter(modPath, file, id)
    if (!detail) return { ok: false, error: `Character ${id} not found in ${file}` }
    const parsed = parseRulerDesignerDna(paste)
    if ('error' in parsed) return { ok: false, error: parsed.error }
    if (!FILE_NAME.test(dnaFile)) {
      return { ok: false, error: `Invalid DNA file name "${dnaFile}" (expected a .txt file name)` }
    }

    // Resolve the chosen hair/beard to gene templates up front, so a bad paste
    // fails before any file is touched
    const picks: AccessoryPick[] = []
    for (const [gene, accessory] of [
      ['hairstyles', parsed.customHair],
      ['beards', parsed.customBeards]
    ] as const) {
      if (accessory === null) continue
      const template = findAccessoryTemplate(gameDir, modPath, replacePaths, gene, accessory)
      if (template === null) {
        return {
          ok: false,
          error: `Accessory "${accessory}" isn't in any ${gene} gene template (checked common/genes)`
        }
      }
      picks.push({ gene, template, accessory })
    }
    if (picks.length > 0) {
      if (modifierFile === null) {
        return { ok: false, error: 'A portrait modifier file is needed for the chosen hair/beard' }
      }
      if (!FILE_NAME.test(modifierFile)) {
        return {
          ok: false,
          error: `Invalid modifier file name "${modifierFile}" (expected a .txt file name)`
        }
      }
    }

    // The genes a scripted DNA keeps: everything except the Ruler Designer's
    // outfit picks — and hair/beard genes only when no explicit accessory
    // pins them through the portrait modifier instead
    const dropped = new Set(RULER_DESIGNER_ONLY_GENES)
    for (const pick of picks) dropped.add(pick.gene)
    const genes = parsed.genes.filter((g) => !dropped.has(g.key))

    const dnaKey = detail.dna ?? `${id}_dna`
    if (picks.length > 0) writeModifierEntry(modPath, modifierFile!, id, picks)
    writeDnaBlock(modPath, dnaFile, dnaKey, genes)
    return setCharacterDna(modPath, file, id, dnaKey, picks.length > 0)
  } catch (err) {
    // The wrapper logs the message; the stack only exists here
    console.error('[ck3-tools] Ruler Designer DNA paste threw:', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
