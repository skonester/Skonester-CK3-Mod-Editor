import { Fragment } from 'react'
import { Plus, X } from 'lucide-react'
import type {
  CalendarConfig,
  CultureData,
  CultureEthnicity,
  CulturePatch,
  CulturePillarType,
  RefEntry,
  RefKind
} from '@shared/types'
import { FieldLabel } from './CharacterForm'
import ReferenceBadge from './ReferenceBadge'
import ReferenceInput from './ReferenceInput'
import ReferenceLabel, { findRef } from './ReferenceLabel'
import Hint from './Hint'
import FormSection from './FormSection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { formatCalendarDate, fromCalendarInput, isValidCK3Date, toCalendarInput } from '@/lib/ck3Date'
import type { CalendarEra } from '@/lib/ck3Date'
import { isRequired, normId } from '@/lib/cultureView'

/** The pillar fields, in the order a culture file writes them. */
const PILLARS: { key: keyof CulturePatch; type: CulturePillarType; label: string }[] = [
  { key: 'ethos', type: 'ethos', label: 'Ethos' },
  { key: 'heritage', type: 'heritage', label: 'Heritage' },
  { key: 'language', type: 'language', label: 'Language' },
  { key: 'martialCustom', type: 'martial_custom', label: 'Martial custom' },
  { key: 'headDetermination', type: 'head_determination', label: 'Head determination' }
]

/** The four graphics-bundle lists, and which pool of ids each offers. */
const GFX: { key: keyof CulturePatch; pool: 'coa' | 'building' | 'clothing' | 'unit'; label: string }[] =
  [
    { key: 'coaGfx', pool: 'coa', label: 'Coat of arms' },
    { key: 'buildingGfx', pool: 'building', label: 'Buildings' },
    { key: 'clothingGfx', pool: 'clothing', label: 'Clothing' },
    { key: 'unitGfx', pool: 'unit', label: 'Units' }
  ]

/** A culture with no `created` exists from the start of the game. */
const CREATED_PLACEHOLDER = 'never — exists from the start'

interface Props {
  draft: CulturePatch
  set: (patch: Partial<CulturePatch>) => void
  data: CultureData
  modPath: string
  gameDir: string | null
  replacePaths: string[]
  calendar: CalendarConfig | null
  /** Show file years instead of the mod calendar's era years in the date field */
  showRawDates?: boolean
  /** False for a base-game culture, which the app can show but not write */
  editable?: boolean
  /** Asterisk the fields a playable culture must set (the create panel) */
  markRequired?: boolean
  /** Switch the editor to another culture (a parent badge's follow button) */
  onOpenCulture: (id: string) => void
  /** Opens the Identity fieldset: the read-only ID, or the create panel's pickers */
  identitySlot?: React.ReactNode
  /** Extra note rendered under a given field, by the draft key it belongs to */
  notes?: Partial<Record<keyof CulturePatch, React.ReactNode>>
}

/**
 * Every editable field of a culture definition, shared by the detail and create
 * panels the way CharacterForm is shared by the character ones. It owns no
 * state: the panel holds the draft and decides what saving or creating means.
 */
