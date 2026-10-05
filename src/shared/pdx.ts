/**
 * Minimal Paradox-script scanner shared by parsing and editing code.
 *
 * Works on RAW text (comments preserved) so block spans can be used for
 * surgical edits that keep the rest of a file byte-for-byte identical.
 * Braces inside comments (# to end of line) and quoted strings are ignored.
 */

export interface BlockSpan {
  key: string
  /** Offset of the first char of the key */
  start: number
  /** Offset of the first char after the opening brace */
  bodyStart: number
  /** Offset of the closing brace */
  bodyEnd: number
  /** Offset of the first char after the closing brace */
  end: number
}

const KEY_CHARS = /[A-Za-z0-9_.\-']/

/**
 * Scan `key = {` blocks at depth 0 of the given text, returning exact spans.
 */
export function scanBlocks(text: string): BlockSpan[] {
  const blocks: BlockSpan[] = []
  let depth = 0
  let i = 0
  const len = text.length
  // Track the last depth-0 bare word seen, so when we hit `= {` we know the key
  let keyStart = -1
  let keyEnd = -1
  let pendingEquals = false
  while (i < len) {
    const c = text[i]
    if (c === '#') {
      while (i < len && text[i] !== '\n') i++
      continue
    }
    if (c === '"') {
      i++
      while (i < len && text[i] !== '"' && text[i] !== '\n') i++
      i++
      // A quoted string is either a scalar value or a stray token — in both
      // cases the pending `key =` state is finished
      keyStart = -1
      pendingEquals = false
      continue
    }
    if (c === '{') {
      if (depth === 0 && pendingEquals && keyStart >= 0) {
        // Found `key = {` at depth 0 — walk to matching close
        const key = text.slice(keyStart, keyEnd)
        const bodyStart = i + 1
        let d = 1
        let j = bodyStart
        while (j < len && d > 0) {
          const cj = text[j]
          if (cj === '#') {
            while (j < len && text[j] !== '\n') j++
            continue
          }
          if (cj === '"') {
            j++
            while (j < len && text[j] !== '"' && text[j] !== '\n') j++
            j++
            continue
          }
          if (cj === '{') d++
          else if (cj === '}') d--
          j++
        }
        blocks.push({ key, start: keyStart, bodyStart, bodyEnd: j - 1, end: j })
        i = j
        keyStart = -1
        pendingEquals = false
        continue
      }
      depth++
      i++
      keyStart = -1
      pendingEquals = false
      continue
    }
    if (c === '}') {
      depth = Math.max(0, depth - 1)
      i++
      keyStart = -1
      pendingEquals = false
      continue
    }
    if (depth === 0) {
      if (c === '=') {
        pendingEquals = keyStart >= 0
        i++
        continue
      }
      if (KEY_CHARS.test(c)) {
        if (pendingEquals) {
          // `key = value` — a scalar; consume the value word and reset
          while (i < len && KEY_CHARS.test(text[i])) i++
          keyStart = -1
          pendingEquals = false
          continue
        }
        keyStart = i
        while (i < len && KEY_CHARS.test(text[i])) i++
        keyEnd = i
        continue
      }
      if (!/\s/.test(c)) {
        // Unexpected char (e.g. stray token) — reset key tracking
        keyStart = -1
        pendingEquals = false
      }
    }
    i++
  }
  return blocks
}

/** Strip # comments. For read-only parsing paths. */
export function stripComments(text: string): string {
  return text.replace(/#[^\r\n]*/g, '')
}

/**
 * Split a body into lines annotated with the brace depth at the line's start.
 * Depth is computed ignoring braces in comments and quoted strings.
 */
export interface BodyLine {
  text: string
  depth: number
}

export function annotateLines(body: string): BodyLine[] {
  const lines = body.split('\n')
  const result: BodyLine[] = []
  let depth = 0
  for (const line of lines) {
    result.push({ text: line, depth })
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inQuote) {
        if (c === '"') inQuote = false
        continue
      }
      if (c === '#') break
      if (c === '"') inQuote = true
      else if (c === '{') depth++
      else if (c === '}') depth = Math.max(0, depth - 1)
    }
  }
  return result
}

