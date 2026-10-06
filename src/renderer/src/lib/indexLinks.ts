import type { IndexDef, IndexType, ModTouch } from '@shared/types'

/** Where an index entry opens inside the app: one of the editors, with its deep link */
export type EditorTarget =
  | { to: '/characters'; search: { file: string; id: string } }
  | { to: '/dynasties'; search: { id: string; kind: 'dynasty' | 'house' } }
  | { to: '/cultures' | '/faiths' | '/religions' | '/rites' | '/titles'; search: { id: string } }

const ROUTES: Partial<Record<IndexType, '/cultures' | '/faiths' | '/religions' | '/rites' | '/titles'>> = {
  'culture/cultures': '/cultures',
  faith: '/faiths',
  'religion/religion_types': '/religions',
  'religion/rite_types': '/rites',
  landed_titles: '/titles'
}

/**
 * The editor that opens an index entry, or null when none does — events,
 * decisions and the like open in the text editor instead. A character opens
 * only when the mod defines it in a file directly under history/characters,
 * since those are the files the character editor lists.
 */
export function editorTarget(type: string, name: string, def?: IndexDef): EditorTarget | null {
  if (type === 'characters') {
    const file = def?.inMod ? /^history\/characters\/([^/]+\.txt)$/i.exec(def.file)?.[1] : undefined
    return file ? { to: '/characters', search: { file, id: name } } : null
  }
  if (type === 'dynasties') return { to: '/dynasties', search: { id: name, kind: 'dynasty' } }
  if (type === 'dynasty_houses') return { to: '/dynasties', search: { id: name, kind: 'house' } }
  const to = ROUTES[type as IndexType]
  return to ? { to, search: { id: name } } : null
}

/** "common/landed_titles/malta_titles.txt", 482 → "malta_titles.txt:482" */
export function siteLabel(file: string, line: number): string {
  return `${file.slice(file.lastIndexOf('/') + 1)}:${line}`
}

/**
 * How the selected mod touches an entry, as a short label and a sentence for
 * its tooltip. Null for an entry the mod leaves alone.
 */
export function modTouchLabel(
  touch: ModTouch | undefined
): { label: string; detail: string } | null {
  if (!touch) return null
  switch (touch.state) {
    case 'added':
      return { label: 'Added by mod', detail: 'The mod defines this; the game has no definition of it.' }
    case 'overridden':
      return { label: 'Overrides game', detail: "The mod's definition replaces the game's." }
    case 'same':
      return {
        label: 'Same as game',
        detail: "The mod defines this, but its definition says the same as the game's."
      }
    case 'removed':
      return {
        label: 'Removed by mod',
        detail: 'Only defined in files the mod hides (same path or replace_path): the game no longer loads it.'
      }
    case 'merged':
      return { label: 'Merged', detail: 'The game and the mod both contribute to this.' }
  }
}
