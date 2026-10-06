import { useContext, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import type {
  DescNode,
  EntityCard,
  EntityKey,
  EventStory,
  FollowUp,
  Line,
  OnActionStory,
  Rich,
  StoryOption,
  StoryOrigin,
  UsageSummary
} from '@crusaderpope/shared/api'
import { api } from '@crusaderpope/renderer/src/api'
import { GameImg } from '@crusaderpope/renderer/src/img'
import { useRevision } from '@crusaderpope/renderer/src/revision'
import { FollowCtx, LineList, ReadCtx, RichText } from './rich'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/**
 * An entry's script read as plain language — CrusaderPope's readable view
 * (its StoryView), read-only: an event as a timeline with its texts, options,
 * conditions and effects and the events they lead to; an on_action as what it
 * fires; anything else as a card of its facts and sections.
 */

/** How many levels of follow-up events open by themselves */
const AUTO_DEPTH = 2

const plain = (r: Rich): string => r.map((s) => (typeof s === 'string' ? s : s.text)).join('')
const isEventStory = (s: EventStory | OnActionStory): s is EventStory => 'options' in s

function Section({
  title,
  children,
  className
}: {
  title: React.ReactNode
  children: React.ReactNode
  className?: string
}): React.JSX.Element | null {
  if (!children) return null
  return (
    <section className={cn('flex flex-col gap-1', className)}>
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
      {children}
    </section>
  )
}

function hasVisible(lines: { hidden?: boolean }[], showHidden: boolean): boolean {
  return lines.some((l) => showHidden || !l.hidden)
}

/** A long text folded to a few lines until clicked */
function Prose({ rich, clamp }: { rich: Rich; clamp?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(!clamp)
  const long = plain(rich).length > 320
  return (
    <div
      className={cn(
        'text-sm leading-relaxed whitespace-pre-line',
        !open && long && 'line-clamp-3 cursor-pointer'
      )}
      onClick={!open && long ? () => setOpen(true) : undefined}
    >
      <RichText rich={rich} />
    </div>
  )
}

/** The first text of a description (a nested event's preview) */
function firstText(n: DescNode | undefined): DescNode | undefined {
  return !n || n.kind === 'text' ? n : firstText(n.kids?.[0])
}

/** A description as written: a text, parts one after another, or versions (the first shown, the others on request) */
function DescView({ node }: { node: DescNode }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  if (node.kind === 'text') return <Prose rich={node.text ?? []} />
  const kids = node.kids ?? []
  const choice = node.kind !== 'seq'
  const shown = choice && !open ? kids.slice(0, 1) : kids
  return (
    <div className="flex flex-col gap-2">
      {shown.map((k, i) => (
        <div key={i} className={cn(choice && i > 0 && 'border-l-2 pl-3')}>
          {(k.when || k.otherwise) && (
            <div className="text-xs text-muted-foreground">
              <RichText rich={k.when ?? ['Otherwise:']} />
            </div>
          )}
          <DescView node={k} />
        </div>
      ))}
      {choice && kids.length > 1 && (
        <Button variant="ghost" size="xs" className="self-start" onClick={() => setOpen((v) => !v)}>
          {open
            ? 'Hide other versions'
            : `${kids.length - 1} more ${node.kind === 'random' ? 'random ' : ''}version${kids.length > 2 ? 's' : ''}`}
        </Button>
      )}
    </div>
  )
}

/** Where an event or on_action is fired from */
function Origins({ origins }: { origins: StoryOrigin[] }): React.JSX.Element {
  const { follow } = useContext(ReadCtx)
  const [all, setAll] = useState(false)
  if (origins.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Started by the game itself (not fired from script).
      </p>
    )
  }
  const shown = all ? origins : origins.slice(0, 8)
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Comes from</span>
      {shown.map((o) => (
        <Badge
          key={o.ref.type + o.ref.name}
          variant="outline"
          className="cursor-pointer"
          title={o.typeLabel}
          onClick={() => follow(o.ref)}
        >
          {o.label}
          {o.when && <span className="text-muted-foreground"> · {o.when}</span>}
        </Badge>
      ))}
      {origins.length > 8 && !all && (
        <Button variant="ghost" size="xs" onClick={() => setAll(true)}>
          +{origins.length - 8} more
        </Button>
      )}
    </div>
  )
}

