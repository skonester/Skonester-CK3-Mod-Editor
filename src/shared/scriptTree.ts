/**
 * Full-depth Paradox-script parser with exact offsets.
 *
 * pdx.ts scans one level at a time, which is all the history editors need.
 * Script files (scripted effects, on_actions, events, decisions) nest freely —
 * `eddy_set_up_effect = { if = { limit = { … } character:205523 = { … } } }`
 * — so finding everything that touches an entity needs the whole tree. Every
 * node keeps the RAW span it came from, so a statement can be spliced back
 * into its file leaving every other byte as it was.
 *
 * Lenient like the game: a stray closing brace is skipped, an unclosed block
 * runs to the end of the text, and a key with no value is kept as a key.
 */

export interface ScriptNode {
  /** The statement's key; null for a bare list value or an anonymous `{ … }` */
  key: string | null
  /** `=`, `?=`, `<`, `>=` …; null for bare values */
  op: string | null
  /** Offset of the statement's first character (the key, or a bare value) */
  start: number
  /** Offset just past the statement (past the closing brace for a block) */
  end: number
  /** A scalar value as written, quotes stripped; null for a block */
  value: string | null
  quoted: boolean
  /** A block value's statements; null for a scalar */
  children: ScriptNode[] | null
  /** Offsets of a block's body: just after `{` and at the closing `}` */
  bodyStart: number
  bodyEnd: number
}

type Token =
  | { t: 'open'; start: number; end: number }
  | { t: 'close'; start: number; end: number }
  | { t: 'op'; start: number; end: number; op: string }
  | { t: 'word'; start: number; end: number; value: string; quoted: boolean }

const OPERATORS = ['?=', '==', '!=', '<=', '>=', '=', '<', '>']
const WORD_STOP = /[\s{}=<>!?#"]/

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const len = text.length
  let i = 0
  while (i < len) {
    const c = text[i]
    if (c === '#') {
      while (i < len && text[i] !== '\n') i++
      continue
    }
    if (/\s/.test(c) || c === '﻿') {
      i++
      continue
    }
    if (c === '{' || c === '}') {
      tokens.push(
        c === '{' ? { t: 'open', start: i, end: i + 1 } : { t: 'close', start: i, end: i + 1 }
      )
      i++
      continue
    }
    if (c === '"') {
      // Strings are single-line, as in the game (and pdx.ts's scanner)
      let j = i + 1
      while (j < len && text[j] !== '"' && text[j] !== '\n') j++
      const end = text[j] === '"' ? j + 1 : j
      tokens.push({ t: 'word', start: i, end, value: text.slice(i + 1, j), quoted: true })
      i = end
      continue
    }
    const op = OPERATORS.find((o) => text.startsWith(o, i))
    if (op) {
      tokens.push({ t: 'op', start: i, end: i + op.length, op })
      i += op.length
      continue
    }
    let j = i
    while (j < len && !WORD_STOP.test(text[j])) j++
    if (j === i) {
      // A lone `!` or `?` that isn't part of an operator: step over it
      i++
      continue
    }
    tokens.push({ t: 'word', start: i, end: j, value: text.slice(i, j), quoted: false })
    i = j
  }
  return tokens
}

/** Parse script text into its top-level statements. */
export function parseScript(text: string): ScriptNode[] {
  const tokens = tokenize(text)
  let p = 0

  const block = (open: Token): ScriptNode[] & { closeAt: number } => {
    const children = parseList(true) as ScriptNode[] & { closeAt: number }
    return Object.assign(children, { closeAt: children.closeAt ?? open.end })
  }

  function parseList(nested: boolean): ScriptNode[] & { closeAt?: number } {
    const nodes: ScriptNode[] & { closeAt?: number } = []
    while (p < tokens.length) {
      const tok = tokens[p]
      if (tok.t === 'close') {
        p++
        if (nested) {
          nodes.closeAt = tok.start
          return nodes
        }
        continue // stray closing brace at the top level
      }
      if (tok.t === 'op') {
        p++ // an operator with no key before it
        continue
      }
      if (tok.t === 'open') {
        p++
        const children = block(tok)
        const closeAt = children.closeAt
        nodes.push({
          key: null,
          op: null,
          start: tok.start,
          end: closeAt < text.length && text[closeAt] === '}' ? closeAt + 1 : closeAt,
          value: null,
          quoted: false,
          children,
          bodyStart: tok.end,
          bodyEnd: closeAt
        })
        continue
      }
      // A word: `key op value`, or a bare value
      p++
      const next = tokens[p]
      if (next?.t !== 'op') {
        nodes.push({
          key: null,
          op: null,
          start: tok.start,
          end: tok.end,
          value: tok.value,
          quoted: tok.quoted,
          children: null,
          bodyStart: tok.end,
          bodyEnd: tok.end
        })
        continue
      }
      p++
      const val = tokens[p]
      if (val?.t === 'open') {
        p++
        const children = block(val)
        const closeAt = children.closeAt
        nodes.push({
          key: tok.value,
          op: next.op,
          start: tok.start,
          end: closeAt < text.length && text[closeAt] === '}' ? closeAt + 1 : closeAt,
          value: null,
          quoted: false,
          children,
          bodyStart: val.end,
          bodyEnd: closeAt
        })
        continue
      }
      if (val?.t === 'word') {
        p++
        nodes.push({
          key: tok.value,
          op: next.op,
          start: tok.start,
          end: val.end,
          value: val.value,
          quoted: val.quoted,
          children: null,
          bodyStart: val.end,
          bodyEnd: val.end
        })
        continue
      }
      // `key =` with nothing usable after it
      nodes.push({
        key: tok.value,
        op: next.op,
        start: tok.start,
        end: next.end,
        value: null,
        quoted: false,
        children: null,
        bodyStart: next.end,
        bodyEnd: next.end
      })
    }
    if (nested) nodes.closeAt = text.length
    return nodes
  }

  return parseList(false)
}

/** 1-based line number of an offset. */
export function lineAt(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++
  return line
}

/** Depth-first walk; `visit` gets each node with its ancestors (outermost first). */
export function walkScript(
  nodes: ScriptNode[],
  visit: (node: ScriptNode, ancestors: ScriptNode[]) => void,
  ancestors: ScriptNode[] = []
): void {
  for (const node of nodes) {
    visit(node, ancestors)
    if (node.children) walkScript(node.children, visit, [...ancestors, node])
  }
}

/** A statement's text with runs of whitespace collapsed, for one-line display. */
export function compactScript(text: string): string {
  return text
    .replace(/#[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
