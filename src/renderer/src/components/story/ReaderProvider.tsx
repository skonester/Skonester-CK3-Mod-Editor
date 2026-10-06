import { createContext, lazy, Suspense, useCallback, useContext, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, FileCode } from 'lucide-react'
import { toast } from 'sonner'
import type { EntityKey } from '@crusaderpope/shared/api'
import { editorTarget } from '@/lib/indexLinks'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'

// The describer's renderer reads CrusaderPope's bridge at load: lazy
const StoryPane = lazy(() => import('./StoryPane'))

const HIDDEN_KEY = 'reader.showHidden'

/** Opens an entry in the reader: its script as plain language */
const ReaderCtx = createContext<(entry: EntityKey) => void>(() => {})

export const useReader = (): ((entry: EntityKey) => void) => useContext(ReaderCtx)

/**
 * Where an entry is edited, if anywhere here: its editor's deep link — a mod
 * character by its history file, which takes asking the index.
 */
export async function editorFor(entry: EntityKey): Promise<ReturnType<typeof editorTarget>> {
  if (entry.type !== 'characters') return editorTarget(entry.type, entry.name)
  const refs = await window.ck3tools.getReferences(entry.type, entry.name, 0)
  const def = refs?.defs.at(-1)
  return def ? editorTarget(entry.type, entry.name, { ...def, inMod: !!def.origin?.mod }) : null
}

/**
 * The reader: a side sheet showing any entry the game index knows as plain
 * language — an event as a story, anything else as a card (CrusaderPope's
 * readable view). A link inside goes to the entry's editor when the app has
 * one, else reads it here, with Back to return.
 */
export default function ReaderProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const navigate = useNavigate()
  const [stack, setStack] = useState<EntityKey[]>([])
  const [showHidden, setShowHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const entry = stack.at(-1)

  const open = useCallback((e: EntityKey) => setStack([e]), [])
  const follow = useCallback(
    (e: EntityKey) => {
      void editorFor(e).then((target) => {
        if (target) {
          setStack([])
          void navigate(target)
        } else setStack((s) => [...s, e])
      })
    },
    [navigate]
  )
  const openScript = async (): Promise<void> => {
    if (!entry) return
    const def = (await window.ck3tools.getReferences(entry.type, entry.name, 0))?.defs.at(-1)
    if (!def?.path) {
      toast.error(`Couldn't find where ${entry.name} is defined`)
      return
    }
    const r = await window.ck3tools.openInEditor(def.path, def.line)
    if (!r.ok) toast.error(r.error)
  }

  return (
    <ReaderCtx.Provider value={open}>
      {children}
      <Sheet open={entry !== undefined} onOpenChange={(o) => !o && setStack([])}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-2xl">
          <SheetHeader className="border-b">
            <div className="flex items-center gap-2 pr-8">
              {stack.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Back"
                  onClick={() => setStack((s) => s.slice(0, -1))}
                >
                  <ArrowLeft />
                </Button>
              )}
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate font-mono text-sm">{entry?.name}</SheetTitle>
                <SheetDescription>Read as plain language</SheetDescription>
              </div>
              <Button
                variant="outline"
                size="xs"
                title="Open its definition in the text editor"
                onClick={() => void openScript()}
              >
                <FileCode />
                Script
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="reader-hidden"
                checked={showHidden}
                onCheckedChange={(v) => {
                  setShowHidden(v)
                  try {
                    localStorage.setItem(HIDDEN_KEY, v ? '1' : '0')
                  } catch {
                    // No storage: off again next time
                  }
                }}
              />
              <Label htmlFor="reader-hidden" className="text-xs font-normal text-muted-foreground">
                Show behind-the-scenes effects (flags, variables, hidden effects)
              </Label>
            </div>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {entry && (
              <Suspense fallback={<Spinner />}>
                <StoryPane
                  key={`${entry.type}:${entry.name}`}
                  entry={entry}
                  follow={follow}
                  showHidden={showHidden}
                />
              </Suspense>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </ReaderCtx.Provider>
  )
}