/**
 * Merges follow-ups to the same target (the same event fired from several
 * if-branches): identical paths once, different ones joined with "or"; any
 * unconditional path wins.
 */
function mergeFollowUps(items: FollowUp[]): FollowUp[] {
  const m = new Map<string, { f: FollowUp; alts: Rich[]; seen: Set<string>; always: boolean }>()
  for (const f of items) {
    const k = `${f.target.type}:${f.target.name}:${f.who ?? ''}`
    let e = m.get(k)
    if (!e) m.set(k, (e = { f, alts: [], seen: new Set(), always: false }))
    if (f.when.length === 0) {
      e.always = true
      continue
    }
    const alt: Rich = f.when.flatMap((r, i) => (i ? [', ', ...r] : r))
    const text = plain(alt)
    if (!e.seen.has(text)) {
      e.seen.add(text)
      e.alts.push(alt)
    }
  }
  return [...m.values()].map(({ f, alts, always }) => ({
    ...f,
    when: always || alts.length === 0 ? [] : [alts.flatMap((a, i) => (i ? [' or ', ...a] : a))]
  }))
}

const followKey = (f: FollowUp): string => `${f.target.type}:${f.target.name}:${f.who ?? ''}`

/** The follow-ups the lines show themselves, under their "Leads to …" line */
function inlineFollowUps(lines: Line[], showHidden: boolean): Set<string> {
  const out = new Set<string>()
  const walk = (ls: Line[]): void => {
    for (const l of ls) {
      if (!showHidden && l.hidden) continue
      if (l.followUp) out.add(followKey(l.followUp))
      if (l.children) walk(l.children)
    }
  }
  walk(lines)
  return out
}

function FollowUps({
  items,
  lines,
  depth,
  ancestors,
  label
}: {
  items: FollowUp[]
  lines?: Line[]
  depth: number
  ancestors: string[]
  label?: string
}): React.JSX.Element | null {
  const { showHidden } = useContext(ReadCtx)
  const inline = lines ? inlineFollowUps(lines, showHidden) : null
  const merged = mergeFollowUps(inline ? items.filter((f) => !inline.has(followKey(f))) : items)
  if (merged.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {label && <h4 className="text-xs font-medium text-muted-foreground uppercase">{label}</h4>}
      {merged.map((f, i) => (
        <FollowUpBranch key={i} f={f} depth={depth + 1} ancestors={ancestors} />
      ))}
    </div>
  )
}

function loadStory(key: EntityKey): Promise<EventStory | OnActionStory | null> {
  return api.story(key.type, key.name)
}

/** The event a trigger_event leads to: its card, loaded when opened */
function FollowUpBranch({
  f,
  depth,
  ancestors,
  inline
}: {
  f: FollowUp
  depth: number
  ancestors: string[]
  inline?: boolean
}): React.JSX.Element {
  const { follow } = useContext(ReadCtx)
  const key = `${f.target.type}:${f.target.name}`
  const loop = ancestors.includes(key)
  const isOnAction = f.target.type === 'on_action'
  const [open, setOpen] = useState(!loop && !isOnAction && depth <= AUTO_DEPTH)
  const [story, setStory] = useState<EventStory | OnActionStory | null | undefined>(undefined)
  const revision = useRevision()
  const loadedAt = useRef(-1)

  useEffect(() => {
    if (!open || (story !== undefined && loadedAt.current === revision)) return
    let cancelled = false
    void loadStory(f.target).then((s) => {
      if (cancelled) return
      loadedAt.current = revision
      setStory((old) => (old && s && JSON.stringify(old) === JSON.stringify(s) ? old : s))
    })
    return () => {
      cancelled = true
    }
  }, [open, story, revision, f.target])

  if (loop) {
    return (
      <Button variant="ghost" size="xs" className="self-start" onClick={() => follow(f.target)}>
        <RotateCcw />
        Loops back to {f.label}
      </Button>
    )
  }
  return (
    <div className={cn('flex flex-col gap-1', f.hidden && 'opacity-70')}>
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1.5 self-start rounded px-1 text-xs hover:bg-muted"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span className="font-medium">{isOnAction ? `Something from “${f.label}”` : f.label}</span>
        {!inline && f.delay && <Badge variant="secondary">{f.delay}</Badge>}
        {!inline && f.who && <Badge variant="secondary">for {f.who}</Badge>}
        {!inline &&
          f.when.map((w, i) => (
            <Badge key={i} variant="outline" className="font-normal">
              <RichText rich={w} />
            </Badge>
          ))}
      </button>
      {open && (
        <div className="ml-2 border-l-2 pl-3">
          {story === undefined ? (
            <Spinner />
          ) : story === null ? (
            <p className="text-xs text-muted-foreground">{f.label} (not found)</p>
          ) : isEventStory(story) ? (
            <EventNode story={story} depth={depth} ancestors={ancestors} />
          ) : (
            <OnActionNode story={story} depth={depth} ancestors={ancestors} />
          )}
        </div>
      )}
    </div>
  )
}

