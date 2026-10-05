import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { DATE_KEY } from './characters'
import { endOfBodyIndex, makeEditor, setBlockBody, setScalar, splitComment, withEol } from '@shared/lineEditor'
import { annotateLines, scanBlocks, scanScalarsCI, topLevelCode } from '@shared/pdx'
import { effectiveFiles, isUnderDir } from './refdata'
import { norm } from './religions'
import { KEY_CHARS, appendBlock, isTxtRelativePath } from './scriptFile'
import type { BlockSpan } from '@shared/pdx'
import type {
  SaveResult,
  TitleHistoryEntry,
  TitleHistoryEntryPatch
} from '@shared/types'

/**
 * Title history: `history/titles` files hold `<title> = { <date> = { … } }`
 * blocks. A title's entries can be split across several blocks in one file and
 * across several files (vanilla does both — the game merges them), the same
 * date can head several blocks of one title (routine, and merging them on save
 * would be destructive), and file order is deliberately non-chronological
 * (development lines first, then holders) — so an entry is addressed by the
 * ordinals (titleBlock, index) rather than by its date, and edits splice one
 * dated block while the rest of the file stays byte-identical.
 */

const HISTORY_DIR = 'history/titles'

/**
 * What counts as a dated block when READING title history. Looser than the
 * DATE_KEY the writers validate against: real mod files head blocks with bare
 * years (`3244 = { … }`), and those must be visible and editable — inside a
 * title's history block, a numeric key is always a date. The reader, the
 * entry-address resolver and the anchors below must all use this same test,
 * or an ordinal would point at a different block on the way back in.
 */
export const DATED_BLOCK_KEY = /^\d+(\.\d+){0,2}\.?$/

/** Known scalar keys of a dated block: file spelling -> patch field. */
const SCALAR_KEYS: [string, keyof TitleHistoryEntryPatch][] = [
  ['holder', 'holder'],
  ['liege', 'liege'],
  ['de_jure_liege', 'deJureLiege'],
  ['government', 'government'],
  ['change_development_level', 'changeDevelopmentLevel'],
  ['development_level', 'developmentLevel'],
  ['name', 'name'],
  ['reset_name', 'resetName'],
  ['insert_title_history', 'insertTitleHistory'],
  ['remove_succession_laws', 'removeSuccessionLaws'],
  ['holder_ignore_head_of_faith_requirement', 'holderIgnoreHeadOfFaithRequirement']
]

const KNOWN_SCALARS = new Set(SCALAR_KEYS.map(([key]) => key))

function historyDir(modPath: string): string {
  return join(modPath, ...HISTORY_DIR.split('/'))
}

// ---------- Reading ----------

