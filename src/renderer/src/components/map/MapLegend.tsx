import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { MapInfo } from '@crusaderpope/shared/api'
import {
  WATER,
  modesOf,
  type Groups,
  type Mode
} from '@crusaderpope/renderer/src/components/map/model'
import { Swatch } from '../Swatch'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

/** Rows drawn at most (the filter finds the rest) */
const ROWS = 150
const OPEN_KEY = 'map.legend.open'

function remembered(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

function share(area: number, land: number): string {
  const p = (area / land) * 100
  return p >= 10 ? `${Math.round(p)}%` : p >= 0.1 ? `${p.toFixed(1)}%` : '<0.1%'
}

/**
 * The map mode's legend (from CrusaderPope's): its groups with their colour
 * and share of the land, biggest first, with a filter; a numeric layer's
 * colour bar. A click picks a group, hovering highlights it on the map.
 */
export default function MapLegend({
  info,
  groups,
  mode,
  onPick,
  onHover
}: {
  info: MapInfo
  groups: Groups
  mode: Mode
  onPick: (g: number) => void
  onHover: (g: number | null) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(remembered)
  // The filter is the mode's: another mode starts without one
  const [typed, setTyped] = useState({ mode, q: '' })
  const filter = typed.mode === mode ? typed.q : ''
  const label = modesOf(info).find((m) => m.id === mode)?.label ?? ''
  // The land's area (water left out unless the mode colours it)
  const land = useMemo(() => {
    let a = 0
    for (let p = 0; p < info.count; p++)
      if (groups.of[p] >= 0 || !WATER.has(info.kinds[info.province.kind[p]])) a += info.province.area[p]
    return a || 1
  }, [info, groups])
  const scale = groups.layer?.scale
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    // A scale's bands in their order, low to high
    const all = scale ? groups.bySize.slice().sort((a, b) => a - b) : groups.bySize
    return q ? all.filter((g) => groups.name(g).toLowerCase().includes(q)) : all
  }, [groups, filter, scale])

  const fold = (value: boolean): void => {
    setOpen(value)
    try {
      localStorage.setItem(OPEN_KEY, value ? '1' : '0')
    } catch {
      // No storage: open again next time
    }
  }

  if (groups.bySize.length === 0) return null

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="absolute right-3 bottom-3 shadow"
        title="Show the legend"
        onClick={() => fold(true)}
      >
        {label}
        <ChevronUp />
      </Button>
    )
  }

  return (
    <Card className="absolute right-3 bottom-3 flex max-h-[60%] w-64 flex-col gap-2 py-3 shadow-lg">
      <div className="flex items-center gap-2 px-3">
        <span className="font-heading text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          {groups.bySize.length} {scale ? 'bands' : 'on the map'}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          title="Hide the legend"
          onClick={() => fold(false)}
        >
          <ChevronDown />
        </Button>
      </div>
      {scale && (
        <div className="px-3">
          <div className="flex h-3 overflow-hidden rounded">
            {scale.colors.map((c, i) => (
              <span
                key={i}
                className="flex-1 cursor-pointer"
                style={{ background: c }}
                title={groups.name(i)}
                onClick={() => groups.area[i] && onPick(i)}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {Math.round(scale.min)}
              {scale.unit ? ` ${scale.unit}` : ''}
            </span>
            <span>
              {Math.round(scale.max)}
              {scale.unit ? ` ${scale.unit}` : ''}
            </span>
          </div>
        </div>
      )}
      {groups.bySize.length > 12 && !scale && (
        <div className="px-3">
          <Input
            className="h-7 text-xs"
            value={filter}
            onChange={(e) => setTyped({ mode, q: e.target.value })}
            placeholder={`Filter ${label.toLowerCase()}…`}
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5">
        {rows.slice(0, ROWS).map((g) => (
          <Button
            key={g}
            variant="ghost"
            size="xs"
            className="w-full justify-start gap-2 font-normal"
            title={`${groups.name(g)} — ${share(groups.area[g], land)} of the land`}
            onClick={() => onPick(g)}
            onMouseEnter={() => onHover(g)}
            onMouseLeave={() => onHover(null)}
          >
            <Swatch hex={groups.color(g) ?? null} className="size-3 shrink-0 rounded-sm" />
            <span className="min-w-0 flex-1 truncate text-left">{groups.name(g)}</span>
            <span className="text-muted-foreground">{share(groups.area[g], land)}</span>
          </Button>
        ))}
        {rows.length > ROWS && (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            … {rows.length - ROWS} more (filter to find them)
          </p>
        )}
        {rows.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">Nothing by that name</p>}
      </div>
    </Card>
  )
}
