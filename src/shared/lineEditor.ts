import { annotateLines, scanBlocks } from './pdx'

/**
 * Surgical line editor for the body slice of a `key = { ... }` block. Only
 * the characters that carry an edited property change; comments, formatting
 * and every other line are preserved byte-for-byte, so a no-op edit
 * round-trips exactly.
 */

export interface LineEditor {
  lines: string[]
  depths: number[]
  indent: string
}

export function makeEditor(body: string): LineEditor {
  const annotated = annotateLines(body)
  const lines = annotated.map((l) => l.text)
  const depths = annotated.map((l) => l.depth)
  // Detect the block's indentation from its first scalar line. In a
  // multi-line body the first line is the rest of the opening `{` line
  // (` #Baldwin`), whose leading space isn't indentation
  let indent = '\t'
  for (let i = lines.length > 1 ? 1 : 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s+)\S/)
    if (depths[i] === 0 && m) {
      indent = m[1]
      break
    }
  }
  return { lines, depths, indent }
}

/** Recompute depths after a structural change. */
export function refresh(ed: LineEditor): void {
  const annotated = annotateLines(ed.lines.join('\n'))
  ed.lines = annotated.map((l) => l.text)
  ed.depths = annotated.map((l) => l.depth)
}

/** Split a line at its first unquoted `#` into [code, comment]. */
export function splitComment(line: string): [string, string] {
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuote) {
      if (c === '"') inQuote = false
      continue
    }
    if (c === '"') inQuote = true
    else if (c === '#') return [line.slice(0, i), line.slice(i)]
  }
  return [line, '']
}

/** A `key = value` statement located within one line's code. */
interface StatementHit {
  line: number
  /** Span of the whole statement within the line */
  start: number
  end: number
  /** Span of just the value (including quotes when quoted) */
  valueStart: number
  valueEnd: number
  quoted: boolean
  /** The value with any surrounding quotes stripped */
  value: string
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The depth-0 code of a line, offset-preserving: everything inside inline
 * sub-blocks (relative to the block's own depth 0) and comments is blanked
 * out rather than removed, so a statement match carries its true span within
 * the line. The braces that cross depth 0 stay visible, leaving a masked
 * sub-block reading `{     }` — no key or value charset can match into it.
 *
 * This is the writer's mirror of the readers' `topLevelCode` eliding: the
 * writer must see exactly what `scanScalarsCI` sees, or a save edits content
 * the parse never reported — a single-line child block's own scalars
 * (`b_home = { province = 100 }` inside a county), or the inside of a
 * one-line `effect = { … }`. It also captures depth-0 code AFTER a mid-line
 * closing brace (`} capital = c_b`), which the readers attribute to the
 * block, so an edit replaces it instead of inserting a duplicate.
 */
function depthZeroCode(line: string, startDepth: number): string {
  let out = ''
  let depth = startDepth
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuote) {
      out += depth === 0 ? c : ' '
      if (c === '"') inQuote = false
      continue
    }
    if (c === '#') return out + ' '.repeat(line.length - i)
    if (c === '"') {
      inQuote = true
      out += depth === 0 ? c : ' '
      continue
    }
    if (c === '{') {
      out += depth === 0 ? c : ' '
      depth++
      continue
    }
    if (c === '}') {
      depth = Math.max(0, depth - 1)
      out += depth === 0 ? c : ' '
      continue
    }
    out += depth === 0 ? c : ' '
  }
  return out
}

/**
 * Every statement carrying one of `keys` at depth 0, in file order. Statements
 * are matched anywhere in a line, not just lines holding a single scalar — real
 * files (and this editor's own inline inserts) put several statements on one
 * line — with comments and inline sub-blocks masked out (see depthZeroCode) so
 * the writer sees the same depth-0 code the lenient readers do.
 */
