/** Structural validation for user-edited CK3 fragments, not a game rules interpreter. */
export function validateScriptFragment(script: string): string | null {
  let depth = 0
  let quoted = false
  let comment = false
  let line = 1
  for (const c of script) {
    if (c === '\0') return `Invalid NUL character on line ${line}`
    if (c === '\n') {
      if (quoted) return `Unclosed quoted value on line ${line}`
      line++
      comment = false
      continue
    }
    if (comment) continue
    if (c === '"') quoted = !quoted
    if (quoted) continue
    if (c === '#') comment = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth < 0) return `Unexpected closing brace on line ${line}`
    }
  }
  if (quoted) return `Unclosed quoted value on line ${line}`
  if (depth > 0) return `${depth} unclosed brace${depth === 1 ? '' : 's'}`
  return null
}

/** A final comment needs a newline before a containing block's closing brace. */
export function terminateScriptComment(script: string, eol: string): string {
  let quoted = false
  for (const c of script.slice(script.lastIndexOf('\n') + 1)) {
    if (c === '"') quoted = !quoted
    if (c === '#' && !quoted) return script + eol
  }
  return script
}
