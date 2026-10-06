import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  DnaEditorData,
  DnaGene,
  DnaGeneInfo,
  PortraitData,
  PortraitRequest
} from '@crusaderpope/shared/api'
import { api } from '@crusaderpope/renderer/src/api'
import { imgUrl } from '@crusaderpope/renderer/src/img'
import { useApp } from '../AppContext'
import { DEFAULT_LOOK, PortraitView } from './CharacterPortrait'
import Hint from './Hint'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

/** An accessory's file name as words: "male_hair_western_01" → "hair western 01" */
const accessoryLabel = (a: string): string =>
  a.replace(/^(male|female|boy|girl)_/, '').replace(/_/g, ' ')

/** A colour palette (gfx/portraits/*_palette.dds): click or drag to pick the point (0..255 each way) */
function Palette({
  src,
  xy,
  onPick
}: {
  src: string
  xy: [number, number] | undefined
  onPick: (xy: [number, number]) => void
}): React.JSX.Element {
  const el = useRef<HTMLDivElement>(null)
  const pick = (e: React.PointerEvent): void => {
    const r = el.current!.getBoundingClientRect()
    const f = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)))
    onPick([f((e.clientX - r.left) / r.width), f((e.clientY - r.top) / r.height)])
  }
  return (
    <div
      ref={el}
      className="relative size-32 shrink-0 cursor-crosshair overflow-hidden rounded-md border touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        pick(e)
      }}
      onPointerMove={(e) => e.buttons & 1 && pick(e)}
    >
      <img src={imgUrl(src, 256)} alt="" draggable={false} className="size-full" />
      {xy && (
        <span
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background ring-1 ring-foreground"
          style={{ left: `${(xy[0] / 255) * 100}%`, top: `${(xy[1] / 255) * 100}%` }}
        />
      )}
    </div>
  )
}

