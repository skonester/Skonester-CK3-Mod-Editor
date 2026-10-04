import { useEffect, useRef, useState } from 'react'
import { useEntryHistory } from './useEntryHistory'
import { entryKey } from '@shared/entries'
import type { EntryDraft, EntryRef, ToolKey } from '@shared/types'

/** How long editing settles before the draft is written to settings.json. */
const PERSIST_DELAY = 400

interface Options<T> {
  tool: ToolKey
  /** The row being edited; null while none is open */
  ref: EntryRef | null
  /**
   * The row exactly as the file has it, rebuilt from the scan on every render.
   * Null while the parse is still loading, or when the row isn't defined.
   */
  original: T | null
  /** Read-only rows (base-game definitions) keep no draft */
  editable: boolean
  /** Supply defaults for fields introduced since a draft was stored. */
  migrate?: (stored: T, current: T) => T
}

export interface PersistedDraft<T> {
  /** The edited state, or null while there is nothing to edit */
  draft: T | null
  setDraft: (next: T) => void
  dirty: boolean
  /** The file changed on disk while this draft was dormant (external edit) */
  stale: boolean
  /** Throw the draft away and take the file's state again */
  revert: () => void
  /** After a successful save: forget the draft and treat `saved` as the file's state */
  markSaved: (saved: T) => void
}

/**
 * An editor panel's draft, kept in settings.json until it is saved or
 * reverted — the same VS Code-style bargain the Character Editor makes, so
 * closing a row, switching tools or restarting the app never silently drops
 * an edit. The page lists whatever is still outstanding as "Unsaved" chips.
 */
export function usePersistedDraft<T>({
  tool,
  ref,
  original,
  editable,
  migrate
}: Options<T>): PersistedDraft<T> {
  const { drafts, persistDraft } = useEntryHistory(tool)
  const key = ref === null ? null : entryKey(ref)
  const originalJson = original === null ? null : JSON.stringify(original)

  const [draft, setDraft] = useState<T | null>(null)
  const [stale, setStale] = useState(false)

  // The store is read only when a row opens, so our own writes to it don't
  // re-seed the draft we just persisted.
  const storeRef = useRef(drafts)
  storeRef.current = drafts
  const draftRef = useRef(draft)
  draftRef.current = draft

  /** The row the current draft was seeded for */
  const seeded = useRef<string | null>(null)
  /** The parse that draft was last measured against */
  const seen = useRef<string | null>(null)

  /** A debounced persist waiting to fire; flushed before the row changes */
  const pending = useRef<(() => void) | null>(null)
  const flush = (): void => {
    pending.current?.()
    pending.current = null
  }

  useEffect(() => {
    if (key === null || original === null || originalJson === null) {
      flush()
      seeded.current = null
      setDraft(null)
      setStale(false)
      return
    }
    if (seeded.current !== key) {
      flush()
      seeded.current = key
      seen.current = originalJson
      const stored = editable ? (storeRef.current[key] as EntryDraft<T> | undefined) : undefined
      // A resumed draft is measured against the file's CURRENT state, so
      // dirty/save/revert all work against what's really on disk.
      setDraft(
        structuredClone(stored ? (migrate?.(stored.draft, original) ?? stored.draft) : original)
      )
      setStale(
        stored !== undefined &&
          JSON.stringify(migrate?.(stored.original, original) ?? stored.original) !== originalJson
      )
      return
    }
    // Same row, but its parse moved under us — a save, a reload, or an edit in
    // another window. A clean draft simply follows the file; an edited one
    // stands and says so.
    if (seen.current === originalJson) return
    const wasClean = JSON.stringify(draftRef.current) === seen.current
    seen.current = originalJson
    if (wasClean) {
      setDraft(structuredClone(original))
      setStale(false)
    } else {
      setStale(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, originalJson, editable])

  const dirty = draft !== null && originalJson !== null && JSON.stringify(draft) !== originalJson

  // Persist as the draft changes (cleared once it matches the file again),
  // debounced so typing doesn't write settings.json per keystroke.
  useEffect(() => {
    if (!editable || draft === null || original === null || ref === null) return undefined
    // Skip the window between a save and the reload that follows it: the file
    // already holds the draft, `original` just hasn't caught up.
    if (seen.current !== originalJson) return undefined
    const entry: EntryDraft<T> | null = dirty ? { draft, original, ref } : null
    pending.current = () => persistDraft(ref, entry)
    const t = setTimeout(flush, PERSIST_DELAY)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, originalJson, key, editable])

  // Whatever is still pending when the panel goes away is written, not lost
  useEffect(() => flush, [])

  return {
    draft,
    setDraft,
    dirty,
    stale,
    revert: () => {
      pending.current = null
      if (ref !== null) persistDraft(ref, null)
      if (original !== null) {
        seen.current = originalJson
        setDraft(structuredClone(original))
      }
      setStale(false)
    },
    markSaved: (saved) => {
      pending.current = null
      if (ref !== null) persistDraft(ref, null)
      seen.current = JSON.stringify(saved)
      setDraft(structuredClone(saved))
      setStale(false)
    }
  }
}
