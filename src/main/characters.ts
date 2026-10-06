import { existsSync, readdirSync, readFileSync } from 'fs'
import { writeModText } from './modWrite'
import { join, resolve } from 'path'
import {
  endOfBodyIndex,
  eolSuffix,
  makeEditor,
  refresh,
  setRepeatedScalar,
  setScalar,
  splitComment,
  withEol
} from '@shared/lineEditor'
import { annotateLines, scanBlocks, scanRepeatedScalar, scanScalars } from '@shared/pdx'
import { appendBlock, isTxtFileName, KEY_CHARS } from './scriptFile'
import { applyScriptSites, getScriptSites } from './scriptSites'
import type { LineEditor } from '@shared/lineEditor'
import type {
  CharacterDetail,
  CharacterRelation,
  CharacterSpouse,
  CharacterStats,
  CharacterSummary,
  SaveResult,
  ScriptSite
} from '@shared/types'

// Tolerates typos that appear in real mod files: a trailing dot ("3220.1.1.")
// and a missing day part ("3212.1")
export const DATE_KEY = /^\d+\.\d+(\.\d+)?\.?$/

export const STAT_KEYS = [
  'diplomacy',
  'martial',
  'stewardship',
  'intrigue',
  'learning',
  'prowess'
] as const

function charactersDir(modPath: string): string {
  return join(modPath, 'history', 'characters')
}

/** Comment-safe test for a statement inside a date block body. */
function hasStatement(subBody: string, statement: string): boolean {
  for (const { text } of annotateLines(subBody)) {
    const code = text.split('#')[0]
    if (new RegExp(`(^|[\\s{])${statement}\\s*=`).test(code)) return true
  }
  return false
}

function findDateBlocks(body: string, statement: 'birth' | 'death') {
  return scanBlocks(body).filter(
    (sub) => DATE_KEY.test(sub.key) && hasStatement(body.slice(sub.bodyStart, sub.bodyEnd), statement)
  )
}

function cleanDate(key: string): string {
  return key.replace(/\.$/, '')
}

/** Sortable number for a Y.M.D date key, so new blocks land chronologically. */
function dateSortKey(date: string): number {
  const [y, m, d] = cleanDate(date).split('.')
  return Number(y) * 10000 + Number(m ?? 1) * 100 + Number(d ?? 1)
}

// Marriages live as dated effects rather than scalars: `add_spouse` (or
// `add_matrilineal_spouse`) in the wedding year's block, `remove_spouse` in
// the divorce year's. Concubines (Islam's "consorts" are the same effect
// under a different localization) use the parallel `add_concubine` /
// `remove_concubine` pair; there is no matrilineal variant for them.
const SPOUSE_STATEMENT =
  /(^|[\s{])(add_matrilineal_spouse|add_spouse|remove_spouse|add_concubine|remove_concubine)\s*=\s*(?:"([^"]*)"|([^\s{}"#=]+))/gi

interface SpouseEvent {
  kind: 'add' | 'remove'
  id: string
  matrilineal: boolean
  concubine: boolean
  /** Date of the block the statement sits in, cleaned of a trailing dot */
  date: string
}

interface SpouseEventHit extends SpouseEvent {
  /** Index of the containing date block within scanBlocks(body) */
  block: number
  /** Span of the statement within the character body */
  start: number
  end: number
}

/** Every spouse effect in the body's dated blocks, in file order, with spans. */
function scanSpouseEvents(body: string): SpouseEventHit[] {
  const hits: SpouseEventHit[] = []
  scanBlocks(body).forEach((block, index) => {
    if (!DATE_KEY.test(block.key)) return
    const sub = body.slice(block.bodyStart, block.bodyEnd)
    let lineStart = 0
    for (const { text, depth } of annotateLines(sub)) {
      const at = lineStart
      lineStart += text.length + 1
      if (depth !== 0) continue
      const [code] = splitComment(text)
      SPOUSE_STATEMENT.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = SPOUSE_STATEMENT.exec(code)) !== null) {
        const keyword = m[2].toLowerCase()
        hits.push({
          kind: keyword.startsWith('remove') ? 'remove' : 'add',
          id: m[3] ?? m[4],
          matrilineal: keyword === 'add_matrilineal_spouse',
          concubine: keyword.endsWith('concubine'),
          date: cleanDate(block.key),
          block: index,
          start: block.bodyStart + at + m.index + m[1].length,
          end: block.bodyStart + at + m.index + m[0].length
        })
      }
    }
  })
  return hits
}

/**
 * Pair add/remove effects into marriages; a remove closes the latest open one
 * of its own kind (remove_spouse never ends a concubinage or vice versa).
 */
function pairSpouses(events: SpouseEvent[]): CharacterSpouse[] {
  const spouses: CharacterSpouse[] = []
  for (const event of events) {
    if (event.kind === 'add') {
      spouses.push({
        id: event.id,
        marriage: event.date,
        divorce: null,
        matrilineal: event.matrilineal,
        concubine: event.concubine
      })
      continue
    }
    const open = [...spouses]
      .reverse()
      .find((s) => s.id === event.id && s.concubine === event.concubine && s.divorce === null)
    if (open) open.divorce = event.date
    else {
      spouses.push({
        id: event.id,
        marriage: null,
        divorce: event.date,
        matrilineal: false,
        concubine: event.concubine
      })
    }
  }
  return spouses
}

