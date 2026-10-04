import { ClipboardPaste, Plus, X } from 'lucide-react'
import type {
  CalendarConfig,
  CharacterDetail,
  CharacterRelation,
  CharacterSpouse,
  RefEntry,
  RefKind,
  ReferenceData
} from '@shared/types'
import { STAT_LABELS } from '../statLabels'
import { useFlatIcons, useSkillIcons, useTraitIcons } from '../useGameIcons'
import type { IconContext } from '../useGameIcons'
import CoatOfArms from './CoatOfArms'
import ReferenceInput from './ReferenceInput'
import ReferenceBadge from './ReferenceBadge'
import ReferenceLabel, { findRef } from './ReferenceLabel'
import Hint from './Hint'
import FormSection from './FormSection'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  formatCalendarDate,
  fromCalendarInput,
  isValidCK3Date,
  toCalendarInput
} from '@/lib/ck3Date'
import type { CalendarEra } from '@/lib/ck3Date'
import { cn } from '@/lib/utils'

/** The `sexuality =` values the game defines, in its own display order. */
const SEXUALITIES = ['heterosexual', 'homosexual', 'bisexual', 'asexual'] as const

/** Stands in for "no `sexuality =` line": Radix selects can't hold an empty value. */
const NO_SEXUALITY = 'none'

/** Every flat icon this form draws; constant so the batch fetch runs once. */
const FLAT_ICONS = ['male', 'female', ...SEXUALITIES]

/**
 * A game flat icon. These ship as black-on-transparent silhouettes, so draw
 * them as a mask over `currentColor` rather than as an image — that way they
 * follow the surrounding text color (theme, and a toggle's selected state)
 * instead of disappearing into the dark background.
 */
function FlatIcon({
  url,
  className
}: {
  url: string | null | undefined
  className?: string
}): React.JSX.Element {
  const mask = url ? `url(${url}) center / contain no-repeat` : undefined
  return (
    <span
      aria-hidden
      className={cn('inline-block size-4 shrink-0 bg-current', className)}
      // Hidden rather than dropped while loading (or with no game dir set) so
      // labels don't shift sideways once the icons arrive.
      style={mask ? { mask, WebkitMask: mask } : { visibility: 'hidden' }}
    />
  )
}

/** The uppercase micro-label used over every field in the editor panels. */
export function FieldLabel({
  children,
  required,
  htmlFor
}: {
  children: React.ReactNode
  /** Mark the field as mandatory with an asterisk */
  required?: boolean
  htmlFor?: string
}): React.JSX.Element {
  return (
    <Label htmlFor={htmlFor} className="text-xs tracking-wide text-muted-foreground uppercase">
      {children}
      {required && <span className="-ml-0.5 text-destructive">*</span>}
    </Label>
  )
}

/** Dropdown row for the trait picker; fetches its own icon (module-level cached) */
function TraitOption({
  trait,
  iconCtx
}: {
  trait: RefEntry
  iconCtx: IconContext
}): React.JSX.Element {
  const icon = useTraitIcons(iconCtx, [trait.id])(trait.id)
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {icon ? (
        <img className="size-6 shrink-0 object-contain" src={icon} alt="" />
      ) : (
        <span className="inline-block size-6 shrink-0" />
      )}
      <ReferenceLabel entry={trait} />
    </span>
  )
}

/**
 * Whether a marriage row can't be written yet: no spouse chosen, neither date
 * set, or a date that isn't a real Y.M.D. A row parsed from a file with only a
 * divorce (a lone `remove_spouse`) is left alone rather than forced to grow a
 * marriage date it never had.
 */
export function spouseRowInvalid(spouse: CharacterSpouse): boolean {
  const badDate = (d: string | null): boolean => !!d && !isValidCK3Date(d)
  return (
    !spouse.id.trim() ||
    (!spouse.marriage && !spouse.divorce) ||
    badDate(spouse.marriage) ||
    badDate(spouse.divorce)
  )
}

/** True when any marriage row would be rejected by a save. */
export function spousesInvalid(spouses: CharacterSpouse[] | undefined): boolean {
  return (spouses ?? []).some(spouseRowInvalid)
}

