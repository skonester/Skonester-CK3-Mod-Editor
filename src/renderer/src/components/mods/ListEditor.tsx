import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { LoadOrderMod, ModList, ModListEntry, ModsState } from '@shared/types'
import ModRow, { type ModActions } from './ModRow'
import { AddModsDialog, ConfirmDialog, modWarning, PromptDialog } from './modParts'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface Draft {
  name: string
  mods: ModListEntry[]
}

export const KIND_LABEL: Record<ModList['kind'], string> = {
  playset: 'Launcher playset',
  game: 'Game list',
  custom: 'Custom list'
}

const sameEntries = (a: ModListEntry[], b: ModListEntry[]): boolean =>
  a.length === b.length && a.every((e, i) => e.id === b[i].id && e.enabled === b[i].enabled)

export const isDirty = (list: ModList, draft: Draft | undefined): boolean =>
  !!draft && (!sameEntries(draft.mods, list.mods) || draft.name !== list.name)

/**
 * One mod list (CrusaderPope's ListEditor): its mods in load order — drag or
 * ↑ ↓ to reorder, tick to enable — kept as a draft until saved (the app's own
 * lists), written back (a launcher playset, the game's dlc_load.json), or saved
 * as a new list; and loaded into the game index.
 */
export default function ListEditor({
  state,
  list,
  draft,
  busy,
  actions,
  setDraft,
  dropDraft,
  run,
  setState,
  showList,
  newListRef,
  select
}: {
  state: ModsState
  list: ModList
  draft?: Draft
  busy: boolean
  actions: ModActions
  setDraft: (d: Draft) => void
  dropDraft: () => void
  run: (label: string, fn: () => Promise<string | void>) => Promise<boolean>
  setState: (s: ModsState) => void
  showList: (ref: string | undefined) => void
  newListRef: (next: ModsState) => string | undefined
  select: (ref: string) => void
}): React.JSX.Element {
  const current: Draft = draft ?? { name: list.name, mods: list.mods }
  const dirty = isDirty(list, draft)
  const loaded = state.selected === list.ref
  const custom = list.kind === 'custom'
  const byId = useMemo(() => new Map(state.mods.map((m) => [m.id.toLowerCase(), m])), [state.mods])
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null)
  const [adding, setAdding] = useState(false)
  const [dialog, setDialog] = useState<React.ReactNode>(null)
  const closeDialog = (): void => setDialog(null)

  const edit = (mods: ModListEntry[], name = current.name): void => setDraft({ name, mods })
  /** `to` = the insertion point before removal */
  const move = (from: number, to: number): void => {
    const mods = [...current.mods]
    const [e] = mods.splice(from, 1)
    mods.splice(to > from ? to - 1 : to, 0, e)
    edit(mods)
  }
  const enabled = current.mods.filter((e) => e.enabled)
  const warnings = enabled
    .map((e) => modWarning(byId.get(e.id.toLowerCase()), state.gameVersion))
    .filter(Boolean).length
  const inList = new Set(current.mods.map((e) => e.id.toLowerCase()))
  // Row keys: the id (a list read from the launcher could name a mod twice)
  const seen = new Map<string, number>()
  const keys = current.mods.map((e) => {
    const n = (seen.get(e.id) ?? 0) + 1
    seen.set(e.id, n)
    return n === 1 ? e.id : `${e.id}#${n}`
  })
  // Where a dragged row would land; none when dropping it there changes nothing
  const dropAt =
    drag && drag.over !== null && drag.over !== drag.from && drag.over !== drag.from + 1
      ? drag.over
      : null

  const save = (): Promise<boolean> =>
    run('Saving…', async () => {
      setState(
        await window.ck3tools.saveModList({ ref: list.ref, name: current.name, mods: current.mods })
      )
      dropDraft()
      return `Saved “${current.name.trim() || 'Unnamed list'}”.${loaded ? ' The game index loads it again.' : ''}`
    })

  const load = (): void => {
    if (custom && dirty) void save().then((ok) => ok && select(list.ref))
    else select(list.ref)
  }

  const saveAs = (): void =>
    setDialog(
      <PromptDialog
        title="Save as a new list"
        label="Name of the new custom list"
        initial={`${current.name} (copy)`}
        confirm="Save list"
        onClose={closeDialog}
        onConfirm={(name) =>
          void run('Saving…', async () => {
            const next = await window.ck3tools.saveModList({ name, mods: current.mods })
            setState(next)
            dropDraft()
            showList(newListRef(next))
            return `Saved as “${name}”.`
          })
        }
      />
    )

  const remove = (): void =>
    setDialog(
      <ConfirmDialog
        title={`Delete “${list.name}”?`}
        confirm="Delete list"
        danger
        onClose={closeDialog}
        onConfirm={() =>
          void run('Deleting…', async () => {
            setState(await window.ck3tools.deleteModList(list.ref))
            dropDraft()
            showList(undefined)
            return `Deleted “${list.name}”.${loaded ? ' The game index loads just the selected mod now.' : ''}`
          })
        }
      >
        <p>
          This removes the app&apos;s own list. No mod files, playsets or game files are touched.
        </p>
      </ConfirmDialog>
    )

  const backups = `${state.userDir}\\crusaderpope-backups`
  // Local mods of the user's mod folder the launcher has not registered
  const unregistered = current.mods
    .map((e) => byId.get(e.id.toLowerCase()))
    .filter(
      (m): m is LoadOrderMod =>
        !!m &&
        !m.launcherId &&
        m.source === 'local' &&
        m.status === 'ok' &&
        !!m.descriptorFile &&
        /^mod\/[^/\\]+\.mod$/i.test(m.id)
    )
  const toLauncher = (launcherClosed: boolean): Promise<boolean> =>
    run('Writing the launcher playset…', async () => {
      const r = await window.ck3tools.writeModList(
        list.ref,
        'launcher',
        current.mods,
        launcherClosed ? { launcherClosed } : undefined
      )
      // Nothing written: the process list couldn't be read — the user may say the launcher is closed
      if (r.unchecked) {
        setDialog(
          <ConfirmDialog
            title="Is the Paradox Launcher closed?"
            confirm="It is closed — write"
            danger
            onClose={closeDialog}
            onConfirm={() => void toLauncher(true)}
          >
            <p>{r.unchecked}</p>
            <p>
              Write only when the Paradox Launcher is not running: it keeps its playsets in memory
              and would overwrite the change. The database is backed up first either way.
            </p>
          </ConfirmDialog>
        )
        return "Nothing written — the app couldn't check whether the Paradox Launcher is running."
      }
      setState(await window.ck3tools.modsState())
      dropDraft()
      const reg = r.registered?.length
        ? ` Registered in the launcher: ${r.registered.join(', ')}.`
        : ''
      return `Written to the launcher playset “${list.name}”.${reg} Backup of the launcher database: ${r.backup}`
    })

  const writeLauncher = (): void =>
    setDialog(
      <ConfirmDialog
        title={`Write “${list.name}” to the Paradox Launcher?`}
        confirm="Write to launcher"
        onClose={closeDialog}
        onConfirm={() => void toLauncher(false)}
      >
        <p>
          The playset&apos;s mods, their order and enabled flags are replaced with this list (
          {current.mods.length} mods, {enabled.length} enabled).
        </p>
        {unregistered.length > 0 && (
          <p>
            The launcher has not registered {unregistered.map((m) => `“${m.name}”`).join(', ')} yet:
            the app adds {unregistered.length === 1 ? 'it' : 'them'} to its mod list, as the
            launcher does when it finds a new mod.
          </p>
        )}
        <p>
          The launcher database is copied first to <code>{backups}</code> (the last 10 copies are
          kept). Close the Paradox Launcher before writing — it keeps its playsets in memory.
        </p>
      </ConfirmDialog>
    )

  const writeGame = (): void =>
    setDialog(
      <ConfirmDialog
        title="Write to the game list (dlc_load.json)?"
        confirm="Write game list"
        onClose={closeDialog}
        onConfirm={() =>
          void run('Writing dlc_load.json…', async () => {
            const r = await window.ck3tools.writeModList(list.ref, 'game', current.mods)
            setState(await window.ck3tools.modsState())
            if (list.kind === 'game') dropDraft()
            return `Written ${enabled.length} mods to dlc_load.json.${r.backup ? ` Backup: ${r.backup}` : ''}`
          })
        }
      >
        <p>
          The {enabled.length} enabled mods of “{current.name}” become the mods the game loads when
          started without the launcher, in this order. The launcher replaces this list with its
          playset when you press Play.
        </p>
        <p>
          The current file is copied first to <code>{backups}</code> (the last 10 copies are kept).
        </p>
      </ConfirmDialog>
    )

  const dirtyText = custom
    ? 'Save to keep them.'
    : list.kind === 'playset'
      ? 'Write them to the launcher playset, or save them as a new list.'
      : 'Write them to the game list, or save them as a new list.'

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{KIND_LABEL[list.kind]}</Badge>
          {list.active && <Badge>Active in the launcher</Badge>}
          {loaded && <Badge variant="outline">Loaded in the game index</Badge>}
          {list.kind === 'game' && <Badge variant="outline">dlc_load.json</Badge>}
        </div>
        {custom ? (
          <Input
            className="h-10 max-w-md font-heading text-xl font-semibold"
            value={current.name}
            disabled={busy}
            title="Rename the list"
            onChange={(e) => edit(current.mods, e.target.value)}
          />
        ) : (
          <h2 className="font-heading text-xl font-semibold">{list.name}</h2>
        )}
        <p className="text-sm text-muted-foreground">
          {current.mods.length} {current.mods.length === 1 ? 'mod' : 'mods'} · {enabled.length}{' '}
          enabled
          {warnings > 0 && <span className="text-destructive"> · {warnings} with warnings</span>} ·
          load order top to bottom, later mods win
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || (loaded && !dirty)} onClick={load}>
            {loaded && !dirty
              ? 'Loaded in the game index'
              : custom && dirty
                ? 'Save & load into the game index'
                : dirty
                  ? 'Load saved version'
                  : 'Load into the game index'}
          </Button>
          {custom && (
            <Button variant="outline" disabled={busy || !dirty} onClick={() => void save()}>
              Save
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={saveAs}>
            Save as new list…
          </Button>
          {list.kind === 'playset' && (
            <Button variant="outline" disabled={busy || !state.launcher} onClick={writeLauncher}>
              Write to launcher playset…
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            title="Make these the mods the game loads when started directly"
            onClick={writeGame}
          >
            Write to game list…
          </Button>
          {custom && (
            <Button variant="destructive" disabled={busy} onClick={remove}>
              Delete list
            </Button>
          )}
          <Button
            variant="outline"
            className="ml-auto"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            <Plus />
            Add mods
          </Button>
        </div>
      </header>
      {dirty && (
        <Alert>
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>Unsaved changes. {dirtyText}</span>
            <Button variant="outline" size="sm" disabled={busy} onClick={dropDraft}>
              Discard changes
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col">
        {current.mods.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No mods in this list yet — Add mods picks from every mod found.
          </p>
        )}
        {current.mods.map((e, i) => (
          <ModRow
            key={keys[i]}
            entry={e}
            mod={byId.get(e.id.toLowerCase())}
            state={state}
            index={i}
            count={current.mods.length}
            actions={actions}
            busy={busy}
            drop={
              dropAt === i
                ? 'before'
                : dropAt === i + 1 && i === current.mods.length - 1
                  ? 'after'
                  : undefined
            }
            onToggle={() =>
              edit(current.mods.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)))
            }
            onMove={(to) => move(i, to)}
            onRemove={() => edit(current.mods.filter((_, j) => j !== i))}
            onDragStart={() => setDrag({ from: i, over: null })}
            onDragOver={(after) => setDrag((d) => (d ? { ...d, over: after ? i + 1 : i } : d))}
            onDrop={() => {
              if (drag && dropAt !== null) move(drag.from, dropAt)
              setDrag(null)
            }}
            onDragEnd={() => setDrag(null)}
          />
        ))}
      </div>
      {adding && (
        <AddModsDialog
          state={state}
          listName={current.name}
          inList={inList}
          onAdd={(id) => edit([...current.mods, { id, enabled: true }])}
          onClose={() => setAdding(false)}
        />
      )}
      {dialog}
    </div>
  )
}
