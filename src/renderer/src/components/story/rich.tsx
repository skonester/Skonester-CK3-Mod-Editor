import { createContext, useContext, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { EntityKey, FollowUp, Line, Rich, TooltipInfo } from '@crusaderpope/shared/api'
import { api } from '@crusaderpope/renderer/src/api'
import { GameImg } from '@crusaderpope/renderer/src/img'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'

/**
 * Plain-language script, as CrusaderPope's describer writes it (its rich.tsx,
 * read-only): rich text with links, values and scopes, and lists of lines —
 * effects, conditions, if/else chains, nested blocks, "leads to" follow-ups.
 */

/** Glyph per line icon, as CrusaderPope draws them */
const ICONS: Record<string, string> = {
  event: '✦',
  trait: '◆',
  gold: '●',
  prestige: '♛',
  piety: '✝',
  stress: 'ϟ',
  dread: '☠',
  opinion: '♥',
  modifier: '◈',
  flag: '⚑',
  var: '✎',
  chance: '⚄',
  death: '☠',
  scope: '➤',
  if: '⤷',
  else: '⤷',
  loop: '⟳',
  note: '✉',
  skill: '★',
  call: '⚙'
}

/** How the reader follows a link, and whether behind-the-scenes lines show */
export const ReadCtx = createContext<{ follow: (key: EntityKey) => void; showHidden: boolean }>({
  follow: () => {},
  showHidden: false
})

/** How a "Leads to …" line shows the event it leads to, right under itself; none: the line alone */
export const FollowCtx = createContext<((f: FollowUp) => ReactNode) | null>(null)

const tooltipCache = new Map<string, Promise<TooltipInfo | null>>()
function fetchTooltip(key: EntityKey): Promise<TooltipInfo | null> {
  const k = `${key.type}\u0000${key.name}`
  let p = tooltipCache.get(k)
  if (!p) {
    p = api.tooltip(key.type, key.name)
    tooltipCache.set(k, p)
  }
  return p
}

/** An entry's hover card: its icon, kind, description and what it does */
function EntityHover({
  entity,
  children
}: {
  entity: EntityKey
  children: ReactNode
}): React.JSX.Element {
  const [info, setInfo] = useState<TooltipInfo | null | undefined>(undefined)
  return (
    <HoverCard
      openDelay={350}
      onOpenChange={(open) => {
        if (open && info === undefined) void fetchTooltip(entity).then(setInfo)
      }}
    >
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-80 text-sm">
        {info === undefined ? (
          <span className="text-muted-foreground">…</span>
        ) : info === null ? (
          <span className="text-muted-foreground">{entity.name}</span>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start gap-2">
              {info.icon && <GameImg path={info.icon} size={36} className="size-9 shrink-0" />}
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{info.typeLabel}</div>
                <div className="font-heading font-medium">{info.title}</div>
              </div>
            </div>
            {info.description && (
              <p className="text-xs text-muted-foreground">{info.description}</p>
            )}
            {info.lines.length > 0 && <LineList lines={info.lines.slice(0, 12)} compact />}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

export function RichText({ rich }: { rich: Rich }): React.JSX.Element {
  const { follow } = useContext(ReadCtx)
  return (
    <>
      {rich.map((s, i) => {
        if (typeof s === 'string') return <span key={i}>{s}</span>
        const cls = cn(
          s.kind === 'value' && 'font-semibold tabular-nums',
          s.kind === 'scope' && 'font-medium italic',
          s.kind === 'ph' && 'text-muted-foreground italic',
          s.kind === 'code' && 'font-mono text-[0.9em]',
          s.kind === 'good' && 'font-medium text-primary',
          s.kind === 'bad' && 'font-medium text-destructive',
          s.kind === 'entity' && 'font-medium'
        )
        if (s.ref) {
          const ref = s.ref
          return (
            <EntityHover key={i} entity={ref}>
              <button
                type="button"
                className={cn(
                  cls,
                  'cursor-pointer underline decoration-dotted underline-offset-2 hover:decoration-solid'
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  follow(ref)
                }}
              >
                {s.text}
              </button>
            </EntityHover>
          )
        }
        return (
          <span key={i} className={cls} title={s.tip}>
            {s.kind === 'color' && (
              <span
                className="mr-1 inline-block size-2.5 rounded-sm border align-baseline"
                style={{ background: s.text }}
              />
            )}
            {s.text}
          </span>
        )
      })}
    </>
  )
}

export function LineList({
  lines,
  compact
}: {
  lines: Line[]
  compact?: boolean
}): React.JSX.Element | null {
  const { showHidden } = useContext(ReadCtx)
  const visible = lines.filter((l) => showHidden || !l.hidden)
  if (visible.length === 0) return null
  return (
    <ul className={cn('flex flex-col', compact ? 'gap-0' : 'gap-0.5')}>
      {visible.map((l, i) => (
        <LineItem key={i} line={l} compact={compact} />
      ))}
    </ul>
  )
}

function LineItem({ line, compact }: { line: Line; compact?: boolean }): React.JSX.Element {
  const { showHidden } = useContext(ReadCtx)
  const follow = useContext(FollowCtx)
  const [open, setOpen] = useState(!line.collapsed)
  const kids = (line.children ?? []).filter((c) => showHidden || !c.hidden)
  const expandable = !!line.collapsed && kids.length > 0
  return (
    <li className={cn(line.hidden && 'opacity-60')}>
      <div
        className={cn(
          'flex items-start gap-1.5 rounded px-1',
          compact ? 'text-xs' : 'text-sm',
          expandable && 'cursor-pointer hover:bg-muted/50',
          line.tone === 'good' && 'text-primary',
          line.tone === 'bad' && 'text-destructive'
        )}
        title={line.tip}
        onClick={expandable ? () => setOpen((o) => !o) : undefined}
      >
        <span className="w-4 shrink-0 text-center text-muted-foreground">
          {ICONS[line.icon ?? ''] ?? '•'}
        </span>
        <span className="min-w-0 flex-1">
          <RichText rich={line.text} />
          {expandable &&
            (open ? (
              <ChevronDown className="ml-1 inline size-3" />
            ) : (
              <ChevronRight className="ml-1 inline size-3" />
            ))}
        </span>
      </div>
      {line.conditions && line.conditions.length > 0 && (
        <div className="ml-6 border-l pl-2">
          <LineList lines={line.conditions} compact />
        </div>
      )}
      {open && kids.length > 0 && (
        <div className="ml-6 border-l pl-2">
          <LineList lines={kids} compact={compact} />
        </div>
      )}
      {line.followUp && follow && <div className="ml-6">{follow(line.followUp)}</div>}
    </li>
  )
}
