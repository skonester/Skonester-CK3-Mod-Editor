import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderOpen, History, Plus, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import type { LoadOrderMod, ModList, ModsState, NewModRequest } from '@shared/types'
import { useApp } from '../AppContext'
import ListEditor, { isDirty, KIND_LABEL, type Draft } from '../components/mods/ListEditor'
import ModRow, { type ModActions } from '../components/mods/ModRow'
import NewModDialog, { type NewModTarget } from '../components/mods/NewModDialog'
import {
  ConfirmDialog,
  errorText,
  ModThumb,
  PromptDialog,
  SOURCE_LABEL
} from '../components/mods/modParts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

const LIBRARY = '@all'
const CHANGES = '@changes'

/** What the page shows and the lists' unsaved edits, kept while the page is closed */
const memory: { view?: string; drafts: Record<string, Draft> } = { drafts: {} }

function listLabel(state: ModsState, ref: string): string {
  return ref === 'none'
    ? 'Just the selected mod'
    : (state.lists.find((l) => l.ref === ref)?.name ?? ref)
}

function ListButton({
  label,
  count,
  active,
  loaded,
  launcher,
  dirty,
  title,
  onClick
}: {
  label: string
  count?: number | null
  active: boolean
  loaded?: boolean
  launcher?: boolean
  dirty?: boolean
  title?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('w-full justify-start gap-1.5 font-normal', active && 'bg-accent')}
      title={title}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {dirty && <span className="size-1.5 rounded-full bg-primary" title="Unsaved changes" />}
      {launcher && <Badge variant="outline">launcher</Badge>}
      {loaded && <Badge variant="secondary">loaded</Badge>}
      {count !== null && count !== undefined && (
        <span className="text-xs text-muted-foreground">{count}</span>
      )}
    </Button>
  )
}

function Section({
  title,
  action
}: {
  title: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mt-3 flex items-center justify-between px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {title}
      {action}
    </div>
  )
}

/** Every mod found, with the lists each is in */
function LibraryView({
  state,
  actions,
  busy,
  onNew
}: {
  state: ModsState
  actions: ModActions
  busy: boolean
  onNew: () => void
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
  const inLists = (m: LoadOrderMod): string[] =>
    state.lists
      .filter((l) => l.mods.some((e) => e.id.toLowerCase() === m.id.toLowerCase()))
      .map((l) => l.name)
  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-col gap-2">
        <h2 className="font-heading text-xl font-semibold">All mods</h2>
        <p className="text-sm text-muted-foreground">
          {state.mods.length} mods: descriptors in your mod folder, the launcher&apos;s mods and
          Steam Workshop folders. {state.mods.filter((m) => m.editable).length} can be edited here
          (unpacked in your mod folder).
        </p>
        <div className="flex items-center gap-2">
          <Input
            className="max-w-sm"
            placeholder="Filter by name, tag, source…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button className="ml-auto" disabled={busy || !state.userDirFound} onClick={onNew}>
            <Plus />
            New mod…
          </Button>
        </div>
      </header>
      <div className="flex flex-col">
        {mods.map((m) => (
          <ModRow
            key={m.id}
            entry={{ id: m.id, enabled: true }}
            mod={m}
            state={state}
            actions={actions}
            busy={busy}
            note={inLists(m).length ? `in ${inLists(m).join(', ')}` : 'in no list'}
          />
        ))}
      </div>
    </div>
  )
}

