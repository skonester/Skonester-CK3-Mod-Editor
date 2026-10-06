/**
 * The game's map, ported from CrusaderPope (its MapView): the province raster
 * (ck3://map/<key>.bin, a province id per pixel) drawn in 2D through WebGL2 or
 * as the 3D terrain, coloured by a mode — realms and vassals at a date, de jure
 * titles, cultures, faiths, terrain … — with names, a legend, an overview,
 * hover and a side panel whose entries open in the app's editors. The drawing
 * code is CrusaderPope's own (src/crusaderpope/renderer); the chrome here is
 * the app's.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MapInfo } from '@crusaderpope/shared/api'
import { imgUrl } from '@crusaderpope/renderer/src/img'
import { Map2D, type View } from '@crusaderpope/renderer/src/components/map/gl2d'
import { drawLabels } from '@crusaderpope/renderer/src/components/map/labels'
import {
  centralProvince,
  focusOf,
  groupsOf,
  modesOf,
  type Mode,
  type Style
} from '@crusaderpope/renderer/src/components/map/model'
import { provinceRaster } from '@crusaderpope/renderer/src/components/map/raster'
import { loadMapInfo } from '@crusaderpope/renderer/src/components/map/mapLoad'
import { drawOverlays2d } from '@crusaderpope/renderer/src/components/map/overlays2d'
import { useApp } from '../../AppContext'
import Map3DPane from './Map3DPane'
import MapDateControl from './MapDateControl'
import MapLegend from './MapLegend'
import MapMinimap from './MapMinimap'
import MapModeMenu from './MapModeMenu'
import { MapSidePanel, MapTooltip } from './MapSidePanel'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/** A picture of one colour (AGOT's terrain colour map is a grey placeholder) */
function isFlat(img: HTMLImageElement): boolean {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 16
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, 32, 16)
  const d = ctx.getImageData(0, 0, 32, 16).data
  let lo = 255
  let hi = 0
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3
    lo = Math.min(lo, l)
    hi = Math.max(hi, l)
  }
  return hi - lo < 10
}

const STYLES: { value: Style; label: string }[] = [
  { value: 'terrain', label: 'Terrain' },
  { value: 'paper', label: 'Paper map' },
  { value: 'plain', label: 'Plain' }
]

