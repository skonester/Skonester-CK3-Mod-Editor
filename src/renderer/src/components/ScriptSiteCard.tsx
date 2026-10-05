import { useState } from 'react'
import { Code, ExternalLink, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ScriptHop, ScriptSite } from '@shared/types'
import { validateScriptFragment } from '@shared/scriptValidation'
import Hint from './Hint'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/** Strip the indentation every line after the first shares, for display. */
export function dedentScript(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const rest = lines.slice(1).filter((l) => l.trim() !== '')
  const widths = rest.map((l) => /^[ \t]*/.exec(l)?.[0].length ?? 0)
  const cut = widths.length > 0 ? Math.min(...widths) : 0
  // The closing brace sits one level out from the body: keep the body indented under it
  const closing = lines.length > 1 && /^\s*}\s*$/.test(lines[lines.length - 1])
  const shift = closing ? Math.min(cut, /^[ \t]*/.exec(lines[lines.length - 1])?.[0].length ?? 0) : cut
  return [lines[0], ...lines.slice(1).map((l) => l.slice(Math.min(shift, /^[ \t]*/.exec(l)?.[0].length ?? 0)))]
    .join('\n')
    .replace(/\t/g, '  ')
}

const HOP_KIND: Record<ScriptHop['kind'], string> = {
  on_action: 'on_action',
  scripted_effect: 'scripted effect',
  scripted_trigger: 'scripted trigger',
  event: 'event',
  decision: 'decision',
  history: 'history',
  bookmark: 'bookmark',
  other: 'script'
}

/** "on_game_start › eddy_set_up › eddy_set_up_effect", each hop's gate beside it. */
function Chain({ hops }: { hops: ScriptHop[] }): React.JSX.Element {
  return (
    <span className="flex flex-wrap items-baseline gap-x-1">
      {hops.map((hop, i) => (
        <span key={`${hop.name}:${i}`} className="inline-flex items-baseline gap-1">
          {i > 0 && <span aria-hidden>›</span>}
          <span className="font-mono text-foreground" title={HOP_KIND[hop.kind]}>
            {hop.name}
          </span>
          {hop.condition && (
            <span className="font-mono" title={hop.condition}>
              (if {hop.condition.length > 60 ? `${hop.condition.slice(0, 60)}…` : hop.condition})
            </span>
          )}
        </span>
      ))}
    </span>
  )
}

interface Props {
  site: ScriptSite
  modPath: string
  onChange: (text: string) => void
  /**
   * Fields for what the statement does, drawn above its script. Without them
   * the script itself is shown; with them it stays behind the edit toggle.
   */
  children?: React.ReactNode
  /** Draw a single-line statement as a one-line input instead of a card body */
  compact?: boolean
}

/**
 * One statement of the mod's script that touches the entity being edited:
 * what it means, where it lives, how the game gets to it, and the statement
 * itself, editable in place. Removing it empties its text, which the save
 * turns into deleting just that statement.
 */
export default function ScriptSiteCard({
  site,
  modPath,
  onChange,
  children,
  compact = false
}: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const edited = site.text !== site.diskText
  const removed = site.text === ''
  const problem = removed ? null : validateScriptFragment(site.text)
  const oneLine = compact && !site.diskText.includes('\n')

  const open = async (): Promise<void> => {
    const result = await window.ck3tools.openInEditor(`${modPath}/${site.file}`, site.line)
    if (!result.ok) toast.error(result.error)
  }

  return (
    <div
      className={cn(
        'space-y-2 rounded-md border p-3',
        edited && 'border-primary/50',
        removed && 'border-destructive/50 bg-destructive/5'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            {site.summary}
            {site.context === 'trigger' && <Badge variant="outline">condition</Badge>}
            {removed ? (
              <Badge variant="destructive">removed on save</Badge>
            ) : (
              edited && (
                <span className="size-2 rounded-full bg-primary" title="Unsaved changes" />
              )
            )}
          </p>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={site.path.join(' › ')}>
            {site.file}:{site.line}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!oneLine && !removed && (
            <Button
              variant={editing ? 'secondary' : 'ghost'}
              size="icon-sm"
              title={editing ? 'Hide the script' : 'Edit the script'}
              aria-pressed={editing}
              onClick={() => setEditing(!editing)}
            >
              <Code />
            </Button>
          )}
          {edited && !removed && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Undo the changes to this statement"
              onClick={() => onChange(site.diskText)}
            >
              <Undo2 />
            </Button>
          )}
          {removed ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Keep this statement"
              onClick={() => onChange(site.diskText)}
            >
              <RotateCcw />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Remove this statement from the mod"
              onClick={() => onChange('')}
            >
              <Trash2 />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            title="Open the file at this line in your text editor"
            onClick={open}
          >
            <ExternalLink />
          </Button>
        </div>
      </div>

      {site.reachedFrom.map((hops, i) => (
        <Hint key={i} label="Runs via" value={<Chain hops={hops} />} />
      ))}
      {site.conditions.map((c, i) => (
        <Hint key={`c${i}`} label="Only if" value={<span className="font-mono">{c}</span>} />
      ))}

      {removed ? (
        <pre className="overflow-x-auto font-mono text-xs text-muted-foreground line-through">
          {dedentScript(site.diskText)}
        </pre>
      ) : oneLine ? (
        <Input
          className="font-mono"
          value={site.text}
          spellCheck={false}
          aria-invalid={problem !== null || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <>
          {children}
          {editing ? (
            <Textarea
              className="max-h-96 font-mono text-xs"
              value={site.text}
              spellCheck={false}
              aria-invalid={problem !== null || undefined}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : (
            !children && (
              <pre className="max-h-60 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-xs">
                {dedentScript(site.text)}
              </pre>
            )
          )}
        </>
      )}
      {problem && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  )
}