function OptionView({
  o,
  depth,
  path
}: {
  o: StoryOption
  depth: number
  path: string[]
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-muted/20 p-2.5">
      <div className="text-sm font-medium">
        <RichText rich={o.text} />
        {o.fallback && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">(fallback)</span>
        )}
      </div>
      {o.conditions.length > 0 && (
        <div className="flex gap-2 text-xs">
          <span className="shrink-0 text-muted-foreground">Only if</span>
          <LineList lines={o.conditions} compact />
        </div>
      )}
      <LineList lines={o.effects} />
      <FollowUps items={o.followUps} lines={o.effects} depth={depth} ancestors={path} />
    </div>
  )
}

function EventNode({
  story,
  depth,
  ancestors
}: {
  story: EventStory
  depth: number
  ancestors: string[]
}): React.JSX.Element {
  const { showHidden, follow } = useContext(ReadCtx)
  const [showConds, setShowConds] = useState(depth === 0)
  const path = [...ancestors, `${story.key.type}:${story.key.name}`]
  const nested = depth > 0
  const followUp = (f: FollowUp): React.ReactNode => (
    <FollowUpBranch f={f} depth={depth + 1} ancestors={path} inline />
  )
  return (
    <FollowCtx.Provider value={followUp}>
      <div className={cn('flex flex-col gap-3', story.hidden && 'opacity-80')}>
        {story.illustration && (
          <GameImg
            path={story.illustration}
            size={nested ? 640 : 1000}
            className={cn('w-full rounded-md object-cover', nested ? 'max-h-32' : 'max-h-64')}
          />
        )}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {story.icon && <GameImg path={story.icon} size={20} className="size-5" />}
            {story.kindLabel}
            {story.theme && <> · {story.theme}</>}
            {story.cooldown && <> · at most once every {story.cooldown}</>}
          </div>
          <h3 className="font-heading text-base font-semibold" title={story.key.name}>
            {nested ? (
              <button
                type="button"
                className="cursor-pointer text-left underline decoration-dotted underline-offset-2"
                onClick={() => follow(story.key)}
              >
                <RichText rich={story.title} />
              </button>
            ) : (
              <RichText rich={story.title} />
            )}
          </h3>
          {story.portraits.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {story.portraits.map((p, i) => (
                <Badge key={i} variant="secondary" className="font-normal">
                  <RichText rich={p} />
                </Badge>
              ))}
            </div>
          )}
        </div>
        {story.desc &&
          (nested ? (
            <Prose rich={firstText(story.desc)?.text ?? []} clamp />
          ) : (
            <DescView node={story.desc} />
          ))}
        {story.conditions.length > 0 && (
          <section className="flex flex-col gap-1">
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1 self-start text-xs font-medium tracking-wide text-muted-foreground uppercase"
              onClick={() => setShowConds((v) => !v)}
            >
              {showConds ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              Only happens if
            </button>
            {showConds && <LineList lines={story.conditions} />}
          </section>
        )}
        {hasVisible(story.immediate, showHidden) && (
          <Section title="Right away">
            <LineList lines={story.immediate} />
          </Section>
        )}
        {story.options.length > 0 && (
          <div className="flex flex-col gap-2">
            {story.options.map((o, i) => (
              <OptionView key={i} o={o} depth={depth} path={path} />
            ))}
          </div>
        )}
        {hasVisible(story.after, showHidden) && (
          <Section title="Afterwards">
            <LineList lines={story.after} />
          </Section>
        )}
        <FollowUps
          items={story.immediateFollowUps}
          lines={story.immediate}
          depth={depth}
          ancestors={path}
          label="Right away this also leads to"
        />
        <FollowUps
          items={story.afterFollowUps}
          lines={story.after}
          depth={depth}
          ancestors={path}
          label="Afterwards"
        />
      </div>
    </FollowCtx.Provider>
  )
}