/** The effects a spouse list should produce, in list order. */
function spouseEvents(spouses: CharacterSpouse[]): SpouseEvent[] {
  const events: SpouseEvent[] = []
  for (const spouse of spouses) {
    const id = spouse.id.trim()
    if (!id) continue
    // A concubine has no matrilineal variant, so the flag is dropped there
    const concubine = spouse.concubine === true
    if (spouse.marriage) {
      events.push({
        kind: 'add',
        id,
        matrilineal: !concubine && spouse.matrilineal,
        concubine,
        date: spouse.marriage
      })
    }
    if (spouse.divorce) {
      events.push({ kind: 'remove', id, matrilineal: false, concubine, date: spouse.divorce })
    }
  }
  return events
}

function statementFor(event: SpouseEvent): string {
  const keyword =
    event.kind === 'remove'
      ? event.concubine
        ? 'remove_concubine'
        : 'remove_spouse'
      : event.concubine
        ? 'add_concubine'
        : event.matrilineal
          ? 'add_matrilineal_spouse'
          : 'add_spouse'
  return `${keyword} = ${event.id}`
}

const eventKey = (e: SpouseEvent): string =>
  `${e.kind}|${e.id}|${cleanDate(e.date)}|${e.kind === 'add' && e.matrilineal ? 'm' : ''}${
    e.concubine ? 'c' : ''
  }`

/** Reject a spouse list that can't be written; null when it's fine. */
function validateSpouses(spouses: CharacterSpouse[]): string | null {
  for (const spouse of spouses) {
    if (!spouse.id.trim()) return 'Every spouse needs a character id'
    for (const [label, date] of [
      ['Marriage', spouse.marriage],
      ['Divorce', spouse.divorce]
    ] as const) {
      if (date !== null && date !== '' && !DATE_KEY.test(date)) {
        return `Invalid ${label.toLowerCase()} date "${date}" (expected Y.M.D)`
      }
    }
    if (!spouse.marriage && !spouse.divorce) {
      return spouse.concubine
        ? `Concubine ${spouse.id.trim()} needs a start date`
        : `Spouse ${spouse.id.trim()} needs a marriage date`
    }
  }
  return null
}

// Scripted relations (lover, rival, friend, …) live as `set_relation_<type>`
// statements inside `effect = { … }` wrappers within dated blocks, either as
// a scalar (`set_relation_rival = character:73815`) or as a block carrying a
// reason (`set_relation_rival = { target = … reason = … }`).
const RELATION_SCALAR =
  /(^|[\s{])set_relation_([A-Za-z0-9_.\-']+)\s*=\s*(?:"([^"]*)"|([^\s{}"#=]+))/gi

/** `target =` / `reason =` statements inside a block-form relation's body. */
const RELATION_INNER = /(^|[\s{])(target|reason)\s*=\s*(?:"([^"]*)"|([^\s{}"#=]+))/gi

interface RelationHit extends CharacterRelation {
  /** Index of the containing date block within scanBlocks(body) */
  block: number
  /** Span of the statement (scalar) or whole block (block form) within the character body */
  start: number
  end: number
}

/** Split a raw target into the id and whether it carried the character: prefix. */
function splitTarget(raw: string): { target: string; prefixed: boolean } {
  const prefixed = /^character:/i.test(raw)
  return { target: prefixed ? raw.slice('character:'.length) : raw, prefixed }
}

/**
 * Parse a block-form relation's body: the first `target =` and `reason =`
 * become fields, and every other non-blank line (nested blocks and trailing
 * comments included) is kept verbatim as `extra` so a rewrite loses nothing.
 */
function parseRelationBlockBody(inner: string): {
  target: string
  prefixed: boolean
  reason: string | null
  extra: string | null
} {
  let target = ''
  let prefixed = false
  let reason: string | null = null
  const extraLines: string[] = []
  for (const { text, depth } of annotateLines(inner)) {
    if (depth !== 0) {
      // Inside a nested sub-block that belongs to extra — keep the line
      if (text.trim() !== '') extraLines.push(text.trim())
      continue
    }
    const [code, comment] = splitComment(text)
    const cuts: [number, number][] = []
    RELATION_INNER.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = RELATION_INNER.exec(code)) !== null) {
      const key = m[2].toLowerCase()
      const value = m[3] ?? m[4]
      if (key === 'target' && target === '') {
        const split = splitTarget(value)
        target = split.target
        prefixed = split.prefixed
        cuts.push([m.index + m[1].length, m.index + m[0].length])
      } else if (key === 'reason' && reason === null) {
        reason = value
        cuts.push([m.index + m[1].length, m.index + m[0].length])
      }
    }
    let leftover = code
    for (const [s, e] of cuts.reverse()) leftover = leftover.slice(0, s) + leftover.slice(e)
    const rest = `${leftover.trim()}${leftover.trim() && comment ? ' ' : ''}${comment}`.trim()
    if (rest !== '') extraLines.push(rest)
  }
  return { target, prefixed, reason, extra: extraLines.length > 0 ? extraLines.join('\n') : null }
}

/** Every relation effect in the body's dated blocks, in file order, with spans. */
function scanRelationHits(body: string): RelationHit[] {
  const hits: RelationHit[] = []
  scanBlocks(body).forEach((dateBlock, index) => {
    if (!DATE_KEY.test(dateBlock.key)) return
    const dateBody = body.slice(dateBlock.bodyStart, dateBlock.bodyEnd)
    for (const eff of scanBlocks(dateBody)) {
      if (eff.key !== 'effect') continue
      const effBody = dateBody.slice(eff.bodyStart, eff.bodyEnd)
      const base = dateBlock.bodyStart + eff.bodyStart
      // Block form: `set_relation_x = { target = … }` sub-blocks
      for (const sub of scanBlocks(effBody)) {
        const m = sub.key.match(/^set_relation_(.+)$/i)
        if (!m) continue
        const parsed = parseRelationBlockBody(effBody.slice(sub.bodyStart, sub.bodyEnd))
        hits.push({
          type: m[1],
          ...parsed,
          date: cleanDate(dateBlock.key),
          block: index,
          start: base + sub.start,
          end: base + sub.end
        })
      }
      // Scalar form: `set_relation_x = character:123` on depth-0 lines of the
      // effect body (the value charset excludes `{`, so block form never
      // double-matches here)
      let lineStart = 0
      for (const { text, depth } of annotateLines(effBody)) {
        const at = lineStart
        lineStart += text.length + 1
        if (depth !== 0) continue
        const [code] = splitComment(text)
        RELATION_SCALAR.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = RELATION_SCALAR.exec(code)) !== null) {
          const { target, prefixed } = splitTarget(m[3] ?? m[4])
          hits.push({
            type: m[2],
            target,
            prefixed,
            date: cleanDate(dateBlock.key),
            reason: null,
            extra: null,
            block: index,
            start: base + at + m.index + m[1].length,
            end: base + at + m.index + m[0].length
          })
        }
      }
    }
  })
  return hits.sort((a, b) => a.start - b.start)
}