/** The selected mod's changes, newest first: each can be undone (or forgotten when it no longer can) */
function ChangesView(): React.JSX.Element {
  const { undoSteps, selectedMod } = useApp()
  const [busy, setBusy] = useState<number | null>(null)
  const run = async (id: number): Promise<void> => {
    setBusy(id)
    try {
      const r = await window.ck3tools.undo(id)
      if (!r) return
      if (r.refused) {
        toast.error(`Can't undo “${r.label}”`, {
          description: r.refused,
          action: { label: 'Forget it', onClick: () => void window.ck3tools.forgetUndo(id) }
        })
      } else toast.success(`Undid “${r.label}”`)
    } catch (e) {
      toast.error('Undo failed', { description: errorText(e) })
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <header>
        <h2 className="font-heading text-xl font-semibold">Changes</h2>
        <p className="text-sm text-muted-foreground">
          What the app wrote into {selectedMod?.name ?? 'the selected mod'} — saves, map edits, the
          Barbershop, Blender imports — newest first. Kept across restarts (the last 100).
        </p>
      </header>
      {undoSteps.length === 0 && (
        <p className="text-sm text-muted-foreground">No changes to undo.</p>
      )}
      {undoSteps.map((s) => (
        <div key={s.id} className="flex items-center gap-3 border-b px-2 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm">{s.label}</div>
            <div className="text-xs text-muted-foreground">
              {new Date(s.at).toLocaleString()} · {s.kind}
            </div>
          </div>
          <Button
            variant="outline"
            size="xs"
            disabled={busy !== null}
            onClick={() => void run(s.id)}
          >
            {busy === s.id ? <Spinner /> : <Undo2 />}
            Undo
          </Button>
        </div>
      ))}
    </div>
  )
}

/**
 * The Mods page (CrusaderPope's): mod lists — the launcher's playsets, the
 * game's dlc_load.json, the app's own — edited, written back and loaded into
 * the game index; every mod found; new mods, packing and unpacking; and the
 * selected mod's history of changes.
 */
export default function ModsPage(): React.JSX.Element {
  const { indexStatus, selectedMod, refreshMods } = useApp()
  const [state, setState] = useState<ModsState | null>(null)
  const [view, setView] = useState<string | undefined>(memory.view)
  const [drafts, setDrafts] = useState<Record<string, Draft>>(memory.drafts)
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<React.ReactNode>(null)

  useEffect(() => {
    memory.view = view
    memory.drafts = drafts
  }, [view, drafts])

  // Mods may have changed on disk since the last look
  useEffect(() => {
    window.ck3tools
      .modsState()
      .then(setState)
      .catch((e) => toast.error(errorText(e)))
  }, [selectedMod?.file])

  /** A new state: the app's mod list may have changed too (a new mod, the selected one) */
  const takeState = useCallback(
    (s: ModsState) => {
      setState(s)
      void refreshMods()
    },
    [refreshMods]
  )

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Reading mods…
      </div>
    )
  }

  const lists = state.lists
  const viewRef =
    view &&
    (view === LIBRARY || view === CHANGES || view === 'none' || lists.some((l) => l.ref === view))
      ? view
      : state.selected !== 'none' && lists.some((l) => l.ref === state.selected)
        ? state.selected
        : LIBRARY
  const closeDialog = (): void => setDialog(null)

  /** Runs an operation, one at a time; its message or error as a toast */
  const run = async (label: string, fn: () => Promise<string | void>): Promise<boolean> => {
    setBusy(label)
    try {
      const msg = await fn()
      if (msg) toast.success(msg)
      return true
    } catch (e) {
      toast.error(errorText(e))
      return false
    } finally {
      setBusy(null)
    }
  }
  const dropDraft = (ref: string): void =>
    setDrafts((d) => {
      if (!(ref in d)) return d
      const next = { ...d }
      delete next[ref]
      return next
    })
  /** The ref of the custom list a save created */
  const newListRef = (next: ModsState): string | undefined =>
    next.lists.find((l) => l.kind === 'custom' && !lists.some((o) => o.ref === l.ref))?.ref

  const select = (ref: string): void =>
    void run('Loading into the game index…', async () => {
      const next = await window.ck3tools.selectModList(ref)
      setState(next)
      return ref === 'none'
        ? 'The game index loads just the selected mod.'
        : `“${listLabel(next, ref)}” is loaded into the game index (with the selected mod last, if it isn't in it).`
    })

  const actions: ModActions = {
    setActive: (id) =>
      void run('Selecting the mod…', async () => {
        takeState(await window.ck3tools.setActiveMod(id))
      }),
    pack: (m) => {
      const pack = (overwrite: boolean): void =>
        void run(`Packing ${m.name}…`, async () => {
          const r = await window.ck3tools.packMod(m.id, overwrite)
          if (!r.exists)
            return `Packed ${r.files} ${r.files === 1 ? 'file' : 'files'} into ${r.file}.`
          // A zip from an earlier pack is there: ask before replacing it
          setDialog(
            <ConfirmDialog
              title={`Replace the zip of “${m.name}”?`}
              confirm="Replace"
              danger
              onClose={closeDialog}
              onConfirm={() => pack(true)}
            >
              <p>
                <code>{r.file}</code> exists already. Packing again replaces it with the mod
                folder&apos;s current files.
              </p>
            </ConfirmDialog>
          )
          return undefined
        })
      pack(false)
    },
    unpack: (m) =>
      setDialog(
        <ConfirmDialog
          title={`Unpack “${m.name}”?`}
          confirm="Unpack"
          onClose={closeDialog}
          onConfirm={() =>
            void run(`Unpacking ${m.name}…`, async () => {
              const r = await window.ck3tools.unpackMod(m.id)
              takeState(await window.ck3tools.modsState())
              return `Unpacked ${r.files} ${r.files === 1 ? 'file' : 'files'} into ${r.dir}; the mod's descriptor points there now.`
            })
          }
        >
          <p>
            The zip is extracted into a folder in your mod folder ({state.userDir}\mod\…) and the
            mod&apos;s descriptor is changed to point there (<code>path=</code> instead of{' '}
            <code>archive=</code>). The zip itself stays where it is.
          </p>
        </ConfirmDialog>
      ),
    openFolder: (m) =>
      void run('Opening…', async () => {
        await window.ck3tools.openModFolder(m.id)
      })
  }

  const newMod = (): void => {
    const loadedCustom = lists.find((l) => l.ref === state.selected && l.kind === 'custom')
    const viewedCustom = lists.find((l) => l.ref === viewRef && l.kind === 'custom')
    setDialog(
      <NewModDialog
        state={state}
        defaultTarget={viewedCustom?.ref ?? loadedCustom?.ref ?? ''}
        onClose={closeDialog}
        onCreate={async (req: NewModRequest, target: NewModTarget) => {
          // (a failure here stays in the dialog)
          let next = await window.ck3tools.createMod(req)
          const created = `Created “${req.name}” in ${next.userDir}\\mod\\${req.folder} — it is the selected mod.`
          const entry = { id: `mod/${req.folder}.mod`, enabled: true }
          let show = LIBRARY
          try {
            if (target === 'new') {
              next = await window.ck3tools.saveModList({ name: req.name, mods: [entry] })
              show = newListRef(next) ?? LIBRARY
            } else if (target) {
              const saved = next.lists.find((l) => l.ref === target)
              if (saved) {
                next = await window.ck3tools.saveModList({
                  ref: target,
                  name: saved.name,
                  mods: [...saved.mods, entry]
                })
                // Unsaved edits of that list get the mod too
                setDrafts((d) =>
                  d[target]
                    ? { ...d, [target]: { ...d[target], mods: [...d[target].mods, entry] } }
                    : d
                )
                show = target
              }
            }
            toast.success(created)
          } catch (e) {
            // The mod exists: report the list error on the page
            toast.error(`${created} Adding it to the list failed: ${errorText(e)}`)
          }
          takeState(next)
          setView(show)
        }}
      />
    )
  }

  const newList = (): void =>
    setDialog(
      <PromptDialog
        title="New mod list"
        label="Name"
        initial="New list"
        confirm="Create list"
        onClose={closeDialog}
        onConfirm={(name) =>
          void run('Creating the list…', async () => {
            const next = await window.ck3tools.saveModList({ name, mods: [] })
            setState(next)
            setView(newListRef(next))
          })
        }
      />
    )

  const active = state.activeMod ? state.mods.find((m) => m.id === state.activeMod) : undefined
  const listButtons = (kind: ModList['kind']): React.ReactNode =>
    lists
      .filter((l) => l.kind === kind)
      .map((l) => (
        <ListButton
          key={l.ref}
          label={l.name}
          count={l.mods.filter((e) => e.enabled).length}
          active={viewRef === l.ref}
          loaded={state.selected === l.ref}
          launcher={l.active}
          dirty={isDirty(l, drafts[l.ref])}
          title={`${KIND_LABEL[l.kind]}: ${l.mods.length} mods, ${l.mods.filter((e) => e.enabled).length} enabled`}
          onClick={() => setView(l.ref)}
        />
      ))

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-72 shrink-0 flex-col gap-2 border-r p-3">
        <div className="flex items-baseline justify-between">
          <h1 className="font-heading text-2xl font-semibold">Mods</h1>
          {state.gameVersion && (
            <span className="text-xs text-muted-foreground">game {state.gameVersion}</span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Loaded in the game index</span>
          <Select value={state.selected} disabled={!!busy} onValueChange={select}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Just the selected mod</SelectItem>
              {!lists.some((l) => l.ref === state.selected) && state.selected !== 'none' && (
                <SelectItem value={state.selected}>Missing list</SelectItem>
              )}
              {(['playset', 'game', 'custom'] as const).map(
                (kind) =>
                  lists.some((l) => l.kind === kind) && (
                    <SelectGroup key={kind}>
                      <SelectLabel>{KIND_LABEL[kind]}s</SelectLabel>
                      {lists
                        .filter((l) => l.kind === kind)
                        .map((l) => (
                          <SelectItem key={l.ref} value={l.ref}>
                            {l.name}
                            {l.active ? ' (launcher’s active playset)' : ''}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  )
              )}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {indexStatus.state === 'indexing'
              ? `Indexing — ${indexStatus.phase ?? 'starting'}…`
              : indexStatus.state === 'ready'
                ? `Index ready · ${indexStatus.stats?.files.toLocaleString() ?? '?'} files`
                : ''}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ListButton
            label="Just the selected mod"
            active={viewRef === 'none'}
            loaded={state.selected === 'none'}
            onClick={() => setView('none')}
          />
          <Section title="Launcher playsets" />
          {!state.launcher && (
            <p className="px-2 text-xs text-muted-foreground">
              The launcher database (launcher-v2.sqlite) wasn&apos;t found.
            </p>
          )}
          {listButtons('playset')}
          <Section title="Game" />
          {listButtons('game')}
          {!lists.some((l) => l.kind === 'game') && (
            <p className="px-2 text-xs text-muted-foreground">
              No dlc_load.json yet (the launcher writes it when you press Play).
            </p>
          )}
          <Section
            title="Custom lists"
            action={
              <Button
                variant="ghost"
                size="xs"
                disabled={!!busy}
                title="A new, empty list kept by this app"
                onClick={newList}
              >
                <Plus />
                New
              </Button>
            }
          />
          {listButtons('custom')}
          {!lists.some((l) => l.kind === 'custom') && (
            <p className="px-2 text-xs text-muted-foreground">
              Lists kept by this app — e.g. a playset plus the mod you are writing.
            </p>
          )}
          <Section title="Library" />
          <ListButton
            label="All mods"
            count={state.mods.length}
            active={viewRef === LIBRARY}
            onClick={() => setView(LIBRARY)}
          />
          <Section title="History" />
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-start gap-1.5 font-normal',
              viewRef === CHANGES && 'bg-accent'
            )}
            onClick={() => setView(CHANGES)}
          >
            <History />
            Changes to the selected mod
          </Button>
        </div>
        <div className="flex flex-col gap-2 border-t pt-2">
          <span className="text-xs text-muted-foreground">Selected mod — the one you edit</span>
          {active ? (
            <div className="flex items-center gap-2" title={active.root}>
              <ModThumb mod={active} small />
              <div className="min-w-0">
                <div className="truncate text-sm">{active.name}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{active.id}</div>
              </div>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {state.activeMod ? `${state.activeMod} (not found)` : 'None'}
            </span>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" disabled={!!busy || !state.userDirFound} onClick={newMod}>
              <Plus />
              New mod…
            </Button>
            {active && (
              <Button
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() => actions.openFolder(active)}
              >
                <FolderOpen />
                Open folder
              </Button>
            )}
          </div>
          <span
            className={cn(
              'truncate font-mono text-xs',
              state.userDirFound ? 'text-muted-foreground' : 'text-destructive'
            )}
            title="The CK3 user folder"
          >
            {state.userDirFound ? state.userDir : `User folder not found: ${state.userDir}`}
          </span>
        </div>
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto p-5">
        {busy && (
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            {busy}
          </div>
        )}
        {viewRef === 'none' ? (
          <div className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-semibold">Just the selected mod</h2>
            <p className="text-sm text-muted-foreground">
              The game index loads the game with the selected mod over it — what the editors edit.
              Load a list to see the mod among others (their overrides and conflicts); the selected
              mod then loads last unless the list has it.
            </p>
            <Button
              className="self-start"
              disabled={state.selected === 'none' || !!busy}
              onClick={() => select('none')}
            >
              {state.selected === 'none' ? 'Loaded in the game index' : 'Load into the game index'}
            </Button>
          </div>
        ) : viewRef === LIBRARY ? (
          <LibraryView state={state} actions={actions} busy={!!busy} onNew={newMod} />
        ) : viewRef === CHANGES ? (
          <ChangesView />
        ) : (
          <ListEditor
            key={viewRef}
            state={state}
            list={lists.find((l) => l.ref === viewRef)!}
            draft={drafts[viewRef]}
            busy={!!busy}
            actions={actions}
            setDraft={(d) => setDrafts((all) => ({ ...all, [viewRef]: d }))}
            dropDraft={() => dropDraft(viewRef)}
            run={run}
            setState={setState}
            showList={setView}
            newListRef={newListRef}
            select={select}
          />
        )}
      </section>
      {dialog}
    </div>
  )
}