/** Big pools (an on_action's random events) listed compactly; each unfolds into its story */
function PoolList({
  title,
  items,
  depth,
  ancestors
}: {
  title: string
  items: FollowUp[]
  depth: number
  ancestors: string[]
}): React.JSX.Element | null {
  const [limit, setLimit] = useState(25)
  if (items.length === 0) return null
  return (
    <Section title={`${title} (${items.length})`}>
      <div className="flex flex-col gap-1">
        {items.slice(0, limit).map((f, i) => (
          <FollowUpBranch
            key={i}
            f={f}
            depth={Math.max(depth + 1, AUTO_DEPTH + 1)}
            ancestors={ancestors}
          />
        ))}
      </div>
      {items.length > limit && (
        <Button
          variant="ghost"
          size="xs"
          className="self-start"
          onClick={() => setLimit((l) => l + 100)}
        >
          Show {items.length - limit} more
        </Button>
      )}
    </Section>
  )
}

function OnActionNode({
  story,
  depth,
  ancestors
}: {
  story: OnActionStory
  depth: number
  ancestors: string[]
}): React.JSX.Element {
  const { follow } = useContext(ReadCtx)
  const path = [...ancestors, `${story.key.type}:${story.key.name}`]
  const nested = depth > 0
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <div className="text-xs text-muted-foreground">Game moment (on_action)</div>
        <h3 className="font-heading text-base font-semibold" title={story.key.name}>
          {nested ? (
            <button
              type="button"
              className="cursor-pointer underline decoration-dotted underline-offset-2"
              onClick={() => follow(story.key)}
            >
              {story.label}
            </button>
          ) : (
            story.label
          )}
        </h3>
        {story.doc && <p className="text-xs text-muted-foreground">{story.doc}</p>}
      </div>
      {story.conditions.length > 0 && (
        <Section title="Only if">
          <LineList lines={story.conditions} />
        </Section>
      )}
      {story.effects.length > 0 && (
        <Section title="Effects">
          <LineList lines={story.effects} />
        </Section>
      )}
      {story.noEventChance && (
        <p className="text-xs text-muted-foreground">{story.noEventChance}</p>
      )}
      <PoolList title="Always fires" items={story.events} depth={depth} ancestors={path} />
      <PoolList
        title="Picks one at random"
        items={story.randomEvents}
        depth={depth}
        ancestors={path}
      />
      <PoolList
        title="First one that applies"
        items={story.firstValid}
        depth={depth}
        ancestors={path}
      />
      <PoolList title="Also triggers" items={story.onActions} depth={depth} ancestors={path} />
      <FollowUps
        items={story.effectFollowUps}
        depth={depth}
        ancestors={path}
        label="Effects lead to"
      />
    </div>
  )
}

/** How many of a revealed "Used by" row show at once */
const USAGE_PAGE = 500

