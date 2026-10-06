import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { writeModText } from './modWrite'
import { dirname, join } from 'path'

/**
 * Writing brand-new top-level blocks into Paradox script files, shared by the
 * character, dynasty/house and culture creators. Editing existing blocks goes
 * through `pdx.ts` spans and `lineEditor.ts` instead — this is only the append
 * path.
 */

/** The .txt files directly in `dir`, sorted — the targets a new block can go to. */
export function listTxtFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.txt'))
    .sort((a, b) => a.localeCompare(b))
}

/** Charset a top-level block key may use — the same one `scanBlocks` accepts. */
export const KEY_CHARS = /^[A-Za-z0-9_.\-']+$/

/**
 * Whether `file` is a plain `.txt` file name that can be joined onto a mod
 * directory: no path separators, no drive letters, no wildcards. Backslash
 * counts as a separator too — this app runs on Windows, where a name carrying
 * one would otherwise reach out of the directory it was joined onto.
 */
export function isTxtFileName(file: string): boolean {
  return file.toLowerCase().endsWith('.txt') && file.length > 4 && /^[^\\/:*?"<>|]+$/.test(file)
}

/** A nested .txt path inside a content folder, without traversal or absolute paths. */
export function isTxtRelativePath(file: string): boolean {
  const parts = file.replace(/\\/g, '/').split('/')
  return (
    parts.every((part) => part !== '.' && part !== '..' && part.trim() === part && !part.endsWith('.') && /^[^\\/:*?"<>|]+$/.test(part)) &&
    isTxtFileName(parts[parts.length - 1])
  )
}

/**
 * Append a block to `dir/file`, creating the file (and its directory) when
 * missing. Existing content is preserved byte-for-byte and the block is
 * separated from it by a blank line, in the file's own line-ending style.
 */
export function appendBlock(dir: string, file: string, lines: string[]): void {
  const path = join(dir, file)
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : null
  const eol = existing !== null && existing.includes('\r\n') ? '\r\n' : '\n'
  let prefix = existing ?? ''
  if (prefix !== '' && !prefix.endsWith('\n')) prefix += eol
  if (prefix !== '' && !/(\r?\n){2}$/.test(prefix)) prefix += eol
  if (existing === null) mkdirSync(dirname(path), { recursive: true })
  writeModText(path, prefix + lines.join(eol) + eol)
}
