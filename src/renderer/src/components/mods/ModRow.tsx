import { ArrowDown, ArrowUp, GripVertical, MoreHorizontal, Pencil, X } from 'lucide-react'
import type { LoadOrderMod, ModListEntry, ModsState } from '@shared/types'
import { ModThumb, SOURCE_LABEL, StatusBadge, SupportedBadge } from './modParts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface ModActions {
  setActive: (id: string | null) => void
  pack: (m: LoadOrderMod) => void
  unpack: (m: LoadOrderMod) => void
  openFolder: (m: LoadOrderMod) => void
}

/** A mod's actions: set as the selected mod, pack, unpack, open its folder */
function ModMenu({
  mod,
  state,
  busy,
  actions
}: {
  mod: LoadOrderMod
  state: ModsState
  busy: boolean
  actions: ModActions
}): React.JSX.Element {
  const active = state.activeMod === mod.id
  const packed = !!mod.archive && !mod.root
  const items: { label: string; hint: string; disabled?: string; run: () => void }[] = [
    active
      ? { label: 'Unselect it', hint: 'No mod is being edited', run: () => actions.setActive(null) }
      : {
          label: 'Select it — edit this mod',
          hint: 'The mod the editors write into',
          disabled: mod.editable
            ? undefined
            : 'Only unpacked mods in your mod folder can be edited',
          run: () => actions.setActive(mod.id)
        },
    {
      label: 'Pack into a zip',
      hint: mod.root ? `${mod.root}.zip` : '',
      disabled: mod.editable ? undefined : 'Only unpacked mods in your mod folder can be packed',
      run: () => actions.pack(mod)
    },
    {
      label: 'Unpack into the mod folder',
      hint: 'Extract the zip and point the descriptor at the folder',
      disabled: !packed
        ? 'Not a packed mod'
        : !mod.descriptorFile
          ? 'No descriptor in your mod folder'
          : undefined,
      run: () => actions.unpack(mod)
    },
    {
      label: packed ? 'Show the zip' : 'Open folder',
      hint: mod.root ?? mod.archive ?? '',
      disabled: mod.status === 'missing' ? 'The mod’s files were not found' : undefined,
      run: () => actions.openFolder(mod)
    }
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" title="Mod actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {items.map((it) => (
          <DropdownMenuItem
            key={it.label}
            disabled={!!it.disabled || busy}
            className="flex-col items-start gap-0"
            onSelect={it.run}
          >
            <span>{it.label}</span>
            <span className="truncate text-xs text-muted-foreground" title={it.disabled ?? it.hint}>
              {it.disabled ?? it.hint}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * One mod: in a list (`index` set) with its position, enabled box, drag
 * handle, ↑ ↓ and ✕; in the library without. Its facts as badges and its ⋯
 * menu either way.
 */
export default function ModRow({
  entry,
  mod,
  state,
  actions,
  busy,
  index,
  count,
  note,
  drop,
  onToggle,
  onMove,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  entry: ModListEntry
  mod?: LoadOrderMod
  state: ModsState
  actions: ModActions
  busy: boolean
  /** list rows (absent in the library) */
  index?: number
  count?: number
  note?: string
  drop?: 'before' | 'after'
  onToggle?: () => void
  onMove?: (to: number) => void
  onRemove?: () => void
  onDragStart?: () => void
  onDragOver?: (after: boolean) => void
  onDrop?: () => void
  onDragEnd?: () => void
}): React.JSX.Element {
  const inList = index !== undefined
  const i = index ?? 0
  const active = !!mod && state.activeMod === mod.id
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b px-2 py-2',
        inList && !entry.enabled && 'opacity-60',
        drop === 'before' && 'border-t-2 border-t-primary',
        drop === 'after' && 'border-b-2 border-b-primary',
        active && 'bg-primary/5'
      )}
      draggable={inList && !busy}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', entry.id)
        onDragStart?.()
      }}
      onDragOver={(e) => {
        if (!inList) return
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect()
        onDragOver?.(e.clientY > r.top + r.height / 2)
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop?.()
      }}
      onDragEnd={onDragEnd}
    >
      {inList && (
        <>
          <GripVertical
            className="size-4 shrink-0 cursor-grab text-muted-foreground"
            aria-label="Drag to reorder"
          />
          <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
          <Checkbox
            checked={entry.enabled}
            disabled={busy}
            onCheckedChange={() => onToggle?.()}
            title={entry.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
          />
        </>
      )}
      <ModThumb mod={mod} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{mod?.name ?? entry.id}</span>
          {mod?.version && <span className="text-xs text-muted-foreground">v{mod.version}</span>}
          {active && (
            <Badge>
              <Pencil />
              selected mod
            </Badge>
          )}
        </div>
        {mod ? (
          <div className="flex flex-wrap gap-1">
            <Badge variant="secondary">{SOURCE_LABEL[mod.source]}</Badge>
            <StatusBadge mod={mod} />
            <SupportedBadge mod={mod} game={state.gameVersion} />
            {mod.editable && (
              <Badge
                variant="outline"
                title="Unpacked in your mod folder: can be edited, packed, selected"
              >
                editable
              </Badge>
            )}
            {mod.replacePaths.length > 0 && (
              <Badge
                variant="outline"
                title={`replace_path — the game's and earlier mods' files directly in these folders are ignored:\n${mod.replacePaths.join('\n')}`}
              >
                replaces {mod.replacePaths.length}{' '}
                {mod.replacePaths.length === 1 ? 'folder' : 'folders'}
              </Badge>
            )}
            {!mod.launcherId && mod.descriptorFile && (
              <Badge
                variant="outline"
                title={
                  mod.source === 'local'
                    ? 'The Paradox Launcher has not registered this mod yet — writing a launcher playset with it registers it'
                    : 'The Paradox Launcher has not registered this mod yet'
                }
              >
                not in launcher
              </Badge>
            )}
          </div>
        ) : (
          <div>
            <Badge
              variant="destructive"
              title="No descriptor, launcher entry or Workshop folder has this id"
            >
              Not found
            </Badge>
          </div>
        )}
        <div
          className="truncate font-mono text-xs text-muted-foreground"
          title={mod?.root ?? mod?.archive ?? entry.id}
        >
          {entry.id}
          {mod && (mod.root || mod.archive) ? ` · ${mod.root ?? mod.archive}` : ''}
          {note ? ` · ${note}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {inList && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={busy || i === 0}
              title="Load earlier"
              onClick={() => onMove?.(i - 1)}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={busy || i === (count ?? 1) - 1}
              title="Load later"
              onClick={() => onMove?.(i + 2)}
            >
              <ArrowDown />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={busy}
              title="Remove from the list"
              onClick={onRemove}
            >
              <X />
            </Button>
          </>
        )}
        {mod && <ModMenu mod={mod} state={state} busy={busy} actions={actions} />}
      </div>
    </div>
  )
}
