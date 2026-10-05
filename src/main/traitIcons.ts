import { readFileSync } from 'fs'
import { scanBlocks, scanScalars } from '@shared/pdx'
import { effectiveFiles } from './refdata'
import { resolveIcons } from './icons'

const ICON_REL_DIR = 'gfx/interface/icons/traits'

/**
 * Trait definitions may name a custom icon file (`icon = reveler.dds`);
 * otherwise the icon is `<trait_key>.dds`. Dynamic icons (an `icon = { … }`
 * trigger block) fall back to the default name.
 */
function iconFileNames(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[]
): Map<string, string> {
  const names = new Map<string, string>()
  for (const file of effectiveFiles(gameDir, modPath, replacePaths, 'common/traits')) {
    try {
      const text = readFileSync(file, 'utf-8')
      for (const block of scanBlocks(text)) {
        const icon = scanScalars(text.slice(block.bodyStart, block.bodyEnd)).get('icon')
        if (icon) names.set(block.key, icon)
      }
    } catch {
      // skip unreadable files
    }
  }
  return names
}

// Reset when the mod context changes; the decoded icons cache in ./icons
let namesKey = ''
let namesCache: Map<string, string> | null = null

export function getTraitIcons(
  gameDir: string | null,
  modPath: string | null,
  replacePaths: string[],
  traits: string[]
): Record<string, string | null> {
  const key = `${gameDir}|${modPath}`
  if (key !== namesKey) {
    namesKey = key
    namesCache = null
  }
  const names = (namesCache ??= iconFileNames(gameDir, modPath, replacePaths))
  return resolveIcons(
    gameDir,
    modPath,
    replacePaths,
    ICON_REL_DIR,
    new Map(traits.map((t) => [t, names.get(t) ?? `${t}.dds`]))
  )
}