/** A relation's identity for matching file statements against edited rows. */
const relationKey = (r: CharacterRelation): string =>
  [
    r.type.trim(),
    r.target.trim(),
    r.prefixed ? 'p' : '',
    cleanDate(r.date),
    r.reason ?? '',
    r.extra ?? ''
  ].join('|')

/** Strip span bookkeeping so a hit can travel as plain detail data. */
const hitToRelation = (h: RelationHit): CharacterRelation => ({
  type: h.type,
  target: h.target,
  prefixed: h.prefixed,
  date: h.date,
  reason: h.reason,
  extra: h.extra
})

/**
 * The statement a relation writes, as lines relative to its own indentation
 * (nested lines carry one `indent` unit). Scalar form unless a reason or
 * extra content forces the block form.
 */
function relationStatementLines(rel: CharacterRelation, indent: string): string[] {
  const target = `${rel.prefixed ? 'character:' : ''}${rel.target.trim()}`
  const key = `set_relation_${rel.type.trim()}`
  const reason = rel.reason?.trim() ? rel.reason.trim() : null
  if (reason === null && rel.extra === null) return [`${key} = ${target}`]
  const lines = [`${key} = {`, `${indent}target = ${target}`]
  if (reason !== null) lines.push(`${indent}reason = ${reason}`)
  for (const x of (rel.extra ?? '').split('\n')) {
    if (x !== '') lines.push(`${indent}${x}`)
  }
  lines.push('}')
  return lines
}

/** The statement as a single line, for splicing into one-line blocks. */
function relationInline(rel: CharacterRelation): string {
  return relationStatementLines(rel, '')
    .map((l) => l.trim())
    .join(' ')
}

/** Reject a relation list that can't be written; null when it's fine. */
function validateRelations(relations: CharacterRelation[]): string | null {
  for (const rel of relations) {
    if (!rel.type.trim()) return 'Every relation needs a type'
    if (!rel.target.trim()) return 'Every relation needs a target character id'
    if (!DATE_KEY.test(rel.date)) {
      return `Invalid relation date "${rel.date}" (expected Y.M.D)`
    }
  }
  return null
}

function parseBlockDetail(body: string, id: string, file: string): CharacterDetail {
  const scalars = scanScalars(body)
  const stats = {} as CharacterStats
  for (const key of STAT_KEYS) {
    const v = scalars.get(key)
    const n = v !== undefined ? Number(v) : NaN
    stats[key] = Number.isNaN(n) ? null : n
  }
  const birthBlock = findDateBlocks(body, 'birth')[0] ?? null
  const deathBlock = findDateBlocks(body, 'death')[0] ?? null
  return {
    id,
    file,
    name: scalars.get('name') ?? null,
    dynasty: scalars.get('dynasty') ?? null,
    house: scalars.get('dynasty_house') ?? null,
    birth: birthBlock ? cleanDate(birthBlock.key) : null,
    death: deathBlock ? cleanDate(deathBlock.key) : null,
    culture: scalars.get('culture') ?? null,
    faith: scalars.get('faith') ?? scalars.get('religion') ?? null,
    rite: scalars.get('rite') ?? null,
    father: scalars.get('father') ?? null,
    mother: scalars.get('mother') ?? null,
    traits: scanRepeatedScalar(body, 'trait'),
    spouses: pairSpouses(scanSpouseEvents(body)),
    relations: scanRelationHits(body).map(hitToRelation),
    stats,
    female: scalars.get('female') ?? null,
    sexuality: scalars.get('sexuality') ?? null,
    dna: scalars.get('dna') ?? null
  }
}

export function listCharacters(modPath: string): CharacterSummary[] {
  const dir = charactersDir(modPath)
  if (!existsSync(dir)) return []
  const characters: CharacterSummary[] = []
  for (const entry of readdirSync(dir)) {
    if (!entry.toLowerCase().endsWith('.txt')) continue
    try {
      const text = readFileSync(join(dir, entry), 'utf-8')
      for (const block of scanBlocks(text)) {
        const detail = parseBlockDetail(text.slice(block.bodyStart, block.bodyEnd), block.key, entry)
        characters.push({
          id: detail.id,
          name: detail.name,
          // The list's one lineage column shows whichever key the file uses
          dynasty: detail.dynasty ?? detail.house,
          birth: detail.birth,
          father: detail.father,
          mother: detail.mother,
          file: entry
        })
      }
    } catch {
      // skip unreadable files
    }
  }
  return characters.sort((a, b) => {
    const na = Number(a.id)
    const nb = Number(b.id)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    return a.id.localeCompare(b.id)
  })
}