/**
 * Whether a relationship row can't be written yet: no type picked, no target
 * character, or a date that isn't a real Y.M.D.
 */
export function relationRowInvalid(relation: CharacterRelation): boolean {
  return !relation.type.trim() || !relation.target.trim() || !isValidCK3Date(relation.date)
}

/** True when any relationship row would be rejected by a save. */
export function relationsInvalid(relations: CharacterRelation[] | undefined): boolean {
  return (relations ?? []).some(relationRowInvalid)
}

interface Props {
  draft: CharacterDetail
  set: (patch: Partial<CharacterDetail>) => void
  modPath: string
  gameDir: string | null
  replacePaths: string[]
  /** The mod's offset-calendar display convention, if it declares one */
  calendar: CalendarConfig | null
  /** Show file years instead of the mod calendar's era years in the date inputs */
  showRawDates?: boolean
  refData: ReferenceData | null
  /** Every character in the mod, offered as father/mother options */
  characters: RefEntry[]
  /** Switch the editor to another character in the mod (father/mother jump) */
  onNavigate: (id: string) => void
  /** Open a lineage row in the Dynasty & House Editor */
  onOpenLineage: (kind: 'dynasty' | 'house', id: string) => void
  /** Open a culture in the Culture Editor */
  onOpenCulture: (id: string) => void
  /** Open a faith in the Faith Editor */
  onOpenFaith: (id: string) => void
  onOpenRite: (id: string) => void
  badBirth: boolean
  badDeath: boolean
  /** Mark the game-mandatory fields with an asterisk (create mode) */
  markRequired?: boolean
  /** Rendered at the top of the identity fieldset (ID display/input, file picker) */
  identitySlot?: React.ReactNode
  /** Rendered at the end of Family (the edit panel's children list) */
  childrenSlot?: React.ReactNode
  /**
   * Open the "Paste from Ruler Designer" dialog. Only the edit panel provides
   * it — the paste rewires files for a character that already exists on disk.
   */
  onPasteDna?: () => void
}

/**
 * The editable character fields, shared between the detail (edit) panel and
 * the create panel. What differs between the two — how the identity (ID/file)
 * is presented, and the derived children list — comes in through slots.
 */
