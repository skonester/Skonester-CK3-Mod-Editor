import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, resolve, sep } from 'path'
import type { ScriptHop, ScriptScopeKind, ScriptSite } from '@shared/types'
import { terminateScriptComment, validateScriptFragment } from '@shared/scriptValidation'
import { splitComment } from '@shared/lineEditor'
import { compactScript, lineAt, parseScript, walkScript } from '@shared/scriptTree'
import type { ScriptNode } from '@shared/scriptTree'

/**
 * Finds everything in a mod's script that touches one entity, and writes edits
 * to it back in place.
 *
 * A character is rarely just their history record. Total conversions set the
 * stage at game start: `character:205523 = { add_trait = … add_perk = … }` in
 * a scripted effect an on_action runs, a title history `holder = 205523`, a
 * bookmark's `history_id = 205523`, a `tfc_set_liege_effect = { … LIEGE =
 * 205523 }` call. Each of those is a ScriptSite: the statement's exact text
 * plus enough of its surroundings (enclosing keys, `if` limits, the chain of
 * on_actions/effects/events that reaches it) to read it without opening the
 * file. Saving splices the edited text over the statement's span and leaves
 * every other byte alone.
 */

// Folders that hold no script worth scanning (art, maps, text) or that are
// machine-written data whose only mention of an id is a comment
const SKIP_PREFIXES = [
  'gfx/',
  'map_data/',
  'localization/',
  'fonts/',
  'sound/',
  'music/',
  'content_source/',
  'common/bookmark_portraits/',
  'common/coat_of_arms/',
  'common/dna_data/',
  'common/ethnicities/',
  'common/genes/'
]

interface ParsedFile {
  rel: string
  text: string
  tree: ScriptNode[]
}

// Parses are kept per file and reused while its text is unchanged. Keyed on
// the text itself, not mtime: a same-size edit within the clock's resolution
// (`holder = 100` → `101`) must never be served stale, and reading a mod's
// script is cheap next to parsing it.
const cache = new Map<string, ParsedFile>()

function readParsed(abs: string, rel: string): ParsedFile | null {
  try {
    const text = readFileSync(abs, 'utf-8')
    const hit = cache.get(abs)
    if (hit && hit.text === text && hit.rel === rel) return hit
    const file = { rel, text, tree: parseScript(text) }
    cache.set(abs, file)
    return file
  } catch {
    return null
  }
}

const toRel = (modPath: string, abs: string): string => relative(modPath, abs).split(sep).join('/')

/** Every scannable `.txt` in the mod, parsed (cached by mtime). */
function modScripts(modPath: string): ParsedFile[] {
  const files: ParsedFile[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const abs = join(dir, name)
      const rel = toRel(modPath, abs)
      let isDir = false
      try {
        isDir = statSync(abs).isDirectory()
      } catch {
        continue
      }
      if (isDir) {
        if (!SKIP_PREFIXES.some((p) => `${rel}/`.startsWith(p))) walk(abs)
        continue
      }
      if (!name.toLowerCase().endsWith('.txt') || !rel.includes('/')) continue
      if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue
      const parsed = readParsed(abs, rel)
      if (parsed) files.push(parsed)
    }
  }
  if (existsSync(modPath)) walk(modPath)
  return files
}

function folderKind(rel: string): ScriptHop['kind'] {
  if (rel.startsWith('common/scripted_effects/')) return 'scripted_effect'
  if (rel.startsWith('common/scripted_triggers/')) return 'scripted_trigger'
  if (rel.startsWith('common/on_action/')) return 'on_action'
  if (rel.startsWith('events/')) return 'event'
  if (rel.startsWith('common/decisions/')) return 'decision'
  if (rel.startsWith('history/')) return 'history'
  if (rel.startsWith('common/bookmarks/')) return 'bookmark'
  return 'other'
}

// ---------- How a statement is reached ----------

/** Blocks whose contents are conditions rather than effects */
const TRIGGER_KEYS = new Set([
  'limit',
  'trigger',
  'potential',
  'allow',
  'is_shown',
  'is_valid',
  'is_valid_showing_failures_only',
  'is_possible',
  'can_pick',
  'ai_potential',
  'ai_will_do',
  'ai_check_interval',
  'weight_multiplier',
  'modifier',
  'or',
  'and',
  'not',
  'nor',
  'nand',
  'trigger_if',
  'trigger_else_if',
  'trigger_else',
  'is_highlighted',
  'can_start',
  'valid',
  'cost',
  'show_as_unavailable'
])

