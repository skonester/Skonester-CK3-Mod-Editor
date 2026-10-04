import { useEffect, useRef, useState } from 'react'
import { History, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type {
  CalendarConfig,
  FaithHistoryEntry,
  FaithHistoryFields,
  FaithHistoryPatch,
  FaithHistoryPreview,
  ReligionData
} from '@shared/types'
import { validateScriptFragment } from '@shared/scriptValidation'
import { useApp } from '../AppContext'
import { useEntryHistory } from '../hooks/useEntryHistory'
import { usePersistedDraft } from '../hooks/usePersistedDraft'
import { formatCalendarDate } from '@/lib/ck3Date'
import FormSection from './FormSection'
import ReferenceInput from './ReferenceInput'
import StaleDraftAlert from './StaleDraftAlert'
import TenetEditor from './TenetEditor'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface Context {
  faithId: string
  data: ReligionData
  gameDir: string | null
  modPath: string
  replacePaths: string[]
}
const address = (e: FaithHistoryEntry): string => `${e.file}:${e.faithBlock}:${e.index}`
const refOf = (faithId: string, e: FaithHistoryEntry) => ({
  id: faithId,
  name: `${faithId} · ${e.date}`,
  scope: address(e)
})

function EntryForm({
  entry,
  initial,
  files,
  calendar,
  busy,
  onSubmit,
  onDone,
  ...ctx
}: Context & {
  entry: FaithHistoryEntry | null
  initial: FaithHistoryPatch
  files: string[]
  calendar: CalendarConfig | null
  busy: boolean
  onSubmit: (patch: FaithHistoryPatch, file: string) => Promise<boolean>
  onDone: () => void
}): React.JSX.Element {
  const creating = entry === null
  const editable = creating || entry.inMod
  const persisted = usePersistedDraft<FaithHistoryPatch>({
    tool: 'faithHistory',
    ref: entry ? refOf(ctx.faithId, entry) : null,
    original: entry ? { date: entry.date, script: entry.script } : null,
    editable
  })
  const [newDraft, setNewDraft] = useState(initial)
  const draft = creating ? newDraft : persisted.draft
  const [file, setFile] = useState('00_my_faith_history.txt')
  const [preview, setPreview] = useState<FaithHistoryPreview | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState('fields')
  const latest = useRef(draft)
  latest.current = draft
  const generation = useRef(0)
  const updating = useRef(false)
  const set = (next: FaithHistoryPatch): void => {
    if (creating) setNewDraft(next)
    else persisted.setDraft(next)
    setError(null)
  }
  useEffect(() => {
    const ticket = ++generation.current
    if (!draft) return undefined
    const script = draft.script
    const timer = setTimeout(() => {
      void window.ck3tools
        .prepareFaithHistoryScript(script)
        .then((p) => {
          if (ticket === generation.current) setPreview(p)
        })
        .catch((err) => {
          if (ticket === generation.current) setError(String(err))
        })
    }, 100)
    return () => {
      clearTimeout(timer)
      generation.current++
    }
  }, [draft?.script])

  const changeFields = async (patch: Partial<FaithHistoryFields>): Promise<void> => {
    if (!draft || updating.current) return
    updating.current = true
    setPreparing(true)
    const source = draft.script
    try {
      const prepared = await window.ck3tools.prepareFaithHistoryScript(source, patch)
      if (latest.current?.script !== source) return
      if (prepared.error) {
        setError(prepared.error)
        return
      }
      set({ ...latest.current, script: prepared.script })
      setPreview(prepared)
    } catch (err) {
      setError(String(err))
    } finally {
      updating.current = false
      setPreparing(false)
    }
  }
  if (!draft) return <p className="text-muted-foreground">Loading entry…</p>
  const scriptError = validateScriptFragment(draft.script)
  const validDate = draft.date === entry?.date || /^\d+\.\d+(\.\d+)?\.?$/.test(draft.date.trim())
  const canSave =
    editable &&
    !busy &&
    !preparing &&
    !persisted.stale &&
    validDate &&
    !scriptError &&
    (creating ? !!file.trim() : persisted.dirty)
  const save = async (): Promise<void> => {
    if (!canSave) return
    if (await onSubmit(draft, file.trim())) {
      if (!creating) persisted.markSaved(draft)
      onDone()
    }
  }
  const locked = !editable || busy || preparing || preview?.script !== draft.script
  return (
    <div
      className="space-y-4"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          void save()
        }
      }}
    >
      {persisted.stale && <StaleDraftAlert what="faith history entry" />}
      {!editable && (
        <p className="text-sm text-muted-foreground">
          Base-game entry. Use it as a new mod entry to change its settings.
        </p>
      )}
      <div className="space-y-1.5">
        <Label>Date in game files</Label>
        <Input
          aria-label="History date"
          value={draft.date}
          placeholder="1066.1.1"
          disabled={!editable || busy}
          onChange={(e) => set({ ...draft, date: e.target.value })}
          aria-invalid={!validDate}
        />
        {calendar && (
          <p className="text-xs text-muted-foreground">
            {formatCalendarDate(draft.date, calendar)}
          </p>
        )}
      </div>
      {creating && (
        <div className="space-y-1.5">
          <Label>Mod history file</Label>
          <ReferenceInput
            value={file}
            options={files.map((id) => ({ id, name: null }))}
            disabled={busy}
            onChange={(v) => setFile(v ?? '')}
            placeholder="00_my_faith_history.txt"
          />
          <p className="text-xs text-muted-foreground">
            Written under history/faiths. Relative subfolders are supported. Existing entries remain
            and all entries at the same date execute.
          </p>
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="fields" disabled={preparing}>
            Fields
          </TabsTrigger>
          <TabsTrigger value="script" disabled={preparing}>
            Complete script
          </TabsTrigger>
        </TabsList>
        <TabsContent value="fields" className="space-y-5 pt-3">
          {preview && (
            <>
              <FormSection title="Faith at this date">
                <div className="space-y-1.5">
                  <Label>Mark as created</Label>
                  <ReferenceInput
                    value={preview.fields.created}
                    options={[
                      { id: 'yes', name: 'Yes' },
                      { id: 'no', name: 'No' }
                    ]}
                    placeholder="no change"
                    disabled={locked}
                    onChange={(created) => void changeFields({ created })}
                  />
                  <p className="text-xs text-muted-foreground">
                    A faith cannot be un-created. Omit this setting to retain its prior state.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Main rite</Label>
                  <ReferenceInput
                    value={preview.fields.mainRite}
                    options={(ctx.data.rites ?? []).map((r) => ({
                      id: r.id,
                      name: r.localizedName
                    }))}
                    placeholder="no change"
                    disabled={locked}
                    onChange={(mainRite) => void changeFields({ mainRite })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Religious head title</Label>
                  <ReferenceInput
                    value={preview.fields.religiousHead}
                    options={[]}
                    placeholder="no change"
                    disabled={locked}
                    onChange={(religiousHead) => void changeFields({ religiousHead })}
                  />
                </div>
              </FormSection>
              {(['known', 'permitted', 'prohibited'] as const).map((key) => (
                <FormSection key={key} title={`${key[0].toUpperCase()}${key.slice(1)} tenets`}>
                  <TenetEditor
                    values={preview.fields[key]}
                    options={ctx.data.tenets ?? []}
                    disabled={locked}
                    onChange={(values) => void changeFields({ [key]: values })}
                    gameDir={ctx.gameDir}
                    modPath={ctx.modPath}
                    replacePaths={ctx.replacePaths}
                  />
                </FormSection>
              ))}
              <p className="text-xs text-muted-foreground">
                Use Complete script to edit rite memberships, enabled flags, DLC-specific tenet
                setups, doctrines, and tenet popularity.
              </p>
            </>
          )}
          {(!preview || preview.script !== draft.script) && (
            <p className="text-xs text-muted-foreground">Reading script…</p>
          )}
          {scriptError && (
            <p className="text-xs text-destructive">
              {scriptError}. Correct this in Complete script.
            </p>
          )}
        </TabsContent>
        <TabsContent value="script" className="space-y-2 pt-3">
          <Label>Contents of the dated block</Label>
          <Textarea
            aria-label="Faith history script"
            className="min-h-96 font-mono text-xs"
            spellCheck={false}
            value={draft.script}
            disabled={!editable || busy}
            aria-invalid={!!scriptError}
            onChange={(e) => set({ ...draft, script: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Enter CK3 statements inside the date block. Brace and quote validation runs before
            saving; game-specific effects require testing in CK3.
          </p>
          {scriptError && <p className="text-xs text-destructive">{scriptError}</p>}
        </TabsContent>
      </Tabs>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {editable && (
        <div className="flex justify-end gap-2">
          {!creating && (
            <Button
              variant="outline"
              disabled={busy || !persisted.dirty}
              onClick={() => {
                persisted.revert()
                setError(null)
              }}
            >
              Revert
            </Button>
          )}
          <Button disabled={!canSave} onClick={() => void save()}>
            {busy ? 'Saving…' : creating ? 'Add entry' : 'Save entry'}
          </Button>
        </div>
      )}
    </div>
  )
}

export default function FaithHistoryPanel({
  onOpenChange,
  ...ctx
}: Context & { onOpenChange?: (open: boolean) => void }): React.JSX.Element {
  const { selectedMod } = useApp()
  const { drafts, persistDraft } = useEntryHistory('faithHistory')
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<FaithHistoryEntry[]>([])
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [newEntry, setNewEntry] = useState<FaithHistoryPatch | null>(null)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const entry = entries.find((e) => address(e) === selected) ?? null
  const calendar = selectedMod?.profile?.calendar ?? null
  useEffect(() => {
    if (!open) return undefined
    let active = true
    setLoading(true)
    setError(null)
    void Promise.all([
      window.ck3tools.getFaithHistory(ctx.gameDir, ctx.modPath, ctx.replacePaths, ctx.faithId),
      window.ck3tools.listFaithHistoryFiles(ctx.modPath)
    ])
      .then(([rows, names]) => {
        if (active) {
          setEntries(rows)
          setFiles(names)
        }
      })
      .catch((err) => {
        if (active) setError(String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, revision, ctx.faithId, ctx.modPath, ctx.gameDir, JSON.stringify(ctx.replacePaths)])
  const done = (): void => {
    setSelected(null)
    setNewEntry(null)
    setRevision((v) => v + 1)
  }
  const submit = async (patch: FaithHistoryPatch, file: string): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      const result =
        entry && !newEntry
          ? await window.ck3tools.saveFaithHistoryEntry(ctx.modPath, ctx.faithId, entry, patch)
          : await window.ck3tools.addFaithHistoryEntry(ctx.modPath, file, ctx.faithId, patch)
      if (!result.ok) {
        setError(result.error)
        return false
      }
      return true
    } catch (err) {
      setError(String(err))
      return false
    } finally {
      setBusy(false)
    }
  }
  const remove = async (row: FaithHistoryEntry): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.ck3tools.deleteFaithHistoryEntry(ctx.modPath, ctx.faithId, row)
      if (!result.ok) {
        setError(result.error)
        return
      }
      persistDraft(refOf(ctx.faithId, row), null)
      done()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  const sorted = [...entries].sort((a, b) => {
    const aa = a.date.split('.').map(Number),
      bb = b.date.split('.').map(Number)
    return aa[0] - bb[0] || (aa[1] ?? 1) - (bb[1] ?? 1) || (aa[2] ?? 1) - (bb[2] ?? 1)
  })
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        setOpen(next)
        onOpenChange?.(next)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <History />
          Faith history
        </Button>
      </DialogTrigger>
      <DialogContent
        className="flex h-[88vh] max-w-[calc(100%-2rem)] flex-col sm:max-w-5xl"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Faith history · {ctx.faithId}</DialogTitle>
          <DialogDescription>
            Dated faith and rite settings across the game and mod. Edits to existing mod entries are
            remembered until saved or reverted.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy || loading}
            onClick={() => {
              setNewEntry({ date: '1066.1.1', script: '\n\t\tcreated = yes\n\t' })
              setSelected(null)
              setError(null)
            }}
          >
            <Plus />
            Add entry
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || loading}
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw />
            Reload
          </Button>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-[280px_minmax(0,1fr)] md:overflow-hidden">
          <div className="space-y-2 md:overflow-y-auto">
            {loading && <p className="text-muted-foreground">Loading history…</p>}
            {!loading && !entries.length && (
              <p className="text-muted-foreground">
                No dated entries. Add an entry to define the faith&apos;s history.
              </p>
            )}
            {sorted.map((row) => (
              <div
                key={address(row)}
                className={cn(
                  'space-y-1 rounded-md border p-2',
                  selected === address(row) && !newEntry && 'border-primary'
                )}
              >
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start px-1"
                  disabled={busy || loading}
                  onClick={() => {
                    setSelected(address(row))
                    setNewEntry(null)
                    setError(null)
                  }}
                >
                  <span className="min-w-0 text-left">
                    <span className="font-heading font-semibold">
                      {formatCalendarDate(row.date, calendar) ?? row.date}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {row.date} · {row.file}
                    </span>
                  </span>
                </Button>
                <div className="flex flex-wrap gap-1">
                  {!row.inMod && <Badge variant="outline">game</Badge>}
                  {Object.values(drafts).some(
                    (d) => d.ref.id === ctx.faithId && d.ref.scope === address(row)
                  ) && <Badge variant="secondary">unsaved</Badge>}
                  {row.mainRite && <Badge variant="secondary">{row.mainRite}</Badge>}
                  {row.rites.length > 0 && (
                    <Badge variant="outline">{row.rites.length} rite setups</Badge>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || loading}
                    onClick={() => {
                      setNewEntry({ date: row.date, script: row.script })
                      setSelected(null)
                      setError(null)
                    }}
                  >
                    Use as new entry
                  </Button>
                  {row.inMod && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          disabled={busy || loading}
                          aria-label={`Delete ${row.date} entry`}
                        >
                          <Trash2 />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this history entry?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes the complete {row.date} block from {row.file}, including
                            its nested rite setups and any other script.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void remove(row)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="min-w-0 rounded-md border p-4 md:overflow-y-auto">
            {newEntry || entry ? (
              <EntryForm
                key={newEntry ? `new:${newEntry.date}:${newEntry.script}` : address(entry!)}
                {...ctx}
                entry={newEntry ? null : entry}
                initial={newEntry ?? { date: entry!.date, script: entry!.script }}
                files={files}
                calendar={calendar}
                busy={busy || loading}
                onSubmit={submit}
                onDone={done}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a dated entry to view or edit it.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
