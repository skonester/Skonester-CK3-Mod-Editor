import { createContext, lazy, Suspense, useCallback, useContext, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft, BookOpen, FileCode, Network, ScanFace } from 'lucide-react'
import { toast } from 'sonner'
import type { EntityKey } from '@crusaderpope/shared/api'
import { editorTarget, PORTRAIT_TYPES } from '@/lib/indexLinks'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

// The describer's renderer reads CrusaderPope's bridge at load: lazy
const StoryPane = lazy(() => import('./StoryPane'))
// cytoscape only loads with the first graph shown
const GraphView = lazy(() => import('../explore/GraphView'))
const PortraitReport = lazy(() => import('../explore/PortraitReport'))

const HIDDEN_KEY = 'reader.showHidden'

/**
 * How the reader shows an entry: as plain language, as the graph of what it
 * links to and from, or (characters, DNA) what its 3D portrait is built from
 */
export type ReaderView = 'read' | 'graph' | 'portrait'

type OpenReader = (entry: EntityKey, view?: ReaderView) => void

/** Opens an entry in the reader: its script as plain language, or another view */
const ReaderCtx = createContext<OpenReader>(() => {})

export const useReader = (): OpenReader => useContext(ReaderCtx)

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
 * one, else reads it here, with Back to return. Its Graph view draws what the
 * entry links to and from; Portrait (characters, DNA) what its 3D portrait is
 * built from.
 */
export default function ReaderProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const navigate = useNavigate()
  const [stack, setStack] = useState<EntityKey[]>([])
  const [view, setView] = useState<ReaderView>('read')
  const [showHidden, setShowHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN_KEY) === '1'
    } catch {
      return false
    }
  })
  const entry = stack.at(-1)
  const shown: ReaderView = view === 'portrait' && entry && !PORTRAIT_TYPES.has(entry.type) ? 'read' : view

  const open = useCallback<OpenReader>((e, v = 'read') => {
    setStack([e])
    setView(v)
  }, [])
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
        <SheetContent
          side="right"
          // (the sheet's own data-[side=right] width classes win over plain ones: same variant to replace them)
          className={cn(
            'gap-0 data-[side=right]:w-full',
            shown === 'graph'
              ? 'data-[side=right]:sm:max-w-[min(92vw,1400px)]'
              : shown === 'portrait'
                ? 'data-[side=right]:sm:max-w-4xl'
                : 'data-[side=right]:sm:max-w-2xl'
          )}
        >
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
                <SheetDescription>
                  {shown === 'graph'
                    ? 'What it links to and from'
                    : shown === 'portrait'
                      ? 'What its 3D portrait is built from'
                      : 'Read as plain language'}
                </SheetDescription>
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
            <Tabs value={shown} onValueChange={(v) => setView(v as ReaderView)}>
              <TabsList>
                <TabsTrigger value="read">
                  <BookOpen />
                  Read
                </TabsTrigger>
                <TabsTrigger value="graph">
                  <Network />
                  Graph
                </TabsTrigger>
                {entry && PORTRAIT_TYPES.has(entry.type) && (
                  <TabsTrigger value="portrait">
                    <ScanFace />
                    Portrait
                  </TabsTrigger>
                )}
              </TabsList>
            </Tabs>
            <div className={cn('flex items-center gap-2', shown !== 'read' && 'hidden')}>
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
          <div className={cn('min-h-0 flex-1 p-4', shown === 'graph' ? 'flex flex-col' : 'overflow-y-auto')}>
            {entry && (
              <Suspense fallback={<Spinner />}>
                {shown === 'graph' ? (
                  <GraphView key={`${entry.type}:${entry.name}`} entry={entry} onOpen={follow} />
                ) : shown === 'portrait' ? (
                  <PortraitReport key={`${entry.type}:${entry.name}`} entry={entry} />
                ) : (
                  <StoryPane
                    key={`${entry.type}:${entry.name}`}
                    entry={entry}
                    follow={follow}
                    showHidden={showHidden}
                  />
                )}
              </Suspense>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </ReaderCtx.Provider>
  )
}