/** One "Used by" row: the count and the entries using it most; "… N more" reveals them all */
function UsageRow({ u, of }: { u: UsageSummary; of: EntityKey }): React.JSX.Element {
  const { follow } = useContext(ReadCtx)
  const [all, setAll] = useState<UsageSummary['examples'] | null>(null)
  const [shown, setShown] = useState(USAGE_PAGE)
  const [loading, setLoading] = useState(false)
  const list = all ?? u.examples
  const visible = all ? list.slice(0, shown) : list
  const hidden = (all ? list.length : u.count) - visible.length
  const more = (): void => {
    if (all) {
      setShown((n) => n + USAGE_PAGE * 2)
      return
    }
    setLoading(true)
    void api
      .usageAll(of.type, of.name, u.type)
      .then((l) => setAll(l))
      .finally(() => setLoading(false))
  }
  return (
    <div className="text-sm">
      <span className="font-medium">
        {u.count} {u.typeLabel.toLowerCase()}:{' '}
      </span>
      {visible.map((x, i) => (
        <span key={i}>
          {i > 0 && ', '}
          <button
            type="button"
            className="cursor-pointer underline decoration-dotted underline-offset-2"
            onClick={() => follow(x.ref)}
          >
            {x.label}
          </button>
        </span>
      ))}
      {hidden > 0 && (
        <Button variant="link" size="xs" className="h-auto px-1" disabled={loading} onClick={more}>
          {loading ? '…' : `… ${hidden} more`}
        </Button>
      )}
    </div>
  )
}

function CardView({ card }: { card: EntityCard }): React.JSX.Element {
  const sections = card.sections.filter((s) => s.lines.length > 0)
  const ancestors = [`${card.key.type}:${card.key.name}`]
  return (
    <div className="flex flex-col gap-4">
      {card.illustration && (
        <GameImg
          path={card.illustration}
          size={760}
          className="max-h-56 w-full rounded-md object-cover"
        />
      )}
      <div className="flex items-start gap-3">
        {card.icon && <GameImg path={card.icon} size={64} className="size-16 shrink-0" />}
        <div>
          <div className="text-xs text-muted-foreground">{card.typeLabel}</div>
          <h3 className="font-heading text-lg font-semibold">{card.title}</h3>
        </div>
      </div>
      {card.description && <Prose rich={card.description} />}
      {card.facts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {card.facts.map((f, i) => (
            <Badge key={i} variant="secondary" className="font-normal">
              <RichText rich={f} />
            </Badge>
          ))}
        </div>
      )}
      {sections.map((s, i) => (
        <Section key={i} title={s.title}>
          <FollowCtx.Provider
            value={(f) => <FollowUpBranch f={f} depth={1} ancestors={ancestors} inline />}
          >
            <LineList lines={s.lines} />
          </FollowCtx.Provider>
          {s.followUps && s.followUps.length > 0 && (
            <FollowUps
              items={s.followUps}
              lines={s.lines}
              depth={0}
              ancestors={ancestors}
              label="Leads to"
            />
          )}
        </Section>
      ))}
      {sections.length === 0 && !card.description && card.facts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No readable details — open the script for the raw text.
        </p>
      )}
      {card.usage.length > 0 && (
        <Section title="Used by">
          {card.usage.map((u) => (
            <UsageRow key={u.type} u={u} of={card.key} />
          ))}
        </Section>
      )}
    </div>
  )
}

/** The readable view of one entry: event timeline, on_action overview, or card */
export default function StoryView({ entry }: { entry: EntityKey }): React.JSX.Element {
  const [card, setCard] = useState<EntityCard | null | undefined>(undefined)
  // An index update (a save): read again — the old card stays until the new one is there
  const revision = useRevision()
  useEffect(() => setCard(undefined), [entry.type, entry.name])
  useEffect(() => {
    let cancelled = false
    void api.card(entry.type, entry.name).then((c) => {
      if (!cancelled)
        setCard((old) => (old && c && JSON.stringify(old) === JSON.stringify(c) ? old : c))
    })
    return () => {
      cancelled = true
    }
  }, [entry.type, entry.name, revision])

  if (card === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Reading the chronicles…
      </div>
    )
  }
  if (card === null) return <p className="text-sm text-muted-foreground">Nothing to show.</p>
  if (card.event) {
    return (
      <div className="flex flex-col gap-3">
        <Origins origins={card.event.origins} />
        <EventNode story={card.event} depth={0} ancestors={[]} />
      </div>
    )
  }
  if (card.onAction) {
    return (
      <div className="flex flex-col gap-3">
        <Origins origins={card.onAction.origins} />
        <OnActionNode story={card.onAction} depth={0} ancestors={[]} />
      </div>
    )
  }
  return <CardView card={card} />
}
