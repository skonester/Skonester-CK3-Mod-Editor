import { useEffect, useState } from 'react'
import { ArrowRight, ChevronRight, ExternalLink, Plus } from 'lucide-react'
import type {
  CalendarConfig,
  DynastyCharacter,
  DynastyData,
  ReferenceData,
  SaveResult
} from '@shared/types'
import { SAVE_HOTKEY_LABEL, useFormHotkeys } from '../hooks/useFormHotkeys'
import { usePersistedDraft } from '../hooks/usePersistedDraft'
import CoatOfArms from './CoatOfArms'
import DateFormatToggle from './DateFormatToggle'
import ReferenceInput, { openReferenceTarget } from './ReferenceInput'
import Hint from './Hint'
import FormSection from './FormSection'
import StaleDraftAlert from './StaleDraftAlert'
import EntityReferencesSection from './EntityReferencesSection'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { formatCalendarYear } from '@/lib/ck3Date'
import { yearOf } from '@/lib/familyTree'
import {
  housesOfDynasty,
  membersOfDynasty,
  membersOfHouse,
  normId,
  sortMembers
} from '@/lib/dynastyView'

/**
 * Group key for the members who carry the dynasty but no house — the dynasty
 * itself acts as their house. '#' opens a comment in Paradox script, so no real
 * id can contain one and this can't collide with a house's normalized id.
 */
const NO_HOUSE = '#no-house'

/** The editable fields of either entity; house uses `dynasty`, dynasty `culture`. */
interface DefDraft {
  name: string | null
  prefix: string | null
  motto: string | null
  culture: string | null
  dynasty: string | null
}

interface Props {
  kind: 'dynasty' | 'house'
  id: string
  data: DynastyData
  modPath: string
  gameDir: string | null
  replacePaths: string[]
  calendar: CalendarConfig | null
  refData: ReferenceData | null
  /** house group id (normalized) → CSS color, matching the tree's stripes */
  groupColors: Record<string, string>
  selectedMemberId: string | null
  /** Focus this member's node in the tree */
  onMemberClick: (id: string) => void
  /** Jump to the character editor */
  onOpenCharacter: (id: string) => void
  /** Open the character editor's create panel with this dynasty/house prefilled */
  onAddMember: () => void
  /** Dynasties only: open the new-house panel with this dynasty as the parent */
  onAddHouse: () => void
  /** Switch the editor to another dynasty/house row */
  onOpenRow: (kind: 'dynasty' | 'house', id: string) => void
  /** Open a culture in the Culture Editor */
  onOpenCulture: (id: string) => void
  /** Called after a successful save so the page can reload definitions */
  onSaved: () => void
  /** Leave the row and go back to the list (the header arrow, and Esc) */
  onClose: () => void
}

function lifespanLabel(c: DynastyCharacter, calendar: CalendarConfig | null): string {
  const b = yearOf(c.birth)
  const d = yearOf(c.death)
  const show = (y: number): string => (calendar ? formatCalendarYear(y, calendar) : String(y))
  if (b === null && d === null) return ''
  return `${b === null ? '?' : show(b)} – ${d === null ? '' : show(d)}`
}

