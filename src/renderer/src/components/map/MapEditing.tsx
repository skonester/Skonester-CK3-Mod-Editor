/**
 * Editing from the map (CrusaderPope's MapEdit / MapEditTitle / MapEditChooser,
 * on this app's UI): the side panel's editors of a province — a county's
 * culture, faith and development, a barony's holding, a title's holder, liege
 * and colour — written into the selected mod as history at the map's date by
 * the main process (CrusaderPope's map/edit.ts). Each edit is one undoable
 * change (the sidebar's Undo); the map reads its data again once the index has
 * the files.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type {
  MapCharacter,
  MapEditRequest,
  MapEditResult,
  MapInfo,
  MapLayer
} from '@crusaderpope/shared/api'
import { api } from '@crusaderpope/renderer/src/api'
import { TIER_NAMES, ancestorAt, hashColor } from '@crusaderpope/renderer/src/components/map/model'
import { Swatch } from '../Swatch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/** The layers the map edits: the county's value (culture, faith, development) or the barony's (holding) */
export const EDITABLE_LAYERS = new Set(['culture', 'faith', 'holding', 'development'])

type When = 'date' | 'current'

/** Runs a map edit and says how it went; the reason when it was refused, else null */
async function runEdit(req: MapEditRequest, text: string): Promise<string | null> {
  let r: MapEditResult
  try {
    r = await api.mapEdit(req)
  } catch (e) {
    r = { ok: false, message: (e as Error).message }
  }
  if (!r.ok) {
    toast.error(`Not changed: ${text}`, { description: r.message ?? 'Refused' })
    return r.message ?? 'Refused'
  }
  toast.success(text, {
    description: [r.rel && `${r.rel}:${r.line}`, ...(r.notes ?? [])].filter(Boolean).join('\n')
  })
  return null
}

/** What an edit would change (main's plan): the statement in effect, the file written; undefined while loading */
function usePlan(req: MapEditRequest, info: MapInfo): MapEditResult | null | undefined {
  const [plan, setPlan] = useState<MapEditResult | null | undefined>(undefined)
  const key = JSON.stringify(req)
  useEffect(() => {
    let live = true
    setPlan(undefined)
    api
      .mapEdit({ ...(JSON.parse(key) as MapEditRequest), plan: true })
      .then((r) => live && setPlan(r))
      .catch(() => live && setPlan(null))
    return () => {
      live = false
    }
  }, [key, info])
  return plan
}

const sameDate = (a: string, b: string): boolean =>
  a.split('.').map(Number).join('.') === b.split('.').map(Number).join('.')

/**
 * When the change happens — from the map's date on (a dated block), or the
 * statement in effect at the date (since its date, or from the start when
 * undated) — and the file it goes to.
 */
function WhenRow({
  date,
  plan,
  when,
  onWhen,
  undated
}: {
  date: string
  plan: MapEditResult | null | undefined
  when: When
  onWhen: (w: When) => void
  /** history/provinces: without a statement in effect a change can go from the start */
  undated: boolean
}): React.JSX.Element {
  const cur = plan?.current
  const t = plan?.target
  const one = cur?.date && sameDate(cur.date, date)
  const choice = !one && (!!cur || undated)
  const since = cur
    ? cur.title
      ? `Since ${cur.date} (${cur.title} sets it then)`
      : cur.date
        ? `Since ${cur.date} (changes that entry)`
        : 'From the start (changes the undated entry)'
    : 'From the start'
  return (
    <div className="flex flex-col gap-1 text-xs">
      {one ? (
        <span>At {date} (changes the entry of that date)</span>
      ) : choice ? (
        <Select value={when} onValueChange={(w) => onWhen(w as When)}>
          <SelectTrigger
            size="sm"
            className="w-full"
            title="When the change happens (the history's dates)"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date">From {date} on</SelectItem>
            <SelectItem value="current">{since}</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <span title="Title history is dated: with nothing set before, the change goes from the map's date on">
          From {date} on
        </span>
      )}
      {t && (
        <span className="text-muted-foreground" title={t.rel}>
          → {t.rel.slice(t.rel.lastIndexOf('/') + 1)}
          {t.from
            ? ` (copied from ${t.from === 'Game' ? 'the game' : t.from} first)`
            : t.created
              ? ' (new file)'
              : ''}
        </span>
      )}
      {plan && !plan.ok && <span className="text-destructive">{plan.message}</span>}
    </div>
  )
}