/** One gene: a palette for colours, the accessory list for accessory genes, a slider (and template) for morphs */
function GeneRow({
  info,
  gene,
  kind,
  worn,
  onChange
}: {
  info: DnaGeneInfo
  gene: DnaGene | undefined
  /** male, female, boy or girl */
  kind: string
  /** the template a portrait modifier makes the portrait wear this gene from */
  worn?: string
  onChange: (g: DnaGene) => void
}): React.JSX.Element {
  const first = info.templates.find((t) => t.visible) ?? info.templates[0]
  // The templates the ruler designer offers, and the one the DNA has even when hidden
  const offered = info.templates.filter((t) => t.visible || t.name === gene?.template)
  const template = gene?.template ?? first?.name
  const value = gene?.value ?? 127
  const base: DnaGene = gene ?? {
    gene: info.gene,
    template,
    value,
    template2: template,
    value2: value
  }
  const label = <Label className="w-32 shrink-0 text-xs font-normal">{info.label}</Label>

  if (info.kind === 'color') {
    return (
      <div className="flex items-start gap-3 py-1">
        {label}
        <Palette
          src={info.palette!}
          xy={gene?.xy}
          onPick={(xy) =>
            onChange({
              ...base,
              value: 0,
              template: undefined,
              template2: undefined,
              xy,
              xy2: gene?.xy2 ?? xy
            })
          }
        />
      </div>
    )
  }

  const templateSelect = offered.length > 1 && (
    <Select value={template} onValueChange={(t) => onChange({ ...base, template: t })}>
      <SelectTrigger size="sm" className="w-36" aria-label={`${info.label}: variant`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {offered.map((t) => (
          <SelectItem key={t.name} value={t.name}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  if (info.kind === 'accessory') {
    // A portrait modifier (culture, hair type) may wear it from another list: the DNA's value walks that one
    const from = worn && info.accessories?.[kind]?.[worn] ? worn : template
    const swapped = from !== template
    const list = (from && info.accessories?.[kind]?.[from]) || []
    const i = list.findIndex((x) => value >= x.from && value < x.to)
    const current = i < 0 ? list.length - 1 : i
    return (
      <div className="flex flex-wrap items-center gap-2 py-1">
        {label}
        {templateSelect}
        {list.length > 0 ? (
          <Select
            value={String(current)}
            onValueChange={(v) => {
              const x = list[Number(v)]
              // The lowest whole value inside its range (ranges narrower than 1 take their middle)
              const n =
                Math.ceil(x.from) < x.to ? Math.ceil(x.from) : Math.round((x.from + x.to) / 2)
              onChange({ ...base, value: Math.min(255, n) })
            }}
          >
            <SelectTrigger size="sm" className="w-48" aria-label={info.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {list.map((x, k) => (
                <SelectItem key={k} value={String(k)}>
                  {accessoryLabel(x.accessory)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">nothing for this portrait type</span>
        )}
        {swapped && (
          <span
            className="text-xs text-muted-foreground"
            title="A portrait modifier (culture, clothing, hair type) picks this list; the DNA's value chooses in it"
          >
            worn from {info.templates.find((t) => t.name === from)?.label ?? from}
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn('flex flex-wrap items-center gap-2 py-1', !gene && 'opacity-60')}
      title={gene ? undefined : 'Not in this DNA — the game uses the middle'}
    >
      {label}
      {templateSelect}
      <Slider
        className="w-40"
        min={0}
        max={255}
        value={[value]}
        aria-label={info.label}
        onValueChange={([v]) => onChange({ ...base, value: v })}
      />
      <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{value}</span>
    </div>
  )
}

/**
 * The Barbershop (CrusaderPope's): a character's DNA gene by gene, grouped as
 * the game's ruler designer groups them, with the portrait rebuilt as it
 * changes. Age and sex only change the preview — the DNA has neither. Save
 * writes the DNA into the selected mod as one undoable change.
 */
export default function Barbershop({
  id,
  onClose
}: {
  id: string
  onClose: () => void
}): React.JSX.Element {
  const { selectedMod } = useApp()
  const [data, setData] = useState<DnaEditorData | null | undefined>(undefined)
  const [genes, setGenes] = useState<DnaGene[]>([])
  const [female, setFemale] = useState(false)
  const [age, setAge] = useState(30)
  const [group, setGroup] = useState('')
  const [preview, setPreview] = useState<PortraitRequest | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Accessory gene → the template the portrait wears it from (a portrait modifier may swap in another list)
  const [worn, setWorn] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    void api.dnaEditor('characters', id).then(
      (d) => {
        setData(d)
        if (!d) return
        setGenes(d.genes)
        setFemale(d.female)
        setAge(d.age)
        setGroup(d.catalog[0]?.group ?? '')
      },
      (e: Error) => setError(e.message)
    )
  }, [id])

  // The portrait follows the sliders a moment later (each change rebuilds it in the worker)
  useEffect(() => {
    if (!data) return
    const t = setTimeout(() => setPreview({ genes, age, female }), 120)
    return () => clearTimeout(t)
  }, [data, genes, age, female])

  const groups = useMemo(() => {
    const out: { group: string; label: string; genes: DnaGeneInfo[] }[] = []
    for (const g of data?.catalog ?? []) {
      let e = out.find((x) => x.group === g.group)
      if (!e) out.push((e = { group: g.group, label: g.groupLabel, genes: [] }))
      e.genes.push(g)
    }
    return out
  }, [data])
  const byGene = useMemo(() => new Map(genes.map((g) => [g.gene, g])), [genes])
  const kind = age < 18 ? (female ? 'girl' : 'boy') : female ? 'female' : 'male'
  const set = (g: DnaGene): void =>
    setGenes((list) => {
      const i = list.findIndex((x) => x.gene === g.gene)
      return i < 0 ? [...list, g] : list.map((x, k) => (k === i ? g : x))
    })
  const shown = groups.find((g) => g.group === group) ?? groups[0]
  const t = data?.target

  const save = async (): Promise<void> => {
    if (!data) return
    setSaving(true)
    setError(null)
    try {
      const r = await api.saveDna({ target: data.target, genes })
      toast.success(`Changed the looks of ${data.target.character ?? data.target.name}`, {
        description: [`${r.rel}:${r.line}`, ...r.notes].join('\n')
      })
      // The DNA entry exists now: the next save changes it
      setData({ ...data, target: { ...data.target, create: false } })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[88vh] flex-col sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Barbershop{data ? ` — ${data.label}` : ''}</DialogTitle>
          <DialogDescription>
            {data ? `${data.source}. Age and sex only change the preview.` : 'Reading the DNA…'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex w-[42%] shrink-0 flex-col">
            {data && (
              <PortraitView
                type="characters"
                name={id}
                look={DEFAULT_LOOK}
                request={preview ?? { genes, age, female }}
                className="min-h-0 flex-1"
                onData={(d: PortraitData | null) =>
                  setWorn(
                    new Map(
                      (d?.accessories ?? [])
                        .filter((a) => a.template)
                        .map((a) => [a.gene, a.template!] as [string, string])
                    )
                  )
                }
              />
            )}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            {data === undefined && !error && <Spinner />}
            {data === null && (
              <p className="text-sm text-muted-foreground">This portrait has no DNA to change.</p>
            )}
            {data && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={female ? 'female' : 'male'}
                    onValueChange={(v) => v && setFemale(v === 'female')}
                  >
                    <ToggleGroupItem value="male">Male</ToggleGroupItem>
                    <ToggleGroupItem value="female">Female</ToggleGroupItem>
                  </ToggleGroup>
                  <Label className="text-xs font-normal">Age {age}</Label>
                  <Slider
                    className="w-40"
                    min={2}
                    max={90}
                    value={[age]}
                    onValueChange={([a]) => setAge(a)}
                  />
                </div>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  className="flex-wrap justify-start"
                  value={shown?.group ?? ''}
                  onValueChange={(g) => g && setGroup(g)}
                >
                  {groups.map((g) => (
                    <ToggleGroupItem key={g.group} value={g.group}>
                      {g.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {shown?.genes.map((info) => (
                    <GeneRow
                      key={info.gene}
                      info={info}
                      gene={byGene.get(info.gene)}
                      kind={kind}
                      worn={worn.get(info.gene)}
                      onChange={set}
                    />
                  ))}
                </div>
              </>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <Hint
            value={
              !selectedMod
                ? 'Select a mod to save into.'
                : t
                  ? t.create
                    ? `Saves a new DNA entry ${t.name} for character ${t.character} into ${selectedMod.name}.`
                    : `Saves ${t.type === 'dna_data' ? 'DNA' : 'bookmark portrait'} ${t.name} into ${selectedMod.name}.`
                  : ''
            }
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!data}
              title="Back to the DNA as it was loaded"
              onClick={() => data && setGenes(data.genes)}
            >
              Reset
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button disabled={!data || !selectedMod || saving} onClick={() => void save()}>
              {saving && <Spinner />}
              Save to mod
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