/** Keys whose list values (or `id`/`on_action` children) name an on_action or event to run */
const LIST_CALLERS = new Set([
  'on_actions',
  'events',
  'random_events',
  'random_on_action',
  'random_on_actions',
  'first_valid',
  'first_valid_on_action',
  'first_valid_on_actions'
])

interface Usage {
  /** The top-level statement of the file the call sits in */
  top: string
  rel: string
}

interface ScriptIndex {
  /** Top-level definitions by name: scripted effects/triggers, on_actions, events, decisions */
  defs: Map<string, { rel: string; node: ScriptNode; kind: ScriptHop['kind'] }[]>
  /** Where each name is run from */
  usages: Map<string, Usage[]>
  /** Raw body of each scripted effect/trigger, for resolving `$PARAM$` scopes */
  callableBodies: Map<string, string>
}

function buildIndex(files: ParsedFile[]): ScriptIndex {
  const defs: ScriptIndex['defs'] = new Map()
  const callableBodies = new Map<string, string>()
  for (const file of files) {
    const kind = folderKind(file.rel)
    if (!['scripted_effect', 'scripted_trigger', 'on_action', 'event', 'decision'].includes(kind)) {
      continue
    }
    for (const node of file.tree) {
      if (node.key === null || node.children === null) continue
      const list = defs.get(node.key) ?? []
      list.push({ rel: file.rel, node, kind })
      defs.set(node.key, list)
      if (kind === 'scripted_effect' || kind === 'scripted_trigger') {
        callableBodies.set(node.key, file.text.slice(node.bodyStart, node.bodyEnd))
      }
    }
  }

  const usages: ScriptIndex['usages'] = new Map()
  const use = (name: string, top: ScriptNode | undefined, rel: string): void => {
    if (!top?.key || top.key === name) return
    const list = usages.get(name) ?? []
    if (!list.some((u) => u.top === top.key && u.rel === rel)) list.push({ top: top.key, rel })
    usages.set(name, list)
  }
  for (const file of files) {
    walkScript(file.tree, (node, ancestors) => {
      if (ancestors.length === 0) return
      const top = ancestors[0]
      const parent = ancestors[ancestors.length - 1]
      const parentKey = parent.key?.toLowerCase() ?? ''
      // `my_effect = yes` / `my_effect = { PARAM = … }`
      if (node.key !== null && callableBodies.has(node.key)) use(node.key, top, file.rel)
      // `on_actions = { a b }`, `random_events = { 100 = ev.1 }`
      if (LIST_CALLERS.has(parentKey) && node.value !== null && !/^\d+$/.test(node.value)) {
        use(node.value, top, file.rel)
      }
      // `trigger_event = ev.1`, `trigger_event = { id = ev.1 on_action = x }`
      const key = node.key?.toLowerCase()
      if (node.value !== null) {
        if (key === 'trigger_event' || (parentKey === 'trigger_event' && (key === 'id' || key === 'on_action'))) {
          use(node.value, top, file.rel)
        }
        if (key === 'fallback' && ancestors.length === 1) use(node.value, top, file.rel)
      }
    })
  }
  return { defs, usages, callableBodies }
}

function hopFor(index: ScriptIndex, files: ParsedFile[], name: string, rel: string): ScriptHop {
  const defs = index.defs.get(name) ?? []
  const def = defs.find((d) => d.rel === rel) ?? defs[0]
  const kind = def?.kind ?? folderKind(rel)
  let condition: string | null = null
  if (def && (kind === 'on_action' || kind === 'event')) {
    const trigger = def.node.children?.find((c) => c.key?.toLowerCase() === 'trigger' && c.children)
    const text = files.find((f) => f.rel === def.rel)?.text
    if (trigger && text) condition = compactScript(text.slice(trigger.bodyStart, trigger.bodyEnd)) || null
  }
  return { name, kind, condition }
}

const MAX_CHAINS = 6
const MAX_DEPTH = 8

