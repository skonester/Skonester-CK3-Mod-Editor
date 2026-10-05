import { makeEditor, setRepeatedScalar, setScalar } from './lineEditor'
import { compactScript, parseScript } from './scriptTree'
import type { ScriptNode } from './scriptTree'

/**
 * The common effects of a `character:<id> = { … }` block, read as data so the
 * editor can show them as fields, and the writers that change one of them
 * while leaving the rest of the block's text exactly as it was.
 *
 * Only the block's own top level is read: an `add_trait` inside an `if` in
 * the block is conditional, so it stays part of the raw script rather than
 * being promoted to a field that would claim it always happens.
 */
export interface ScopeEffects {
  addTraits: string[]
  removeTraits: string[]
  perks: string[]
  flags: string[]
  /** `set_sexuality = …`, null when the block doesn't set it */
  sexuality: string | null
  /** Single-number effects (`add_piety = 300`, `add_martial_skill = 2`), in file order */
  amounts: { key: string; value: string }[]
  /** `some_scripted_effect = yes` lines, in file order */
  calls: string[]
  /** Blocks scoped to another entity (`character:94030 = { … }`) */
  nested: { key: string; kind: string; id: string }[]
  /** Statements none of the above covers, each compacted to one line */
  other: string[]
}

/** The statement's block node and the offsets of its body within `text`. */
function blockOf(text: string): ScriptNode | null {
  const node = parseScript(text).find((n) => n.key !== null)
  return node?.children ? node : null
}

const NUMBER = /^-?\d+(\.\d+)?$/

/** Read a scope block's top-level effects; null when `text` isn't a block statement. */
export function readScopeEffects(text: string): ScopeEffects | null {
  const node = blockOf(text)
  if (!node) return null
  const fx: ScopeEffects = {
    addTraits: [],
    removeTraits: [],
    perks: [],
    flags: [],
    sexuality: null,
    amounts: [],
    calls: [],
    nested: [],
    other: []
  }
  const other = (n: ScriptNode): void => {
    fx.other.push(compactScript(text.slice(n.start, n.end)))
  }
  for (const child of node.children ?? []) {
    const key = child.key
    if (key === null) {
      other(child)
      continue
    }
    const value = child.value
    const scope = /^([a-z_]+):(.+)$/i.exec(key)
    if (scope && child.children) fx.nested.push({ key, kind: scope[1], id: scope[2] })
    else if (value === null) other(child)
    else if (key === 'add_trait') fx.addTraits.push(value)
    else if (key === 'remove_trait') fx.removeTraits.push(value)
    else if (key === 'add_perk') fx.perks.push(value)
    else if (key === 'add_character_flag') fx.flags.push(value)
    else if (key === 'set_sexuality' && fx.sexuality === null) fx.sexuality = value
    else if (NUMBER.test(value) && /^(add|change)_/.test(key)) fx.amounts.push({ key, value })
    else if (value === 'yes' && child.op === '=') fx.calls.push(key)
    else other(child)
  }
  return fx
}

/** Rewrite the block's body with a line-editor change, keeping the statement around it. */
function editBody(text: string, change: (ed: ReturnType<typeof makeEditor>) => void): string {
  const node = blockOf(text)
  if (!node) return text
  const ed = makeEditor(text.slice(node.bodyStart, node.bodyEnd))
  change(ed)
  return text.slice(0, node.bodyStart) + ed.lines.join('\n') + text.slice(node.bodyEnd)
}

/** Set every value of a repeating effect (`add_trait`, `add_perk` …), as a minimal diff. */
export function setScopeList(text: string, key: string, values: string[]): string {
  return editBody(text, (ed) => setRepeatedScalar(ed, key, values))
}

/** Set, change or (with null) remove a single-valued effect such as `set_sexuality`. */
export function setScopeScalar(text: string, key: string, value: string | null): string {
  return editBody(text, (ed) => setScalar(ed, [key], value))
}

/**
 * A single `key = value` statement's parts, for own-record lines like
 * `add_trait = conqueror` that the editor folds into its fields; null for
 * anything else (blocks, several statements).
 */
export function readStatement(text: string): { key: string; value: string } | null {
  const nodes = parseScript(text)
  if (nodes.length !== 1) return null
  const [node] = nodes
  if (node.key === null || node.value === null || node.op !== '=') return null
  return { key: node.key, value: node.value }
}
