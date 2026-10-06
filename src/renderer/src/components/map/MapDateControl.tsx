import { useCallback, useEffect, useRef, useState } from 'react'
import type { MapInfo } from '@crusaderpope/shared/api'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

/** y, y.m or y.m.d → y.m.d (month 1–12, day 1–31), else null */
export function parseMapDate(s: string): string | null {
  const m = /^\s*(\d{1,5})(?:\.(\d{1,2}))?(?:\.(\d{1,2}))?\s*$/.exec(s)
  if (!m) return null
  const y = Number(m[1])
  const mo = m[2] === undefined ? 1 : Number(m[2])
  const d = m[3] === undefined ? 1 : Number(m[3])
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}.${mo}.${d}` : null
}

const yearOf = (d: string): number => Number(d.split('.')[0])

/** A map asked for that hasn't come within this time is given up on: the next can go */
const GIVE_UP = 3000

/**
 * The map's history date (from CrusaderPope's DateControl): the bookmarks'
 * start dates, a year slider over the history's range, and a typed y.m.d.
 * Scrubbing asks for one map at a time — while one is on its way, the latest
 * date wanted waits and goes next. Dimmed when the mode isn't read at a date.
 */
export default function MapDateControl({
  info,
  historical,
  onDate
}: {
  info: MapInfo
  historical: boolean
  onDate: (date: string) => void
}): React.JSX.Element {
  // The date asked for and not shown yet (the slider and entry show it meanwhile)
  const [draft, setDraft] = useState<string | null>(null)
  const [text, setText] = useState(info.date)
  const [bad, setBad] = useState(false)
  const asked = useRef<{ date: string; at: number } | null>(null)
  const next = useRef<string | null>(null)
  const shown = useRef(info.date)
  shown.current = info.date

  const send = useCallback(
    (d: string) => {
      if (asked.current && performance.now() - asked.current.at < GIVE_UP) {
        next.current = d
        return
      }
      next.current = null
      if (d === shown.current) {
        asked.current = null
        setDraft(null)
        return
      }
      asked.current = { date: d, at: performance.now() }
      onDate(d)
    },
    [onDate]
  )

  // A map came: the latest date wanted meanwhile goes next
  useEffect(() => {
    asked.current = null
    setText(info.date)
    setBad(false)
    const want = next.current
    if (want && want !== info.date) send(want)
    else {
      next.current = null
      setDraft(null)
    }
  }, [info, send])

  const want = (d: string): void => {
    setDraft(d)
    setText(d)
    setBad(false)
    send(d)
  }
  const current = draft ?? info.date
  const { from, to } = info.range
  const year = Math.min(to, Math.max(from, yearOf(current)))
  const bookmark = info.dates.find((d) => d.date === current)
  const commit = (): void => {
    const d = parseMapDate(text)
    if (d) want(d)
    else setBad(true)
  }

  return (
    <div
      className={cn('flex items-center gap-2', !historical && 'opacity-60')}
      title="Holders, realms, names, cultures, faiths and holdings are read from the history at this date"
    >
      <Select value={bookmark?.date ?? ''} onValueChange={(v) => v && want(v)}>
        <SelectTrigger size="sm" className="w-40" title="The bookmarks' start dates">
          <SelectValue placeholder="Bookmarks…" />
        </SelectTrigger>
        <SelectContent>
          {info.dates.map((d) => (
            <SelectItem key={d.date} value={d.date}>
              {d.date} — {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Slider
        className="w-40"
        min={from}
        max={to}
        step={1}
        value={[year]}
        onValueChange={([y]) => want(`${y}.1.1`)}
        title={`Year (${from}–${to}), the first of January`}
      />
      <Input
        className={cn('h-8 w-28 font-mono text-xs', bad && 'border-destructive')}
        value={text}
        spellCheck={false}
        aria-invalid={bad}
        onChange={(e) => {
          setText(e.target.value)
          setBad(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setText(current)
        }}
        onBlur={() => text !== current && commit()}
        title="A date (year.month.day) — Enter"
      />
      {draft && <span className="size-2 animate-pulse rounded-full bg-primary" title="Loading…" />}
    </div>
  )
}