export default function CultureForm({
  draft,
  set,
  data,
  modPath,
  gameDir,
  replacePaths,
  calendar,
  showRawDates = false,
  editable = true,
  markRequired = false,
  onOpenCulture,
  identitySlot,
  notes
}: Props): React.JSX.Element {
  const locate = (kind: RefKind) => (v: string) =>
    window.ck3tools.locateRef(gameDir, modPath, replacePaths, kind, v)

  const cultureOptions: RefEntry[] = data.cultures.map((c) => ({
    id: c.id,
    name: c.localizedName
  }))

  const required = (key: keyof CulturePatch): boolean => markRequired && isRequired(key)

  /** A single-value reference field backed by a picker. */
  const refField = (
    key: keyof CulturePatch,
    label: string,
    kind: RefKind,
    value: string | null,
    onChange: (v: string | null) => void,
    options: readonly RefEntry[]
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <FieldLabel required={required(key)}>{label}</FieldLabel>
      <ReferenceInput
        value={value}
        onChange={onChange}
        options={options}
        placeholder="none"
        locate={locate(kind)}
        disabled={!editable}
      />
      {notes?.[key]}
    </div>
  )

  /**
   * A repeating list of references: badges for what's set, a picker to add.
   * `navigate` points the badge back into this editor (parent cultures);
   * `kind` points it at a definition file. With neither — graphics bundles,
   * which are declared in no folder we can enumerate — the badge is inert.
   */
  const listField = (
    key: keyof CulturePatch,
    label: string,
    values: string[],
    onChange: (v: string[]) => void,
    options: readonly RefEntry[],
    opts: {
      kind?: RefKind
      navigate?: boolean
      renderItem?: (e: RefEntry) => React.ReactNode
    } = {}
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <FieldLabel required={required(key)}>
        {label}
        {values.length > 0 && <span className="ml-1 normal-case">· {values.length}</span>}
      </FieldLabel>
      <div className="flex min-h-6 flex-wrap gap-1.5">
        {values.map((v) => (
          <ReferenceBadge
            key={v}
            entry={findRef(options, v)}
            onNavigate={opts.navigate ? () => onOpenCulture(v) : undefined}
            locate={
              opts.navigate || opts.kind === undefined ? undefined : () => locate(opts.kind!)(v)
            }
            onRemove={editable ? () => onChange(values.filter((x) => x !== v)) : undefined}
          />
        ))}
        {values.length === 0 && <span className="text-sm text-muted-foreground">none</span>}
      </div>
      {editable && (
        <ReferenceInput
          options={options.filter((o) => !values.some((v) => normId(v) === normId(o.id)))}
          placeholder={`Add ${label.toLowerCase()}…`}
          onAdd={(v) => onChange([...values, v])}
          renderItem={opts.renderItem}
        />
      )}
      {notes?.[key]}
    </div>
  )

  /** Traditions carry a category, worth showing in the dropdown to tell them apart. */
  const traditionItem = (t: RefEntry): React.ReactNode => {
    const category = data.traditions.find((x) => x.id === t.id)?.category
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <ReferenceLabel entry={t} />
        {category && (
          <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
            {category}
          </Badge>
        )}
      </span>
    )
  }

  /**
   * The `created =` date — the year the culture comes into existence, absent on
   * cultures that exist from the start. Edited the same way the character
   * editor edits dates: raw file value, or the mod calendar's era-relative form
   * with an era picker beside it.
   */
  const createdField = (): React.JSX.Element => {
    const value = draft.created
    const invalid = value !== null && value !== '' && !isValidCK3Date(value)

    if (!calendar || showRawDates) {
      const display = formatCalendarDate(value, calendar)
      return (
        <div className="space-y-1.5">
          <FieldLabel>Created</FieldLabel>
          <Input
            type="text"
            value={value ?? ''}
            placeholder={CREATED_PLACEHOLDER}
            disabled={!editable}
            aria-invalid={invalid || undefined}
            onChange={(e) => set({ created: e.target.value === '' ? null : e.target.value })}
          />
          {display !== null && <Hint label="Display" value={display} />}
          {notes?.created}
        </div>
      )
    }

    const converted = value === null ? null : toCalendarInput(value, calendar)
    const era: CalendarEra = converted?.era ?? 'before'
    const change = (text: string, nextEra: CalendarEra): void => {
      if (text === '') {
        set({ created: null })
        return
      }
      // A misread edit (no year, or one outside the raw 0–9999 range) is
      // dropped rather than stored as something it doesn't mean.
      const raw = fromCalendarInput(text, nextEra, calendar)
      if (raw !== null) set({ created: raw })
    }
    return (
      <div className="space-y-1.5">
        <FieldLabel>Created</FieldLabel>
        <div className="flex gap-1.5">
          <Input
            type="text"
            className="min-w-0 flex-1"
            value={converted?.text ?? value ?? ''}
            placeholder={CREATED_PLACEHOLDER}
            disabled={!editable}
            aria-invalid={invalid || undefined}
            onChange={(e) => change(e.target.value, era)}
          />
          <Select
            value={era}
            disabled={!editable}
            onValueChange={(v) => converted && change(converted.text, v as CalendarEra)}
          >
            <SelectTrigger aria-label="Era" className="shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="before">{calendar.beforeLabel}</SelectItem>
              <SelectItem value="after">{calendar.afterLabel}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {value !== null && <Hint label="Raw" value={value} />}
        {notes?.created}
      </div>
    )
  }

  /** Weighted ethnicity rows: `<weight> = <ethnicity>` in the file. */
  const ethnicitiesField = (): React.JSX.Element => {
    const rows = draft.ethnicities
    const setRow = (index: number, patch: Partial<CultureEthnicity>): void =>
      set({ ethnicities: rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) })
    const total = rows.reduce((sum, r) => sum + (Number(r.weight) || 0), 0)
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel required={required('ethnicities')}>Ethnicities</FieldLabel>
          {editable && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => set({ ethnicities: [...rows, { weight: '10', id: '' }] })}
            >
              <Plus />
              Add
            </Button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">none</p>
        ) : (
          rows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                className="w-16 shrink-0 text-right font-mono"
                type="text"
                inputMode="numeric"
                value={row.weight}
                disabled={!editable}
                aria-invalid={!/^\d+(\.\d+)?$/.test(row.weight)}
                title="Relative weight"
                onChange={(e) => setRow(index, { weight: e.target.value })}
              />
              <ReferenceInput
                className="min-w-0 flex-1"
                value={row.id === '' ? null : row.id}
                onChange={(v) => setRow(index, { id: v ?? '' })}
                options={data.ethnicities}
                placeholder="ethnicity"
                locate={locate('ethnicity')}
                disabled={!editable}
              />
              {editable && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Remove"
                  onClick={() => set({ ethnicities: rows.filter((_, i) => i !== index) })}
                >
                  <X />
                </Button>
              )}
            </div>
          ))
        )}
        {rows.length > 1 && total > 0 && (
          <Hint
            label="Share"
            value={rows
              .map((r) => `${Math.round(((Number(r.weight) || 0) / total) * 100)}% ${r.id || '?'}`)
              .join(' · ')}
          />
        )}
        {notes?.ethnicities}
      </div>
    )
  }

  /**
   * Swatch plus hex field. Editing a culture keeps whatever spelling its file
   * already used; a brand-new one is written as an `rgb` triple.
   */
  const colorField = (): React.JSX.Element => {
    const hex = draft.color
    const valid = hex !== null && /^#[0-9a-f]{6}$/i.test(hex)
    return (
      <div className="space-y-1.5">
        <FieldLabel required={required('color')}>Colour</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            type="color"
            className="h-7 w-12 shrink-0 cursor-pointer p-0.5"
            value={valid ? hex : '#000000'}
            disabled={!editable}
            aria-label="Culture colour"
            onChange={(e) => set({ color: e.target.value })}
          />
          <Input
            type="text"
            className="flex-1 font-mono"
            value={hex ?? ''}
            placeholder="none"
            disabled={!editable}
            aria-invalid={hex !== null && hex !== '' && !valid}
            onChange={(e) => set({ color: e.target.value === '' ? null : e.target.value })}
          />
        </div>
        {notes?.color}
      </div>
    )
  }

  return (
    <>
      <FormSection title="Identity">
        {identitySlot}
        {colorField()}
        {createdField()}
      </FormSection>

      <FormSection title="Pillars">
        {PILLARS.map((p) => (
          <Fragment key={p.key}>
            {refField(
              p.key,
              p.label,
              'pillar',
              draft[p.key] as string | null,
              (v) => set({ [p.key]: v } as Partial<CulturePatch>),
              data.pillars[p.type]
            )}
          </Fragment>
        ))}
      </FormSection>

      <FormSection title="Traditions & lineage">
        {listField(
          'traditions',
          'Traditions',
          draft.traditions,
          (v) => set({ traditions: v }),
          data.traditions,
          { kind: 'tradition', renderItem: traditionItem }
        )}
        {listField('parents', 'Parents', draft.parents, (v) => set({ parents: v }), cultureOptions, {
          navigate: true
        })}
        {refField(
          'nameList',
          'Name list',
          'name_list',
          draft.nameList,
          (v) => set({ nameList: v }),
          data.nameLists
        )}
      </FormSection>

      <FormSection title="Graphics">
        {GFX.map((g) => (
          <Fragment key={g.key}>
            {listField(
              g.key,
              g.label,
              draft[g.key] as string[],
              (v) => set({ [g.key]: v } as Partial<CulturePatch>),
              data.gfx[g.pool].map((v) => ({ id: v, name: null }))
            )}
          </Fragment>
        ))}
        <div className="space-y-1.5">
          <FieldLabel>House CoA frame</FieldLabel>
          <ReferenceInput
            value={draft.houseCoaFrame}
            onChange={(v) => set({ houseCoaFrame: v })}
            options={data.gfx.houseCoaFrame.map((v) => ({ id: v, name: null }))}
            placeholder="none"
            disabled={!editable}
          />
          {notes?.houseCoaFrame}
        </div>
        {ethnicitiesField()}
      </FormSection>
    </>
  )
}