export default function GameMap({
  focus
}: {
  /** An entry to show — `<index type>:<key>`, e.g. "landed_titles:k_jerusalem" */
  focus?: string
}): React.JSX.Element {
  const { indexStatus } = useApp()
  const revision = indexStatus.state === 'ready' ? (indexStatus.revision ?? 0) : null
  const [info, setInfo] = useState<MapInfo | null>(null)
  const [ids, setIds] = useState<Uint16Array | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState<string | undefined>(undefined)
  const [mode, setMode] = useState<Mode>('realm')
  const [dim, setDim] = useState<'2d' | '3d'>('2d')
  const [style, setStyle] = useState<Style>('terrain')
  // A style picked by hand stays; otherwise a flat terrain colour map gives way to the paper map
  const picked = useRef(false)
  const [hover, setHover] = useState<{ p: number; x: number; y: number } | null>(null)
  // The selected province (its group is the mode's: a mode change keeps it selected)
  const [sel, setSel] = useState<number | null>(null)
  const [focusBox, setFocusBox] = useState<[number, number, number, number] | undefined>(undefined)
  const [search, setSearch] = useState('')
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const labels = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  // A legend row under the pointer: its group highlighted (one of its provinces)
  const [legendHover, setLegendHover] = useState<number | null>(null)
  const map2d = useRef<Map2D | null>(null)
  const view = useRef<View | null>(null)
  const frame = useRef(0)
  const dragging = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [ready, setReady] = useState(0)
  const [viewTick, setViewTick] = useState(0)

  // The map at the date (a new index or date: again)
  useEffect(() => {
    if (revision === null) return
    let live = true
    setError(null)
    loadMapInfo(date)
      .then((i) => {
        if (!live) return
        if (!i) throw new Error('The game index is not ready')
        setInfo(i)
        return provinceRaster(i.key).then((r) => live && setIds(r))
      })
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [date, revision])

  const groups = useMemo(() => (info ? groupsOf(info, mode) : null), [info, mode])
  const modes = useMemo(() => (info ? modesOf(info) : []), [info])

  const draw = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const m = map2d.current
      const cv = canvas.current
      const v = view.current
      if (!m || !cv || !v || !groups || !info) return
      const hp = legendHover ?? hover?.p
      m.draw(
        cv,
        v,
        style,
        hp !== undefined ? groups.of[hp] + 1 : 0,
        sel !== null ? groups.of[sel] + 1 : 0
      )
      if (overlay.current) drawOverlays2d(overlay.current, v, info, style)
      if (labels.current) drawLabels(labels.current, v, info, groups, style)
      setViewTick((t) => t + 1)
    })
  }, [info, groups, hover, legendHover, sel, style])

  // A new date keeps the drawing and its background: only the palettes change
  const infoRef = useRef<MapInfo | null>(null)
  infoRef.current = info
  const drawRef = useRef(draw)
  drawRef.current = draw
  const mapKey = info?.key
  const terrainImage = info?.terrainImage
  const paperImage = info?.paperImage

  // The 2D drawing once the raster is here
  useEffect(() => {
    const cv = canvas.current
    const i = infoRef.current
    if (dim !== '2d' || !cv || !ids || !i) return
    let m: Map2D
    try {
      m = new Map2D(cv, i, ids)
    } catch (e) {
      setError((e as Error).message)
      return
    }
    map2d.current = m
    // The whole map in view
    if (!view.current) {
      const s = Math.max(i.width / cv.clientWidth, i.height / cv.clientHeight)
      view.current = {
        x: (i.width - cv.clientWidth * s) / 2,
        y: (i.height - cv.clientHeight * s) / 2,
        scale: s
      }
    }
    setReady((n) => n + 1)
    return () => {
      map2d.current = null
      m.dispose()
    }
  }, [ids, mapKey, dim])

  // The background picture (terrain colour map or paper map)
  useEffect(() => {
    const m = map2d.current
    const path = style === 'paper' ? paperImage : style === 'terrain' ? terrainImage : undefined
    if (!m || !path) return
    let live = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (!live || map2d.current !== m) return
      if (style === 'terrain' && !picked.current && isFlat(img) && paperImage)
        return setStyle('paper')
      m.setBackground(img)
      drawRef.current()
    }
    img.src = imgUrl(path, 4096)
    return () => {
      live = false
    }
  }, [style, terrainImage, paperImage, ready])

  // The palettes of the mode
  useEffect(() => {
    if (!map2d.current || !groups) return
    map2d.current.setGroups(groups)
    draw()
  }, [groups, ready, draw])

  useEffect(() => draw(), [draw])
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => drawRef.current())
    ro.observe(el)
    return () => ro.disconnect()
  }, [dim])

  /** Keeps the view's centre on the map */
  const clamp = (v: View): View => {
    const cv = canvas.current
    if (!cv || !info) return v
    const hw = (cv.clientWidth * v.scale) / 2
    const hh = (cv.clientHeight * v.scale) / 2
    return {
      ...v,
      x: Math.min(info.width - hw, Math.max(-hw, v.x)),
      y: Math.min(info.height - hh, Math.max(-hh, v.y))
    }
  }

  const provinceAt = (e: { clientX: number; clientY: number }): number => {
    const cv = canvas.current
    const v = view.current
    if (!cv || !v || !ids || !info) return -1
    const r = cv.getBoundingClientRect()
    const x = Math.floor(v.x + (e.clientX - r.left) * v.scale)
    const y = Math.floor(v.y + (e.clientY - r.top) * v.scale)
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return -1
    return ids[y * info.width + x]
  }

  /** Brings a box of map pixels into view (2D at once; 3D through its focus) */
  const fit = useCallback(
    (x0: number, y0: number, x1: number, y1: number) => {
      setFocusBox([x0, y0, x1, y1])
      const cv = canvas.current
      if (!cv) return
      const pad = 1.3
      const s = Math.max(
        ((x1 - x0 + 1) * pad) / cv.clientWidth,
        ((y1 - y0 + 1) * pad) / cv.clientHeight,
        0.08
      )
      view.current = {
        x: (x0 + x1) / 2 - (cv.clientWidth * s) / 2,
        y: (y0 + y1) / 2 - (cv.clientHeight * s) / 2,
        scale: s
      }
      draw()
    },
    [draw]
  )

  /** Selects a group (by one of its provinces), zoomed to it */
  const select = useCallback(
    (p: number, zoom: boolean) => {
      setSel(p)
      const g = groups ? groups.of[p] : -1
      if (zoom && groups && g >= 0) {
        fit(groups.box[g * 4], groups.box[g * 4 + 1], groups.box[g * 4 + 2], groups.box[g * 4 + 3])
      }
    },
    [groups, fit]
  )

  // "Show on map": the entry's mode, selected and in view
  const focused = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!focus || !info || !groups || focused.current === focus + info.key) return
    const at = focus.indexOf(':')
    const f = focusOf(info, focus.slice(0, at), focus.slice(at + 1))
    if (!f) return
    if (mode !== f.mode) return setMode(f.mode)
    if (dim === '2d' && !map2d.current) return
    focused.current = focus + info.key
    if (groups.area[f.group]) select(centralProvince(info, groups, f.group), true)
  }, [focus, info, groups, mode, select, ready, dim])

  // Pan (drag) and zoom (wheel, around the pointer)
  const onWheel = (e: React.WheelEvent): void => {
    const cv = canvas.current
    const v = view.current
    if (!cv || !v || !info) return
    const r = cv.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const fitScale = Math.max(info.width / cv.clientWidth, info.height / cv.clientHeight) * 1.1
    const s = Math.min(fitScale, Math.max(0.05, v.scale * Math.pow(1.0015, e.deltaY)))
    view.current = clamp({ x: v.x + mx * (v.scale - s), y: v.y + my * (v.scale - s), scale: s })
    draw()
  }
  const onDown = (e: React.PointerEvent): void => {
    if (e.button > 2) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = { x: e.clientX, y: e.clientY, moved: false }
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = dragging.current
    const v = view.current
    if (d && v) {
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (d.moved || Math.abs(dx) + Math.abs(dy) > 3) {
        d.moved = true
        view.current = clamp({ ...v, x: v.x - dx * v.scale, y: v.y - dy * v.scale })
        d.x = e.clientX
        d.y = e.clientY
        draw()
      }
    }
    const p = provinceAt(e)
    const r = wrap.current!.getBoundingClientRect()
    setHover(p > 0 ? { p, x: e.clientX - r.left, y: e.clientY - r.top } : null)
  }
  const onUp = (e: React.PointerEvent): void => {
    const d = dragging.current
    dragging.current = null
    if (!d || d.moved || e.button !== 0 || !groups) return
    const p = provinceAt(e)
    setSel(p > 0 ? p : null)
  }
  const jump = (x: number, y: number): void => {
    const cv = canvas.current
    const v = view.current
    if (!cv || !v) return
    view.current = clamp({
      ...v,
      x: x - (cv.clientWidth * v.scale) / 2,
      y: y - (cv.clientHeight * v.scale) / 2
    })
    draw()
  }

  const searchable = useMemo(() => {
    if (!groups) return []
    const out: { g: number; name: string }[] = []
    for (let g = 0; g < groups.area.length; g++)
      if (groups.area[g]) out.push({ g, name: groups.name(g) })
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }, [groups])
  const runSearch = (): void => {
    const q = search.trim().toLowerCase()
    if (!q || !groups || !info) return
    const hit =
      searchable.find((s) => s.name.toLowerCase() === q) ??
      searchable.find((s) => s.name.toLowerCase().startsWith(q)) ??
      searchable.find((s) => s.name.toLowerCase().includes(q))
    if (hit) select(centralProvince(info, groups, hit.g), true)
  }

  const current = modes.find((m) => m.id === mode)

  if (revision === null) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        {indexStatus.state === 'indexing' && <Spinner />}
        {indexStatus.state === 'indexing'
          ? `Indexing the game — ${indexStatus.phase ?? 'starting'}…`
          : indexStatus.state === 'error'
            ? 'The game index failed — see Settings.'
            : 'The map needs the game index. Turn it on in Settings.'}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <MapModeMenu modes={modes} mode={mode} onMode={setMode} />
        {info && <MapDateControl info={info} historical={!!current?.historical} onDate={setDate} />}
        <form
          className="ml-auto"
          onSubmit={(e) => {
            e.preventDefault()
            runSearch()
          }}
        >
          <Input
            className="h-8 w-48"
            list="map-search-names"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Find ${current?.label.toLowerCase() ?? ''}…`}
          />
          <datalist id="map-search-names">
            {searchable.slice(0, 3000).map((s) => (
              <option key={s.g} value={s.name} />
            ))}
          </datalist>
        </form>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={dim}
          onValueChange={(d) => {
            if (d !== '2d' && d !== '3d') return
            // 3D starts where the 2D view is
            const v = view.current
            const cv = canvas.current
            if (d === '3d' && dim === '2d' && v && cv) {
              setFocusBox([
                v.x,
                v.y,
                v.x + cv.clientWidth * v.scale,
                v.y + cv.clientHeight * v.scale
              ])
            }
            // The 3D terrain has the game's materials: a flat colour map no longer calls for the paper map
            if (d === '3d' && !picked.current && style === 'paper') setStyle('terrain')
            setDim(d)
          }}
        >
          <ToggleGroupItem value="2d">2D</ToggleGroupItem>
          <ToggleGroupItem value="3d">3D</ToggleGroupItem>
        </ToggleGroup>
        <Select
          value={style}
          onValueChange={(s) => {
            picked.current = true
            setStyle(s as Style)
          }}
        >
          <SelectTrigger size="sm" className="w-32" title="What is under the map mode's colours">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STYLES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div ref={wrap} className="relative min-w-0 flex-1 overflow-hidden">
          {dim === '2d' ? (
            <div
              className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
              onWheel={onWheel}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={() => setHover(null)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <canvas ref={canvas} className="absolute inset-0 block size-full" />
              <canvas
                ref={overlay}
                className="pointer-events-none absolute inset-0 block size-full"
              />
              <canvas
                ref={labels}
                className="pointer-events-none absolute inset-0 block size-full"
              />
            </div>
          ) : info && ids && groups ? (
            <Map3DPane
              info={info}
              ids={ids}
              groups={groups}
              mode={mode}
              style={style}
              sel={sel ?? -1}
              hover={legendHover ?? hover?.p ?? -1}
              onHover={(p, x, y) => setHover(p > 0 ? { p, x, y } : null)}
              onSelect={(p) => setSel(p > 0 ? p : null)}
              focus={focusBox}
            />
          ) : null}
          {(!ids || error) && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              {!error && <Spinner />}
              {error ? (
                <span className="text-destructive">{error}</span>
              ) : info ? (
                'Loading the province map…'
              ) : (
                'Reading the map (the first time builds the province map)…'
              )}
            </div>
          )}
          {hover && info && groups && !dragging.current?.moved && (
            <MapTooltip
              info={info}
              groups={groups}
              mode={mode}
              p={hover.p}
              x={hover.x}
              y={hover.y}
            />
          )}
          {dim === '2d' && info && groups && canvas.current && (
            <MapMinimap
              info={info}
              groups={groups}
              view={view.current}
              size={{ w: canvas.current.clientWidth, h: canvas.current.clientHeight }}
              tick={viewTick}
              onJump={jump}
            />
          )}
          {info && groups && (
            <MapLegend
              info={info}
              groups={groups}
              mode={mode}
              onPick={(g) => select(centralProvince(info, groups, g), true)}
              onHover={(g) => setLegendHover(g === null ? null : centralProvince(info, groups, g))}
            />
          )}
        </div>
        {info && groups && sel !== null && (
          <MapSidePanel
            info={info}
            groups={groups}
            mode={mode}
            sel={sel}
            onClose={() => setSel(null)}
            onZoom={() => select(sel, true)}
          />
        )}
      </div>
    </div>
  )
}