/** Every chain of callers ending at `name`, entry point first. */
function chainsTo(
  index: ScriptIndex,
  files: ParsedFile[],
  name: string,
  rel: string,
  seen: Set<string> = new Set([name])
): ScriptHop[][] {
  const hop = hopFor(index, files, name, rel)
  const users = index.usages.get(name) ?? []
  const chains: ScriptHop[][] = []
  if (seen.size < MAX_DEPTH) {
    for (const user of users) {
      if (seen.has(user.top)) continue
      for (const chain of chainsTo(index, files, user.top, user.rel, new Set([...seen, user.top]))) {
        chains.push([...chain, hop])
        if (chains.length >= MAX_CHAINS) return chains
      }
    }
  }
  return chains.length > 0 ? chains : [[hop]]
}

// ---------- Finding the statements ----------

/** Bare-id values that point at an entity of each kind (no `kind:` prefix) */
const BARE_KEYS: Record<ScriptScopeKind, Set<string>> = {
  character: new Set([
    'holder',
    'father',
    'mother',
    'employer',
    'history_id',
    'add_spouse',
    'add_matrilineal_spouse',
    'add_concubine',
    'remove_spouse',
    'remove_concubine'
  ]),
  title: new Set(),
  faith: new Set(),
  culture: new Set(),
  dynasty: new Set(),
  house: new Set()
}

/** The entity's own record, which the editor's form fields mostly cover. */
export interface OwnRecord {
  /** Mod-relative path of the file holding it */
  file: string
  /** Its top-level key */
  key: string
  /** Statements directly in the record that the form edits */
  managedKeys: Set<string>
  /** Statements in its dated blocks that the form edits */
  managedDatedKeys: Set<string>
  /** Statements inside dated `effect = { … }` blocks that the form edits */
  managedEffect: (key: string) => boolean
}

const DATE_KEY = /^\d+\.\d+(\.\d+)?\.?$/
const pathKey = (n: ScriptNode): string => n.key ?? '{}'

/** The date of the nearest dated block among `path`, if any */
const dateIn = (path: string[]): string | null =>
  [...path].reverse().find((k) => DATE_KEY.test(k))?.replace(/\.$/, '') ?? null

function summarize(
  kind: ScriptScopeKind,
  role: ScriptSite['role'],
  context: ScriptSite['context'],
  node: ScriptNode,
  path: string[],
  param: string | null
): string {
  if (role === 'scope') return context === 'trigger' ? `Tests this ${kind}` : `Runs on this ${kind}`
  const date = dateIn(path)
  const from = date ? ` from ${date}` : ''
  const top = path[0]
  if (role === 'own') return date ? `History at ${date}` : 'History record'
  if (param !== null) return `Passed to ${node.key} as ${param}`
  if (context === 'trigger') {
    // The block that holds the condition, e.g. a decision's `is_shown`
    const gate = [...path].slice(1, -1).reverse().find((k) => TRIGGER_KEYS.has(k.toLowerCase()))
    return `Condition in ${top}${gate ? ` (${gate})` : ''}`
  }
  switch (node.key?.toLowerCase()) {
    case 'holder':
      return `Holds ${top}${from}`
    case 'history_id':
      return `Bookmark character in ${top}`
    case 'employer':
      return `Employs ${top}${from}`
    case 'add_spouse':
    case 'add_matrilineal_spouse':
      return `Married to ${top}${from}`
    case 'add_concubine':
      return `Concubine of ${top}${from}`
    case 'remove_spouse':
    case 'remove_concubine':
      return `Separated from ${top}${from}`
    case 'father':
      return `Father of ${top}`
    case 'mother':
      return `Mother of ${top}`
  }
  // `set_employer = character:X` inside `character:Y = { … }` reads as "set_employer for character:Y"
  const scope = [...path].slice(0, -1).reverse().find((k) => /^[a-z_]+:/i.test(k))
  return scope ? `${node.key} for ${scope}` : `${node.key ?? 'Statement'} in ${top}`
}

/**
 * Everything in the mod that touches `<kind>:<id>`. `own` names the entity's
 * own record: its statements the form doesn't cover come back as `own`
 * sites, and nothing inside it is reported again as a reference.
 */