function findStatements(ed: LineEditor, keys: string[], ignoreCase: boolean): StatementHit[] {
  const re = new RegExp(
    `(^|[\\s{}])(?:${keys.map(escapeRe).join('|')})\\s*=\\s*("[^"]*"|[^\\s{}"#=]+)`,
    ignoreCase ? 'gi' : 'g'
  )
  const hits: StatementHit[] = []
  for (let i = 0; i < ed.lines.length; i++) {
    const code = depthZeroCode(ed.lines[i], ed.depths[i])
    for (const m of code.matchAll(re)) {
      const valueEnd = m.index + m[0].length
      const quoted = m[2].startsWith('"')
      hits.push({
        line: i,
        start: m.index + m[1].length,
        end: valueEnd,
        valueStart: valueEnd - m[2].length,
        valueEnd,
        quoted,
        value: quoted ? m[2].slice(1, -1) : m[2]
      })
    }
  }
  return hits
}

/** The first such statement, which is all a single-valued key needs. */
function findStatement(ed: LineEditor, keys: string[], ignoreCase: boolean): StatementHit | null {
  return findStatements(ed, keys, ignoreCase)[0] ?? null
}

/**
 * Cut one statement out of its line. The whole line goes when the statement was
 * its only code — a trailing comment annotates the statement it sits on, so it
 * goes too — otherwise just the statement is spliced out, eating one
 * neighboring space so no double gap is left behind. Leaves `depths` stale: the
 * caller refreshes once it has finished removing.
 */
function removeStatement(ed: LineEditor, hit: StatementHit): void {
  const line = ed.lines[hit.line]
  const [code] = splitComment(line)
  const rest = code.slice(0, hit.start) + code.slice(hit.end)
  if (rest.trim() === '') {
    ed.lines.splice(hit.line, 1)
    return
  }
  let { start, end } = hit
  if (line[end] === ' ') end++
  else if (line[start - 1] === ' ') start--
  ed.lines[hit.line] = line.slice(0, start) + line.slice(end)
}

/** Line index of the first depth-0 statement carrying one of `keys`, or -1. */
export function findScalarLine(ed: LineEditor, keys: string[], ignoreCase = false): number {
  return findStatement(ed, keys, ignoreCase)?.line ?? -1
}

/**
 * Insertion index for the end of a block body: just before the final line when
 * it is only whitespace (a body slice runs from after `{` to before `}`, so its
 * last line is usually the closing brace's indentation), else the very end.
 */
export function endOfBodyIndex(ed: LineEditor): number {
  const last = ed.lines.length - 1
  if (last > 0 && /^\s*$/.test(ed.lines[last])) return last
  return ed.lines.length
}

/** "\r" when the body uses CRLF line endings, so inserted lines match. */
export function eolSuffix(ed: LineEditor): string {
  return ed.lines.some((l) => l.endsWith('\r')) ? '\r' : ''
}

/**
 * Terminate inserted lines with \r in CRLF bodies (join adds only the \n).
 * A line appended at the very end gets none — nothing follows it.
 */
export function withEol(ed: LineEditor, lines: string[], at: number): string[] {
  const cr = eolSuffix(ed)
  if (cr === '') return lines
  const appendAtEnd = at >= ed.lines.length
  return lines.map((l, i) => (appendAtEnd && i === lines.length - 1 ? l : l + cr))
}

export interface SetScalarOptions {
  /** Quote the value when inserting a new line (existing values keep their style) */
  quoteNew?: boolean
  /**
   * Line index for an inserted line; defaults to the end of the body. The
   * default also keeps a single-line body (`x = { name = "y" }`) on one line
   * by appending inline; an explicit index always splices a new line.
   */
  insertAt?: number
  /** Match existing keys case-insensitively; `keys[0]` is still written as given */
  ignoreCase?: boolean
}

/**
 * Set/replace/remove a scalar. `keys` lists accepted existing spellings
 * (e.g. ['faith', 'religion']); when inserting, `keys[0]` is written.
 * Quote style of an existing value is preserved; `quoteNew` controls inserts.
 */
