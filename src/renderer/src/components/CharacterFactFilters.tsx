import { useEffect, useMemo, useState } from 'react'
import { ListFilter } from 'lucide-react'
import type { CharacterFacets, CharacterFacetValue, CharacterFilter } from '@crusaderpope/shared/api'
import { useApp } from '../AppContext'
import ReferenceInput from './ReferenceInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

const ANY = 'any'
/** A label-and-control row: the label keeps its width, the control takes the rest */
const ROW = '*:data-[slot=field-label]:flex-none'

/** The facets of one index revision (an update can bring other cultures, faiths, traits) */
let facetsCache: { revision: number; facets: Promise<CharacterFacets> } | null = null

/** Number of criteria that filter (the date alone doesn't) */
export function activeCriteria(f: CharacterFilter): number {
  return [
    f.gender,
    f.age,
    f.alive,
    f.culture,
    f.faith,
    f.religion,
    f.trait,
    f.dynasty?.trim(),
    f.rank,
    f.dna
  ].filter((v) => v !== undefined && v !== '').length
}

const options = (list: CharacterFacetValue[] | undefined): { id: string; name: string }[] =>
  (list ?? []).map((v) => ({ id: v.key, name: `${v.label} · ${v.count.toLocaleString()}` }))

function PickSelect<T extends string>({
  label,
  value,
  onChange,
  items
}: {
  label: string
  value: T | undefined
  onChange: (v: T | undefined) => void
  items: [T, string][]
}): React.JSX.Element {
  return (
    <Field orientation="horizontal" className={ROW}>
      <FieldLabel className="w-20 flex-none">{label}</FieldLabel>
      <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? undefined : (v as T))}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any</SelectItem>
          {items.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/**
 * Filters the character list by what the game knows of each character at a
 * date — alive, age, faith, culture, rank held … — from the game index's
 * history of every character (CrusaderPope's character filters), rather than
 * the fields the history file spells out.
 */
export default function CharacterFactFilters({
  value: f,
  onChange,
  bookmarks
}: {
  value: CharacterFilter
  onChange: (f: CharacterFilter) => void
  /** the bookmarks' start dates, earliest first: the first is the date facts are taken at when none is given */
  bookmarks?: string[]
}): React.JSX.Element {
  const defaultDate = bookmarks?.[0]
  const { indexStatus } = useApp()
  const revision = indexStatus.state === 'ready' ? (indexStatus.revision ?? 0) : null
  const [open, setOpen] = useState(false)
  const [facets, setFacets] = useState<CharacterFacets | null>(null)
  const [ageText, setAgeText] = useState(f.age ? String(f.age.value) : '')
  const [ageOp, setAgeOp] = useState<'<' | '>' | '=' | undefined>(f.age?.op)

  useEffect(() => {
    if (!open || revision === null) return
    if (facetsCache?.revision !== revision)
      facetsCache = { revision, facets: window.api.characterFacets() }
    let live = true
    void facetsCache.facets.then((x) => live && setFacets(x))
    return () => {
      live = false
    }
  }, [open, revision])

  const set = (patch: Partial<CharacterFilter>): void => {
    const next: CharacterFilter = { ...f, ...patch }
    for (const k of Object.keys(next) as (keyof CharacterFilter)[]) {
      if (next[k] === undefined || next[k] === '') delete next[k]
    }
    onChange(next)
  }
  const setAge = (op: typeof ageOp, text: string): void => {
    setAgeOp(op)
    setAgeText(text)
    const n = parseInt(text, 10)
    set({ age: op && Number.isFinite(n) ? { op, value: n } : undefined })
  }
  const lists = useMemo(
    () => ({
      religions: options(facets?.religions),
      faiths: options(facets?.faiths),
      cultures: options(facets?.cultures),
      traits: options(facets?.traits)
    }),
    [facets]
  )
  const n = activeCriteria(f)
  const yesNo = (v: boolean | undefined): 'yes' | 'no' | undefined =>
    v === undefined ? undefined : v ? 'yes' : 'no'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={revision === null}
          title={
            revision === null
              ? 'Needs the game index'
              : 'Filter by what the game knows of each character at a date: alive, age, faith, culture, rank …'
          }
        >
          <ListFilter />
          Facts
          {n > 0 && <Badge className="ml-0.5 h-4 min-w-4 px-1">{n}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-96"
        // The pickers' lists are Base UI popups portaled outside this one: a
        // click in them isn't a click away from the filters
        onInteractOutside={(e) => {
          if ((e.target as Element | null)?.closest?.('[data-slot=combobox-content]')) e.preventDefault()
        }}
      >
        <FieldGroup className="gap-2">
          <Field orientation="horizontal" className={ROW}>
            <FieldLabel htmlFor="facts-date" className="w-20 flex-none">
              Date
            </FieldLabel>
            <Input
              id="facts-date"
              className="h-7"
              placeholder={defaultDate ? `${defaultDate} (first bookmark)` : 'yyyy.mm.dd'}
              value={f.date ?? ''}
              onChange={(e) => set({ date: e.target.value.trim() || undefined })}
            />
          </Field>
          {bookmarks && bookmarks.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 pl-[5.5rem]">
              {bookmarks.slice(0, 8).map((d) => (
                <Button
                  key={d}
                  variant={(f.date ?? defaultDate) === d ? 'secondary' : 'ghost'}
                  size="xs"
                  title="A bookmark's start date"
                  onClick={() => set({ date: d === defaultDate ? undefined : d })}
                >
                  {d}
                </Button>
              ))}
            </div>
          )}
          <FieldDescription className="text-xs">
            Age, faith, rank and being alive are taken at this date (yyyy.mm.dd).
          </FieldDescription>
          <PickSelect
            label="Gender"
            value={f.gender}
            onChange={(gender) => set({ gender })}
            items={[
              ['male', 'Male'],
              ['female', 'Female']
            ]}
          />
          <Field orientation="horizontal" className={ROW}>
            <FieldLabel className="w-20 flex-none">Age</FieldLabel>
            <Select value={ageOp ?? ANY} onValueChange={(v) => setAge(v === ANY ? undefined : (v as typeof ageOp), ageText)}>
              <SelectTrigger size="sm" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                <SelectItem value="<">Under</SelectItem>
                <SelectItem value=">">Over</SelectItem>
                <SelectItem value="=">Exactly</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={0}
              max={120}
              className="h-7"
              disabled={!ageOp}
              value={ageText}
              onChange={(e) => setAge(ageOp, e.target.value)}
            />
          </Field>
          <PickSelect
            label="Alive"
            value={yesNo(f.alive)}
            onChange={(v) => set({ alive: v === undefined ? undefined : v === 'yes' })}
            items={[
              ['yes', 'Alive at the date'],
              ['no', 'Not alive then']
            ]}
          />
          {(
            [
              ['Religion', 'religion', lists.religions],
              ['Faith', 'faith', lists.faiths],
              ['Culture', 'culture', lists.cultures],
              ['Trait', 'trait', lists.traits]
            ] as const
          )
            // (no religions when the history can't tell a faith's religion — 1.20's faith_types)
            .filter(([, key, list]) => key !== 'religion' || !facets || list.length > 0)
            .map(([label, key, list]) => (
            <Field key={key} orientation="horizontal" className={ROW}>
              <FieldLabel className="w-20 flex-none">{label}</FieldLabel>
              <div className="min-w-0 flex-1">
                <ReferenceInput
                  value={f[key] ?? null}
                  onChange={(v) => set({ [key]: v ?? undefined })}
                  options={list}
                  placeholder={facets ? 'Any' : 'Loading…'}
                />
              </div>
            </Field>
          ))}
          <PickSelect
            label="Rank"
            value={f.rank}
            onChange={(rank) => set({ rank })}
            items={[
              ['ruler', 'Any ruler'],
              ['unlanded', 'Unlanded'],
              ['empire', 'Emperor / empress'],
              ['kingdom', 'King / queen'],
              ['duchy', 'Duke / duchess'],
              ['county', 'Count / countess'],
              ['barony', 'Baron / baroness']
            ]}
          />
          <Field orientation="horizontal" className={ROW}>
            <FieldLabel htmlFor="facts-dynasty" className="w-20 flex-none">
              Dynasty
            </FieldLabel>
            <Input
              id="facts-dynasty"
              className="h-7"
              placeholder="Name or key, of a dynasty or house"
              value={f.dynasty ?? ''}
              onChange={(e) => set({ dynasty: e.target.value || undefined })}
            />
          </Field>
          <PickSelect
            label="Looks"
            value={yesNo(f.dna)}
            onChange={(v) => set({ dna: v === undefined ? undefined : v === 'yes' })}
            items={[
              ['yes', 'Scripted DNA'],
              ['no', 'Generated']
            ]}
          />
          <Button
            variant="ghost"
            size="sm"
            className="self-end"
            disabled={n === 0 && !f.date}
            onClick={() => {
              setAgeOp(undefined)
              setAgeText('')
              onChange({})
            }}
          >
            Reset
          </Button>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  )
}