export default function CharacterForm({
  draft,
  set,
  modPath,
  gameDir,
  replacePaths,
  calendar,
  showRawDates = false,
  refData,
  characters,
  onNavigate,
  onOpenLineage,
  onOpenCulture,
  onOpenFaith,
  onOpenRite,
  badBirth,
  badDeath,
  markRequired = false,
  identitySlot,
  childrenSlot,
  onPasteDna
}: Props): React.JSX.Element {
  const iconCtx: IconContext = { gameDir, modPath, replacePaths }
  const iconFor = useTraitIcons(iconCtx, draft.traits)
  const flatIconFor = useFlatIcons(iconCtx, FLAT_ICONS)
  const skillIconFor = useSkillIcons(
    iconCtx,
    STAT_LABELS.map(([key]) => key)
  )

  const addTrait = (value: string): void => {
    const t = value.trim()
    if (t && !draft.traits.includes(t)) {
      set({ traits: [...draft.traits, t] })
    }
  }

  const textField = (
    label: string,
    value: string | null,
    onChange: (v: string | null) => void,
    opts: {
      invalid?: boolean
      placeholder?: string
      hint?: React.ReactNode
      required?: boolean
    } = {}
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <FieldLabel required={opts.required}>{label}</FieldLabel>
      <Input
        type="text"
        value={value ?? ''}
        placeholder={opts.placeholder}
        aria-invalid={opts.invalid || undefined}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
      {opts.hint}
    </div>
  )

  /**
   * Birth/death input. With a mod calendar in era mode, the input edits the
   * era-relative year ("780.1.1" plus a BC/AD select) while the draft keeps
   * storing the raw file date — both directions are pure conversions, so the
   * dirty/persist/validation machinery works on raw values as before.
   */
  const dateField = (
    label: string,
    value: string | null,
    onChange: (v: string | null) => void,
    opts: { invalid?: boolean; placeholder?: string; required?: boolean }
  ): React.JSX.Element => {
    if (!calendar || showRawDates) {
      const display = formatCalendarDate(value, calendar)
      return textField(label, value, onChange, {
        ...opts,
        hint: display !== null && <Hint label="Display" value={display} truncate />
      })
    }
    const converted = value === null ? null : toCalendarInput(value, calendar)
    const era: CalendarEra = converted?.era ?? 'before'
    const change = (text: string, nextEra: CalendarEra): void => {
      if (text === '') {
        onChange(null)
        return
      }
      // A misread edit (no year, or one outside the raw 0–9999 range) is
      // dropped rather than stored as something it doesn't mean.
      const raw = fromCalendarInput(text, nextEra, calendar)
      if (raw !== null) onChange(raw)
    }
    return (
      <div className="space-y-1.5">
        <FieldLabel required={opts.required}>{label}</FieldLabel>
        <div className="flex gap-1.5">
          <Input
            type="text"
            className="min-w-0 flex-1"
            value={converted?.text ?? value ?? ''}
            placeholder={opts.placeholder}
            aria-invalid={opts.invalid || undefined}
            onChange={(e) => change(e.target.value, era)}
          />
          <Select
            value={era}
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
        {value !== null && <Hint label="Raw" value={value} truncate />}
      </div>
    )
  }

  const refField = (
    label: string,
    kind: RefKind,
    value: string | null,
    onChange: (v: string | null) => void,
    options: RefEntry[],
    required?: boolean
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <FieldLabel required={required}>{label}</FieldLabel>
      <ReferenceInput
        value={value}
        onChange={onChange}
        options={options}
        placeholder="none"
        locate={(v) => window.ck3tools.locateRef(gameDir, modPath, replacePaths, kind, v)}
      />
    </div>
  )

  /**
   * Dynasty and house are managed data, so they open in the Dynasty & House
   * Editor rather than a text editor. They are separate keys in the file:
   * a house implies its parent dynasty, so a character usually sets one or
   * the other, but nothing stops a file from carrying both.
   */
  const lineageField = (
    label: string,
    kind: 'dynasty' | 'house',
    value: string | null,
    onChange: (v: string | null) => void,
    options: RefEntry[]
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <ReferenceInput
        value={value}
        onChange={onChange}
        options={options}
        placeholder="none"
        onNavigate={(v) => onOpenLineage(kind, v)}
        followTitle="Open in Dynasty & House Editor"
      />
    </div>
  )

  /** Faith is managed data too, and opens in the Faith Editor. */
  /**
   * Culture and faith are managed data: their follow button switches to the
   * editor that owns them rather than opening the definition file.
   */
  const managedField = (
    label: 'Culture' | 'Faith' | 'Rite',
    value: string | null,
    onChange: (v: string | null) => void,
    options: RefEntry[],
    onNavigate: (id: string) => void
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <FieldLabel
        required={
          markRequired &&
          (label === 'Culture' ||
            (label === 'Faith' && !draft.rite) ||
            (label === 'Rite' && !draft.faith))
        }
      >
        {label}
      </FieldLabel>
      <ReferenceInput
        value={value}
        onChange={onChange}
        options={options}
        placeholder="none"
        onNavigate={onNavigate}
        followTitle={`Open in ${label} Editor`}
      />
    </div>
  )

  /** Parent fields reference other characters in the mod, so they jump in-app. */
  const parentField = (
    label: string,
    value: string | null,
    onChange: (v: string | null) => void
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <ReferenceInput
        value={value}
        onChange={onChange}
        options={characters}
        placeholder="none"
        onNavigate={onNavigate}
      />
    </div>
  )

  /**
   * Marriages are dated effects rather than fields, so each row edits one
   * `add_spouse` / `remove_spouse` pair (`add_concubine` / `remove_concubine`
   * for concubine rows): who, when it started, and when (if ever) it ended.
   * Rows keep file order; `matrilineal` picks the other
   * add_ effect and is kept so a file that uses it round-trips.
   */
  const spouses = draft.spouses ?? []
  const setSpouse = (index: number, patch: Partial<CharacterSpouse>): void =>
    set({ spouses: spouses.map((s, i) => (i === index ? { ...s, ...patch } : s)) })

  const spousesField = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Spouses & concubines · {spouses.length}</FieldLabel>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            set({
              spouses: [
                ...spouses,
                { id: '', marriage: null, divorce: null, matrilineal: false, concubine: false }
              ]
            })
          }
        >
          <Plus />
          Add spouse
        </Button>
      </div>
      {spouses.length === 0 ? (
        <p className="text-sm text-muted-foreground">none</p>
      ) : (
        spouses.map((spouse, index) => (
          <div key={index} className="space-y-2.5 rounded-md border p-2.5">
            {/*
              Narrow: the remove button stays on the input's row and matrilineal
              wraps below it. Wide: all three sit on one row, remove last.
            */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2.5 @sm:grid-cols-[minmax(0,1fr)_auto_auto] @sm:gap-x-4">
              <ReferenceInput
                className="col-start-1 row-start-1 min-w-0"
                value={spouse.id === '' ? null : spouse.id}
                onChange={(v) => setSpouse(index, { id: v ?? '' })}
                options={characters}
                placeholder="character"
                onNavigate={onNavigate}
              />
              <div className="col-start-1 row-start-2 flex items-center gap-4 @sm:col-start-2 @sm:row-start-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`spouse-matrilineal-${index}`}
                    checked={spouse.matrilineal}
                    disabled={spouse.concubine}
                    onCheckedChange={(checked) =>
                      setSpouse(index, { matrilineal: checked === true })
                    }
                  />
                  <FieldLabel htmlFor={`spouse-matrilineal-${index}`}>Matrilineal</FieldLabel>
                </div>
                {/* Concubinage has no matrilineal variant, so the two exclude each other */}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`spouse-concubine-${index}`}
                    checked={spouse.concubine}
                    onCheckedChange={(checked) =>
                      setSpouse(
                        index,
                        checked === true
                          ? { concubine: true, matrilineal: false }
                          : { concubine: false }
                      )
                    }
                  />
                  <FieldLabel htmlFor={`spouse-concubine-${index}`}>Concubine</FieldLabel>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="col-start-2 row-start-1 text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20 @sm:col-start-3"
                title="Remove this union"
                onClick={() => set({ spouses: spouses.filter((_, i) => i !== index) })}
              >
                <X />
              </Button>
            </div>
            <div className="flex flex-col gap-2.5 @sm:flex-row @sm:gap-2.5 @sm:*:flex-1">
              {dateField(
                spouse.concubine ? 'Since' : 'Married',
                spouse.marriage,
                (v) => setSpouse(index, { marriage: v }),
                {
                  invalid: spouse.marriage
                    ? !isValidCK3Date(spouse.marriage)
                    : !spouse.divorce,
                  placeholder: 'Y.M.D'
                }
              )}
              {dateField(
                spouse.concubine ? 'Until' : 'Divorced',
                spouse.divorce,
                (v) => setSpouse(index, { divorce: v }),
                {
                  invalid: !!spouse.divorce && !isValidCK3Date(spouse.divorce),
                  placeholder: 'never'
                }
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )

  /**
   * Scripted relations (lover, rival, friend, …) are dated `set_relation_*`
   * effects; each row edits one: the type, who, when, and (optionally) the
   * scripted reason. Rows keep file order; `extra` (unrecognized inner lines
   * of a block-form statement) is carried invisibly so nothing is lost.
   */
  const relations = draft.relations ?? []
  const setRelation = (index: number, patch: Partial<CharacterRelation>): void =>
    set({ relations: relations.map((r, i) => (i === index ? { ...r, ...patch } : r)) })

  const relationsField = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Relationships · {relations.length}</FieldLabel>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            set({
              relations: [
                ...relations,
                { type: '', target: '', prefixed: true, date: '', reason: null, extra: null }
              ]
            })
          }
        >
          <Plus />
          Add relationship
        </Button>
      </div>
      {relations.length === 0 ? (
        <p className="text-sm text-muted-foreground">none</p>
      ) : (
        relations.map((relation, index) => (
          <div key={index} className="space-y-2.5 rounded-md border p-2.5">
            {/*
              Narrow: the remove button stays on the type's row and the target
              wraps below it. Wide: all three sit on one row, remove last.
            */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2.5 @sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] @sm:gap-x-2.5">
              <ReferenceInput
                className="col-start-1 row-start-1 min-w-0"
                value={relation.type === '' ? null : relation.type}
                onChange={(v) => setRelation(index, { type: v ?? '' })}
                options={refData?.relationTypes ?? []}
                placeholder="relation"
                renderItem={(t) => <span>{t.id.replace(/_/g, ' ')}</span>}
              />
              <ReferenceInput
                className="col-start-1 row-start-2 min-w-0 @sm:col-start-2 @sm:row-start-1"
                value={relation.target === '' ? null : relation.target}
                // A user-picked target is always written as character:<id>;
                // only untouched rows keep a bare token the file used
                onChange={(v) => setRelation(index, { target: v ?? '', prefixed: true })}
                options={characters}
                placeholder="character"
                onNavigate={onNavigate}
              />
              <Button
                variant="ghost"
                size="icon"
                className="col-start-2 row-start-1 text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20 @sm:col-start-3"
                title="Remove this relationship"
                onClick={() => set({ relations: relations.filter((_, i) => i !== index) })}
              >
                <X />
              </Button>
            </div>
            <div className="flex flex-col gap-2.5 @sm:flex-row @sm:gap-2.5 @sm:*:flex-1">
              {dateField('Date', relation.date || null, (v) => setRelation(index, { date: v ?? '' }), {
                invalid: !isValidCK3Date(relation.date),
                placeholder: 'Y.M.D'
              })}
              {textField('Reason', relation.reason, (v) => setRelation(index, { reason: v }), {
                placeholder: 'none'
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )

  return (
    <>
      <FieldSet className="gap-3.5">
        {identitySlot}
        {textField('Name', draft.name, (v) => set({ name: v }), { required: markRequired })}
        <div className="flex items-end gap-4">
          <div className="space-y-1.5">
            <FieldLabel>Gender</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={/^yes$/i.test(draft.female ?? '') ? 'female' : 'male'}
              onValueChange={(v) => v && set({ female: v === 'female' ? 'yes' : null })}
              aria-label="Gender"
            >
              <ToggleGroupItem value="male">
                <FlatIcon url={flatIconFor('male')} className="size-3.5" />
                Male
              </ToggleGroupItem>
              <ToggleGroupItem value="female">
                <FlatIcon url={flatIconFor('female')} className="size-3.5" />
                Female
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <FieldLabel htmlFor="character-sexuality">Sexuality</FieldLabel>
            {/* Icons live inside the items, so the trigger shows the chosen one too */}
            <Select
              value={draft.sexuality ?? NO_SEXUALITY}
              onValueChange={(v) => set({ sexuality: v === NO_SEXUALITY ? null : v })}
            >
              <SelectTrigger id="character-sexuality" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SEXUALITY}>
                  <FlatIcon url={null} className="size-3.5" />
                  Unset
                </SelectItem>
                {SEXUALITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    <FlatIcon url={flatIconFor(s)} className="size-3.5" />
                    <span className="capitalize">{s}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </FieldSet>

      <FormSection title="Life & lineage">
        <div className="flex flex-col gap-3.5 @sm:flex-row @sm:gap-2.5 @sm:*:flex-1">
          {dateField('Birth', draft.birth, (v) => set({ birth: v }), {
            invalid: badBirth,
            placeholder: 'Y.M.D',
            required: markRequired
          })}
          {dateField('Death', draft.death, (v) => set({ death: v }), {
            invalid: badDeath,
            placeholder: 'alive'
          })}
        </div>
        <div className="flex items-start gap-4">
          {/* The house's CoA when it has one, else the dynasty's */}
          <CoatOfArms ids={[draft.house, draft.dynasty]} size={112} className="shrink-0" />
          <div className="min-w-0 flex-1 space-y-3.5">
            {lineageField(
              'Dynasty',
              'dynasty',
              draft.dynasty,
              (v) => set({ dynasty: v }),
              refData?.dynasties ?? []
            )}
            {lineageField(
              'House',
              'house',
              draft.house,
              (v) => set({ house: v }),
              refData?.houses ?? []
            )}
          </div>
        </div>
      </FormSection>

      <FormSection title="Family">
        <div className="flex flex-col gap-3.5 @sm:flex-row @sm:gap-2.5 @sm:*:flex-1">
          {parentField('Father', draft.father, (v) => set({ father: v }))}
          {parentField('Mother', draft.mother, (v) => set({ mother: v }))}
        </div>
        {spousesField}
        {relationsField}
        {childrenSlot}
      </FormSection>

      <FormSection title="Culture & traits">
        {managedField(
          'Culture',
          draft.culture,
          (v) => set({ culture: v }),
          refData?.cultures ?? [],
          onOpenCulture
        )}
        {managedField(
          'Faith',
          draft.faith,
          (v) => set({ faith: v }),
          refData?.faiths ?? [],
          onOpenFaith
        )}
        {((refData?.rites?.length ?? 0) > 0 || draft.rite) &&
          managedField(
            'Rite',
            draft.rite ?? null,
            (v) => set({ rite: v }),
            refData?.rites ?? [],
            onOpenRite
          )}
        {(refData?.rites?.length ?? 0) > 0 && (
          <p className="text-xs text-muted-foreground">
            Set a rite for CK3 1.20. A faith alone selects its main rite.
          </p>
        )}
        <div className="space-y-1.5">
          <FieldLabel>Traits</FieldLabel>
          <div className="flex min-h-6 flex-wrap gap-1.5">
            {draft.traits.map((t) => (
              <ReferenceBadge
                key={t}
                entry={findRef(refData?.traits ?? [], t)}
                icon={iconFor(t)}
                locate={() => window.ck3tools.locateRef(gameDir, modPath, replacePaths, 'trait', t)}
                onRemove={() => set({ traits: draft.traits.filter((x) => x !== t) })}
              />
            ))}
            {draft.traits.length === 0 && (
              <span className="text-sm text-muted-foreground">none</span>
            )}
          </div>
          <ReferenceInput
            options={(refData?.traits ?? []).filter((t) => !draft.traits.includes(t.id))}
            placeholder="Add trait…"
            onAdd={addTrait}
            renderItem={(t) => <TraitOption trait={t} iconCtx={iconCtx} />}
            limit={40}
          />
        </div>

        <div className="space-y-1.5">
          <FieldLabel>Stats</FieldLabel>
          <div className="grid grid-cols-3 gap-2">
            {STAT_LABELS.map(([key, label]) => (
              <label key={key} className="space-y-1 text-[11px] text-muted-foreground">
                <span className="block">{label}</span>
                <span className="flex items-center gap-1.5">
                  <img
                    src={skillIconFor(key) ?? undefined}
                    alt=""
                    aria-hidden
                    className="size-6 shrink-0"
                  />
                  <Input
                    type="number"
                    className="min-w-0 flex-1"
                    value={draft.stats[key] ?? ''}
                    placeholder="—"
                    onChange={(e) =>
                      set({
                        stats: {
                          ...draft.stats,
                          [key]: e.target.value === '' ? null : Number(e.target.value)
                        }
                      })
                    }
                  />
                </span>
              </label>
            ))}
          </div>
        </div>
      </FormSection>

      <FormSection title="Appearance">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <FieldLabel>DNA</FieldLabel>
            {onPasteDna && (
              <Button
                variant="outline"
                size="sm"
                title="Convert a Ruler Designer DNA export into this character's scripted appearance"
                onClick={onPasteDna}
              >
                <ClipboardPaste />
                Paste from Ruler Designer
              </Button>
            )}
          </div>
          <ReferenceInput
            value={draft.dna}
            onChange={(v) => set({ dna: v })}
            options={refData?.dnas ?? []}
            placeholder="none"
            locate={(v) => window.ck3tools.locateRef(gameDir, modPath, replacePaths, 'dna', v)}
          />
        </div>
      </FormSection>
    </>
  )
}
