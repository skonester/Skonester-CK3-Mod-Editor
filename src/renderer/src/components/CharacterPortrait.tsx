import { useEffect, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import type { PortraitData, PortraitRequest } from '@crusaderpope/shared/api'
import { api } from '@crusaderpope/renderer/src/api'
import { programFor } from '@crusaderpope/renderer/src/three/gameShader'
import { digest } from '@crusaderpope/renderer/src/revision'
import { PortraitStage, type Figure } from '@/lib/portraitStage'
import { useApp } from '../AppContext'
import Hint from './Hint'
import { Swatch } from './Swatch'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

/** How the figure is built and drawn — the toggles under the portrait */
interface Look {
  dressed: boolean
  /** Blend shapes: the fine facial features genes add */
  shapes: boolean
  /** Bone morphs: face and body proportions */
  bones: boolean
  /** The game's own shaders (gfx/FX compiled for WebGL), or the viewer's approximation */
  gameShaders: boolean
}

const DEFAULT_LOOK: Look = { dressed: true, shapes: true, bones: true, gameShaders: true }

/**
 * One 3D view of a portrait (CrusaderPope's PortraitViewer, minus its chrome):
 * fetches the figure, compiles the game's shaders for its parts, and swaps it
 * onto the stage once its textures and programs are ready — the old figure
 * stays until then, so a toggle or a save never blanks the view.
 */
function PortraitView({
  type,
  name,
  look,
  className,
  onData
}: {
  type: string
  name: string
  look: Look
  className?: string
  onData?: (d: PortraitData | null) => void
}): React.JSX.Element {
  const { indexStatus } = useApp()
  const revision = indexStatus.state === 'ready' ? (indexStatus.revision ?? 0) : null
  const mount = useRef<HTMLDivElement>(null)
  const stage = useRef<PortraitStage | null>(null)
  const shown = useRef('')
  const [data, setData] = useState<PortraitData | null | undefined>(undefined)
  const [figure, setFigure] = useState<Figure | null>(null)
  const [onScreen, setOnScreen] = useState<Figure | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)

  // Another character: a new view
  useEffect(() => {
    setData(undefined)
    setFigure(null)
    setOnScreen(null)
    shown.current = ''
    return () => {
      stage.current?.dispose()
      stage.current = null
    }
  }, [type, name])

  // Built again when a toggle changes and after an index update (a save can
  // change the DNA, genes or textures); kept when the new figure is the same
  useEffect(() => {
    if (revision === null) return
    let cancelled = false
    setError(null)
    setFetching(true)
    const opts: PortraitRequest = {
      blendShapes: look.shapes,
      boneMorphs: look.bones,
      naked: !look.dressed,
      figLeaf: true
    }
    api
      .portrait(type, name, opts)
      .then((d) => {
        if (cancelled) return
        setFetching(false)
        const key = digest(d)
        if (key === shown.current) return
        shown.current = key
        setData(d)
        onData?.(d)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setFetching(false)
        setError(e.message)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, name, look.shapes, look.bones, look.dressed, revision])

  // The game's shaders per part, compiled once per Effect; a part whose Effect
  // fails keeps the viewer's own material
  useEffect(() => {
    if (!data) return
    if (!look.gameShaders) {
      setFigure({ data, programs: null })
      return
    }
    let cancelled = false
    void Promise.all(
      data.parts.map((p) => {
        const pr = programFor(p)
        return pr ? pr.catch((e: Error) => e) : Promise.resolve(null)
      })
    ).then((programs) => !cancelled && setFigure({ data, programs }))
    return () => {
      cancelled = true
    }
  }, [data, look.gameShaders])

  // Onto the stage (made with the first figure, kept for the next ones)
  useEffect(() => {
    const el = mount.current
    if (!el || !figure) return
    if (stage.current && stage.current.el !== el) {
      stage.current.dispose()
      stage.current = null
    }
    stage.current ??= new PortraitStage(el)
    void stage.current.show(figure, () => setOnScreen(figure))
  }, [figure])

  // An error replaces the view
  useEffect(() => {
    if (!error) return
    stage.current?.dispose()
    stage.current = null
    setOnScreen(null)
  }, [error])

  const waiting = look.gameShaders && !!data && !figure
  const busy = !!onScreen && (fetching || onScreen !== figure || figure?.data !== data)

  let note: React.ReactNode = null
  if (error) note = <span className="text-destructive">Portrait failed: {error}</span>
  else if (revision === null) note = 'The portrait shows once the game index is ready.'
  else if (data === null) note = 'No portrait — the game index has no such character.'
  else if (!onScreen) note = waiting ? "Compiling the game's shaders…" : 'Sculpting the likeness…'

  return (
    <div
      ref={mount}
      className={cn('relative overflow-hidden rounded-lg border bg-muted/30', className)}
    >
      {note && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
          {!error && revision !== null && data !== null && <Spinner />}
          {note}
        </div>
      )}
      {busy && (
        <Spinner className="absolute top-2 left-2 text-muted-foreground" aria-label="Updating the portrait" />
      )}
    </div>
  )
}

function LookToggles({
  look,
  onChange,
  creature
}: {
  look: Look
  onChange: (next: Look) => void
  creature: boolean
}): React.JSX.Element {
  const toggle = (key: keyof Look, label: string, title: string): React.JSX.Element => (
    <Toggle
      size="sm"
      variant="outline"
      pressed={look[key]}
      title={title}
      onPressedChange={(v) => onChange({ ...look, [key]: v })}
    >
      {label}
    </Toggle>
  )
  return (
    <div className="flex flex-wrap gap-1.5">
      {/* Creatures wear nothing to take off */}
      {!creature &&
        toggle(
          'dressed',
          'Dressed',
          'Clothes, headgear and cloaks — off shows the body as the game does with nudity enabled'
        )}
      {toggle('shapes', 'Facial features', 'Blend shapes: the fine facial features genes add')}
      {toggle('bones', 'Bone morphs', 'Bone morphs: face and body proportions')}
      {toggle(
        'gameShaders',
        'Game shaders',
        "Render with the game's own shaders (gfx/FX compiled for WebGL), or with the viewer's approximation"
      )}
    </div>
  )
}

const rgb = (c: [number, number, number]): string =>
  `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`

/**
 * A character's 3D portrait, built from their DNA, genes, traits and the
 * portrait modifiers they meet at game start — as the saved files have it, so
 * it follows a save. Ported from CrusaderPope; draws with the game's own
 * shaders recompiled for WebGL.
 */
export default function CharacterPortrait({
  id,
  name
}: {
  id: string
  /** Shown in the enlarged view's title */
  name: string | null
}): React.JSX.Element {
  const [look, setLook] = useState<Look>(DEFAULT_LOOK)
  const [data, setData] = useState<PortraitData | null>(null)
  const [big, setBig] = useState(false)
  const worn = data?.accessories
    .filter((a) => !/^(eye|teeth|eyelashes)_accessory$/.test(a.gene))
    .map((a) => `${a.gene}: ${a.accessory}`)
  const details = data
    ? [
        `${data.applied.genes} genes → ${data.applied.blendShapes} blend shapes, ${data.applied.boneMorphs} bone morphs`,
        ...(worn ?? []),
        data.tags.length ? `tags: ${data.tags.join(', ')}` : '',
        data.modifiers.length ? `portrait modifiers: ${data.modifiers.join(', ')}` : ''
      ]
        .filter(Boolean)
        .join('\n')
    : undefined

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full max-w-72">
        <PortraitView
          type="characters"
          name={id}
          look={look}
          className="aspect-[4/5] w-full"
          onData={setData}
        />
        {data && (
          <Button
            variant="secondary"
            size="icon-xs"
            className="absolute top-2 right-2"
            title="Enlarge"
            onClick={() => setBig(true)}
          >
            <Maximize2 />
          </Button>
        )}
      </div>
      {data && (
        <>
          <LookToggles look={look} onChange={setLook} creature={!!data.creature} />
          <div className="flex items-center gap-2">
            {(
              [
                ['Skin', data.colors.skin],
                ['Hair', data.colors.hair],
                ['Eyes', data.colors.eyes]
              ] as const
            ).map(([label, color]) => (
              <span key={label} className="flex items-center gap-1 text-xs text-muted-foreground" title={label}>
                <Swatch hex={rgb(color)} className="size-3" />
                {label}
              </span>
            ))}
          </div>
          <span title={details}>
            <Hint value={data.source} truncate />
          </span>
        </>
      )}
      <Dialog open={big} onOpenChange={setBig}>
        <DialogContent className="flex h-[85vh] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{name ?? id}</DialogTitle>
            <DialogDescription>Drag to turn, scroll to zoom.</DialogDescription>
          </DialogHeader>
          {big && (
            <PortraitView type="characters" name={id} look={look} className="min-h-0 flex-1" />
          )}
          <LookToggles look={look} onChange={setLook} creature={!!data?.creature} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