/** The mode a WhenRow shows: without a choice, what main does anyway */
const whenOf = (plan: MapEditResult | null | undefined, when: When, undated: boolean): When =>
  plan && !plan.current && !undated ? 'date' : when

/** One entry to choose: a culture, faith, holding, character, title — or "none" */
interface Choice {
  key: string
  name: string
  color?: string
  /** smaller text after the name (a tier, "age 36") */
  hint?: string
  /** a second line (a character's life, culture, titles and id) */
  sub?: string
  /** shown dimmer (not alive at the date, a title without a holder) */
  dim?: boolean
}

const MAX_SHOWN = 200

/** Static choices filtered by words: exact name or key first, then prefix, then contains */
function filterChoices(list: Choice[], q: string): Choice[] {
  const s = q.trim().toLowerCase()
  if (!s) return list
  const scored: [Choice, number][] = []
  for (const c of list) {
    const n = c.name.toLowerCase()
    const k = c.key.toLowerCase()
    const score =
      n === s || k === s
        ? 0
        : n.startsWith(s) || k.startsWith(s)
          ? 1
          : n.includes(s) || k.includes(s)
            ? 2
            : -1
    if (score >= 0) scored.push([c, score])
  }
  return scored.sort((a, b) => a[1] - b[1]).map(([c]) => c)
}

