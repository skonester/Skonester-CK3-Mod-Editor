import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { RefEntry, ReferenceData, ScriptSite } from '@shared/types'
import { readScopeEffects, readStatement, setScopeList, setScopeScalar } from '@shared/scopeEffects'
import type { ScopeEffects } from '@shared/scopeEffects'
import { useTraitIcons } from '../useGameIcons'
import type { IconContext } from '../useGameIcons'
import FormSection from './FormSection'
import ReferenceBadge from './ReferenceBadge'
import { findRef } from './ReferenceLabel'
import ReferenceInput from './ReferenceInput'
import ScriptSiteCard from './ScriptSiteCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

const SEXUALITIES = ['heterosexual', 'homosexual', 'bisexual', 'asexual'] as const
const NO_SEXUALITY = 'none'

/** "add_martial_skill" → "Martial skill", "add_piety" → "Piety" */
export function amountLabel(key: string): string {
  const words = key.replace(/^(add|change)_/, '').replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Script sites that run effects on the character, in the order the game would meet them */
export const isScopeEffect = (s: ScriptSite): boolean => s.role === 'scope' && s.context === 'effect'

/** The name of the script a site lives in, for a badge marker: "eddy_set_up_effect" */
export function siteSource(site: ScriptSite): string {
  const chain = site.reachedFrom[0]
  return chain?.[chain.length - 1]?.name ?? site.path[0] ?? site.file
}

/** An own-record line that is just a trait (`add_trait = x`, a dated `trait = x`) */
export function ownTrait(site: ScriptSite): string | null {
  if (site.role !== 'own') return null
  const st = readStatement(site.diskText)
  return st && (st.key === 'add_trait' || st.key === 'trait') ? st.value : null
}

/** A trait the character gains from script or a dated history entry, with how to drop it */
export interface ScriptedTrait {
  trait: string
  /** Where it comes from, for the badge's tooltip */
  source: string
  /** The sites with the line removed */
  remove: (sites: ScriptSite[]) => ScriptSite[]
}

/** Every trait the character gains outside the record's own `trait =` lines. */
export function scriptedTraits(sites: ScriptSite[]): ScriptedTrait[] {
  const out: ScriptedTrait[] = []
  const replace = (all: ScriptSite[], id: string, text: string): ScriptSite[] =>
    all.map((s) => (s.id === id ? { ...s, text } : s))
  for (const site of sites) {
    if (site.text === '') continue
    const own = ownTrait(site)
    if (own !== null && site.text === site.diskText) {
      const date = site.path.find((k) => /^\d+\.\d+/.test(k))
      out.push({
        trait: own,
        source: date ? `History, at ${date}` : 'History record',
        remove: (all) => replace(all, site.id, '')
      })
      continue
    }
    if (!isScopeEffect(site)) continue
    const fx = readScopeEffects(site.text)
    fx?.addTraits.forEach((trait, i) => {
      out.push({
        trait,
        source: `Script: ${siteSource(site)} (${site.file}:${site.line})`,
        remove: (all) => {
          const current = all.find((s) => s.id === site.id)
          if (!current) return all
          const now = readScopeEffects(current.text)?.addTraits ?? []
          return replace(all, site.id, setScopeList(current.text, 'add_trait', now.filter((_, j) => j !== i)))
        }
      })
    })
  }
  return out
}

function SubLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Label className="text-[11px] text-muted-foreground">{children}</Label>
}

