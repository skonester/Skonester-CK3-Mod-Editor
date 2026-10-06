import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { editorTarget } from './indexLinks'

/**
 * Opens an entry the game index knows (`type` an index type id, `name` its
 * key) where it can be edited: in the app's editor for it — a mod character
 * by its history file, which takes asking the index where it's defined — or
 * else at its definition in the text editor.
 */
export function useOpenEntry(): (type: string, name: string) => Promise<void> {
  const navigate = useNavigate()
  return useCallback(
    async (type: string, name: string) => {
      const direct = type === 'characters' ? null : editorTarget(type, name)
      if (direct) {
        void navigate(direct)
        return
      }
      const refs = await window.ck3tools.getReferences(type, name, 0)
      const def = refs?.defs.at(-1)
      if (!def) {
        toast.error(`The game index doesn't know where ${name} is defined`)
        return
      }
      const target = editorTarget(type, name, { ...def, inMod: !!def.origin?.mod })
      if (target) {
        void navigate(target)
        return
      }
      if (!def.path) {
        toast.error(`${def.file} is inside a packed mod and can't be opened`)
        return
      }
      const result = await window.ck3tools.openInEditor(def.path, def.line)
      if (!result.ok) toast.error(result.error)
    },
    [navigate]
  )
}