export function getCharacter(modPath: string, file: string, id: string): CharacterDetail | null {
  const path = join(charactersDir(modPath), file)
  if (!existsSync(path)) return null
  const text = readFileSync(path, 'utf-8')
  const block = scanBlocks(text).find((b) => b.key === id)
  if (!block) return null
  return parseBlockDetail(text.slice(block.bodyStart, block.bodyEnd), id, file)
}

// ---------- Script ----------

/** Record statements the form edits; anything else in the record is shown as script */
const MANAGED_KEYS = new Set([
  'name',
  'dynasty',
  'dynasty_house',
  'culture',
  'religion',
  'faith',
  'rite',
  'father',
  'mother',
  'trait',
  'female',
  'sexuality',
  'dna',
  ...STAT_KEYS
])

/** Dated-block statements the form edits (birth/death and marriages) */
const MANAGED_DATED_KEYS = new Set([
  'birth',
  'death',
  'add_spouse',
  'add_matrilineal_spouse',
  'remove_spouse',
  'add_concubine',
  'remove_concubine'
])

/**
 * Everything in the mod that shapes a character beyond the form's fields: the
 * rest of their own record, script run on them, and statements naming them.
 */
export function characterScripts(modPath: string, file: string, id: string): ScriptSite[] {
  return getScriptSites(modPath, 'character', id, {
    file: `history/characters/${file}`,
    key: id,
    managedKeys: MANAGED_KEYS,
    managedDatedKeys: MANAGED_DATED_KEYS,
    managedEffect: (key) => /^set_relation_/i.test(key)
  })
}

// ---------- Saving ----------

/**
 * All edits are surgical: only lines that carry an edited property change; the
 * rest of the block (dated effect blocks, comments, formatting) and the rest of
 * the file are preserved byte-for-byte.
 */