/** The bare word tokens of a succession_laws body (comments stripped). */
function lawTokens(inner: string): string[] {
  return inner
    .replace(/#[^\n]*/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '')
}

/**
 * The laws of a dated body across EVERY succession_laws block — duplicate
 * blocks are legal script, and the parse and the save-time diff must read
 * them identically or a law edit would silently drop the extra block's
 * content. Null when the body has no succession_laws at all.
 */
function entryLaws(body: string): string[] | null {
  let laws: string[] | null = null
  for (const b of scanBlocks(body)) {
    if (b.key.toLowerCase() !== 'succession_laws') continue
    laws = [...(laws ?? []), ...lawTokens(body.slice(b.bodyStart, b.bodyEnd))]
  }
  return laws
}

/** Unrecognized depth-0 statements of a dated body, verbatim, for display. */
function extraStatements(body: string): string[] {
  const statement = /(^|\s)([A-Za-z0-9_.\-']+)\s*=\s*("[^"]*"|[^\s{}"#=]+)/g
  const out: string[] = []
  for (const { text, depth } of annotateLines(body)) {
    for (const m of topLevelCode(text, depth).matchAll(statement)) {
      if (!KNOWN_SCALARS.has(m[2].toLowerCase())) out.push(`${m[2]} = ${m[3]}`)
    }
  }
  return out
}

function parseEntry(
  date: string,
  body: string,
  file: string,
  inMod: boolean,
  titleBlock: number,
  index: number
): TitleHistoryEntry {
  const scalars = scanScalarsCI(body)
  const value = (key: string): string | null => scalars.get(key) ?? null

  const successionLaws = entryLaws(body)
  const opaqueBlocks: string[] = []
  for (const b of scanBlocks(body)) {
    if (b.key.toLowerCase() === 'succession_laws') continue
    if (!opaqueBlocks.includes(b.key)) opaqueBlocks.push(b.key)
  }

  return {
    date,
    file,
    inMod,
    titleBlock,
    index,
    holder: value('holder'),
    liege: value('liege'),
    deJureLiege: value('de_jure_liege'),
    government: value('government'),
    changeDevelopmentLevel: value('change_development_level'),
    developmentLevel: value('development_level'),
    name: value('name'),
    resetName: value('reset_name'),
    insertTitleHistory: value('insert_title_history'),
    removeSuccessionLaws: value('remove_succession_laws'),
    holderIgnoreHeadOfFaithRequirement: value('holder_ignore_head_of_faith_requirement'),
    successionLaws,
    opaqueBlocks,
    extra: extraStatements(body)
  }
}

/**
 * Every dated entry recorded for `titleId`, across every effective history
 * file (game files included so a vanilla title's history is viewable; the
 * per-entry inMod flag gates editing). File order within each block is kept —
 * real files are deliberately non-chronological, so the timeline sorts a view.
 */
export function getTitleHistory(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  titleId: string
): TitleHistoryEntry[] {
  const entries: TitleHistoryEntry[] = []
  for (const path of effectiveFiles(gameDir, modPath, replacePaths, HISTORY_DIR, true)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    const inMod = isUnderDir(path, modPath)
    const file = relative(
      join((inMod ? modPath : gameDir)!, ...HISTORY_DIR.split('/')),
      path
    ).replace(/\\/g, '/')
    let titleBlock = 0
    for (const block of scanBlocks(text)) {
      if (norm(block.key) !== norm(titleId)) continue
      const body = text.slice(block.bodyStart, block.bodyEnd)
      let index = 0
      for (const d of scanBlocks(body)) {
        if (!DATED_BLOCK_KEY.test(d.key)) continue
        entries.push(
          parseEntry(d.key, body.slice(d.bodyStart, d.bodyEnd), file, inMod, titleBlock, index)
        )
        index++
      }
      titleBlock++
    }
  }
  return entries
}

/** .txt files under the mod's history/titles folder. */
export function listTitleHistoryFiles(modPath: string): string[] {
  return effectiveFiles(null, modPath, [], HISTORY_DIR, true)
    .map((path) => relative(historyDir(modPath), path).replace(/\\/g, '/'))
    .sort()
}

// ---------- Editing ----------

interface EntryLocation {
  path: string
  text: string
  /** The containing title block within the file */
  title: BlockSpan
  /** The dated block, offsets relative to the title block's body */
  date: BlockSpan
}

/** Locate an entry by its (file, titleBlock, index) address, in the mod. */
function findEntry(
  modPath: string,
  file: string,
  titleId: string,
  titleBlock: number,
  index: number
): EntryLocation | { error: string } {
  if (!isTxtRelativePath(file)) return { error: 'Invalid history file path' }
  const path = join(historyDir(modPath), file)
  if (!existsSync(path)) return { error: `File not found: ${file}` }
  const text = readFileSync(path, 'utf-8')
  if (text.includes('�')) {
    return { error: `${file} isn't valid UTF-8 — edit it in a text editor instead` }
  }
  let ordinal = 0
  for (const block of scanBlocks(text)) {
    if (norm(block.key) !== norm(titleId)) continue
    if (ordinal !== titleBlock) {
      ordinal++
      continue
    }
    const body = text.slice(block.bodyStart, block.bodyEnd)
    let i = 0
    for (const d of scanBlocks(body)) {
      if (!DATED_BLOCK_KEY.test(d.key)) continue
      if (i === index) return { path, text, title: block, date: d }
      i++
    }
    break
  }
  return { error: `History entry not found in ${file} — the file may have changed on disk` }
}

const sameLaws = (a: string[] | null, b: string[] | null): boolean =>
  a === null || b === null ? a === b : a.length === b.length && a.every((v, i) => v === b[i])

/**
 * Rewrite one dated block from a patch: known scalars are set surgically,
 * succession_laws only when actually changed (its writer normalizes layout),
 * and everything else — effect blocks, unknown statements, comments — is
 * untouched. The block's date key is renamed in the same splice.
 */
export function saveTitleHistoryEntry(
  modPath: string,
  file: string,
  titleId: string,
  titleBlock: number,
  index: number,
  patch: TitleHistoryEntryPatch
): SaveResult {
  try {
    const date = patch.date.trim()
    const loc = findEntry(modPath, file, titleId, titleBlock, index)
    if ('error' in loc) return { ok: false, error: loc.error }
    const { path, text, title, date: d } = loc
    // Real files carry date forms DATE_KEY doesn't cover (bare years); keeping
    // such a date as-is must not block edits to the block's other fields.
    if (date !== d.key && !DATE_KEY.test(date)) {
      return { ok: false, error: `Invalid date "${patch.date}" (expected Y.M.D)` }
    }

    const body = text.slice(title.bodyStart, title.bodyEnd).slice(d.bodyStart, d.bodyEnd)
    const ed = makeEditor(body)
    for (const [key, field] of SCALAR_KEYS) {
      setScalar(ed, [key], patch[field] as string | null, { ignoreCase: true })
    }
    if (!sameLaws(entryLaws(body), patch.successionLaws)) {
      const laws = patch.successionLaws
      setBlockBody(
        ed,
        'succession_laws',
        laws === null
          ? null
          : (indent) => ({
              single: laws.length === 0 ? ' ' : ` ${laws.join(' ')} `,
              multi: laws.map((l) => `${indent}${l}`)
            })
      )
    }

    const keyStart = title.bodyStart + d.start
    const updated =
      text.slice(0, keyStart) +
      date +
      text.slice(keyStart + d.key.length, title.bodyStart + d.bodyStart) +
      ed.lines.join('\n') +
      text.slice(title.bodyStart + d.bodyEnd)
    writeFileSync(path, updated, 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** The statement lines a new entry's fields produce, unindented. */
function entryLines(patch: TitleHistoryEntryPatch): string[] {
  const lines: string[] = []
  for (const [key, field] of SCALAR_KEYS) {
    const value = patch[field] as string | null
    if (value !== null && String(value).trim() !== '') lines.push(`${key} = ${String(value).trim()}`)
  }
  if (patch.successionLaws !== null && patch.successionLaws.length > 0) {
    lines.push(`succession_laws = { ${patch.successionLaws.join(' ')} }`)
  }
  return lines
}

/**
 * Add a dated block for `titleId` in the given mod file: appended at the end
 * of the title's last block there (file order is house-style, not
 * chronological — the timeline view sorts), or as a whole new title block at
 * the end of the file (created if missing) when the file has none.
 */
export function addTitleHistoryEntry(
  modPath: string,
  file: string,
  titleId: string,
  patch: TitleHistoryEntryPatch
): SaveResult {
  try {
    const id = titleId.trim()
    if (!id) return { ok: false, error: 'Title id must not be empty' }
    if (!KEY_CHARS.test(id)) {
      return { ok: false, error: `Invalid title id "${id}" (letters, digits, _ . - ' only)` }
    }
    if (!isTxtRelativePath(file)) {
      return { ok: false, error: `Invalid file name "${file}" (expected a .txt file name)` }
    }
    const date = patch.date.trim()
    if (!DATE_KEY.test(date)) {
      return { ok: false, error: `Invalid date "${patch.date}" (expected Y.M.D)` }
    }

    const path = join(historyDir(modPath), file)
    const text = existsSync(path) ? readFileSync(path, 'utf-8') : null
    if (text !== null && text.includes('�')) {
      return { ok: false, error: `${file} isn't valid UTF-8 — edit it in a text editor instead` }
    }
    const blocks = text === null ? [] : scanBlocks(text)
    const title = [...blocks].reverse().find((b) => norm(b.key) === norm(id)) ?? null

    if (text === null || title === null) {
      appendBlock(historyDir(modPath), file, [
        `${id} = {`,
        `\t${date} = {`,
        ...entryLines(patch).map((l) => `\t\t${l}`),
        `\t}`,
        `}`
      ])
      return { ok: true }
    }

    const body = text.slice(title.bodyStart, title.bodyEnd)
    if (!body.includes('\n')) {
      // A one-line title body (`d_x = {}`) has no line to splice into — grow
      // it into the multi-line shape, in the file's own EOL style, with the
      // closing brace back on the title's own indentation
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      const lineStart = text.lastIndexOf('\n', title.start - 1) + 1
      const closingIndent = text.slice(lineStart).match(/^[ \t]*/)![0]
      const content = body.trim()
      const block = [
        `${closingIndent}\t${date} = {`,
        ...entryLines(patch).map((l) => `${closingIndent}\t\t${l}`),
        `${closingIndent}\t}`
      ]
      const newBody =
        (content === '' ? '' : ` ${content}`) + eol + block.join(eol) + eol + closingIndent
      writeFileSync(
        path,
        text.slice(0, title.bodyStart) + newBody + text.slice(title.bodyEnd),
        'utf-8'
      )
      return { ok: true }
    }

    const ed = makeEditor(body)
    const at = endOfBodyIndex(ed)
    const block = [
      `${ed.indent}${date} = {`,
      ...entryLines(patch).map((l) => `${ed.indent}${ed.indent}${l}`),
      `${ed.indent}}`
    ]
    ed.lines.splice(at, 0, ...withEol(ed, block, at))
    const updated =
      text.slice(0, title.bodyStart) + ed.lines.join('\n') + text.slice(title.bodyEnd)
    writeFileSync(path, updated, 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Delete one dated block. The containing title block stays even when emptied —
 * empty title blocks are legal data (real mods keep them as placeholders).
 */
export function deleteTitleHistoryEntry(
  modPath: string,
  file: string,
  titleId: string,
  titleBlock: number,
  index: number
): SaveResult {
  try {
    const loc = findEntry(modPath, file, titleId, titleBlock, index)
    if ('error' in loc) return { ok: false, error: loc.error }
    const { path, text, title, date: d } = loc

    const body = text.slice(title.bodyStart, title.bodyEnd)
    // Swallow the block's leading indentation and trailing newline so no
    // blank line is left where it stood
    let from = d.start
    while (from > 0 && (body[from - 1] === ' ' || body[from - 1] === '\t')) from--
    let to = d.end
    if (body[to] === '\r') to++
    if (body[to] === '\n') to++
    const updated =
      text.slice(0, title.bodyStart) +
      body.slice(0, from) +
      body.slice(to) +
      text.slice(title.bodyEnd)
    writeFileSync(path, updated, 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