/** Adds a free-text value (a flag) on Enter or the button. */
function AddText({
  placeholder,
  onAdd
}: {
  placeholder: string
  onAdd: (value: string) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const commit = (): void => {
    const v = text.trim()
    if (!/^[A-Za-z0-9_.:@-]+$/.test(v)) return
    onAdd(v)
    setText('')
  }
  return (
    <div className="flex gap-1.5">
      <Input
        className="font-mono"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
      />
      <Button variant="outline" size="icon" title="Add" onClick={commit}>
        <Plus />
      </Button>
    </div>
  )
}

interface ScopeFieldsProps {
  text: string
  fx: ScopeEffects
  onChange: (text: string) => void
  refData: ReferenceData | null
  iconCtx: IconContext
  characters: RefEntry[]
  onNavigate: (id: string) => void
  locateTrait: (id: string) => ReturnType<typeof window.ck3tools.locateRef>
}

/**
 * The common effects of a `character:<id> = { … }` block, as fields: only the
 * ones the block uses, one row of pickers to add more, and its remaining
 * statements listed as they are written.
 */
function ScopeFields({
  text,
  fx,
  onChange,
  refData,
  iconCtx,
  characters,
  onNavigate,
  locateTrait
}: ScopeFieldsProps): React.JSX.Element {
  const traitIcon = useTraitIcons(iconCtx, [...fx.addTraits, ...fx.removeTraits])
  const traits = refData?.traits ?? []
  const perks = refData?.perks ?? []

  const badges = (
    label: string,
    key: string,
    values: string[],
    options: RefEntry[] | null,
    icons: boolean
  ): React.JSX.Element | null =>
    values.length === 0 ? null : (
      <div className="space-y-1.5">
        <SubLabel>{label}</SubLabel>
        <div className="flex flex-wrap gap-1.5">
          {values.map((v, i) => (
            <ReferenceBadge
              key={`${v}:${i}`}
              entry={options ? findRef(options, v) : { id: v, name: null }}
              icon={icons ? traitIcon(v) : undefined}
              locate={icons ? () => locateTrait(v) : undefined}
              onRemove={() => onChange(setScopeList(text, key, values.filter((_, j) => j !== i)))}
            />
          ))}
        </div>
      </div>
    )

  const charName = (id: string): string | null => characters.find((c) => c.id === id)?.name ?? null
  const sexualitySelect = (placeholder: string): React.JSX.Element => (
    <Select
      value={fx.sexuality ?? NO_SEXUALITY}
      onValueChange={(v) =>
        onChange(setScopeScalar(text, 'set_sexuality', v === NO_SEXUALITY ? null : v))
      }
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_SEXUALITY}>{placeholder}</SelectItem>
        {SEXUALITIES.map((s) => (
          <SelectItem key={s} value={s}>
            <span className="capitalize">{s}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className="space-y-3">
      {badges('Adds traits', 'add_trait', fx.addTraits, traits, true)}
      {badges('Removes traits', 'remove_trait', fx.removeTraits, traits, true)}
      {badges('Perks', 'add_perk', fx.perks, perks, false)}
      {badges('Flags', 'add_character_flag', fx.flags, null, false)}

      {(fx.sexuality !== null || fx.amounts.length > 0) && (
        <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">
          {fx.sexuality !== null && (
            <div className="space-y-1">
              <SubLabel>Sexuality</SubLabel>
              {sexualitySelect('Unchanged')}
            </div>
          )}
          {fx.amounts.map((a, i) => (
            <label key={`${a.key}:${i}`} className="space-y-1">
              <SubLabel>{amountLabel(a.key)}</SubLabel>
              <Input
                type="number"
                value={a.value}
                title={a.key}
                onChange={(e) =>
                  onChange(setScopeScalar(text, a.key, e.target.value === '' ? null : e.target.value))
                }
              />
            </label>
          ))}
        </div>
      )}

      {fx.calls.length > 0 && (
        <div className="space-y-1.5">
          <SubLabel>Also runs</SubLabel>
          <div className="flex flex-wrap gap-1.5">
            {fx.calls.map((c) => (
              <ReferenceBadge
                key={c}
                entry={{ id: c, name: null }}
                removeTitle={`Stop running ${c} here`}
                onRemove={() => onChange(setScopeScalar(text, c, null))}
              />
            ))}
          </div>
        </div>
      )}
      {fx.nested.length > 0 && (
        <div className="space-y-1.5">
          <SubLabel>Also sets up</SubLabel>
          <div className="flex flex-wrap gap-1.5">
            {fx.nested.map((n) => {
              const inMod = n.kind === 'character' && characters.some((c) => c.id === n.id)
              return (
                <ReferenceBadge
                  key={n.key}
                  entry={{ id: n.key, name: n.kind === 'character' ? charName(n.id) : null }}
                  onNavigate={inMod ? () => onNavigate(n.id) : undefined}
                />
              )
            })}
          </div>
        </div>
      )}
      {fx.other.length > 0 && (
        <div className="space-y-1.5">
          <SubLabel>Also does</SubLabel>
          <ul className="space-y-1">
            {fx.other.map((line, i) => (
              <li
                key={i}
                className="truncate rounded-sm bg-muted/40 px-2 py-1 font-mono text-xs"
                title={line}
              >
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 @md:grid-cols-2">
        <ReferenceInput
          options={traits.filter((o) => !fx.addTraits.includes(o.id))}
          placeholder="Add trait…"
          onAdd={(v) => onChange(setScopeList(text, 'add_trait', [...fx.addTraits, v]))}
        />
        {perks.length > 0 && (
          <ReferenceInput
            options={perks.filter((o) => !fx.perks.includes(o.id))}
            placeholder="Add perk…"
            onAdd={(v) => onChange(setScopeList(text, 'add_perk', [...fx.perks, v]))}
          />
        )}
        <AddText
          placeholder="Add flag…"
          onAdd={(v) => onChange(setScopeList(text, 'add_character_flag', [...fx.flags, v]))}
        />
        {fx.sexuality === null && sexualitySelect('Set sexuality…')}
      </div>
    </div>
  )
}

interface Props {
  sites: ScriptSite[]
  onChange: (sites: ScriptSite[]) => void
  modPath: string
  gameDir: string | null
  replacePaths: string[]
  refData: ReferenceData | null
  characters: RefEntry[]
  onNavigate: (id: string) => void
}

/**
 * Everything in the mod that shapes the character beyond the fields above,
 * each statement editable where it stands: the rest of their history record,
 * the script run on them at game start or by events, and the places the mod
 * names them — titles they hold, bookmarks, calls that make them a liege.
 */
export default function CharacterScriptSection({
  sites,
  onChange,
  modPath,
  gameDir,
  replacePaths,
  refData,
  characters,
  onNavigate
}: Props): React.JSX.Element | null {
  const iconCtx: IconContext = { gameDir, modPath, replacePaths }
  const update = (id: string, text: string): void =>
    onChange(sites.map((s) => (s.id === id ? { ...s, text } : s)))
  const locateTrait = (id: string): ReturnType<typeof window.ck3tools.locateRef> =>
    window.ck3tools.locateRef(gameDir, modPath, replacePaths, 'trait', id)

  // Plain trait lines are drawn with the Traits field instead
  const own = sites.filter((s) => s.role === 'own' && !(ownTrait(s) !== null && s.text === s.diskText))
  const scoped = sites.filter(isScopeEffect)
  const named = sites.filter((s) => s.role !== 'own' && !isScopeEffect(s))
  const elsewhere = named.filter((s) => s.context === 'effect')
  // Checks that test for the character (a decision's is_shown, an event's trigger)
  const conditions = named.filter((s) => s.context === 'trigger')
  if (sites.length === 0) return null

  const card = (site: ScriptSite, compact = false): React.JSX.Element => {
    const fx = isScopeEffect(site) && site.text !== '' ? readScopeEffects(site.text) : null
    return (
      <ScriptSiteCard
        key={site.id}
        site={site}
        modPath={modPath}
        compact={compact}
        onChange={(text) => update(site.id, text)}
      >
        {fx && (
          <ScopeFields
            text={site.text}
            fx={fx}
            onChange={(text) => update(site.id, text)}
            refData={refData}
            iconCtx={iconCtx}
            characters={characters}
            onNavigate={onNavigate}
            locateTrait={locateTrait}
          />
        )}
      </ScriptSiteCard>
    )
  }

  return (
    <>
      {scoped.length > 0 && (
        <FormSection className="min-w-0" title={`Set by script · ${scoped.length}`}>
          <p className="text-xs text-muted-foreground">
            Script the mod runs on this character — at game start, from events or decisions.
          </p>
          {scoped.map((s) => card(s))}
        </FormSection>
      )}
      {own.length > 0 && (
        <FormSection className="min-w-0" title={`More of the history record · ${own.length}`}>
          {own.map((s) => card(s, true))}
        </FormSection>
      )}
      {elsewhere.length > 0 && (
        <FormSection className="min-w-0" title={`Named elsewhere · ${elsewhere.length}`}>
          <p className="text-xs text-muted-foreground">
            Titles they hold, bookmarks, courts and calls that name them.
          </p>
          {elsewhere.map((s) => card(s, true))}
        </FormSection>
      )}
      {conditions.length > 0 && (
        <FormSection className="min-w-0" title={`Conditions on this character · ${conditions.length}`}>
          <p className="text-xs text-muted-foreground">
            Decisions, events and scripts that check for this character.
          </p>
          {conditions.map((s) => card(s, true))}
        </FormSection>
      )}
    </>
  )
}
