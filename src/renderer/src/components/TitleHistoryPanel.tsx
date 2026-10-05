import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'
import type {
  CalendarConfig,
  CharacterSummary,
  RefEntry,
  TitleData,
  TitleHistoryEntry,
  TitleHistoryEntryPatch
} from '@shared/types'
import { FieldLabel } from './CharacterForm'
import DateFormatToggle from './DateFormatToggle'
import Hint from './Hint'
import ReferenceBadge from './ReferenceBadge'
import ReferenceDisplay from './ReferenceDisplay'
import ReferenceInput from './ReferenceInput'
import { idOnly } from './ReferenceLabel'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { formatCalendarDate, fromCalendarInput, toCalendarInput } from '@/lib/ck3Date'
import type { CalendarEra } from '@/lib/ck3Date'
import { cn } from '@/lib/utils'
import { defaultHistoryFile, findTitle, normId, sortEntries } from '@/lib/titleView'

/** The writer's own lenient date check — real files carry "3212.1" and "3220.1.1." */
const DATE_LIKE = /^\d+\.\d+(\.\d+)?\.?$/

/** Sentinel Select values (Radix Select can't hold ''). */
const UNSET = '__unset__'
const NEW_FILE = '__new-file__'

const blankPatch = (): TitleHistoryEntryPatch => ({
  date: '',
  holder: null,
  liege: null,
  deJureLiege: null,
  government: null,
  changeDevelopmentLevel: null,
  developmentLevel: null,
  name: null,
  resetName: null,
  insertTitleHistory: null,
  removeSuccessionLaws: null,
  holderIgnoreHeadOfFaithRequirement: null,
  successionLaws: null
})

const patchOf = (e: TitleHistoryEntry): TitleHistoryEntryPatch => ({
  date: e.date,
  holder: e.holder,
  liege: e.liege,
  deJureLiege: e.deJureLiege,
  government: e.government,
  changeDevelopmentLevel: e.changeDevelopmentLevel,
  developmentLevel: e.developmentLevel,
  name: e.name,
  resetName: e.resetName,
  insertTitleHistory: e.insertTitleHistory,
  removeSuccessionLaws: e.removeSuccessionLaws,
  holderIgnoreHeadOfFaithRequirement: e.holderIgnoreHeadOfFaithRequirement,
  successionLaws: e.successionLaws === null ? null : [...e.successionLaws]
})

/** A stable address for "which entry is being edited". */
const entryKey = (e: TitleHistoryEntry): string => `${e.file}|${e.titleBlock}|${e.index}`

interface FormProps {
  initial: TitleHistoryEntryPatch
  /** Offered when creating (the target file); null when editing in place */
  files: string[] | null
  defaultFile: string | null
  holderOptions: RefEntry[]
  titleOptions: RefEntry[]
  data: TitleData
  calendar: CalendarConfig | null
  showRawDates: boolean
  busy: boolean
  error: string | null
  onSubmit: (patch: TitleHistoryEntryPatch, file: string | null) => void
  onCancel: () => void
}