export function setScalar(
  ed: LineEditor,
  keys: string[],
  value: string | null,
  opts: SetScalarOptions = {}
): void {
  const hit = findStatement(ed, keys, opts.ignoreCase ?? false)
  if (value === null || value === '') {
    if (!hit) return
    removeStatement(ed, hit)
    refresh(ed)
    return
  }
  if (hit) {
    // Replace only the value span; everything else on the line stays verbatim
    const line = ed.lines[hit.line]
    const next = hit.quoted ? `"${value}"` : value
    ed.lines[hit.line] = line.slice(0, hit.valueStart) + next + line.slice(hit.valueEnd)
    return
  }
  const statement = `${keys[0]} = ${opts.quoteNew ? `"${value}"` : value}`
  if (opts.insertAt === undefined && ed.lines.length === 1) {
    ed.lines[0] = `${ed.lines[0].replace(/\s*$/, '')} ${statement} `
    return
  }
  const at = opts.insertAt ?? endOfBodyIndex(ed)
  const cr = at < ed.lines.length ? eolSuffix(ed) : ''
  ed.lines.splice(at, 0, `${ed.indent}${statement}${cr}`)
  refresh(ed)
}

// ---------- Block-valued keys ----------

/**
 * Splice raw text into the body by character offsets and re-annotate. Offsets
 * come from `scanBlocks` over the same joined text, so an edit lands exactly
 * where the scanner saw the block and everything outside the span survives
 * byte-for-byte.
 */
function spliceText(ed: LineEditor, start: number, end: number, replacement: string): void {
  const text = ed.lines.join('\n')
  ed.lines = (text.slice(0, start) + replacement + text.slice(end)).split('\n')
  refresh(ed)
}

/** Every depth-0 `key = { … }` sub-block of the body, keys matched case-insensitively. */
function findBlocks(ed: LineEditor, key: string): ReturnType<typeof scanBlocks> {
  const wanted = key.toLowerCase()
  return scanBlocks(ed.lines.join('\n')).filter((b) => b.key.toLowerCase() === wanted)
}

/** The whitespace prefix of the first non-blank line of a block body, if any. */
function innerIndent(body: string, fallback: string): string {
  for (const line of body.split('\n')) {
    const m = line.match(/^([ \t]*)\S/)
    if (m) return m[1]
  }
  return fallback
}

/**
 * Set the contents of a `key = { … }` block to `values`, one per line.
 *
 * A block that already exists keeps its shape: single-line stays single-line
 * (`coa_gfx = { a b }`), multi-line keeps its inner indentation. An empty list
 * removes the whole statement; a new list is appended at the end of the body.
 * Duplicate blocks of the same key — real files carry them — collapse into the
 * first, since the edited value is the whole truth about the field.
 */
export function setBlockList(ed: LineEditor, key: string, values: string[]): void {
  setBlockBody(
    ed,
    key,
    values.length === 0
      ? null
      : (indent) => ({
          single: ` ${values.join(' ')} `,
          multi: values.map((v) => `${indent}${v}`)
        })
  )
}

/** Line renderings for a block body: one for a single-line block, one for a multi-line one. */
type BlockBody = (innerIndent: string) => { single: string; multi: string[] }

/**
 * Shared machinery behind setBlockList and the ethnicities writer: replace,
 * insert or delete the `key = { … }` statement. `render` returning null
 * deletes it.
 */
