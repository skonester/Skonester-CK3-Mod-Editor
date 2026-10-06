import { useEffect, useMemo, useRef, useState } from 'react'
import { Map as MapIcon, X } from 'lucide-react'
import type { MapInfo } from '@crusaderpope/shared/api'
import { rasterOf, type View } from '@crusaderpope/renderer/src/components/map/gl2d'
import { WATER, rgbOf, type Groups } from '@crusaderpope/renderer/src/components/map/model'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

/** CSS pixels wide */
const WIDTH = 210
const OPEN_KEY = 'map.minimap.open'

/** The mode's colours over the whole map, `w` × `h` device pixels (each the average of four samples) */
function picture(info: MapInfo, ids: Uint16Array, groups: Groups, w: number, h: number): HTMLCanvasElement {
  const P = info.province
  const rgb = new Uint8Array(info.count * 3)
  for (let p = 0; p < info.count; p++) {
    const g = groups.of[p]
    const c: [number, number, number] =
      g >= 0
        ? rgbOf(groups.color(g) ?? '#808080')
        : WATER.has(info.kinds[P.kind[p]])
          ? [24, 36, 48]
          : [74, 71, 66]
    rgb.set(c, p * 3)
  }
  const img = new ImageData(w, h)
  const sx = info.width / w
  const sy = info.height / h
  const samples = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75]
  ]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (const [fx, fy] of samples) {
        const id = ids[Math.floor((y + fy) * sy) * info.width + Math.floor((x + fx) * sx)] * 3
        r += rgb[id]
        g += rgb[id + 1]
        b += rgb[id + 2]
      }
      const o = (y * w + x) * 4
      img.data[o] = r / 4
      img.data[o + 1] = g / 4
      img.data[o + 2] = b / 4
      img.data[o + 3] = 255
    }
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.putImageData(img, 0, 0)
  return c
}

/**
 * The 2D map's overview (from CrusaderPope's Minimap): the whole map small in
 * the mode's colours with the view's rectangle; a click or drag moves the view
 * there. `tick` changes whenever the view moves.
 */
export default function MapMinimap({
  info,
  groups,
  view,
  size,
  tick,
  onJump
}: {
  info: MapInfo
  groups: Groups
  view: View | null
  size: { w: number; h: number }
  tick: number
  onJump: (x: number, y: number) => void
}): React.JSX.Element | null {
  const canvas = useRef<HTMLCanvasElement>(null)
  const dragging = useRef(false)
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== '0'
    } catch {
      return true
    }
  })
  const height = Math.round((WIDTH * info.height) / info.width)
  const dpr = window.devicePixelRatio || 1
  const ids = rasterOf(info)
  const pic = useMemo(
    () => (ids ? picture(info, ids, groups, Math.round(WIDTH * dpr), Math.round(height * dpr)) : null),
    [info, ids, groups, height, dpr]
  )

  useEffect(() => {
    const cv = canvas.current
    if (!cv || !pic) return
    cv.width = pic.width
    cv.height = pic.height
    const ctx = cv.getContext('2d')!
    ctx.drawImage(pic, 0, 0)
    if (!view) return
    // The view: the rest a little darker, its rectangle outlined in the theme's accent
    const k = pic.width / info.width
    const x = view.x * k
    const y = view.y * k
    const w = size.w * view.scale * k
    const h = size.h * view.scale * k
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.beginPath()
    ctx.rect(0, 0, cv.width, cv.height)
    ctx.rect(x, y, w, h)
    ctx.fill('evenodd')
    ctx.lineWidth = 1.5 * dpr
    ctx.strokeStyle = getComputedStyle(cv).getPropertyValue('--primary') || 'white'
    ctx.strokeRect(x, y, w, h)
  }, [pic, view, size.w, size.h, tick, info.width, dpr])

  const fold = (value: boolean): void => {
    setOpen(value)
    try {
      localStorage.setItem(OPEN_KEY, value ? '1' : '0')
    } catch {
      // No storage: open again next time
    }
  }
  const jump = (e: React.PointerEvent): void => {
    const r = canvas.current!.getBoundingClientRect()
    onJump(((e.clientX - r.left) / r.width) * info.width, ((e.clientY - r.top) / r.height) * info.height)
  }
  // The map under it neither pans, zooms nor hovers
  const stop = (e: React.SyntheticEvent): void => e.stopPropagation()

  if (!pic) return null

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="icon-sm"
        className="absolute bottom-3 left-3 shadow"
        title="Show the overview"
        onClick={() => fold(true)}
        onPointerDown={stop}
        onPointerUp={stop}
      >
        <MapIcon />
      </Button>
    )
  }

  return (
    <Card
      className="absolute bottom-3 left-3 gap-0 overflow-hidden p-0 shadow-lg"
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onWheel={stop}
    >
      <canvas
        ref={canvas}
        className="block cursor-pointer"
        style={{ width: WIDTH, height }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
          jump(e)
        }}
        onPointerMove={(e) => dragging.current && jump(e)}
        onPointerUp={() => (dragging.current = false)}
      />
      <Button
        variant="secondary"
        size="icon-xs"
        className="absolute top-1 right-1 opacity-80"
        title="Hide the overview"
        onClick={() => fold(false)}
      >
        <X />
      </Button>
    </Card>
  )
}