/** Extract scalar `key = value` pairs at depth 0, first occurrence wins. */
export function scanScalars(body: string): Map<string, string> {
  const scalars = new Map<string, string>()
  for (const { text, depth } of annotateLines(body)) {
    if (depth !== 0) continue
    const code = text.split('#')[0]
    const m = code.match(/^\s*([A-Za-z0-9_.\-']+)\s*=\s*(?:"([^"]*)"|([^\s{}"]+))\s*$/)
    if (m) {
      const value = m[2] ?? m[3]
      if (!scalars.has(m[1])) scalars.set(m[1], value)
    }
  }
  return scalars
}

/** Collect ALL values of a repeating scalar key (e.g. trait) at depth 0. */
export function scanRepeatedScalar(body: string, key: string): string[] {
  const values: string[] = []
  for (const { text, depth } of annotateLines(body)) {
    if (depth !== 0) continue
    const code = text.split('#')[0]
    const m = code.match(/^\s*([A-Za-z0-9_.\-']+)\s*=\s*(?:"([^"]*)"|([^\s{}"]+))\s*$/)
    if (m && m[1] === key) values.push(m[2] ?? m[3])
  }
  return values
}

// ---------- Lenient scanning ----------

// A `key = value` statement anywhere in a line of depth-0 code. Unlike
// scanScalars this is not anchored to the whole line, so it also reads
// single-line bodies holding several statements.
const STATEMENT = /(^|\s)([A-Za-z0-9_.\-']+)\s*=\s*(?:"([^"]*)"|([^\s{}"#=]+))/g

/**
 * The depth-0 code of a line — comments and the contents of inline sub-blocks
 * removed — given the brace depth at the line's start.
 */
export function topLevelCode(line: string, startDepth: number): string {
  let out = ''
  let depth = startDepth
  let inQuote = false
  for (const c of line) {
    if (inQuote) {
      if (depth === 0) out += c
      if (c === '"') inQuote = false
      continue
    }
    if (c === '#') break
    if (c === '"') {
      inQuote = true
      if (depth === 0) out += c
      continue
    }
    if (c === '{') {
      depth++
      // Elide the sub-block but leave `{}` so the dangling `key =` before it
      // binds to an unmatchable token instead of swallowing the NEXT
      // statement's key as its value
      if (depth === 1) out += '{}'
      continue
    }
    if (c === '}') {
      depth = Math.max(0, depth - 1)
      if (depth === 0) out += ' '
      continue
    }
    if (depth === 0) out += c
  }
  return out
}

/** Depth-0 scalars with lowercased keys, first occurrence wins. */
export function scanScalarsCI(body: string): Map<string, string> {
  const scalars = new Map<string, string>()
  for (const { text, depth } of annotateLines(body)) {
    for (const m of topLevelCode(text, depth).matchAll(STATEMENT)) {
      const key = m[2].toLowerCase()
      if (!scalars.has(key)) scalars.set(key, m[3] ?? m[4])
    }
  }
  return scalars
}

/**
 * Every value of a repeating depth-0 key, in file order. Matched leniently
 * like scanScalarsCI — case-insensitive, and statements sharing a line with
 * others are still seen (real files write `doctrine = x # why`).
 */
export function scanRepeatedScalarCI(body: string, key: string): string[] {
  const wanted = key.toLowerCase()
  const values: string[] = []
  for (const { text, depth } of annotateLines(body)) {
    for (const m of topLevelCode(text, depth).matchAll(STATEMENT)) {
      if (m[2].toLowerCase() === wanted) values.push(m[3] ?? m[4])
    }
  }
  return values
}