export function setBlockBody(ed: LineEditor, key: string, render: BlockBody | null): void {
  const blocks = findBlocks(ed, key)

  if (render === null) {
    // Delete back-to-front so earlier spans keep their offsets
    for (const block of [...blocks].reverse()) {
      const text = ed.lines.join('\n')
      // Swallow the line's leading whitespace and its newline when the
      // statement is all the line holds, so no blank line is left behind
      let start = block.start
      while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--
      let end = block.end
      const trailing = /^[ \t]*\r?\n/.exec(text.slice(end))
      if (trailing && (start === 0 || text[start - 1] === '\n')) end += trailing[0].length
      spliceText(ed, start, end, '')
    }
    return
  }

  for (const extra of blocks.slice(1).reverse()) spliceText(ed, extra.start, extra.end, '')
  const block = findBlocks(ed, key)[0] ?? null

  if (block === null) {
    const body = render(`${ed.indent}${ed.indent}`)
    const cr = eolSuffix(ed)
    const at = endOfBodyIndex(ed)
    ed.lines.splice(
      at,
      0,
      `${ed.indent}${key} = {${cr}`,
      ...body.multi.map((l) => `${l}${cr}`),
      `${ed.indent}}${cr}`
    )
    refresh(ed)
    return
  }

  const text = ed.lines.join('\n')
  const current = text.slice(block.bodyStart, block.bodyEnd)
  if (!current.includes('\n')) {
    spliceText(ed, block.bodyStart, block.bodyEnd, render(ed.indent).single)
    return
  }
  // Multi-line: keep the closing brace's own indentation by rebuilding the
  // body as newline + items + closing indent
  const closingIndent = current.slice(current.lastIndexOf('\n') + 1)
  const cr = eolSuffix(ed)
  const body = render(innerIndent(current, `${closingIndent}${ed.indent}`))
  const lines = body.multi.map((l) => `${l}${cr}`).join('\n')
  spliceText(ed, block.bodyStart, block.bodyEnd, `${cr}\n${lines}\n${closingIndent}`)
}

export interface SetRepeatedOptions {
  /**
   * Line index for the first inserted value when the key has no existing lines
   * to append after; defaults to the end of the body.
   */
  insertAt?: number
  /** Match existing keys case-insensitively; `key` is still written as given */
  ignoreCase?: boolean
}

/**
 * Set a repeating scalar (`doctrine = …`, `holy_site = …`) to `values`.
 *
 * Written as a multiset diff rather than a wipe-and-rewrite: lines whose value
 * survives stay exactly as they are, comments and ordering included — real
 * religion files annotate their doctrine lines, and those notes belong to the
 * doctrine, not to the position. Only surplus lines are cut and only genuinely
 * new values appended, so saving an untouched list changes nothing at all.
 */
export function setRepeatedScalar(
  ed: LineEditor,
  key: string,
  values: string[],
  opts: SetRepeatedOptions = {}
): void {
  const hits = findStatements(ed, [key], opts.ignoreCase ?? false)
  const wanted = [...values]
  const surplus: StatementHit[] = []
  for (const hit of hits) {
    const at = wanted.indexOf(hit.value)
    if (at >= 0) wanted.splice(at, 1)
    else surplus.push(hit)
  }
  // Bottom-up so earlier hits' line indices stay valid as lines are spliced out
  for (const hit of surplus.reverse()) removeStatement(ed, hit)
  if (surplus.length > 0) refresh(ed)
  if (wanted.length === 0) return

  // New values land under the last surviving line of the same key, keeping a
  // faith's doctrines together instead of scattering them down the block
  const remaining = findStatements(ed, [key], opts.ignoreCase ?? false)
  if (remaining.length === 0 && opts.insertAt === undefined && ed.lines.length === 1) {
    // A single-line body (`x = { color = { 1 2 3 } icon = y }`) stays on one
    // line, the way setScalar keeps it, rather than growing a line that the
    // closing brace then gets glued to
    const statements = wanted.map((v) => `${key} = ${v}`).join(' ')
    ed.lines[0] = `${ed.lines[0].replace(/\s*$/, '')} ${statements} `
    return
  }
  const at =
    remaining.length > 0
      ? remaining[remaining.length - 1].line + 1
      : (opts.insertAt ?? endOfBodyIndex(ed))
  ed.lines.splice(at, 0, ...withEol(ed, wanted.map((v) => `${ed.indent}${key} = ${v}`), at))
  refresh(ed)
}