/** Index of the first date-block opener line, used as the insertion anchor for scalars. */
function firstDateBlockLine(ed: LineEditor): number {
  for (let i = 0; i < ed.lines.length; i++) {
    if (ed.depths[i] !== 0) continue
    const code = ed.lines[i].split('#')[0]
    const m = code.match(/^\s*([A-Za-z0-9_.\-']+)\s*=\s*\{/)
    if (m && DATE_KEY.test(m[1])) return i
  }
  return ed.lines.length
}

function setTraits(ed: LineEditor, traits: string[]): void {
  // New trait lines go above the first date block, where the rest of a
  // character's scalars live
  setRepeatedScalar(ed, 'trait', traits, { insertAt: firstDateBlockLine(ed) })
}

/** Rename/add/remove the date block containing a birth/death statement. */
function setDateBlock(ed: LineEditor, statement: 'birth' | 'death', date: string | null): void {
  const body = ed.lines.join('\n')
  const block = findDateBlocks(body, statement)[0] ?? null
  if (block) {
    if (date !== null) {
      // Rename the key in place
      const next =
        body.slice(0, block.start) + date + body.slice(block.start + block.key.length)
      ed.lines = next.split('\n')
    } else if (statement === 'death') {
      // Cut every death statement out of the date block: whole nested
      // `death = { ... }` blocks first (they can span several lines — a
      // per-line filter would orphan their bodies and closing braces),
      // then scalar `death = yes` lines
      let kept = body.slice(block.bodyStart, block.bodyEnd)
      for (const db of scanBlocks(kept).filter((b) => b.key === 'death').reverse()) {
        let from = db.start
        while (from > 0 && (kept[from - 1] === ' ' || kept[from - 1] === '\t')) from--
        let to = db.end
        if (kept[to] === '\r') to++
        if (kept[to] === '\n') to++
        kept = kept.slice(0, from) + kept.slice(to)
      }
      kept = kept
        .split('\n')
        .filter((l) => !/^\s*death\s*=/.test(l.split('#')[0]))
        .join('\n')
      const meaningful = kept.split('\n').some((l) => l.split('#')[0].trim().length > 0)
      if (!meaningful) {
        // Nothing but death in it — drop the whole date block, consuming
        // the line's leading whitespace and trailing newline
        let from = block.start
        while (from > 0 && (body[from - 1] === ' ' || body[from - 1] === '\t')) from--
        let to = block.end
        if (body[to] === '\r') to++
        if (body[to] === '\n') to++
        ed.lines = (body.slice(0, from) + body.slice(to)).split('\n')
      } else {
        ed.lines = (body.slice(0, block.bodyStart) + kept + body.slice(block.bodyEnd)).split('\n')
      }
    }
    refresh(ed)
    return
  }
  if (date === null) return
  // No existing block — append one at the end of the body (before the closing
  // brace's own line, so the block isn't glued to the character's `}`)
  const inner = statement === 'birth' ? 'birth = yes' : 'death = yes'
  const at = endOfBodyIndex(ed)
  ed.lines.splice(
    at,
    0,
    ...withEol(ed, [`${ed.indent}${date} = {`, `${ed.indent}${ed.indent}${inner}`, `${ed.indent}}`], at)
  )
  refresh(ed)
}

/**
 * Remove one statement from a block body, given its span. When the statement
 * was the line's only code the whole line goes (comment included, since it
 * annotated that statement); otherwise just the statement and one neighboring
 * space, so nothing sharing the line is disturbed.
 */
function cutStatement(sub: string, start: number, end: number): string {
  const lineStart = sub.lastIndexOf('\n', start - 1) + 1
  const nl = sub.indexOf('\n', end)
  const lineEnd = nl < 0 ? sub.length : nl
  const [code] = splitComment(sub.slice(lineStart, lineEnd))
  const rest = code.slice(0, start - lineStart) + code.slice(end - lineStart)
  if (rest.trim() === '') {
    return sub.slice(0, lineStart) + sub.slice(nl < 0 ? lineEnd : nl + 1)
  }
  let from = start
  let to = end
  if (sub[to] === ' ') to++
  else if (sub[from - 1] === ' ') from--
  return sub.slice(0, from) + sub.slice(to)
}

/** Whether a block body still carries code once statements have been cut out. */
function hasCode(sub: string): boolean {
  return sub.split('\n').some((line) => splitComment(line)[0].trim() !== '')
}

/** Line index of the opener of the depth-0 date block for `date`, or -1. */
function findDateBlockLine(ed: LineEditor, date: string): number {
  for (let i = 0; i < ed.lines.length; i++) {
    if (ed.depths[i] !== 0) continue
    const [code] = splitComment(ed.lines[i])
    const m = code.match(/^\s*([A-Za-z0-9_.\-']+)\s*=\s*\{/)
    if (m && DATE_KEY.test(m[1]) && cleanDate(m[1]) === date) return i
  }
  return -1
}

/** Add a statement to the block for `date`, creating the block when missing. */
function insertDatedStatement(ed: LineEditor, date: string, statement: string): void {
  const opener = findDateBlockLine(ed, date)
  if (opener >= 0) {
    // A one-line block (`1050.1.1 = { birth = yes }`) has no body line to
    // splice into — append the statement inside its braces instead
    if (opener + 1 >= ed.lines.length || ed.depths[opener + 1] <= ed.depths[opener]) {
      const [code, comment] = splitComment(ed.lines[opener])
      const close = code.lastIndexOf('}')
      ed.lines[opener] = `${code.slice(0, close)}${statement} ${code.slice(close)}${comment}`
      return
    }
    const at = opener + 1
    ed.lines.splice(at, 0, ...withEol(ed, [`${ed.indent}${ed.indent}${statement}`], at))
    refresh(ed)
    return
  }
  // No block for that date — create one, before the first later-dated block
  let at = endOfBodyIndex(ed)
  for (let i = 0; i < ed.lines.length; i++) {
    if (ed.depths[i] !== 0) continue
    const [code] = splitComment(ed.lines[i])
    const m = code.match(/^\s*([A-Za-z0-9_.\-']+)\s*=\s*\{/)
    if (m && DATE_KEY.test(m[1]) && dateSortKey(m[1]) > dateSortKey(date)) {
      at = i
      break
    }
  }
  ed.lines.splice(
    at,
    0,
    ...withEol(
      ed,
      [`${ed.indent}${date} = {`, `${ed.indent}${ed.indent}${statement}`, `${ed.indent}}`],
      at
    )
  )
  refresh(ed)
}

/**
 * Reconcile the body's spouse effects with the edited list. Effects that
 * survive unchanged are matched by value and left byte-for-byte alone; only
 * the ones that went away are cut and the new ones inserted, so an untouched
 * spouse list is a no-op even when the file spells its dates oddly.
 */
function setSpouses(ed: LineEditor, spouses: CharacterSpouse[]): void {
  const body = ed.lines.join('\n')
  const existing = scanSpouseEvents(body)
  const wanted = spouseEvents(spouses).map((e) => ({ event: e, placed: false }))
  const cuts: SpouseEventHit[] = []
  for (const hit of existing) {
    const match = wanted.find((w) => !w.placed && eventKey(w.event) === eventKey(hit))
    if (match) match.placed = true
    else cuts.push(hit)
  }

  if (cuts.length > 0) {
    const blocks = scanBlocks(body)
    // Rewrite each affected block once, dropping it entirely when the cuts
    // leave it empty; blocks are edited back to front so spans stay valid
    const byBlock = new Map<number, SpouseEventHit[]>()
    for (const cut of cuts) byBlock.set(cut.block, [...(byBlock.get(cut.block) ?? []), cut])
    let next = body
    for (const index of [...byBlock.keys()].sort((a, b) => b - a)) {
      const block = blocks[index]
      let sub = next.slice(block.bodyStart, block.bodyEnd)
      for (const cut of byBlock.get(index)!.sort((a, b) => b.start - a.start)) {
        sub = cutStatement(sub, cut.start - block.bodyStart, cut.end - block.bodyStart)
      }
      if (hasCode(sub)) {
        next = next.slice(0, block.bodyStart) + sub + next.slice(block.bodyEnd)
        continue
      }
      let from = block.start
      while (from > 0 && (next[from - 1] === ' ' || next[from - 1] === '\t')) from--
      let to = block.end
      if (next[to] === '\r') to++
      if (next[to] === '\n') to++
      next = next.slice(0, from) + next.slice(to)
    }
    ed.lines = next.split('\n')
    refresh(ed)
  }

  for (const { event } of wanted
    .filter((w) => !w.placed)
    .sort((a, b) => dateSortKey(a.event.date) - dateSortKey(b.event.date))) {
    insertDatedStatement(ed, cleanDate(event.date), statementFor(event))
  }
}

/** Line index the given body offset falls on. */
function lineIndexOf(body: string, offset: number): number {
  let line = 0
  for (let i = 0; i < offset && i < body.length; i++) {
    if (body[i] === '\n') line++
  }
  return line
}

/**
 * Remove one relation statement from an effect body, given its span. A scalar
 * relation behaves like cutStatement; a block-form relation can span several
 * lines, in which case its lines go whole (a trailing comment on the closing
 * brace included, since it annotated that statement).
 */
function cutRelationStatement(sub: string, start: number, end: number): string {
  const lineStart = sub.lastIndexOf('\n', start - 1) + 1
  const nl = sub.indexOf('\n', end)
  const lineEnd = nl < 0 ? sub.length : nl
  const before = sub.slice(lineStart, start)
  const [afterCode] = splitComment(sub.slice(end, lineEnd))
  if (before.trim() === '' && afterCode.trim() === '') {
    return sub.slice(0, lineStart) + sub.slice(nl < 0 ? lineEnd : nl + 1)
  }
  // Shares its line(s) with other code — cut just the statement and one
  // neighboring space, so nothing else on the line is disturbed
  let from = start
  let to = end
  if (sub[to] === ' ') to++
  else if (sub[from - 1] === ' ') from--
  return sub.slice(0, from) + sub.slice(to)
}

/** Splice text out of `text`, consuming leading blanks and the trailing newline. */
function cutBlockSpan(text: string, start: number, end: number): string {
  let from = start
  while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === '\t')) from--
  let to = end
  if (text[to] === '\r') to++
  if (text[to] === '\n') to++
  return text.slice(0, from) + text.slice(to)
}

/**
 * Add a relation statement into the `effect = { … }` wrapper of the block for
 * `date`: reuse the date block's first effect block when there is one, create
 * the wrapper when there isn't, and create the date block itself (placed
 * chronologically) when even that is missing. One-line blocks stay one-line —
 * the statement is spliced inline, in its single-line spelling.
 */
function insertRelation(ed: LineEditor, date: string, rel: CharacterRelation): void {
  const body = ed.lines.join('\n')
  const dateBlock = scanBlocks(body).find(
    (b) => DATE_KEY.test(b.key) && cleanDate(b.key) === date
  )
  const t = ed.indent

  if (!dateBlock) {
    // No block for that date — create one, before the first later-dated block
    let at = endOfBodyIndex(ed)
    for (let i = 0; i < ed.lines.length; i++) {
      if (ed.depths[i] !== 0) continue
      const [code] = splitComment(ed.lines[i])
      const m = code.match(/^\s*([A-Za-z0-9_.\-']+)\s*=\s*\{/)
      if (m && DATE_KEY.test(m[1]) && dateSortKey(m[1]) > dateSortKey(date)) {
        at = i
        break
      }
    }
    ed.lines.splice(
      at,
      0,
      ...withEol(
        ed,
        [
          `${t}${date} = {`,
          `${t}${t}effect = {`,
          ...relationStatementLines(rel, t).map((l) => `${t}${t}${t}${l}`),
          `${t}${t}}`,
          `${t}}`
        ],
        at
      )
    )
    refresh(ed)
    return
  }

  const dateBody = body.slice(dateBlock.bodyStart, dateBlock.bodyEnd)
  const eff = scanBlocks(dateBody).find((b) => b.key === 'effect')

  /** Splice `text` into the body at `offset`, padding with spaces as needed. */
  const spliceInline = (offset: number, text: string): void => {
    const pre = /\s/.test(body[offset - 1] ?? '') ? '' : ' '
    const post = /\s/.test(body[offset] ?? '') ? '' : ' '
    ed.lines = (body.slice(0, offset) + pre + text + post + body.slice(offset)).split('\n')
    refresh(ed)
  }

  if (eff) {
    const effBody = dateBody.slice(eff.bodyStart, eff.bodyEnd)
    if (!effBody.includes('\n')) {
      // One-line effect block — splice the statement before its closing brace
      spliceInline(dateBlock.bodyStart + eff.bodyEnd, relationInline(rel))
      return
    }
    // Append inside the effect block, above its closing brace's line
    const closerLine = lineIndexOf(body, dateBlock.bodyStart + eff.bodyEnd)
    const base = (ed.lines[closerLine].match(/^[ \t]*/)?.[0] ?? `${t}${t}`) + t
    ed.lines.splice(
      closerLine,
      0,
      ...withEol(ed, relationStatementLines(rel, t).map((l) => `${base}${l}`), closerLine)
    )
    refresh(ed)
    return
  }

  if (!dateBody.includes('\n')) {
    // One-line date block with no effect — splice a one-line wrapper in
    spliceInline(dateBlock.bodyEnd, `effect = { ${relationInline(rel)} }`)
    return
  }
  // Multi-line date block with no effect — insert the wrapper after the opener
  const at = lineIndexOf(body, dateBlock.start) + 1
  ed.lines.splice(
    at,
    0,
    ...withEol(
      ed,
      [
        `${t}${t}effect = {`,
        ...relationStatementLines(rel, t).map((l) => `${t}${t}${t}${l}`),
        `${t}${t}}`
      ],
      at
    )
  )
  refresh(ed)
}

/**
 * Reconcile the body's relation effects with the edited list, mirroring
 * setSpouses: statements that survive unchanged are matched by value and left
 * byte-for-byte alone; removed ones are cut (an effect block emptied by the
 * cuts goes whole, and a date block emptied with it goes too) and new ones
 * inserted into their date's effect block.
 */
function setRelations(ed: LineEditor, relations: CharacterRelation[]): void {
  const body = ed.lines.join('\n')
  const existing = scanRelationHits(body)
  const wanted = relations.map((rel) => ({ rel, placed: false }))
  const cuts: RelationHit[] = []
  for (const hit of existing) {
    const match = wanted.find((w) => !w.placed && relationKey(w.rel) === relationKey(hit))
    if (match) match.placed = true
    else cuts.push(hit)
  }

  if (cuts.length > 0) {
    const blocks = scanBlocks(body)
    const byBlock = new Map<number, RelationHit[]>()
    for (const cut of cuts) byBlock.set(cut.block, [...(byBlock.get(cut.block) ?? []), cut])
    let next = body
    // Date blocks are edited back to front so their spans stay valid; the
    // effect blocks within each, likewise
    for (const index of [...byBlock.keys()].sort((a, b) => b - a)) {
      const block = blocks[index]
      let sub = next.slice(block.bodyStart, block.bodyEnd)
      const effects = scanBlocks(sub)
        .filter((b) => b.key === 'effect')
        .sort((a, b) => b.start - a.start)
      for (const eff of effects) {
        const inEffect = byBlock
          .get(index)!
          .map((c) => ({ start: c.start - block.bodyStart, end: c.end - block.bodyStart }))
          .filter((c) => c.start >= eff.bodyStart && c.end <= eff.bodyEnd)
          .sort((a, b) => b.start - a.start)
        if (inEffect.length === 0) continue
        let effBody = sub.slice(eff.bodyStart, eff.bodyEnd)
        for (const c of inEffect) {
          effBody = cutRelationStatement(effBody, c.start - eff.bodyStart, c.end - eff.bodyStart)
        }
        sub = hasCode(effBody)
          ? sub.slice(0, eff.bodyStart) + effBody + sub.slice(eff.bodyEnd)
          : cutBlockSpan(sub, eff.start, eff.end)
      }
      if (hasCode(sub)) {
        next = next.slice(0, block.bodyStart) + sub + next.slice(block.bodyEnd)
      } else {
        next = cutBlockSpan(next, block.start, block.end)
      }
    }
    ed.lines = next.split('\n')
    refresh(ed)
  }

  for (const { rel } of wanted
    .filter((w) => !w.placed)
    .sort((a, b) => dateSortKey(a.rel.date) - dateSortKey(b.rel.date))) {
    insertRelation(ed, cleanDate(rel.date), rel)
  }
}

export function saveCharacter(
  modPath: string,
  file: string,
  originalId: string,
  detail: CharacterDetail
): SaveResult {
  try {
    const path = join(charactersDir(modPath), file)
    if (!existsSync(path)) return { ok: false, error: `File not found: ${file}` }
    const text = readFileSync(path, 'utf-8')
    const blocks = scanBlocks(text)
    const block = blocks.find((b) => b.key === originalId)
    if (!block) return { ok: false, error: `Character ${originalId} not found in ${file}` }

    const newId = detail.id.trim()
    if (!newId) return { ok: false, error: 'ID must not be empty' }
    if (newId !== originalId) {
      if (blocks.some((b) => b.key === newId)) {
        return { ok: false, error: `ID ${newId} already exists in ${file}` }
      }
      const clash = listCharacters(modPath).find((c) => c.id === newId)
      if (clash) {
        return { ok: false, error: `ID ${newId} already exists in ${clash.file}` }
      }
    }
    for (const date of [detail.birth, detail.death]) {
      if (date !== null && !DATE_KEY.test(date)) {
        return { ok: false, error: `Invalid date "${date}" (expected Y.M.D)` }
      }
    }
    const spouseError = validateSpouses(detail.spouses ?? [])
    if (spouseError) return { ok: false, error: spouseError }
    const relationError = validateRelations(detail.relations ?? [])
    if (relationError) return { ok: false, error: relationError }

    const ed = makeEditor(text.slice(block.bodyStart, block.bodyEnd))
    // New scalar lines go above the first date block
    const set = (keys: string[], value: string | null, quoteNew = false): void =>
      setScalar(ed, keys, value, { quoteNew, insertAt: firstDateBlockLine(ed) })
    set(['name'], detail.name, true)
    set(['female'], detail.female)
    set(['sexuality'], detail.sexuality)
    set(['dna'], detail.dna)
    set(['dynasty'], detail.dynasty)
    set(['dynasty_house'], detail.house)
    set(['culture'], detail.culture)
    set(['faith', 'religion'], detail.faith)
    if (detail.rite !== undefined) set(['rite'], detail.rite)
    set(['father'], detail.father)
    set(['mother'], detail.mother)
    for (const key of STAT_KEYS) {
      const v = detail.stats[key]
      set([key], v === null ? null : String(v))
    }
    setTraits(ed, detail.traits)
    setDateBlock(ed, 'birth', detail.birth)
    setDateBlock(ed, 'death', detail.death)
    setSpouses(ed, detail.spouses ?? [])
    setRelations(ed, detail.relations ?? [])

    const newBody = ed.lines.join('\n')
    const updated =
      text.slice(0, block.start) +
      newId +
      text.slice(block.start + originalId.length, block.bodyStart) +
      newBody +
      text.slice(block.bodyEnd)
    // Script edits land on the same in-memory texts, so a statement that can't
    // be placed fails the whole save before anything is written
    const texts = new Map([[resolve(path), updated]])
    const scriptError = applyScriptSites(modPath, texts, detail.scripts ?? [])
    if (scriptError) return { ok: false, error: scriptError }
    for (const [p, t] of texts) writeModText(p, t)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Wire a pasted DNA into the character's history entry: set the `dna =` scalar
 * and (when the appearance is pinned by portrait modifiers) add
 * `add_character_flag = has_scripted_appearance` to the birth block, which is
 * what suppresses the base game's random hair/beard selection. Both edits are
 * surgical; a character already carrying them is left byte-for-byte alone.
 */
export function setCharacterDna(
  modPath: string,
  file: string,
  id: string,
  dnaKey: string,
  addScriptedAppearanceFlag: boolean
): SaveResult {
  try {
    const path = join(charactersDir(modPath), file)
    if (!existsSync(path)) return { ok: false, error: `File not found: ${file}` }
    const text = readFileSync(path, 'utf-8')
    const block = scanBlocks(text).find((b) => b.key === id)
    if (!block) return { ok: false, error: `Character ${id} not found in ${file}` }

    const ed = makeEditor(text.slice(block.bodyStart, block.bodyEnd))
    setScalar(ed, ['dna'], dnaKey, { insertAt: firstDateBlockLine(ed) })
    if (addScriptedAppearanceFlag) {
      const hasFlag = ed.lines.some((l) =>
        /add_character_flag\s*=\s*has_scripted_appearance([^A-Za-z0-9_]|$)/.test(splitComment(l)[0])
      )
      const birth = findDateBlocks(ed.lines.join('\n'), 'birth')[0] ?? null
      if (!hasFlag && birth) {
        insertDatedStatement(
          ed,
          cleanDate(birth.key),
          'add_character_flag = has_scripted_appearance'
        )
      }
    }

    const updated =
      text.slice(0, block.bodyStart) + ed.lines.join('\n') + text.slice(block.bodyEnd)
    writeModText(path, updated)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------- Creating ----------

export function listCharacterFiles(modPath: string): string[] {
  const dir = charactersDir(modPath)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.txt'))
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Append a brand-new character block to a history file (created if missing).
 * Existing file content is preserved byte-for-byte; the block is added after a
 * separating blank line, matching the file's line-ending style.
 */
export function createCharacter(
  modPath: string,
  file: string,
  detail: CharacterDetail
): SaveResult {
  try {
    const id = detail.id.trim()
    if (!id) return { ok: false, error: 'ID must not be empty' }
    if (!KEY_CHARS.test(id)) {
      return { ok: false, error: `Invalid ID "${id}" (letters, digits, _ . - ' only)` }
    }
    if (!isTxtFileName(file)) {
      return { ok: false, error: `Invalid file name "${file}" (expected a .txt file name)` }
    }
    const required: [string, string | null][] = [
      ['Name', detail.name],
      ['Culture', detail.culture],
      ['Faith or rite', detail.faith?.trim() || detail.rite || null],
      ['Birth date', detail.birth]
    ]
    for (const [label, value] of required) {
      if (!value?.trim()) return { ok: false, error: `${label} is required` }
    }
    for (const date of [detail.birth, detail.death]) {
      if (date !== null && !DATE_KEY.test(date)) {
        return { ok: false, error: `Invalid date "${date}" (expected Y.M.D)` }
      }
    }
    const spouseError = validateSpouses(detail.spouses ?? [])
    if (spouseError) return { ok: false, error: spouseError }
    const relationError = validateRelations(detail.relations ?? [])
    if (relationError) return { ok: false, error: relationError }
    const clash = listCharacters(modPath).find((c) => c.id === id)
    if (clash) return { ok: false, error: `ID ${id} already exists in ${clash.file}` }

    const t = '\t'
    const lines: string[] = [`${id} = {`]
    const push = (key: string, value: string | null, quote = false): void => {
      if (value === null || value === '') return
      lines.push(`${t}${key} = ${quote ? `"${value}"` : value}`)
    }
    push('name', detail.name, true)
    push('female', detail.female)
    push('sexuality', detail.sexuality)
    push('dna', detail.dna)
    push('dynasty', detail.dynasty)
    push('dynasty_house', detail.house)
    push('culture', detail.culture)
    push('faith', detail.faith)
    push('rite', detail.rite ?? null)
    push('father', detail.father)
    push('mother', detail.mother)
    for (const trait of detail.traits) push('trait', trait)
    for (const key of STAT_KEYS) {
      const v = detail.stats[key]
      if (v !== null) push(key, String(v))
    }
    // Birth, death and every marriage effect are dated blocks; group the
    // statements by date and emit the blocks chronologically
    const dated = new Map<string, string[]>()
    const onDate = (date: string, statement: string): void => {
      dated.set(cleanDate(date), [...(dated.get(cleanDate(date)) ?? []), statement])
    }
    onDate(detail.birth!, 'birth = yes')
    if (detail.death) onDate(detail.death, 'death = yes')
    for (const event of spouseEvents(detail.spouses ?? [])) {
      onDate(event.date, statementFor(event))
    }
    // Relations need an `effect = { … }` wrapper inside their date's block,
    // emitted after that date's plain statements
    const relDated = new Map<string, string[]>()
    for (const rel of detail.relations ?? []) {
      const date = cleanDate(rel.date)
      relDated.set(date, [...(relDated.get(date) ?? []), ...relationStatementLines(rel, t)])
      if (!dated.has(date)) dated.set(date, [])
    }
    for (const [date, statements] of [...dated].sort(
      (a, b) => dateSortKey(a[0]) - dateSortKey(b[0])
    )) {
      lines.push(`${t}${date} = {`, ...statements.map((x) => `${t}${t}${x}`))
      const rels = relDated.get(date)
      if (rels) lines.push(`${t}${t}effect = {`, ...rels.map((x) => `${t}${t}${t}${x}`), `${t}${t}}`)
      lines.push(`${t}}`)
    }
    lines.push('}')
    appendBlock(charactersDir(modPath), file, lines)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