/** The add/edit form for one dated entry. */
function EntryForm({
  initial,
  files,
  defaultFile,
  holderOptions,
  titleOptions,
  data,
  calendar,
  showRawDates,
  busy,
  error,
  onSubmit,
  onCancel
}: FormProps): React.JSX.Element {
  const [draft, setDraft] = useState<TitleHistoryEntryPatch>(() => structuredClone(initial))
  const [fileChoice, setFileChoice] = useState(() =>
    defaultFile !== null ? defaultFile : files !== null && files.length === 0 ? NEW_FILE : ''
  )
  const [newFileName, setNewFileName] = useState('')

  const set = (patch: Partial<TitleHistoryEntryPatch>): void =>
    setDraft((d) => ({ ...d, ...patch }))

  const typedName = newFileName.trim()
  const targetFile =
    files === null
      ? null
      : fileChoice === NEW_FILE
        ? typedName === ''
          ? ''
          : typedName.toLowerCase().endsWith('.txt')
            ? typedName
            : `${typedName}.txt`
        : fileChoice

  // A date the writer can't take back is only a problem when it changed;
  // existing entries keep their tolerated-typo spellings untouched.
  const dateInvalid = draft.date.trim() !== initial.date && !DATE_LIKE.test(draft.date.trim())
  const canSubmit = !busy && draft.date.trim() !== '' && !dateInvalid && targetFile !== ''

  const dateField = (): React.JSX.Element => {
    const value = draft.date
    if (!calendar || showRawDates) {
      const display = formatCalendarDate(value, calendar)
      return (
        <div className="space-y-1.5">
          <FieldLabel required>Date</FieldLabel>
          <Input
            type="text"
            className="font-mono"
            value={value}
            placeholder="e.g. 3254.1.1"
            aria-invalid={dateInvalid || undefined}
            onChange={(e) => set({ date: e.target.value })}
          />
          {display !== null && <Hint label="Display" value={display} />}
        </div>
      )
    }
    const converted = value === '' ? null : toCalendarInput(value, calendar)
    const era: CalendarEra = converted?.era ?? 'before'
    const change = (text: string, nextEra: CalendarEra): void => {
      if (text === '') {
        set({ date: '' })
        return
      }
      // A misread edit (no year, or one outside the raw 0–9999 range) is
      // dropped rather than stored as something it doesn't mean.
      const raw = fromCalendarInput(text, nextEra, calendar)
      if (raw !== null) set({ date: raw })
    }
    return (
      <div className="space-y-1.5">
        <FieldLabel required>Date</FieldLabel>
        <div className="flex gap-1.5">
          <Input
            type="text"
            className="min-w-0 flex-1"
            value={converted?.text ?? value}
            placeholder="e.g. 746.1.1"
            aria-invalid={dateInvalid || undefined}
            onChange={(e) => change(e.target.value, era)}
          />
          <Select
            value={era}
            onValueChange={(v) => converted && change(converted.text, v as CalendarEra)}
          >
            <SelectTrigger aria-label="Era" className="shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="before">{calendar.beforeLabel}</SelectItem>
              <SelectItem value="after">{calendar.afterLabel}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {value !== '' && <Hint label="Raw" value={value} />}
      </div>
    )
  }

  const refField = (
    label: string,
    value: string | null,
    onChange: (v: string | null) => void,
    options: RefEntry[],
    placeholder: string
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <ReferenceInput value={value} onChange={onChange} options={options} placeholder={placeholder} />
    </div>
  )

  const textField = (
    label: string,
    value: string | null,
    onChange: (v: string | null) => void,
    placeholder: string,
    hint?: string
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="text"
        className="font-mono"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
      {hint !== undefined && <Hint value={hint} />}
    </div>
  )

  const yesField = (
    label: string,
    value: string | null,
    onChange: (v: string | null) => void
  ): React.JSX.Element => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm">{label}</span>
      <Select value={value ?? UNSET} onValueChange={(v) => onChange(v === UNSET ? null : v)}>
        <SelectTrigger size="sm" className="w-28 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>
            <span className="text-muted-foreground">—</span>
          </SelectItem>
          <SelectItem value="yes">yes</SelectItem>
          {/* A raw spelling other than exactly `yes` (case included) must be
              its own item, or the Select renders blank for it */}
          {value !== null && value !== 'yes' && <SelectItem value={value}>{value}</SelectItem>}
        </SelectContent>
      </Select>
    </div>
  )

  const laws = draft.successionLaws ?? []

  return (
    <div className="space-y-3.5 rounded-lg border bg-muted/30 p-3">
      {files !== null && (
        <div className="space-y-1.5">
          <FieldLabel required>File</FieldLabel>
          <Select value={fileChoice || undefined} onValueChange={setFileChoice}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a file…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW_FILE}>New file…</SelectItem>
              {files.map((f) => (
                <SelectItem key={f} value={f} className="font-mono">
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fileChoice === NEW_FILE && (
            <Input
              type="text"
              className="font-mono"
              value={newFileName}
              placeholder="k_hellas.txt"
              onChange={(e) => setNewFileName(e.target.value)}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Under <code className="font-mono">history/titles</code>
          </p>
        </div>
      )}

      {dateField()}
      {refField('Holder', draft.holder, (v) => set({ holder: v }), holderOptions, 'unchanged')}
      {refField('Liege (de facto)', draft.liege, (v) => set({ liege: v }), titleOptions, 'unchanged')}
      {refField(
        'Government',
        draft.government,
        (v) => set({ government: v }),
        data.governments,
        'unchanged'
      )}
      {textField(
        'Development change',
        draft.changeDevelopmentLevel,
        (v) => set({ changeDevelopmentLevel: v }),
        'e.g. 3',
        'Added to the capital county’s development at this date.'
      )}

      <div className="space-y-1.5">
        <FieldLabel>Succession laws</FieldLabel>
        <div className="flex min-h-6 flex-wrap gap-1.5">
          {laws.map((law) => (
            <ReferenceBadge
              key={law}
              entry={data.successionLaws.find((l) => normId(l.id) === normId(law)) ?? idOnly(law)}
              onRemove={() => {
                const next = laws.filter((l) => l !== law)
                set({ successionLaws: next.length === 0 ? null : next })
              }}
            />
          ))}
          {laws.length === 0 && (
            <span className="text-sm text-muted-foreground">
              {draft.successionLaws === null ? 'unchanged' : 'empty block'}
            </span>
          )}
        </div>
        <ReferenceInput
          options={data.successionLaws.filter((l) => !laws.includes(l.id))}
          placeholder="Set succession law…"
          onAdd={(v) => set({ successionLaws: [...laws, v] })}
        />
        <Hint value="Setting laws replaces the title's whole law set at this date." />
      </div>

      {refField(
        'De jure liege',
        draft.deJureLiege,
        (v) => set({ deJureLiege: v }),
        titleOptions,
        'unchanged'
      )}
      {textField(
        'Development level',
        draft.developmentLevel,
        (v) => set({ developmentLevel: v }),
        'absolute value',
        undefined
      )}
      {textField(
        'Name',
        draft.name,
        (v) => set({ name: v }),
        'localization key, e.g. WEST_FRANCIA',
        'Renames the title from this date.'
      )}
      {refField(
        'Insert title history',
        draft.insertTitleHistory,
        (v) => set({ insertTitleHistory: v }),
        titleOptions,
        'none'
      )}
      {textField(
        'Holder (ignore head-of-faith requirement)',
        draft.holderIgnoreHeadOfFaithRequirement,
        (v) => set({ holderIgnoreHeadOfFaithRequirement: v }),
        'character id',
        undefined
      )}
      {yesField('Reset name', draft.resetName, (v) => set({ resetName: v }))}
      {yesField('Remove succession laws', draft.removeSuccessionLaws, (v) =>
        set({ removeSuccessionLaws: v })
      )}

      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={() => onSubmit(draft, targetFile)}>
          {busy ? 'Saving…' : 'Save entry'}
        </Button>
      </div>
    </div>
  )
}

interface Props {
  titleId: string
  data: TitleData
  /** All entries for the title, across game and mod files; null while loading */
  entries: TitleHistoryEntry[] | null
  /** The mod's own history/titles files, for the add form's target picker */
  historyFiles: string[]
  characters: CharacterSummary[]
  calendar: CalendarConfig | null
  showRawDates: boolean
  onShowRawDatesChange: (v: boolean) => void
  modPath: string
  onOpenTitle: (id: string) => void
  onOpenCharacter: (file: string, id: string) => void
  /** Called after any successful write so the page can reload the history */
  onChanged: () => void
  /**
   * Reports whether an entry form is open, so the page can keep the detail
   * panel's Escape-to-close from firing while one is — Escape then cancels
   * the form instead (handled here).
   */
  onFormOpenChange: (open: boolean) => void
}

/**
 * The title's timeline: every dated history entry, sorted chronologically
 * (files themselves are deliberately out of order — only this view sorts),
 * with holders and properties editable per entry and new entries appendable.
 */
export default function TitleHistoryPanel({
  titleId,
  data,
  entries,
  historyFiles,
  characters,
  calendar,
  showRawDates,
  onShowRawDatesChange,
  modPath,
  onOpenTitle,
  onOpenCharacter,
  onChanged,
  onFormOpenChange
}: Props): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEditing(null)
    setAdding(false)
    setError(null)
  }, [titleId])

  const formOpen = editing !== null || adding
  useEffect(() => {
    onFormOpenChange(formOpen)
    return () => onFormOpenChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen])

  // Escape cancels an open entry form; the page keeps the detail panel's
  // Escape-to-close inert while one is open, so the two never both fire.
  useHotkeys(
    'escape',
    () => {
      setEditing(null)
      setAdding(false)
      setError(null)
    },
    {
      enabled: () => formOpen,
      enableOnFormTags: true,
      ignoreEventWhen: (e) => e.defaultPrevented
    }
  )

  const sorted = useMemo(() => (entries === null ? [] : sortEntries(entries)), [entries])

  const charById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters])
  const holderOptions: RefEntry[] = useMemo(
    () => [
      { id: '0', name: 'vacant / destroyed' },
      ...characters.map((c) => ({ id: c.id, name: c.name }))
    ],
    [characters]
  )
  const titleOptions: RefEntry[] = useMemo(
    () => [
      { id: '0', name: 'none / independent' },
      ...data.titles.map((t) => ({ id: t.id, name: t.localizedName }))
    ],
    [data.titles]
  )

  const displayDate = (date: string): string =>
    (showRawDates ? null : formatCalendarDate(date, calendar)) ?? date

  const submitEdit = async (entry: TitleHistoryEntry, patch: TitleHistoryEntryPatch): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.ck3tools.saveTitleHistoryEntry(
        modPath,
        entry.file,
        titleId,
        entry.titleBlock,
        entry.index,
        patch
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEditing(null)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const submitAdd = async (patch: TitleHistoryEntryPatch, file: string | null): Promise<void> => {
    if (file === null || file === '') return
    setBusy(true)
    setError(null)
    try {
      const result = await window.ck3tools.addTitleHistoryEntry(modPath, file, titleId, patch)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAdding(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (entry: TitleHistoryEntry): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.ck3tools.deleteTitleHistoryEntry(
        modPath,
        entry.file,
        titleId,
        entry.titleBlock,
        entry.index
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      // Deleting reindexes the entries after it, so an open edit form's
      // (file, titleBlock, index) address could now point at a different
      // entry — close it rather than let a save land on the wrong block.
      setEditing(null)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const holderRow = (label: string, value: string): React.JSX.Element => {
    const known = charById.get(value)
    return row(
      label,
      value === '0' ? (
        <em className="text-muted-foreground">vacant / destroyed</em>
      ) : (
        <ReferenceDisplay
          value={value}
          name={known?.name ?? null}
          onNavigate={known ? () => onOpenCharacter(known.file, known.id) : undefined}
        />
      )
    )
  }

  const titleRow = (label: string, value: string, zeroLabel: string): React.JSX.Element =>
    row(
      label,
      value === '0' ? (
        <em className="text-muted-foreground">{zeroLabel}</em>
      ) : (
        <ReferenceDisplay
          value={value}
          name={findTitle(data.titles, value)?.localizedName ?? null}
          onNavigate={onOpenTitle}
        />
      )
    )

  function row(label: string, value: React.ReactNode): React.JSX.Element {
    return (
      <div key={label} className="flex items-baseline gap-2 text-sm">
        <span className="w-28 shrink-0 text-xs tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <span className="min-w-0">{value}</span>
      </div>
    )
  }

  const entryRows = (e: TitleHistoryEntry): React.JSX.Element[] => {
    const rows: React.JSX.Element[] = []
    if (e.holder !== null) rows.push(holderRow('Holder', e.holder))
    if (e.liege !== null) rows.push(titleRow('Liege', e.liege, 'independent'))
    if (e.deJureLiege !== null) rows.push(titleRow('De jure liege', e.deJureLiege, 'revoked'))
    if (e.government !== null) {
      const known = data.governments.find((g) => normId(g.id) === normId(e.government!))
      rows.push(
        row(
          'Government',
          <span className={cn(known === undefined && 'font-mono')}>
            {known?.name ?? e.government}
            {known === undefined && (
              <span className="ml-1.5 text-xs text-destructive">(not a known government)</span>
            )}
          </span>
        )
      )
    }
    if (e.changeDevelopmentLevel !== null) {
      const n = Number(e.changeDevelopmentLevel)
      rows.push(
        row('Development', `${Number.isFinite(n) && n >= 0 ? '+' : ''}${e.changeDevelopmentLevel}`)
      )
    }
    if (e.developmentLevel !== null) rows.push(row('Dev. level', e.developmentLevel))
    if (e.name !== null)
      rows.push(row('Renamed', <code className="font-mono text-xs">{e.name}</code>))
    if (e.resetName !== null) rows.push(row('Name', 'reset to default'))
    if (e.insertTitleHistory !== null)
      rows.push(titleRow('Insert history', e.insertTitleHistory, '—'))
    if (e.removeSuccessionLaws !== null) rows.push(row('Laws', 'succession laws removed'))
    if (e.holderIgnoreHeadOfFaithRequirement !== null)
      rows.push(holderRow('Holder (no HoF req.)', e.holderIgnoreHeadOfFaithRequirement))
    if (e.successionLaws !== null) {
      rows.push(
        row(
          'Laws',
          e.successionLaws.length === 0 ? (
            <em className="text-muted-foreground">empty law block</em>
          ) : (
            <span className="flex flex-wrap gap-1">
              {e.successionLaws.map((law) => (
                <Badge key={law} variant="secondary" className="font-normal">
                  {data.successionLaws.find((l) => normId(l.id) === normId(law))?.name ?? (
                    <span className="font-mono">{law}</span>
                  )}
                </Badge>
              ))}
            </span>
          )
        )
      )
    }
    for (const key of e.opaqueBlocks) {
      rows.push(
        row(
          'Script',
          <Badge
            variant="outline"
            className="font-mono"
            title="Scripted block — preserved untouched; edit it in a text editor"
          >
            {key}
          </Badge>
        )
      )
    }
    for (const raw of e.extra) {
      rows.push(row('Other', <code className="font-mono text-xs">{raw}</code>))
    }
    return rows
  }

  return (
    <Card className="flex h-full min-h-0 w-full min-w-0 flex-col gap-0 py-0">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="min-w-0 truncate text-lg font-semibold text-foreground">
          History · {entries?.length ?? '…'}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <DateFormatToggle
            calendar={calendar}
            showRaw={showRawDates}
            onChange={onShowRawDatesChange}
          />
          <Button
            size="sm"
            disabled={adding}
            onClick={() => {
              setAdding(true)
              setEditing(null)
              setError(null)
            }}
          >
            <Plus />
            Add entry
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {adding && (
          <EntryForm
            initial={blankPatch()}
            files={historyFiles}
            defaultFile={entries === null ? null : defaultHistoryFile(entries)}
            holderOptions={holderOptions}
            titleOptions={titleOptions}
            data={data}
            calendar={calendar}
            showRawDates={showRawDates}
            busy={busy}
            error={error}
            onSubmit={(patch, file) => void submitAdd(patch, file)}
            onCancel={() => {
              setAdding(false)
              setError(null)
            }}
          />
        )}

        {entries !== null && entries.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">
            No history recorded — the title never changes hands or properties in this mod&apos;s
            files. Add an entry to give it a holder.
          </p>
        )}

        {sorted.map((e) => {
          const key = entryKey(e)
          if (editing === key) {
            return (
              <EntryForm
                key={key}
                initial={patchOf(e)}
                files={null}
                defaultFile={null}
                holderOptions={holderOptions}
                titleOptions={titleOptions}
                data={data}
                calendar={calendar}
                showRawDates={showRawDates}
                busy={busy}
                error={error}
                onSubmit={(patch) => void submitEdit(e, patch)}
                onCancel={() => {
                  setEditing(null)
                  setError(null)
                }}
              />
            )
          }
          return (
            <div key={key} className="space-y-1.5 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <span className="font-heading font-semibold">{displayDate(e.date)}</span>
                {calendar !== null && (
                  <span className="text-xs text-muted-foreground">
                    {showRawDates ? formatCalendarDate(e.date, calendar) : e.date}
                  </span>
                )}
                {!e.inMod && (
                  <Badge variant="outline" className="text-[10px]">
                    game
                  </Badge>
                )}
                <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-muted-foreground">
                  {e.file}
                </span>
                {e.inMod && (
                  <span className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Edit entry"
                      onClick={() => {
                        setEditing(key)
                        setAdding(false)
                        setError(null)
                      }}
                    >
                      <Pencil />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon-sm" title="Delete entry" disabled={busy}>
                          <Trash2 />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The {displayDate(e.date)} block ({e.date}) is cut from{' '}
                            <code className="font-mono">{e.file}</code>
                            {e.opaqueBlocks.length > 0 && (
                              <>
                                {' '}
                                — including its scripted{' '}
                                <code className="font-mono">{e.opaqueBlocks.join(', ')}</code> block
                                {e.opaqueBlocks.length === 1 ? '' : 's'}
                              </>
                            )}
                            . This can&apos;t be undone from here.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void remove(e)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {entryRows(e).length > 0 ? (
                  entryRows(e)
                ) : (
                  <p className="text-sm text-muted-foreground">— no recorded changes —</p>
                )}
              </div>
            </div>
          )
        })}

        {entries === null && <p className="text-sm text-muted-foreground">Loading…</p>}

        {error !== null && editing === null && !adding && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </Card>
  )
}
