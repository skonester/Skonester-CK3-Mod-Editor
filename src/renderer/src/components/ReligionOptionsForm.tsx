import { useEffect, useState } from 'react'
import type {
  FaithOptions,
  RefEntry,
  ReligionData,
  ReligionOptions,
  RiteOptions
} from '@shared/types'
import { validateScriptFragment } from '@shared/scriptValidation'
import FormSection from './FormSection'
import ReferenceBadge from './ReferenceBadge'
import ReferenceInput from './ReferenceInput'
import { findRef } from './ReferenceLabel'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

interface Context {
  data: ReligionData
  gameDir: string | null
  modPath: string
  replacePaths: string[]
  disabled: boolean
}
interface Field {
  key: string
  label: string
  kind?: 'flag' | 'number' | 'list' | 'script'
  options?: RefEntry[]
  disabled?: boolean
  hint?: string
}
type Values = Record<string, string | null | string[] | undefined>

function useOptionsReferences(ctx: Context): {
  cultures: RefEntry[]
  governments: RefEntry[]
  titles: RefEntry[]
} {
  const [refs, setRefs] = useState({
    cultures: [] as RefEntry[],
    governments: [] as RefEntry[],
    titles: [] as RefEntry[]
  })
  useEffect(() => {
    let active = true
    setRefs({ cultures: [], governments: [], titles: [] })
    void Promise.all([
      window.ck3tools.getReferenceData(ctx.gameDir, ctx.modPath, ctx.replacePaths),
      window.ck3tools.getTitleData(ctx.gameDir, ctx.modPath, ctx.replacePaths)
    ])
      .then(([r, t]) => {
        if (active)
          setRefs({
            cultures: r.cultures,
            governments: t.governments,
            titles: t.titles.map((title) => ({ id: title.id, name: title.localizedName }))
          })
      })
      .catch(() => {
        /* Free-form ids remain available when references cannot be loaded. */
      })
    return () => {
      active = false
    }
  }, [ctx.gameDir, ctx.modPath, JSON.stringify(ctx.replacePaths)])
  return refs
}

