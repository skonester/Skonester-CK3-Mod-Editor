import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, BookOpen, ChevronRight, Map as MapIcon, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import type {
  EntityReferences,
  IndexRefGroup,
  IndexRefItem,
  IndexSite,
  IndexType
} from '@shared/types'
import { useApp } from '../AppContext'
import { editorTarget, modTouchLabel, siteLabel } from '@/lib/indexLinks'
import FormSection from './FormSection'
import Hint from './Hint'
import ReferenceLabel from './ReferenceLabel'
import { useReader } from './story/ReaderProvider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Items per group in the first answer; "Show all" asks for the rest */
const LIMIT = 50
/** Rows drawn at a time once a group is shown whole (a rite has 20,000+ characters) */
const PAGE = 200
/** Sites listed per item before the rest fold into "+N" */
const SITES_SHOWN = 3

type Direction = 'incoming' | 'outgoing'

/** The types the map can show an entry of (a title, or a culture/faith/religion layer's thing) */
const MAP_TYPES = new Set<string>(['landed_titles', 'culture/cultures', 'faith', 'religion/religion_types'])

async function openSite(site: { path: string | null; line: number; file: string }): Promise<void> {
  if (!site.path) {
    toast.error(`${site.file} is inside a packed mod and can't be opened`)
    return
  }
  const result = await window.ck3tools.openInEditor(site.path, site.line)
  if (!result.ok) toast.error(result.error)
}

function SiteLink({ site }: { site: IndexSite }): React.JSX.Element {
  return (
    <Button
      variant="link"
      size="xs"
      className="h-auto gap-0.5 p-0 font-mono text-xs font-normal text-muted-foreground"
      title={`Open ${site.file}, line ${site.line}, in the text editor`}
      onClick={() => void openSite(site)}
    >
      {siteLabel(site.file, site.line)}
    </Button>
  )
}

