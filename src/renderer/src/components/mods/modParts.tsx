import { useEffect, useMemo, useState } from 'react'
import type { LoadOrderMod, ModsState } from '@shared/types'
import { versionMatches } from '@crusaderpope/shared/modRules'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Pieces of the Mods page (CrusaderPope's ModDialogs, on this app's UI): mod
 * facts as badges, thumbnails, and the confirm / prompt / add-mods dialogs.
 */

export const SOURCE_LABEL: Record<LoadOrderMod['source'], string> = {
  steam: 'Steam Workshop',
  pdx: 'Paradox Mods',
  local: 'Local'
}

/** An IPC error without Electron's "Error invoking remote method …" wrapper */
export function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']*': /, '').replace(/^Error: /, '')
}

export function StatusBadge({ mod }: { mod: LoadOrderMod }): React.JSX.Element {
  if (mod.status === 'missing') {
    return (
      <Badge variant="destructive" title="Neither the mod's folder nor its zip exists">
        Missing
      </Badge>
    )
  }
  if (mod.archive && !mod.root) {
    return (
      <Badge variant="outline" title={`Packed: ${mod.archive}`}>
        Packed
      </Badge>
    )
  }
  return (
    <Badge variant="outline" title={`Unpacked: ${mod.root}`}>
      Unpacked
    </Badge>
  )
}

/** The game version the mod supports; warns when it doesn't fit the installed game */
export function SupportedBadge({
  mod,
  game
}: {
  mod: LoadOrderMod
  game?: string
}): React.JSX.Element {
  const sv = mod.supportedVersion
  if (!sv) {
    return (
      <Badge variant="outline" title="The descriptor names no supported game version">
        game ?
      </Badge>
    )
  }
  const fits = versionMatches(sv, game)
  return (
    <Badge
      variant={fits === false ? 'destructive' : 'outline'}
      title={
        fits === false
          ? `Made for game version ${sv}; the installed game is ${game}`
          : `Supports game version ${sv}`
      }
    >
      game {sv}
    </Badge>
  )
}

/** Why a mod warrants a warning in a list: missing, or made for another game version */
export function modWarning(mod: LoadOrderMod | undefined, game?: string): string | undefined {
  if (!mod) return 'not found'
  if (mod.status === 'missing') return 'files missing'
  if (versionMatches(mod.supportedVersion, game) === false) return 'other game version'
  return undefined
}

// Thumbnails come through IPC as data URLs (they can live anywhere on disk); one request per image per session
const thumbs = new Map<string, Promise<string | null>>()

export function ModThumb({
  mod,
  small
}: {
  mod?: LoadOrderMod
  small?: boolean
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const key = mod?.thumbnail ? `${mod.id}\u0000${mod.thumbnail}` : ''
  useEffect(() => {
    setUrl(null)
    if (!key || !mod) return
    let p = thumbs.get(key)
    if (!p) {
      p = window.ck3tools.modThumbnail(mod.id).catch(() => null)
      thumbs.set(key, p)
    }
    let alive = true
    void p.then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const initials = (mod?.name ?? '?')
    .split(/\s+/)
    .map((w) => w[0])
    .filter((c) => c && /[\p{L}\p{N}]/u.test(c))
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-xs font-medium text-muted-foreground',
        small ? 'size-8' : 'size-12'
      )}
    >
      {url ? (
        <img src={url} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        initials || '?'
      )}
    </div>
  )
}

export function ConfirmDialog({
  title,
  confirm,
  danger,
  onConfirm,
  onClose,
  children
}: {
  title: string
  confirm: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">{children}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={danger ? 'destructive' : 'default'}
            onClick={() => {
              onClose()
              onConfirm()
            }}
          >
            {confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function PromptDialog({
  title,
  label,
  initial,
  confirm,
  onConfirm,
  onClose
}: {
  title: string
  label: string
  initial: string
  confirm: string
  onConfirm: (value: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const ok = value.trim() !== ''
  const go = (): void => {
    if (!ok) return
    onClose()
    onConfirm(value.trim())
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{label}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ok} onClick={go}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Every mod found, to add to a list: added ones go to the end of the load order, enabled */
export function AddModsDialog({
  state,
  listName,
  inList,
  onAdd,
  onClose
}: {
  state: ModsState
  listName: string
  inList: Set<string>
  onAdd: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const mods = useMemo(() => {
    const f = q.trim().toLowerCase()
    return state.mods
      .filter(
        (m) =>
          !f ||
          [m.name, m.id, m.version ?? '', SOURCE_LABEL[m.source], ...m.tags].some((s) =>
            s.toLowerCase().includes(f)
          )
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [state.mods, q])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add mods to “{listName}”</DialogTitle>
          <DialogDescription>
            Added mods go to the end of the load order, enabled.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder={`Search ${state.mods.length} mods by name, tag, source…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {mods.length === 0 && <p className="p-2 text-sm text-muted-foreground">No mods match.</p>}
          {mods.map((m) => {
            const added = inList.has(m.id.toLowerCase())
            return (
              <div
                key={m.id}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
                title={m.id}
              >
                <ModThumb mod={m} small />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {m.name}
                    {m.version && (
                      <span className="ml-1.5 text-xs text-muted-foreground">v{m.version}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="secondary">{SOURCE_LABEL[m.source]}</Badge>
                    <StatusBadge mod={m} />
                    <SupportedBadge mod={m} game={state.gameVersion} />
                  </div>
                </div>
                {added ? (
                  <span className="text-xs text-muted-foreground">In the list</span>
                ) : (
                  <Button size="xs" variant="outline" onClick={() => onAdd(m.id)}>
                    Add
                  </Button>
                )}
              </div>
            )
          })}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