/** App-specific settings form, composed from installed inputs, selects and reference chips. */
function OptionFields({
  fields,
  values,
  disabled,
  onChange
}: {
  fields: Field[]
  values: Values
  disabled: boolean
  onChange: (patch: Values) => void
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const value = values[field.key]
        const locked = disabled || field.disabled
        const scalar = typeof value === 'string' ? value : null
        const list = Array.isArray(value) ? value : []
        const options = field.options ?? []
        const change = (next: string | null | string[]): void => onChange({ [field.key]: next })
        const scriptError =
          field.kind === 'script' && scalar ? validateScriptFragment(scalar) : null
        return (
          <div key={field.key} className="space-y-1.5">
            <Label>{field.label}</Label>
            {field.kind === 'list' ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {list.map((id, i) => (
                    <ReferenceBadge
                      key={`${id}:${i}`}
                      entry={findRef(options, id)}
                      onRemove={
                        locked ? undefined : () => change(list.filter((_, index) => i !== index))
                      }
                    />
                  ))}
                  {!list.length && <span className="text-xs text-muted-foreground">none</span>}
                </div>
                {!locked && (
                  <ReferenceInput
                    options={options.filter((o) => !list.includes(o.id))}
                    placeholder={`Add ${field.label.toLowerCase()}…`}
                    onAdd={(id) => change([...list, id])}
                  />
                )}
              </div>
            ) : field.kind === 'flag' ? (
              <Select
                value={scalar ?? '__default__'}
                disabled={locked}
                onValueChange={(v) => change(v === '__default__' ? null : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Game default / inherit</SelectItem>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  {scalar && scalar !== 'yes' && scalar !== 'no' && (
                    <SelectItem value={scalar}>{scalar}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            ) : field.kind === 'number' ? (
              <Input
                aria-label={field.label}
                type="number"
                min={0}
                step={1}
                value={scalar ?? ''}
                placeholder="game default"
                disabled={locked}
                onChange={(e) => change(e.target.value || null)}
              />
            ) : field.kind === 'script' ? (
              <Textarea
                aria-label={field.label}
                className="min-h-44 font-mono"
                spellCheck={false}
                value={scalar ?? ''}
                placeholder="virtues = { brave = { scale = 1 weight = 2 } }"
                disabled={locked}
                aria-invalid={!!scriptError}
                onChange={(e) => change(e.target.value || null)}
              />
            ) : (
              <ReferenceInput
                value={scalar}
                options={options}
                disabled={locked}
                placeholder="inherit / none"
                onChange={change}
              />
            )}
            {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
            {scriptError && <p className="text-xs text-destructive">{scriptError}</p>}
          </div>
        )
      })}
    </div>
  )
}
const reserved: Field[] = [
  { key: 'reservedMaleNames', label: 'Reserved male names', kind: 'list' },
  { key: 'reservedFemaleNames', label: 'Reserved female names', kind: 'list' }
]

export function FaithOptionsForm({
  values,
  onChange,
  ...ctx
}: Context & {
  values: FaithOptions
  onChange: (values: FaithOptions) => void
}): React.JSX.Element {
  const refs = useOptionsReferences(ctx)
  const fields: Field[] = [
    { key: 'headOfRite', label: 'Head of rite title', options: refs.titles },
    {
      key: 'origin',
      label: 'Origin faith',
      options: ctx.data.faiths.map((f) => ({ id: f.id, name: f.localizedName }))
    },
    { key: 'graphicalFaith', label: 'Graphical faith' },
    { key: 'theocracyGovernmentType', label: 'Theocracy government', options: refs.governments },
    {
      key: 'historical',
      label: 'Historical faith',
      kind: 'flag',
      hint: 'Non-historical faiths need characters, counties, or created = yes in faith history to become available.'
    },
    { key: 'cultures', label: 'Associated cultures', kind: 'list', options: refs.cultures },
    ...reserved
  ]
  return (
    <FormSection title="Faith settings">
      <OptionFields
        fields={fields}
        values={values as Values}
        disabled={ctx.disabled}
        onChange={(patch) => onChange({ ...values, ...patch } as FaithOptions)}
      />
    </FormSection>
  )
}

export function ReligionOptionsForm({
  values,
  onChange,
  modern,
  ...ctx
}: Context & {
  values: ReligionOptions
  onChange: (values: ReligionOptions) => void
  modern: boolean
}): React.JSX.Element {
  const refs = useOptionsReferences(ctx)
  const fields: Field[] = [
    { key: 'tenetBackgroundIcon', label: 'Tenet background icon' },
    { key: 'theocracyGovernmentType', label: 'Theocracy government', options: refs.governments },
    { key: 'paganRoots', label: 'Pagan roots', kind: 'flag' },
    ...(modern
      ? [
          { key: 'mainHolySite', label: 'Main holy site', options: ctx.data.holySites },
          {
            key: 'eminentHolySitesMin',
            label: 'Minimum eminent holy sites',
            kind: 'number' as const
          },
          {
            key: 'eminentHolySitesMax',
            label: 'Maximum eminent holy sites',
            kind: 'number' as const
          },
          { key: 'holySitesMin', label: 'Minimum total holy sites', kind: 'number' as const },
          { key: 'holySitesMax', label: 'Maximum total holy sites', kind: 'number' as const }
        ]
      : []),
    ...reserved,
    { key: 'customFaithIcons', label: 'Custom faith icons', kind: 'list' },
    {
      key: 'traitsScript',
      label: 'Virtues and sins',
      kind: 'script',
      hint: 'Contents of traits = { … }. Supports virtue/sin lists, multipliers, and scale/weight blocks. Clear to inherit defaults.'
    }
  ]
  return (
    <FormSection title="Religion settings">
      <OptionFields
        fields={fields}
        values={values as Values}
        disabled={ctx.disabled}
        onChange={(patch) => onChange({ ...values, ...patch } as ReligionOptions)}
      />
    </FormSection>
  )
}

export function RiteOptionsForm({
  values,
  onChange,
  dynamicName,
  dynamicDescription,
  ...ctx
}: Context & {
  values: RiteOptions
  onChange: (values: RiteOptions) => void
  dynamicName?: boolean
  dynamicDescription?: boolean
}): React.JSX.Element {
  const refs = useOptionsReferences(ctx)
  return (
    <FormSection title="Rite settings">
      <OptionFields
        values={values as Values}
        disabled={ctx.disabled}
        onChange={(patch) => onChange({ ...values, ...patch } as RiteOptions)}
        fields={[
          {
            key: 'nameKey',
            label: 'Name localization key',
            disabled: dynamicName,
            hint: dynamicName
              ? 'Dynamic name: edit its script in the definition file.'
              : 'References an existing localization key.'
          },
          {
            key: 'descriptionKey',
            label: 'Description localization key',
            disabled: dynamicDescription,
            hint: dynamicDescription
              ? 'Dynamic description: edit its script in the definition file.'
              : 'References an existing localization key.'
          },
          { key: 'cultures', label: 'Associated cultures', kind: 'list', options: refs.cultures }
        ]}
      />
    </FormSection>
  )
}
