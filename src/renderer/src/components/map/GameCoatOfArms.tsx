import { useEffect, useRef, useState } from 'react'
import type { CoaInfo, CoaKind } from '@crusaderpope/shared/api'
import { useRevision } from '@crusaderpope/renderer/src/revision'
import {
  coaInfo,
  coaPicture,
  coaSignature,
  setCoaRevision
} from '@crusaderpope/renderer/src/components/coa-draw'
import { cn } from '@/lib/utils'

/**
 * A title's, dynasty's or house's coat of arms as the game's interface shows
 * it — in its frame (kind `realm`: the government's shape and the tier's bar)
 * and at a history `date`, where a title shows its holder's house arms and
 * dynamic definitions. Drawn by CrusaderPope's coa-draw (its CoatOfArms); a
 * new date redraws only when the arms differ. Nothing when there are none.
 * Uses CrusaderPope's `window.api` bridge, so only lazy-loaded views use it.
 */
export default function GameCoatOfArms({
  kind,
  name,
  size,
  date,
  className
}: {
  kind: CoaKind
  /** The title's key; dynasties and houses by id */
  name: string
  /** CSS pixels square, the frame included */
  size: number
  /** y.m.d; none: the first bookmark's */
  date?: string
  className?: string
}): React.JSX.Element | null {
  const revision = useRevision()
  const ref = useRef<HTMLCanvasElement>(null)
  const [info, setInfo] = useState<{ id: string; info: CoaInfo | null } | null>(null)
  const box = Math.round(size * (window.devicePixelRatio || 1))
  const id = `${kind}:${name}`
  const shown = info?.id === id ? info.info : undefined

  useEffect(() => {
    let live = true
    setCoaRevision(revision)
    void coaInfo(kind, name, date).then(
      (i) => live && setInfo((old) => (old?.id === id && old.info === i ? old : { id, info: i }))
    )
    return () => {
      live = false
    }
  }, [kind, name, id, date, revision])

  useEffect(() => {
    if (!shown) return
    // The canvas remembers what it shows: the same arms at another date aren't drawn again
    const what = `${revision}|${box}|${coaSignature(shown)}`
    if (ref.current?.dataset.coa === what) return
    let live = true
    void coaPicture(shown, box).then((pic) => {
      const c = ref.current
      if (!live || !c || !pic) return
      c.width = box
      c.height = box
      const g = c.getContext('2d')!
      g.clearRect(0, 0, box, box)
      g.drawImage(pic, 0, 0)
      c.dataset.coa = what
    })
    return () => {
      live = false
    }
  }, [shown, box, revision])

  if (shown === null) return null
  return (
    <canvas
      ref={ref}
      className={cn('inline-block shrink-0 align-middle', className)}
      style={{ width: size, height: size }}
      title={shown?.note}
    />
  )
}
