import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import type {
  FaithHistoryEntry,
  FaithHistoryFields,
  FaithHistoryPatch,
  FaithHistoryPreview,
  FaithHistoryTarget,
  SaveResult
} from '@shared/types'
import { terminateScriptComment, validateScriptFragment } from '@shared/scriptValidation'
import { DATE_KEY } from './characters'
import { makeEditor, setBlockList, setScalar } from '@shared/lineEditor'
import { scanBlocks, scanScalarsCI } from '@shared/pdx'
import { effectiveFiles, isUnderDir } from './refdata'
import { blockList } from './religionSchema'
import { KEY_CHARS, appendBlock, isTxtRelativePath } from './scriptFile'
import { DATED_BLOCK_KEY } from './titleHistory'

const DIR = 'history/faiths'
const sameId = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The convenience form edits only these fields; all other script survives unchanged. */
export function prepareFaithHistoryScript(
  script: string,
  patch?: Partial<FaithHistoryFields>
): FaithHistoryPreview {
  let error = validateScriptFragment(script)
  if (!error && patch) {
    try {
      const ed = makeEditor(script)
      for (const [field, key] of [
        ['created', 'created'],
        ['mainRite', 'main_rite'],
        ['religiousHead', 'religious_head']
      ] as const) {
        const value = patch[field]
        if (value === undefined) continue
        if (
          value !== null &&
          (field === 'created' ? !/^(yes|no)$/.test(value) : !KEY_CHARS.test(value))
        )
          throw new Error(`Invalid ${key} value`)
        setScalar(ed, [key], value, { ignoreCase: true })
      }
      for (const key of ['known', 'permitted', 'prohibited'] as const) {
        const values = patch[key]
        if (values === undefined) continue
        if (values.some((v) => !KEY_CHARS.test(v))) throw new Error(`Invalid tenet in ${key}`)
        if (JSON.stringify(blockList(script, key)) !== JSON.stringify(values))
          setBlockList(ed, key, values)
      }
      script = ed.lines.join('\n')
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }
  const scalars = scanScalarsCI(script)
  return {
    script,
    error,
    fields: {
      created: scalars.get('created') ?? null,
      mainRite: scalars.get('main_rite') ?? null,
      religiousHead: scalars.get('religious_head') ?? null,
      known: blockList(script, 'known'),
      permitted: blockList(script, 'permitted'),
      prohibited: blockList(script, 'prohibited')
    }
  }
}

export function getFaithHistory(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  faithId: string
): FaithHistoryEntry[] {
  const entries: FaithHistoryEntry[] = []
  for (const path of effectiveFiles(gameDir, modPath, replacePaths, DIR, true)) {
    let text: string
    try {
      text = readFileSync(path, 'utf-8')
    } catch {
      continue
    }
    const inMod = isUnderDir(path, modPath)
    const file = relative(join((inMod ? modPath : gameDir)!, DIR), path).replace(/\\/g, '/')
    let faithBlock = 0
    for (const faith of scanBlocks(text)) {
      if (!sameId(faith.key, faithId)) continue
      const body = text.slice(faith.bodyStart, faith.bodyEnd)
      let index = 0
      for (const date of scanBlocks(body)) {
        if (!DATED_BLOCK_KEY.test(date.key)) continue
        const script = body.slice(date.bodyStart, date.bodyEnd)
        const rites: string[] = []
        for (const block of scanBlocks(script)) {
          const inner = script.slice(block.bodyStart, block.bodyEnd)
          if (block.key.toLowerCase() === 'rites')
            rites.push(...scanBlocks(inner).map((b) => b.key))
          if (block.key.toLowerCase() === 'rite')
            rites.push(scanScalarsCI(inner).get('rite') ?? '(main rite)')
        }
        entries.push({
          file,
          inMod,
          faithBlock,
          index,
          date: date.key,
          script,
          ...prepareFaithHistoryScript(script).fields,
          rites
        })
        index++
      }
      faithBlock++
    }
  }
  return entries
}

export function listFaithHistoryFiles(modPath: string): string[] {
  return effectiveFiles(null, modPath, [], DIR, true)
    .map((path) => relative(join(modPath, DIR), path).replace(/\\/g, '/'))
    .sort()
}

function locate(modPath: string, faithId: string, target: FaithHistoryTarget) {
  if (!isTxtRelativePath(target.file)) throw new Error('Invalid faith history file path')
  if (!KEY_CHARS.test(faithId)) throw new Error('Invalid faith id')
  const path = join(modPath, DIR, target.file)
  const text = readFileSync(path, 'utf-8')
  if (text.includes('\uFFFD')) throw new Error('History file is not valid UTF-8')
  const faith = scanBlocks(text).filter((b) => sameId(b.key, faithId))[target.faithBlock]
  if (!faith) throw new Error('Faith history changed; reload before editing')
  const body = text.slice(faith.bodyStart, faith.bodyEnd)
  const date = scanBlocks(body).filter((b) => DATED_BLOCK_KEY.test(b.key))[target.index]
  if (
    !date ||
    date.key !== target.date ||
    body.slice(date.bodyStart, date.bodyEnd) !== target.script
  )
    throw new Error('History entry changed on disk; reload before editing')
  return { path, text, faith, body, date }
}

function checkPatch(patch: FaithHistoryPatch, existingDate?: string): void {
  if (patch.date !== existingDate && !DATE_KEY.test(patch.date.trim()))
    throw new Error('Invalid date (expected Y.M.D)')
  const error = validateScriptFragment(patch.script)
  if (error) throw new Error(error)
}
function caught(err: unknown): SaveResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}
function eolScript(script: string, text: string): string {
  return script.replace(/\r?\n/g, text.includes('\r\n') ? '\r\n' : '\n')
}