/** A filterable list: type to filter `choices` or to `search` (the index's characters); `fixed` entries first */
function Chooser({
  choices,
  search,
  fixed,
  current,
  placeholder,
  busy,
  onPick
}: {
  choices?: Choice[]
  search?: (q: string) => Promise<Choice[]>
  fixed?: Choice[]
  current?: string
  placeholder: string
  busy?: boolean
  onPick: (c: Choice) => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Choice[] | null>(null)

  // Searching, debounced; the last query wins
  useEffect(() => {
    if (!search) return
    if (!q.trim()) {
      setFound(null)
      return
    }
    let live = true
    const t = setTimeout(() => void search(q).then((r) => live && setFound(r)), 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, search])

  const shown = useMemo(() => {
    const rest = search ? (found ?? []) : filterChoices(choices ?? [], q)
    return [...filterChoices(fixed ?? [], q), ...rest].slice(0, MAX_SHOWN)
  }, [fixed, choices, search, found, q])

  return (
    <Command shouldFilter={false} className="rounded-md border">
      <CommandInput
        value={q}
        onValueChange={setQ}
        placeholder={placeholder}
        disabled={busy}
        autoFocus
      />
      <CommandList className="max-h-64">
        <CommandEmpty>
          {search && !q.trim()
            ? 'Type a name, house or id to search'
            : search && found === null
              ? 'Searching…'
              : 'Nothing matches'}
        </CommandEmpty>
        {shown.map((c) => (
          <CommandItem
            key={c.key}
            value={c.key}
            disabled={busy}
            className={cn('items-start', c.dim && 'opacity-60')}
            title={c.key}
            onSelect={() => onPick(c)}
          >
            {c.color !== undefined && (
              <Swatch hex={c.color} className="mt-1 size-3 shrink-0 rounded-sm" />
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="truncate">{c.name}</span>
                {c.hint && <span className="text-xs text-muted-foreground">{c.hint}</span>}
                {c.key === current && <Badge variant="secondary">now</Badge>}
              </span>
              {c.sub && <span className="truncate text-xs text-muted-foreground">{c.sub}</span>}
            </span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  )
}

/** A county's provinces in title order: its capital barony's first (history/provinces writes there) */
function countyProvinces(info: MapInfo, county: number): number[] {
  const out: number[] = []
  for (let q = 1; q < info.count; q++) {
    const b = info.province.barony[q]
    if (b >= 0 && info.titles[b].parent === county) out.push(q)
  }
  return out.sort((a, b) => info.province.barony[a] - info.province.barony[b])
}

/** A title's de jure lieges at the date, lowest first */
function liegesOf(info: MapInfo, t: number): string[] {
  const out: string[] = []
  for (
    let x = info.titles[t].parent, guard = 0;
    x >= 0 && guard < 10;
    x = info.titles[x].parent, guard++
  ) {
    out.push(info.titles[x].key)
  }
  return out
}

/**
 * Changes a layer's value of the selected province: the county's culture,
 * faith or development (history/titles `change_development_level`), the
 * barony's holding.
 */
export function MapLayerEdit({
  info,
  layer,
  p
}: {
  info: MapInfo
  layer: MapLayer
  p: number
}): React.JSX.Element {
  const kind = layer.id as 'culture' | 'faith' | 'holding' | 'development'
  const t = kind === 'holding' ? info.province.barony[p] : ancestorAt(info, p, 'c')
  const provinces = useMemo(
    () =>
      kind === 'holding'
        ? [p]
        : kind !== 'development' && t >= 0
          ? countyProvinces(info, t)
          : undefined,
    [kind, p, t, info]
  )
  const lieges = useMemo(
    () => (kind === 'development' && t >= 0 ? liegesOf(info, t) : undefined),
    [kind, t, info]
  )
  const title = t >= 0 ? info.titles[t] : undefined
  const [when, setWhen] = useState<When>('current')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const plan = usePlan({ kind, title: title?.key, provinces, lieges, date: info.date }, info)
  const [holdings, setHoldings] = useState<Choice[]>([])
  const v = layer.values[p]
  const [level, setLevel] = useState(Number.isFinite(v) ? String(v) : '')

  // Holdings: every holding type (the layer lists only those on the map), none and auto
  useEffect(() => {
    if (kind !== 'holding') return
    let live = true
    void api.list('holdings').then((list) => {
      if (!live) return
      const color = (key: string): string =>
        layer.things?.find((x) => x.key === key)?.color ?? hashColor(key)
      setHoldings([
        ...list.map((h) => ({ key: h.name, name: h.display ?? h.name, color: color(h.name) })),
        { key: 'none', name: 'No holding', color: color('none'), hint: 'none' },
        {
          key: 'auto',
          name: 'Automatic',
          color: color('auto'),
          hint: 'auto: the game fills the county'
        }
      ])
    })
    return () => {
      live = false
    }
  }, [kind, layer])

  const choices = useMemo(
    () =>
      kind === 'holding'
        ? holdings
        : (layer.things ?? []).map((x) => ({
            key: x.key,
            name: x.name,
            color: x.color ?? hashColor(x.key)
          })),
    [kind, holdings, layer]
  )

  if (!title)
    return (
      <p className="text-xs text-muted-foreground">
        No {kind === 'holding' ? 'barony' : 'county'} here.
      </p>
    )

  const undated = kind !== 'development'
  const at = whenOf(plan, when, undated)
  const set = async (value: string, name: string): Promise<void> => {
    setBusy(true)
    setError(null)
    const why = await runEdit(
      { kind, title: title.key, provinces, lieges, value, date: info.date, when: at },
      `${layer.row} of ${title.name}: ${name}${at === 'date' ? ` from ${info.date}` : ''}`
    )
    setBusy(false)
    if (why) setError(why)
  }
  const levelOk = /^\d{1,3}$/.test(level.trim())

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-2">
      <div className="text-xs">
        {layer.row} of <span className="font-medium">{title.name}</span>
        {(kind === 'culture' || kind === 'faith') && (
          <span className="text-muted-foreground"> (written on its capital)</span>
        )}
      </div>
      <WhenRow date={info.date} plan={plan} when={when} onWhen={setWhen} undated={undated} />
      {kind === 'development' ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={999}
            className="h-8 w-24"
            value={level}
            disabled={busy}
            onChange={(e) => setLevel(e.target.value)}
            onKeyDown={(e) =>
              e.key === 'Enter' && levelOk && !busy && void set(level.trim(), level.trim())
            }
          />
          <span className="text-xs text-muted-foreground">
            {Number.isFinite(v) ? `now ${v}` : ''}
          </span>
          <Button
            size="xs"
            disabled={busy || !levelOk || Number(level) === v}
            onClick={() => void set(level.trim(), level.trim())}
          >
            Set
          </Button>
        </div>
      ) : (
        <Chooser
          choices={choices}
          current={v >= 0 ? layer.things?.[v]?.key : undefined}
          placeholder={`Find a ${layer.row.toLowerCase()}…`}
          busy={busy}
          onPick={(c) => void set(c.key, c.name)}
        />
      )}
      {busy && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner />
          Writing into the mod…
        </span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

/** Tiers from low to high */
const TIER_RANK = 'bcdkeh'

/** #rrggbb of a CSS colour (the title's colour, or its fallback) */
const hexOf = (c: string | undefined): string =>
  c && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '#808080'

const yearOf = (d: string | undefined): string => (d ? d.slice(0, d.indexOf('.')) : '?')

/** A found character as a choice: name and house; life, culture and what they hold at the date below */
function characterChoice(c: MapCharacter, holds: Map<string, string>): Choice {
  const life = c.birth || c.death ? `${yearOf(c.birth)}–${c.death ? yearOf(c.death) : ''}` : ''
  const title = holds.get(c.id)
  return {
    key: c.id,
    name: c.house ? `${c.name} ${c.house}` : c.name,
    hint: c.alive ? (c.age !== undefined ? `age ${c.age}` : 'alive') : 'not alive then',
    sub: [life, c.culture?.name, title && `holds ${title}`, `#${c.id}`].filter(Boolean).join(' · '),
    dim: !c.alive
  }
}

/** Changes a title: its holder and liege at the map's date (history), its colour (its definition) */
export function MapTitleEdit({ info, t }: { info: MapInfo; t: number }): React.JSX.Element {
  const title = info.titles[t]
  const [sub, setSub] = useState<'holder' | 'liege' | null>(null)
  const [when, setWhen] = useState<When>('date')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [color, setColor] = useState(hexOf(title.color))
  const holderPlan = usePlan({ kind: 'holder', title: title.key, date: info.date }, info)
  const liegePlan = usePlan({ kind: 'liege', title: title.key, date: info.date }, info)
  const liegeKey = liegePlan?.current?.value
  const liege =
    liegeKey && liegeKey !== '0' ? info.titles.find((x) => x.key === liegeKey) : undefined

  useEffect(() => setColor(hexOf(title.color)), [title.color])
  // The holder chooser opens: main readies its character lists for the date meanwhile
  useEffect(() => {
    if (sub === 'holder') void api.mapCharacters('', info.date).catch(() => undefined)
  }, [sub, info.date])

  // Who holds what at the date: each character's highest title
  const holds = useMemo(() => {
    const m = new Map<string, { name: string; rank: number }>()
    for (const x of info.titles) {
      if (!x.holder) continue
      const rank = TIER_RANK.indexOf(x.tier)
      const had = m.get(x.holder.id)
      if (!had || rank > had.rank) m.set(x.holder.id, { name: x.name, rank })
    }
    return new Map([...m].map(([id, x]) => [id, x.name]))
  }, [info.titles])

  // Characters by name, id, house or dynasty — those alive at the date first (main ranks them)
  const searchCharacters = useCallback(
    async (q: string): Promise<Choice[]> =>
      (await api.mapCharacters(q, info.date)).map((c) => characterChoice(c, holds)),
    [info.date, holds]
  )
  const lieges = useMemo(() => {
    const rank = TIER_RANK.indexOf(title.tier)
    return info.titles
      .filter((x) => TIER_RANK.indexOf(x.tier) > rank)
      .map((x) => ({
        key: x.key,
        name: x.name,
        color: x.color ?? hashColor(x.key),
        hint: `${TIER_NAMES[x.tier]?.[0] ?? x.tier} · ${x.holder ? x.holder.name : 'no holder'}`,
        dim: !x.holder
      }))
      .sort((a, b) => Number(a.dim) - Number(b.dim) || a.name.localeCompare(b.name))
  }, [info.titles, title.tier])

  const edit = async (req: MapEditRequest, text: string): Promise<void> => {
    setBusy(true)
    setError(null)
    const why = await runEdit(req, text)
    setBusy(false)
    if (why) setError(why)
    else setSub(null)
  }
  const open = (s: 'holder' | 'liege'): void => {
    setSub(sub === s ? null : s)
    setWhen('date')
    setError(null)
  }
  const plan = sub === 'liege' ? liegePlan : holderPlan
  const at = whenOf(plan, when, false)
  const from = at === 'date' ? ` from ${info.date}` : ''

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-2 text-xs">
      <div>
        <span className="font-medium">{title.name}</span>{' '}
        <span className="text-muted-foreground">at {info.date}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-12 text-muted-foreground">Holder</span>
        <span className="min-w-0 flex-1 truncate">
          {title.holder
            ? `${title.holder.name}${title.holder.house ? ` ${title.holder.house}` : ''}`
            : 'none'}
        </span>
        <Button
          variant={sub === 'holder' ? 'secondary' : 'outline'}
          size="xs"
          disabled={busy}
          onClick={() => open('holder')}
        >
          Change…
        </Button>
      </div>
      {sub === 'holder' && (
        <>
          <WhenRow
            date={info.date}
            plan={holderPlan}
            when={when}
            onWhen={setWhen}
            undated={false}
          />
          <Chooser
            search={searchCharacters}
            fixed={[{ key: '0', name: 'No holder', hint: 'holder = 0' }]}
            current={title.holder?.id}
            placeholder="Find a character (name, house or id)…"
            busy={busy}
            onPick={(c) =>
              void edit(
                { kind: 'holder', title: title.key, value: c.key, date: info.date, when: at },
                `Holder of ${title.name}: ${c.key === '0' ? 'none' : c.name}${from}`
              )
            }
          />
        </>
      )}
      <div className="flex items-center gap-2">
        <span className="w-12 text-muted-foreground">Liege</span>
        <span className="min-w-0 flex-1 truncate">
          {liegePlan === undefined
            ? '…'
            : liege
              ? liege.name
              : liegeKey && liegeKey !== '0'
                ? liegeKey
                : 'none'}
        </span>
        <Button
          variant={sub === 'liege' ? 'secondary' : 'outline'}
          size="xs"
          disabled={busy}
          onClick={() => open('liege')}
        >
          Change…
        </Button>
      </div>
      {sub === 'liege' && (
        <>
          <WhenRow date={info.date} plan={liegePlan} when={when} onWhen={setWhen} undated={false} />
          <Chooser
            choices={lieges}
            fixed={[{ key: '0', name: 'None (independent)', hint: 'liege = 0' }]}
            current={liegeKey ?? '0'}
            placeholder="Find a title…"
            busy={busy}
            onPick={(c) =>
              void edit(
                { kind: 'liege', title: title.key, value: c.key, date: info.date, when: at },
                `Liege of ${title.name}: ${c.key === '0' ? 'none' : c.name}${from}`
              )
            }
          />
        </>
      )}
      <div className="flex items-center gap-2">
        <span className="w-12 text-muted-foreground">Colour</span>
        <Input
          type="color"
          className="h-7 w-12 p-0.5"
          value={color}
          disabled={busy}
          onChange={(e) => setColor(e.target.value)}
          title="The title's colour (common/landed_titles: color = { r g b })"
        />
        <span className="flex-1 font-mono text-muted-foreground">{color}</span>
        <Button
          size="xs"
          disabled={busy || color === hexOf(title.color)}
          title="Overrides the title's definition in the mod and sets its color"
          onClick={() =>
            void edit(
              { kind: 'color', title: title.key, value: color },
              `Colour of ${title.name}: ${color}`
            )
          }
        >
          Apply
        </Button>
      </div>
      {busy && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Spinner />
          Writing into the mod…
        </span>
      )}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  )
}