function RefRow({ item }: { item: IndexRefItem }): React.JSX.Element {
  const navigate = useNavigate()
  const target = editorTarget(item.type, item.name, item.def)
  const entry = { id: item.name, name: item.display ?? null }
  const more = item.sites.length - SITES_SHOWN

  const read = useReader()
  // Entries with an editor here open in it; the rest are read as plain language
  const open = (): void => {
    if (target) void navigate(target)
    else read({ type: item.type, name: item.name })
  }

  return (
    <li className="flex flex-col gap-0.5 rounded-md px-2 py-1 hover:bg-muted/50">
      <div className="flex min-w-0 items-center gap-2">
        {target || item.def ? (
          <Button
            variant="link"
            size="sm"
            className="group h-auto min-w-0 justify-start gap-1 p-0 text-left font-normal text-foreground"
            title={target ? 'Open in its editor' : 'Read it as plain language'}
            onClick={open}
          >
            <ReferenceLabel entry={entry} nameClassName="underline decoration-dotted underline-offset-2" />
            {target ? (
              <ArrowRight className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
            ) : (
              <BookOpen className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
            )}
          </Button>
        ) : (
          <ReferenceLabel entry={entry} className="text-sm" />
        )}
        {item.mod && (
          <Badge variant="outline" className="shrink-0" title={modTouchLabel(item.mod)?.detail}>
            {modTouchLabel(item.mod)?.label}
          </Badge>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-0.5">
        {item.contexts.length > 0 && (
          <span
            className="min-w-0 truncate font-mono text-xs text-muted-foreground/80"
            title={item.contexts.join('\n')}
          >
            {item.contexts[0]}
          </span>
        )}
        {item.sites.slice(0, SITES_SHOWN).map((s, i) => (
          <SiteLink key={i} site={s} />
        ))}
        {more > 0 && (
          <span
            className="text-xs text-muted-foreground"
            title={item.sites
              .slice(SITES_SHOWN)
              .map((s) => siteLabel(s.file, s.line))
              .join('\n')}
          >
            +{more}
          </span>
        )}
      </div>
    </li>
  )
}

function RefGroupView({
  group,
  defaultOpen,
  onShowAll,
  loadingAll
}: {
  group: IndexRefGroup
  defaultOpen: boolean
  onShowAll: () => void
  loadingAll: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const [shown, setShown] = useState(PAGE)
  const partial = group.items.length < group.total
  const rows = group.items.slice(0, shown)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-sm hover:bg-muted">
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate">{group.typeLabel}</span>
        <Badge variant="secondary">{group.total.toLocaleString()}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="ml-3 border-l pl-1">
          {rows.map((item) => (
            <RefRow key={`${item.type}:${item.name}`} item={item} />
          ))}
        </ul>
        {(partial || rows.length < group.items.length) && (
          <div className="ml-4 flex items-center gap-2 py-1">
            <span className="text-xs text-muted-foreground">
              {rows.length.toLocaleString()} of {group.total.toLocaleString()}
            </span>
            {partial ? (
              <Button variant="outline" size="xs" disabled={loadingAll} onClick={onShowAll}>
                {loadingAll && <Spinner />}
                Show all
              </Button>
            ) : (
              <Button variant="outline" size="xs" onClick={() => setShown((n) => n + PAGE)}>
                Show more
              </Button>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function RefGroups({
  groups,
  emptyText,
  onShowAll,
  loadingAll
}: {
  groups: IndexRefGroup[]
  emptyText: string
  onShowAll: (groupType: string) => void
  loadingAll: string | null
}): React.JSX.Element {
  if (groups.length === 0) return <p className="px-1 text-sm text-muted-foreground">{emptyText}</p>
  return (
    <div className="flex flex-col gap-0.5">
      {groups.map((g) => (
        <RefGroupView
          key={g.type}
          group={g}
          // A handful of groups reads at a glance; more, and they start folded
          defaultOpen={groups.length <= 3 && g.total <= 20}
          onShowAll={() => onShowAll(g.type)}
          loadingAll={loadingAll === g.type}
        />
      ))}
    </div>
  )
}

/** Where the entry is defined: each definition with its origin, the winning one last */
function Definitions({ refs }: { refs: EntityReferences }): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-0.5">
      {refs.defs.map((d, i) => (
        <li key={i} className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
          <Badge variant={d.origin?.mod ? 'default' : 'secondary'}>{d.origin?.name ?? 'Game'}</Badge>
          <SiteLink site={d} />
          {d.overridden && <span className="text-xs text-muted-foreground">overridden</span>}
          {d.origin?.hiddenBy && (
            <span className="text-xs text-muted-foreground">
              file hidden by {d.origin.hiddenBy.name} (
              {d.origin.hiddenBy.how === 'file' ? 'same path' : 'replace_path'})
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

const total = (groups: IndexRefGroup[]): number => groups.reduce((n, g) => n + g.total, 0)

/**
 * "References": everything in the game and the selected mod that uses this
 * entry, and everything it uses — from the game index (CrusaderPope's
 * cross-reference scanner). Entries the app has an editor for open there;
 * the rest open at their line in the text editor.
 */
export default function EntityReferencesSection({
  type,
  id
}: {
  type: IndexType
  id: string
}): React.JSX.Element {
  const { settings, indexStatus, reindex } = useApp()
  /** undefined while loading; null when the index doesn't know the entry */
  const [refs, setRefs] = useState<EntityReferences | null | undefined>(undefined)
  const [tab, setTab] = useState<Direction>('incoming')
  const [loadingAll, setLoadingAll] = useState<string | null>(null)
  const revision = indexStatus.state === 'ready' ? (indexStatus.revision ?? 0) : null

  // A new entry starts blank; an index update (a save) refetches in place, so
  // the list doesn't flash and opened groups stay open
  useEffect(() => setRefs(undefined), [type, id])
  useEffect(() => {
    if (revision === null) return
    let live = true
    void window.ck3tools.getReferences(type, id, LIMIT).then((r) => {
      if (live) setRefs(r)
    })
    return () => {
      live = false
    }
  }, [type, id, revision])

  const showAll = async (direction: Direction, groupType: string): Promise<void> => {
    setLoadingAll(groupType)
    try {
      const r = await window.ck3tools.getReferences(type, id, LIMIT, { direction, type: groupType })
      const full = r?.[direction].find((g) => g.type === groupType)
      if (!full) return
      setRefs((cur) =>
        cur && {
          ...cur,
          [direction]: cur[direction].map((g) => (g.type === groupType ? full : g))
        }
      )
    } finally {
      setLoadingAll(null)
    }
  }

  const touch = refs ? modTouchLabel(refs.mod) : null
  const navigate = useNavigate()
  const read = useReader()
  const onMap = refs && MAP_TYPES.has(type)
  const action =
    refs ? (
      <span className="flex items-center gap-1">
        <Button
          variant="outline"
          size="xs"
          title="Its script as plain language: what it is, does and is made of"
          onClick={() => read({ type, name: id })}
        >
          <BookOpen />
          Read
        </Button>
        {onMap && (
          <Button
            variant="outline"
            size="xs"
            title="Show it on the map"
            onClick={() => void navigate({ to: '/map', search: { focus: `${type}:${id}` } })}
          >
            <MapIcon />
            Show on map
          </Button>
        )}
        {touch && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline">{touch.label}</Badge>
            </TooltipTrigger>
            <TooltipContent>{touch.detail}</TooltipContent>
          </Tooltip>
        )}
        {refs.mod?.duplicate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline">Defined {refs.defs.length}×</Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              The game loads more than one definition of this entry and keeps no single winner —
              unless one sets history_override_priority, which one applies is undefined.
            </TooltipContent>
          </Tooltip>
        )}
      </span>
    ) : undefined

  let body: React.ReactNode
  if (settings?.gameIndex === false) {
    body = <Hint value="The game index is off. Turn it on in Settings to see what uses this." />
  } else if (indexStatus.state === 'indexing') {
    const pct = indexStatus.total ? (100 * (indexStatus.done ?? 0)) / indexStatus.total : 0
    body = (
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Indexing the game — {indexStatus.phase ?? 'starting'}…
        </span>
        <Progress value={pct} className="h-1" />
      </div>
    )
  } else if (indexStatus.state === 'error') {
    body = (
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm break-words text-destructive">
          {indexStatus.message?.split('\n')[0] ?? 'The game index failed.'}
        </p>
        <Button variant="outline" size="xs" onClick={reindex}>
          <RotateCw />
          Retry
        </Button>
      </div>
    )
  } else if (indexStatus.state === 'idle') {
    body = <Hint value="The game index starts once the game directory is set." />
  } else if (refs === undefined) {
    body = (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Looking up references…
      </span>
    )
  } else if (refs === null) {
    body = <Hint value={`The game index has no entry "${id}" — save it first, if it's new.`} />
  } else {
    body = (
      <div key={`${type}:${id}`} className="flex flex-col gap-3">
        <Definitions refs={refs} />
        <Tabs value={tab} onValueChange={(v) => setTab(v as Direction)}>
          <TabsList>
            <TabsTrigger value="incoming">Used by · {total(refs.incoming).toLocaleString()}</TabsTrigger>
            <TabsTrigger value="outgoing">Uses · {total(refs.outgoing).toLocaleString()}</TabsTrigger>
          </TabsList>
          <TabsContent value="incoming">
            <RefGroups
              groups={refs.incoming}
              emptyText="Nothing in the game or the mod refers to this."
              onShowAll={(g) => void showAll('incoming', g)}
              loadingAll={loadingAll}
            />
          </TabsContent>
          <TabsContent value="outgoing">
            <RefGroups
              groups={refs.outgoing}
              emptyText="This refers to nothing the index knows."
              onShowAll={(g) => void showAll('outgoing', g)}
              loadingAll={loadingAll}
            />
          </TabsContent>
        </Tabs>
      </div>
    )
  }

  return (
    <FormSection title="References" action={action}>
      {body}
    </FormSection>
  )
}