export default function DynastyDetailPanel({
  kind,
  id,
  data,
  modPath,
  gameDir,
  replacePaths,
  calendar,
  refData,
  groupColors,
  selectedMemberId,
  onMemberClick,
  onOpenCharacter,
  onAddMember,
  onAddHouse,
  onOpenRow,
  onOpenCulture,
  onSaved,
  onClose
}: Props): React.JSX.Element {
  const def =
    kind === 'dynasty'
      ? (data.dynasties.find((d) => normId(d.id) === normId(id)) ?? null)
      : (data.houses.find((h) => normId(h.id) === normId(id)) ?? null)
  const house = kind === 'house' ? (def as (typeof data.houses)[number] | null) : null
  const dynasty = kind === 'dynasty' ? (def as (typeof data.dynasties)[number] | null) : null

  const original: DefDraft | null = def
    ? {
        name: def.name,
        prefix: def.prefix,
        motto: def.motto,
        culture: dynasty?.culture ?? null,
        dynasty: house?.dynasty ?? null
      }
    : null

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [grouped, setGrouped] = useState(true)
  /** Show file years instead of the mod calendar's era years in member lifespans */
  const [showRawDates, setShowRawDates] = useState(false)
  // Group keys the user has folded away; absent means open, so new groups
  // (and every group of a freshly opened row) start expanded.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const toggleGroup = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const editable = def !== null && def.inMod
  // Edits outlive the row: closing it, switching tools or restarting the app
  // all leave the draft where it was, listed above the list as unsaved.
  const { draft, setDraft, dirty, stale, revert, markSaved } = usePersistedDraft<DefDraft>({
    tool: 'dynasties',
    ref: def === null ? null : { id: def.id, name: def.localizedName ?? def.name, scope: kind },
    original,
    editable
  })

  useEffect(() => {
    setError(null)
  }, [kind, id, data])

  // The "Saved ✓" flash must survive the post-save data reload (which re-runs
  // the reseed above), so it resets only when a different row is opened
  useEffect(() => {
    setSavedFlash(false)
    setCollapsed(new Set())
  }, [kind, id])

  // A house without its own CoA inherits its dynasty's, like in game
  const coaIds = kind === 'house' ? [id, house?.dynasty] : [id]

  // Parent-dynasty options carry the same display name the list shows:
  // localized where localization resolved it, else the raw `name` value.
  const dynastyOptions = data.dynasties.map((d) => ({
    id: d.id,
    name: d.localizedName ?? d.name
  }))


  const members = sortMembers(
    kind === 'dynasty' ? membersOfDynasty(data, id, true) : membersOfHouse(data, id)
  )
  const houses = kind === 'dynasty' ? housesOfDynasty(data, id) : []

  const set = (patch: Partial<DefDraft>): void => {
    if (!draft) return
    setDraft({ ...draft, ...patch })
    setSavedFlash(false)
  }

  const save = async (): Promise<void> => {
    if (!def || !draft) return
    setSaving(true)
    setError(null)
    try {
      let result: SaveResult
      if (kind === 'dynasty') {
        result = await window.ck3tools.saveDynasty(modPath, def.file, def.id, {
          name: draft.name,
          prefix: draft.prefix,
          motto: draft.motto,
          culture: draft.culture
        })
      } else {
        result = await window.ck3tools.saveHouse(modPath, def.file, def.id, {
          name: draft.name,
          prefix: draft.prefix,
          motto: draft.motto,
          dynasty: draft.dynasty
        })
      }
      if (!result.ok) {
        setError(result.error)
        return
      }
      markSaved(draft)
      setSavedFlash(true)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  useFormHotkeys({ onSave: save, canSave: editable && dirty && !saving, onClose })

  const textField = (
    label: string,
    value: string | null,
    onChange: (v: string | null) => void,
    hint?: React.ReactNode
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <Label className="text-xs tracking-wide text-muted-foreground uppercase">{label}</Label>
      <Input
        type="text"
        value={value ?? ''}
        placeholder="none"
        disabled={!editable}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
      {hint}
    </div>
  )

  /** The resolved display form, hung under a field on a rounded elbow. */
  const hintRow = (label: string, value: string): React.JSX.Element => (
    <Hint label={label} value={value} truncate />
  )

  const memberRow = (c: DynastyCharacter): React.JSX.Element => (
    <div
      key={c.id}
      role="button"
      tabIndex={0}
      className={cn(
        'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted',
        selectedMemberId === c.id && 'bg-muted'
      )}
      title={[
        `${c.id} — ${c.file}`,
        c.spouses.length > 0 ? `Spouses: ${c.spouses.join(', ')}` : null
      ]
        .filter(Boolean)
        .join('\n')}
      onClick={() => onMemberClick(c.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onMemberClick(c.id)
        }
      }}
    >
      <span className="min-w-0 flex-1 truncate">
        {c.name ?? <span className="font-mono text-muted-foreground">{c.id}</span>}
        {c.female && <span className="ml-1 text-muted-foreground">♀</span>}
      </span>
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        {lifespanLabel(c, showRawDates ? null : calendar)}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="opacity-0 group-hover:opacity-100"
        title="Open in Character Editor"
        onClick={(e) => {
          e.stopPropagation()
          onOpenCharacter(c.id)
        }}
      >
        <ArrowRight />
      </Button>
    </div>
  )

  /** Dynasty members grouped: no-house first (the dynasty acts as their house). */
  const groupedMembers = (): React.JSX.Element => {
    const noHouse = members.filter((c) => c.house === null)
    const houseIds = new Map<string, string>() // norm id → raw spelling
    for (const h of houses) houseIds.set(normId(h.id), h.id)
    for (const c of members) {
      if (c.house !== null && !houseIds.has(normId(c.house))) houseIds.set(normId(c.house), c.house)
    }
    const groups = [
      // The base dynasty collapses like any house, so it leads the same list
      ...(noHouse.length > 0
        ? [{ norm: NO_HOUSE, raw: null, def: null, list: noHouse }]
        : []),
      ...[...houseIds.entries()].map(([norm, raw]) => ({
        norm,
        raw: raw as string | null,
        // Resolved against ALL houses: a member's house can be defined under
        // another dynasty and still deserves its name, not an "undefined" badge
        def: data.houses.find((h) => normId(h.id) === norm) ?? null,
        list: members.filter((c) => c.house !== null && normId(c.house) === norm)
      }))
    ]
    return (
      <div className="space-y-3">
        {groups.map((g) => {
          const open = !collapsed.has(g.norm)
          return (
            <Collapsible key={g.norm} open={open} onOpenChange={() => toggleGroup(g.norm)}>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md py-0.5 text-left hover:text-foreground">
                  <ChevronRight
                    className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
                  />
                  {g.raw !== null && (
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: groupColors[g.norm] }}
                    />
                  )}
                  <span className="truncate">
                    {g.raw === null
                      ? 'Dynasty (no house)'
                      : (g.def?.localizedName ?? g.def?.name ?? g.raw)}
                  </span>
                  <span className="shrink-0">· {g.list.length}</span>
                  {g.raw !== null && g.def === null && (
                    <Badge variant="outline" className="text-[10px]">
                      undefined
                    </Badge>
                  )}
                </CollapsibleTrigger>
                {g.raw !== null && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Open this house"
                    onClick={() => onOpenRow('house', g.raw!)}
                  >
                    <ArrowRight />
                  </Button>
                )}
              </div>
              <CollapsibleContent>
                {g.list.length > 0 ? (
                  g.list.map(memberRow)
                ) : (
                  <p className="px-2 text-xs text-muted-foreground">no members</p>
                )}
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      </div>
    )
  }

  return (
    <Card className="flex h-full min-h-0 w-full min-w-0 flex-col gap-0 py-0">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-foreground">
          <span className="truncate">
            {def ? (def.localizedName ?? def.name ?? def.id) : id}
          </span>
          {dirty && <span className="size-2 shrink-0 rounded-full bg-primary" title="Unsaved changes" />}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <DateFormatToggle calendar={calendar} showRaw={showRawDates} onChange={setShowRawDates} />
          <Badge variant="secondary">{kind}</Badge>
          {def && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Open definition in text editor"
              onClick={() =>
                void openReferenceTarget(
                  () => window.ck3tools.locateRef(gameDir, modPath, replacePaths, 'dynasty', def.id),
                  def.id
                )
              }
            >
              <ExternalLink />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-4">
        {stale && <StaleDraftAlert what={kind} />}
        {/* Without the details form the CoA stands alone at the top */}
        {!(draft && def) && <CoatOfArms ids={coaIds} size={112} />}
        {def === null && (
          <Alert>
            <AlertDescription>
              No definition found for <code className="font-mono">{id}</code> in the mod (or the
              game files it loads). {members.length} character{members.length === 1 ? '' : 's'}{' '}
              reference it; its metadata can&apos;t be edited until it&apos;s defined.
            </AlertDescription>
          </Alert>
        )}
        {def !== null && !def.inMod && (
          <Alert>
            <AlertDescription>
              Defined in the base game (<code className="font-mono">{def.file}</code>). Editing
              game files isn&apos;t supported — copy the definition into the mod to change it.
            </AlertDescription>
          </Alert>
        )}

        {draft && def && (
          <FormSection title="Details">
            <div className="flex items-start gap-4">
              <CoatOfArms ids={coaIds} size={112} className="shrink-0" />
              <div className="min-w-0 flex-1 space-y-3.5">
                <div className="space-y-1.5">
                  <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                    ID
                  </Label>
                  <Input type="text" value={def.id} disabled readOnly className="font-mono" />
                </div>
                {textField(
                  'Name',
                  draft.name,
                  (v) => set({ name: v }),
                  def.localizedName !== null ? hintRow('Display', def.localizedName) : undefined
                )}
              </div>
            </div>
            {textField('Prefix', draft.prefix, (v) => set({ prefix: v }))}
            {textField('Motto', draft.motto, (v) => set({ motto: v }))}
            {kind === 'dynasty' && (
              <div className="space-y-1.5">
                <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                  Culture
                </Label>
                <ReferenceInput
                  value={draft.culture}
                  onChange={(v) => set({ culture: v })}
                  options={refData?.cultures ?? []}
                  placeholder="none"
                  onNavigate={onOpenCulture}
                  followTitle="Open in Culture Editor"
                />
              </div>
            )}
            {kind === 'house' && (
              <div className="space-y-1.5">
                <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                  Dynasty
                </Label>
                <ReferenceInput
                  value={draft.dynasty}
                  onChange={(v) => set({ dynasty: v })}
                  options={dynastyOptions}
                  placeholder="none"
                  followTitle="Go to this dynasty"
                  onNavigate={(v) => onOpenRow('dynasty', v)}
                />
              </div>
            )}
          </FormSection>
        )}

        <FormSection
          title={<>Members · {members.length}</>}
          action={
            <span className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="xs"
                title={`Create a new character in this ${kind}`}
                onClick={onAddMember}
              >
                <Plus />
                Member
              </Button>
              {kind === 'dynasty' && (
                <Button
                  variant="outline"
                  size="xs"
                  title="Create a new cadet house in this dynasty"
                  onClick={onAddHouse}
                >
                  <Plus />
                  House
                </Button>
              )}
              {kind === 'dynasty' && (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={grouped ? 'grouped' : 'flat'}
                  onValueChange={(v) => v && setGrouped(v === 'grouped')}
                  aria-label="Member list mode"
                >
                  <ToggleGroupItem value="grouped">By house</ToggleGroupItem>
                  <ToggleGroupItem value="flat">Flat</ToggleGroupItem>
                </ToggleGroup>
              )}
            </span>
          }
        >
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No characters belong to this {kind}.
            </p>
          ) : kind === 'dynasty' && grouped ? (
            groupedMembers()
          ) : (
            <div>{members.map(memberRow)}</div>
          )}
        </FormSection>

        <EntityReferencesSection type={kind === 'house' ? 'dynasty_houses' : 'dynasties'} id={id} />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      {editable && (
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <span
            className={cn(
              'mr-auto text-sm text-green-600 dark:text-green-500',
              !(savedFlash && !dirty) && 'invisible'
            )}
          >
            Saved ✓
          </span>
          <Button
            variant="outline"
            disabled={!dirty || saving}
            onClick={() => {
              revert()
              setError(null)
            }}
          >
            Revert
          </Button>
          <Button disabled={!dirty || saving} title={SAVE_HOTKEY_LABEL} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </Card>
  )
}
