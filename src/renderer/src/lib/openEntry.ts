import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { editorFor, useReader } from '@/components/story/ReaderProvider'

/**
 * Opens an entry the game index knows (`type` an index type id, `name` its
 * key) where it can be edited — the app's editor for it, a mod character by
 * its history file — or else in the reader, as plain language.
 */
export function useOpenEntry(): (type: string, name: string) => Promise<void> {
  const navigate = useNavigate()
  const read = useReader()
  return useCallback(
    async (type: string, name: string) => {
      const target = await editorFor({ type, name })
      if (target) void navigate(target)
      else read({ type, name })
    },
    [navigate, read]
  )
}
