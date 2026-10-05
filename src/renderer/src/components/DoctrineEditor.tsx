import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { DoctrineGroup, RefEntry, RefLocation } from '@shared/types'
import ReferenceBadge from './ReferenceBadge'
import ReferenceInput from './ReferenceInput'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import {
  CATEGORY_LABELS,
  doctrineSlots,
  entriesFor,
  setGroupPicks,
  ungroupedPicks
} from '@/lib/faithView'
import type { DoctrineSlot } from '@/lib/faithView'

interface Props {
  /** Every doctrine group the scan found, in definition order */
  groups: DoctrineGroup[]
  /** The entity's own `doctrine =` values, in file order */
  doctrines: string[]
  /**
   * Doctrines the entity would fall back to for groups it leaves unset — a
   * faith inherits its religion's. Empty when editing a religion itself.
   */
  inheritedFrom?: { label: string; doctrines: string[] }
  inheritanceDescription?: string
  /** Doctrines belonging to no scanned group, so nothing is edited away blind */
  ungrouped: RefEntry[]
  disabled: boolean
  onChange: (doctrines: string[]) => void
  /** Opens a doctrine's defining file in the user's text editor */
  locate: (id: string) => Promise<RefLocation | null>
}

/**
 * The grouped doctrine picker shared by the faith and religion panels.
 *
 * CK3 models doctrines as mutually exclusive picks within a group ("Marriage
 * Type" is monogamy OR polygamy OR concubines), so each group gets one control
 * rather than the flat `doctrine =` list the file actually stores. Groups are
 * collected under their category, and a faith that leaves a group unset shows
 * what its religion supplies instead.
 */
export default function DoctrineEditor({
  groups,
  doctrines,
  inheritedFrom,
  inheritanceDescription,
  ungrouped,
  disabled,
  onChange,
  locate
}: Props): React.JSX.Element {
  // The base game ships 44 groups, most of which a given faith never touches,
  // so the decided ones lead and the rest are a click away.
  const [showAll, setShowAll] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const slots = useMemo(
    () => doctrineSlots(groups, doctrines, inheritedFrom?.doctrines ?? []),
    [groups, doctrines, inheritedFrom]
  )
  const extra = useMemo(() => ungroupedPicks(groups, doctrines), [groups, doctrines])

  const visible = showAll ? slots : slots.filter((s) => s.own.length > 0)

  const byCategory = new Map<string, DoctrineSlot[]>()
  for (const slot of visible) {
    const key = slot.group.category ?? 'other'
    const list = byCategory.get(key)
    if (list) list.push(slot)
    else byCategory.set(key, [slot])
  }

  const toggleCategory = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const set = (group: DoctrineGroup, picks: string[]): void =>
    onChange(setGroupPicks(doctrines, group, picks))

  const groupControl = (slot: DoctrineSlot): React.JSX.Element => {
    const { group, own, inherited } = slot
    const options = group.doctrines
    const multi = group.picks > 1
    const full = multi && own.length >= group.picks
    // Inherited picks are shown by name, like the options in the picker itself
    const inheritedLabel = entriesFor(options, inherited)
      .map((e) => e.name ?? e.id)
      .join(', ')

    return (
      <div key={group.id} className="space-y-1.5">
        <Label className="flex items-baseline gap-2 text-xs tracking-wide text-muted-foreground uppercase">
          <span className="min-w-0 truncate">{group.name ?? group.id}</span>
          {multi && (
            <span className="shrink-0 text-[10px] normal-case">
              {own.length} / {group.picks}
            </span>
          )}
        </Label>
        {multi ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {entriesFor(options, own).map((entry) => (
                <ReferenceBadge
                  key={entry.id}
                  entry={entry}
                  locate={() => locate(entry.id)}
                  onRemove={
                    disabled ? undefined : () => set(group, own.filter((d) => d !== entry.id))
                  }
                />
              ))}
              {own.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  {inherited.length > 0 ? `inherited: ${inheritedLabel}` : 'none'}
                </span>
              )}
            </div>
            {!disabled && !full && (
              <ReferenceInput
                options={options.filter((o) => !own.includes(o.id))}
                placeholder="Add…"
                onAdd={(v) => set(group, [...own, v])}
              />
            )}
          </div>
        ) : (
          <ReferenceInput
            value={own[0] ?? null}
            onChange={(v) => set(group, v === null ? [] : [v])}
            options={options}
            placeholder={inherited.length > 0 ? `inherited: ${inheritedLabel}` : 'none'}
            locate={locate}
            disabled={disabled}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {inheritanceDescription ??
            (inheritedFrom
              ? `Groups left unset fall back to ${inheritedFrom.label}.`
              : 'Every faith of this religion inherits these unless it sets its own.')}
        </p>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={showAll ? 'all' : 'set'}
          onValueChange={(v) => v && setShowAll(v === 'all')}
          aria-label="Which doctrine groups to show"
        >
          <ToggleGroupItem value="set">Set</ToggleGroupItem>
          <ToggleGroupItem value="all">All {groups.length}</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {visible.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No doctrines set. Switch to <span className="font-medium">All</span> to pick some.
        </p>
      )}

      {[...byCategory].map(([category, list]) => {
        const open = !collapsed.has(category)
        return (
          <Collapsible key={category} open={open} onOpenChange={() => toggleCategory(category)}>
            <CollapsibleTrigger className="mb-2 flex w-full cursor-pointer items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground">
              <ChevronRight
                className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
              />
              <span className="truncate">{CATEGORY_LABELS[category] ?? category}</span>
              <span className="shrink-0">· {list.length}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3.5">
              {list.map(groupControl)}
            </CollapsibleContent>
          </Collapsible>
        )
      })}

      {extra.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs tracking-wide text-muted-foreground uppercase">
            Ungrouped
          </Label>
          <p className="text-xs text-muted-foreground">
            Held doctrines that belong to no group definition the scan found.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {entriesFor(ungrouped, extra).map((entry) => (
              <ReferenceBadge
                key={entry.id}
                entry={entry}
                locate={() => locate(entry.id)}
                onRemove={
                  disabled ? undefined : () => onChange(doctrines.filter((d) => d !== entry.id))
                }
              />
            ))}
          </div>
          {!disabled && (
            <ReferenceInput
              options={ungrouped.filter((o) => !doctrines.includes(o.id))}
              placeholder="Add ungrouped doctrine…"
              onAdd={(v) => onChange([...doctrines, v])}
            />
          )}
        </div>
      )}
    </div>
  )
}