export function getScriptSites(
  modPath: string,
  kind: ScriptScopeKind,
  id: string,
  own: OwnRecord | null = null
): ScriptSite[] {
  const files = modScripts(modPath)
  const index = buildIndex(files)
  const token = `${kind}:${id}`.toLowerCase()
  const isToken = (s: string | null): boolean => s !== null && s.toLowerCase() === token
  const startsToken = (s: string | null): boolean =>
    s !== null && (s.toLowerCase() === token || s.toLowerCase().startsWith(`${token}.`))
  const bare = BARE_KEYS[kind]
  const sites: ScriptSite[] = []

  for (const file of files) {
    const fileKind = folderKind(file.rel)
    const seenStarts = new Set<number>()
    const occurrences = new Map<string, number>()

    const add = (
      node: ScriptNode,
      ancestors: ScriptNode[],
      role: ScriptSite['role'],
      param: string | null = null,
      summary: string | null = null
    ): void => {
      if (seenStarts.has(node.start)) return
      seenStarts.add(node.start)
      const path = [...ancestors.map(pathKey), pathKey(node)]
      const diskText = file.text.slice(node.start, node.end)
      const occKey = `${path.join('\u0000')}\u0001${diskText}`
      const occurrence = occurrences.get(occKey) ?? 0
      occurrences.set(occKey, occurrence + 1)
      const trigger =
        fileKind === 'scripted_trigger' ||
        ancestors.some((a) => {
          const k = a.key?.toLowerCase() ?? ''
          return TRIGGER_KEYS.has(k) || k.startsWith('any_')
        })
      const context: ScriptSite['context'] = trigger ? 'trigger' : 'effect'
      const conditions: string[] = []
      ancestors.forEach((a, i) => {
        const k = a.key?.toLowerCase()
        if (k === 'if' || k === 'else_if' || k === 'trigger_if') {
          const limit = a.children?.find((c) => c.key?.toLowerCase() === 'limit' && c.children)
          if (limit && limit !== ancestors[i + 1]) {
            const text = compactScript(file.text.slice(limit.bodyStart, limit.bodyEnd))
            if (text) conditions.push(text)
          }
        } else if (k === 'else') {
          conditions.push('else (the preceding if did not match)')
        }
      })
      const top = ancestors[0] ?? node
      const reachedFrom =
        role === 'own' || fileKind === 'history' || fileKind === 'bookmark' || top.key === null
          ? []
          : chainsTo(index, files, top.key, file.rel)
      sites.push({
        id: `${file.rel}:${node.start}`,
        file: file.rel,
        line: lineAt(file.text, node.start),
        path,
        role,
        context,
        summary: summary ?? summarize(kind, role, context, node, path, param),
        reachedFrom,
        conditions,
        occurrence,
        diskText,
        text: diskText
      })
    }

    walkScript(file.tree, (node, ancestors) => {
      if (node.key === null) return
      const ownRecord = own !== null && file.rel === own.file && (ancestors[0] ?? node).key === own.key
      if (ownRecord) {
        collectOwn(node, ancestors, own, add)
        return
      }
      // Inside a block already reported for this entity: that block shows it
      if (ancestors.some((a) => isToken(a.key))) return

      if (isToken(node.key) && node.children !== null) {
        add(node, ancestors, 'scope')
        return
      }
      if (startsToken(node.key) || startsToken(node.value)) {
        add(node, ancestors, 'reference')
        return
      }
      const key = node.key.toLowerCase()
      if (node.value === id && bare.has(key)) {
        // A character's father/mother are this editor's children list already
        if (fileKind === 'history' && (key === 'father' || key === 'mother')) return
        // A bookmark entry is the whole `character = { … }` block, not its id line
        if (key === 'history_id' && ancestors.length > 0) {
          add(
            ancestors[ancestors.length - 1],
            ancestors.slice(0, -1),
            'reference',
            null,
            `Bookmark character in ${ancestors[0].key}`
          )
          return
        }
        add(node, ancestors, 'reference')
        return
      }
      // `my_effect = { LIEGE = 205523 }` where my_effect uses `character:$LIEGE$`
      const call = ancestors[ancestors.length - 1]
      if (node.value === id && call?.key && index.callableBodies.has(call.key)) {
        const body = index.callableBodies.get(call.key) as string
        if (body.toLowerCase().includes(`${kind}:$${key}$`)) {
          add(call, ancestors.slice(0, -1), 'reference', node.key)
        }
      }
    })
  }
  return sites
}

