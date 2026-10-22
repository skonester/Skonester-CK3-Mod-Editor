import { useEffect, useMemo, useRef, useState } from 'react'
import { FlipHorizontal2, RotateCcw, RotateCw } from 'lucide-react'
import type { PickedImage } from '@crusaderpope/shared/api'
import { tokenColor } from '@/lib/tokenColor'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Toggle } from '@/components/ui/toggle'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The canvas the picture is shown in, at most */
const VIEW = { w: 860, h: 480 }

const corners = (r: Rect): [number, number][] => [
  [r.x, r.y],
  [r.x + r.w, r.y],
  [r.x, r.y + r.h],
  [r.x + r.w, r.y + r.h]
]

/**
 * Crop and turn an image before it goes into the mod (CrusaderPope's crop
 * dialog): the frame keeps the target's proportions — drag it, drag a corner
 * to size it; turn by 90°, straighten by up to 30°, mirror. The result is
 * drawn at the target size (black where a turned picture leaves corners
 * empty) and handed back as PNG; "Use as is" skips all that.
 */
export default function ImageCropDialog({
  image,
  out,
  title,
  note,
  onDone,
  onAsIs,
  onCancel
}: {
  image: PickedImage
  /** the size the result is made at */
  out: { w: number; h: number }
  title: string
  note?: string
  onDone: (png: Uint8Array) => void
  onAsIs: () => void
  onCancel: () => void
}): React.JSX.Element {
  const aspect = out.w / out.h
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [quarter, setQuarter] = useState(0)
  const [fine, setFine] = useState(0)
  const [flip, setFlip] = useState(false)
  const [crop, setCrop] = useState<Rect | null>(null)
  const [busy, setBusy] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ mode: 'move' | 'corner'; corner?: number; x0: number; y0: number; c0: Rect } | null>(
    null
  )

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([image.data as BlobPart], { type: image.mime }))
    const el = new Image()
    el.onload = () => setImg(el)
    el.src = url
    return () => URL.revokeObjectURL(url)
  }, [image])

  const rad = ((quarter * 90 + fine) * Math.PI) / 180
  // The turned picture's bounding box ("stage"): crop coordinates are in it
  const stage = useMemo(() => {
    if (!img) return { w: 1, h: 1 }
    const c = Math.abs(Math.cos(rad))
    const s = Math.abs(Math.sin(rad))
    return { w: img.naturalWidth * c + img.naturalHeight * s, h: img.naturalWidth * s + img.naturalHeight * c }
  }, [img, rad])

  // The largest frame of the target's proportions, centred (again after each turn)
  useEffect(() => {
    if (!img) return
    const w = Math.min(stage.w, stage.h * aspect)
    const h = w / aspect
    setCrop({ x: (stage.w - w) / 2, y: (stage.h - h) / 2, w, h })
  }, [img, stage.w, stage.h, aspect])

  const scale = Math.min(VIEW.w / stage.w, VIEW.h / stage.h)
  // (the theme's colours, read once: the frame redraws on every pointer move)
  const colors = useMemo(
    () => ({
      dim: tokenColor('--background', 0.6),
      frame: tokenColor('--primary'),
      thirds: tokenColor('--primary', 0.35)
    }),
    []
  )

  const drawImage = (ctx: CanvasRenderingContext2D): void => {
    if (!img) return
    ctx.translate(stage.w / 2, stage.h / 2)
    ctx.rotate(rad)
    ctx.scale(flip ? -1 : 1, 1)
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  }

  useEffect(() => {
    const cv = canvas.current
    if (!cv || !img || !crop) return
    cv.width = Math.round(stage.w * scale)
    cv.height = Math.round(stage.h * scale)
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.save()
    ctx.scale(scale, scale)
    ctx.imageSmoothingQuality = 'high'
    drawImage(ctx)
    ctx.restore()
    // Outside the frame: dimmed
    const r = { x: crop.x * scale, y: crop.y * scale, w: crop.w * scale, h: crop.h * scale }
    ctx.fillStyle = colors.dim
    ctx.fillRect(0, 0, cv.width, r.y)
    ctx.fillRect(0, r.y + r.h, cv.width, cv.height - r.y - r.h)
    ctx.fillRect(0, r.y, r.x, r.h)
    ctx.fillRect(r.x + r.w, r.y, cv.width - r.x - r.w, r.h)
    ctx.strokeStyle = colors.frame
    ctx.lineWidth = 1.5
    ctx.strokeRect(r.x, r.y, r.w, r.h)
    // Thirds
    ctx.strokeStyle = colors.thirds
    ctx.lineWidth = 1
    for (let i = 1; i < 3; i++) {
      ctx.beginPath()
      ctx.moveTo(r.x + (r.w * i) / 3, r.y)
      ctx.lineTo(r.x + (r.w * i) / 3, r.y + r.h)
      ctx.moveTo(r.x, r.y + (r.h * i) / 3)
      ctx.lineTo(r.x + r.w, r.y + (r.h * i) / 3)
      ctx.stroke()
    }
    ctx.fillStyle = colors.frame
    for (const [cx, cy] of corners(r)) ctx.fillRect(cx - 5, cy - 5, 10, 10)
  })

  /** A frame kept inside the stage (moved back in; shrunk to fit) */
  const clamp = (c: Rect): Rect => {
    let { w, h } = c
    if (w > stage.w) {
      w = stage.w
      h = w / aspect
    }
    if (h > stage.h) {
      h = stage.h
      w = h * aspect
    }
    return { x: Math.min(Math.max(0, c.x), stage.w - w), y: Math.min(Math.max(0, c.y), stage.h - h), w, h }
  }

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!crop) return
    const b = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - b.left
    const py = e.clientY - b.top
    const r = { x: crop.x * scale, y: crop.y * scale, w: crop.w * scale, h: crop.h * scale }
    const corner = corners(r).findIndex(([cx, cy]) => Math.abs(px - cx) < 10 && Math.abs(py - cy) < 10)
    if (corner >= 0) drag.current = { mode: 'corner', corner, x0: px, y0: py, c0: crop }
    else if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h)
      drag.current = { mode: 'move', x0: px, y0: py, c0: crop }
    else return
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current
    if (!d) return
    const b = e.currentTarget.getBoundingClientRect()
    const dx = (e.clientX - b.left - d.x0) / scale
    const dy = (e.clientY - b.top - d.y0) / scale
    const c = d.c0
    if (d.mode === 'move') {
      setCrop(clamp({ ...c, x: c.x + dx, y: c.y + dy }))
      return
    }
    // A corner: the opposite one stays, the frame keeps its proportions
    const left = d.corner === 0 || d.corner === 2
    const top = d.corner === 0 || d.corner === 1
    const ax = left ? c.x + c.w : c.x
    const ay = top ? c.y + c.h : c.y
    let w = Math.max(20, left ? c.w - dx : c.w + dx, (top ? c.h - dy : c.h + dy) * aspect)
    w = Math.min(w, left ? ax : stage.w - ax, (top ? ay : stage.h - ay) * aspect)
    const h = w / aspect
    setCrop({ x: left ? ax - w : ax, y: top ? ay - h : ay, w, h })
  }

  const finish = async (): Promise<void> => {
    if (!img || !crop || busy) return
    setBusy(true)
    const cv = document.createElement('canvas')
    cv.width = out.w
    cv.height = out.h
    const ctx = cv.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, out.w, out.h)
    ctx.imageSmoothingQuality = 'high'
    ctx.scale(out.w / crop.w, out.h / crop.h)
    ctx.translate(-crop.x, -crop.y)
    drawImage(ctx)
    const blob = await new Promise<Blob | null>((resolve) => cv.toBlob(resolve, 'image/png'))
    setBusy(false)
    if (blob) onDone(new Uint8Array(await blob.arrayBuffer()))
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-[920px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {image.name}
            {img ? ` · ${img.naturalWidth}×${img.naturalHeight}` : ''} → {out.w}×{out.h}
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex items-center justify-center rounded-md border bg-muted/40"
          style={{ height: VIEW.h }}
        >
          {img && (
            <canvas
              ref={canvas}
              className="cursor-move touch-none"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={() => (drag.current = null)}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" title="Turn left by 90°" onClick={() => setQuarter((q) => (q + 3) % 4)}>
            <RotateCcw />
            90°
          </Button>
          <Button variant="outline" size="sm" title="Turn right by 90°" onClick={() => setQuarter((q) => (q + 1) % 4)}>
            <RotateCw />
            90°
          </Button>
          <Toggle variant="outline" pressed={flip} onPressedChange={setFlip} title="Mirror left–right">
            <FlipHorizontal2 />
            Mirror
          </Toggle>
          <span className="flex min-w-64 flex-1 items-center gap-2">
            <Label className="text-xs font-normal">Straighten</Label>
            <Slider min={-30} max={30} step={0.5} value={[fine]} onValueChange={([v]) => setFine(v)} />
            <span className="w-12 text-right text-xs text-muted-foreground">
              {fine > 0 ? '+' : ''}
              {fine}°
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuarter(0)
              setFine(0)
              setFlip(false)
            }}
          >
            Reset
          </Button>
        </div>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" title="The file as it is — not cropped (converted as usual)" onClick={onAsIs}>
            Use as is
          </Button>
          <Button disabled={!img || busy} onClick={() => void finish()}>
            {busy ? 'Cropping…' : 'Crop & use'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