export function saveFaithHistoryEntry(
  modPath: string,
  faithId: string,
  target: FaithHistoryTarget,
  patch: FaithHistoryPatch
): SaveResult {
  try {
    const { path, text, faith, date } = locate(modPath, faithId, target)
    checkPatch(patch, date.key)
    const start = faith.bodyStart + date.start
    const bodyStart = faith.bodyStart + date.bodyStart
    const bodyEnd = faith.bodyStart + date.bodyEnd
    const script =
      patch.script === target.script
        ? patch.script
        : terminateScriptComment(
            eolScript(patch.script, text),
            text.includes('\r\n') ? '\r\n' : '\n'
          )
    writeFileSync(
      path,
      text.slice(0, start) +
        patch.date.trim() +
        text.slice(start + date.key.length, bodyStart) +
        script +
        text.slice(bodyEnd),
      'utf-8'
    )
    return { ok: true }
  } catch (err) {
    return caught(err)
  }
}

/** Append a separate faith block. CK3 merges them, preserving all existing bytes. */
export function addFaithHistoryEntry(
  modPath: string,
  file: string,
  faithId: string,
  patch: FaithHistoryPatch
): SaveResult {
  try {
    if (!isTxtRelativePath(file)) throw new Error('Invalid faith history file path')
    if (!KEY_CHARS.test(faithId.trim())) throw new Error('Invalid faith id')
    checkPatch(patch)
    const path = join(modPath, DIR, file)
    if (existsSync(path) && readFileSync(path, 'utf-8').includes('\uFFFD'))
      throw new Error('History file is not valid UTF-8')
    appendBlock(join(modPath, DIR), file, [
      `${faithId.trim()} = {`,
      `\t${patch.date.trim()} = {`,
      ...patch.script
        .trim()
        .split(/\r?\n/)
        .map((line) => `\t\t${line}`),
      '\t}',
      '}'
    ])
    return { ok: true }
  } catch (err) {
    return caught(err)
  }
}

export function deleteFaithHistoryEntry(
  modPath: string,
  faithId: string,
  target: FaithHistoryTarget
): SaveResult {
  try {
    const { path, text, faith, body, date } = locate(modPath, faithId, target)
    let from = date.start
    while (from > 0 && /[ \t]/.test(body[from - 1])) from--
    let to = date.end
    if (body[to] === '\r') to++
    if (body[to] === '\n') to++
    writeFileSync(
      path,
      text.slice(0, faith.bodyStart) +
        body.slice(0, from) +
        body.slice(to) +
        text.slice(faith.bodyEnd),
      'utf-8'
    )
    return { ok: true }
  } catch (err) {
    return caught(err)
  }
}