/** The own-record statements the form doesn't cover, reported as `own` sites. */
function collectOwn(
  node: ScriptNode,
  ancestors: ScriptNode[],
  own: OwnRecord,
  add: (node: ScriptNode, ancestors: ScriptNode[], role: ScriptSite['role']) => void
): void {
  const depth = ancestors.length
  const key = node.key as string
  if (depth === 1) {
    // Directly in the record: anything that isn't a dated block or a field
    if (DATE_KEY.test(key) && node.children) return
    if (!own.managedKeys.has(key.toLowerCase())) add(node, ancestors, 'own')
    return
  }
  const dated = ancestors[1]
  if (!dated?.key || !DATE_KEY.test(dated.key)) return
  if (depth === 2) {
    // In a dated block: the dated `effect` wrapper is opened up below
    if (key.toLowerCase() === 'effect' && node.children) return
    if (!own.managedDatedKeys.has(key.toLowerCase())) add(node, ancestors, 'own')
    return
  }
  if (depth === 3 && ancestors[2].key?.toLowerCase() === 'effect') {
    if (!own.managedEffect(key)) add(node, ancestors, 'own')
  }
}

// ---------- Saving ----------

/** The node the site was read from, found again in (possibly changed) text. */
function locate(text: string, site: ScriptSite): ScriptNode | null {
  const matches: { node: ScriptNode; path: string[] }[] = []
  walkScript(parseScript(text), (node, ancestors) => {
    if (node.key === null) return
    if (text.slice(node.start, node.end) !== site.diskText) return
    matches.push({ node, path: [...ancestors.map(pathKey), pathKey(node)] })
  })
  const samePath = matches.filter((m) => m.path.join('\u0000') === site.path.join('\u0000'))
  if (samePath.length > site.occurrence) return samePath[site.occurrence].node
  // The record's id or a date was renamed in the same save: a unique match still holds
  if (matches.length === 1) return matches[0].node
  return null
}

/** Splice `replacement` over [start, end), dropping a line the deletion leaves blank. */
function splice(text: string, start: number, end: number, replacement: string): string {
  if (replacement !== '') {
    const eol = text.includes('\r\n') ? '\r\n' : '\n'
    const next = text[end]
    const safe = next === undefined || next === '\n' || next === '\r'
      ? replacement
      : terminateScriptComment(replacement, eol)
    return text.slice(0, start) + safe + text.slice(end)
  }
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  let lineEnd = text.indexOf('\n', end)
  if (lineEnd === -1) lineEnd = text.length
  // The statement was the line's only code: the line goes, and a trailing
  // comment with it — it annotated the statement, as in the line editor
  const [restCode] = splitComment(text.slice(lineStart, start) + text.slice(end, lineEnd))
  if (restCode.trim() === '') {
    return text.slice(0, lineStart) + text.slice(Math.min(lineEnd + 1, text.length))
  }
  // Eat one neighbouring space so no double gap is left behind
  let s = start
  let e = end
  if (text[e] === ' ') e++
  else if (text[s - 1] === ' ') s--
  return text.slice(0, s) + text.slice(e)
}

/**
 * Apply edited sites to in-memory file texts (absolute path → text), reading
 * from disk any file not already there. Nothing is written: the caller writes
 * the map once every edit has landed, so a failure leaves the disk untouched.
 */
export function applyScriptSites(
  modPath: string,
  texts: Map<string, string>,
  sites: ScriptSite[]
): string | null {
  const root = resolve(modPath)
  for (const site of sites) {
    if (site.text === site.diskText) continue
    const abs = resolve(root, site.file)
    if (!abs.startsWith(root + sep) || !abs.toLowerCase().endsWith('.txt')) {
      return `Refusing to write outside the mod: ${site.file}`
    }
    const problem = validateScriptFragment(site.text)
    if (problem) return `${site.file}:${site.line}: ${problem}`
    let text = texts.get(abs)
    if (text === undefined) {
      if (!existsSync(abs)) return `${site.file} no longer exists`
      text = readFileSync(abs, 'utf-8')
    }
    const node = locate(text, site)
    if (!node) {
      return `${site.file}:${site.line} changed on disk since it was opened — reload to see the new version`
    }
    texts.set(abs, splice(text, node.start, node.end, site.text))
  }
  return null
}
