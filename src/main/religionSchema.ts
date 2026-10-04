import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { scanBlocks } from './pdx'
import type { ReligionFormat } from '@shared/types'

export const FAITH_DIR = 'common/religion/faith_types'
export const RITE_DIR = 'common/religion/rite_types'
export const TENET_DIR = 'common/religion/tenet_types'

/** Bare-id lists, preserving duplicates and ignoring comments and quoted whitespace. */
export function blockList(body: string, key: string): string[] {
  return scanBlocks(body)
    .filter((b) => b.key.toLowerCase() === key.toLowerCase())
    .flatMap((b) => {
      const inner = body.slice(b.bodyStart, b.bodyEnd).replace(/#[^\n]*/g, ' ')
      return [...inner.matchAll(/"([^"\r\n]*)"|([^\s{}"]+)/g)].map((m) => m[1] ?? m[2])
    })
}

/** Format for newly created content; existing definitions keep their own format. */
export function religionFormat(gameDir: string | null, modPath: string | null): ReligionFormat {
  for (const base of [gameDir, modPath]) {
    if (!base) continue
    if ([FAITH_DIR, RITE_DIR, TENET_DIR].some((dir) => existsSync(join(base, ...dir.split('/')))))
      return '1.20'
    const dir = join(base, 'common', 'religion', 'religion_types')
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.txt')) continue
      try {
        const text = readFileSync(join(dir, entry.name), 'utf-8')
        if (
          scanBlocks(text).some(
            (b) => nestedBody(text.slice(b.bodyStart, b.bodyEnd), 'religion_details') !== null
          )
        )
          return '1.20'
      } catch {
        /* Skip unreadable definitions like the content readers. */
      }
    }
  }
  return 'legacy'
}

export function nestedBody(body: string, key: string): string | null {
  const block = scanBlocks(body).find((b) => b.key.toLowerCase() === key.toLowerCase())
  return block ? body.slice(block.bodyStart, block.bodyEnd) : null
}
