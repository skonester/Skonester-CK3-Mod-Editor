import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type {
  CalendarConfig,
  CharacterDetail,
  CharacterDraft,
  CharacterSummary,
  RefEntry,
  ReferenceData
} from '@shared/types'
import { SAVE_HOTKEY_LABEL, useFormHotkeys } from '../hooks/useFormHotkeys'
import type { CharacterSearch } from '../router'
import CharacterForm, { FieldLabel, relationsInvalid, spousesInvalid } from './CharacterForm'
import DateFormatToggle from './DateFormatToggle'
import ReferenceDisplay from './ReferenceDisplay'
import RulerDesignerDnaDialog from './RulerDesignerDnaDialog'
import StaleDraftAlert from './StaleDraftAlert'
import EntityReferencesSection from './EntityReferencesSection'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatCalendarDate, isValidCK3Date } from '@/lib/ck3Date'
import { normalizeCharacterDraft as withDefaults } from '@/lib/characterDraft'
import { useApp } from '../AppContext'

// three.js and the game-shader code load with the first portrait shown
const CharacterPortrait = lazy(() => import('./CharacterPortrait'))

interface Props {
  modPath: string
  file: string
  id: string
  gameDir: string | null
  replacePaths: string[]
  /** The mod's offset-calendar display convention, if it declares one */
  calendar: CalendarConfig | null
  refData: ReferenceData | null
  /** Ids of every character in the mod, offered as father/mother options */
  characters: RefEntry[]
  /** Characters in the mod naming this one as father or mother */
  childCharacters: CharacterSummary[]
  /** Switch the editor to another character in the mod (father/mother jump) */
  onNavigate: (id: string) => void
  /** Open a lineage row in the Dynasty & House Editor */
  onOpenLineage: (kind: 'dynasty' | 'house', id: string) => void
  /** Open a culture in the Culture Editor */
  onOpenCulture: (id: string) => void
  /** Open a faith in the Faith Editor */
  onOpenFaith: (id: string) => void
  onOpenRite: (id: string) => void
  /** Open the create-character panel with these prefills (the Add child button) */
  onCreateChild: (prefill: CharacterSearch) => void
  /** Persisted unsaved edits for this character, if any; read once per open */
  storedDraft: CharacterDraft | null
  /**
   * Persist (or clear, with null) the draft for a character in this file.
   * Must be referentially stable.
   */
  onDraftChange: (file: string, id: string, entry: CharacterDraft | null) => void
  /** Called after a successful save; newId may differ from the selected id */
  onSaved: (file: string, newId: string) => void
  onClose: () => void
}

export default function CharacterDetailPanel({
  modPath,
  file,
  id,
  gameDir,
  replacePaths,
  calendar,
  refData,
  characters,
  childCharacters,
  onNavigate,
  onOpenLineage,
  onOpenCulture,
  onOpenFaith,
  onOpenRite,
  onCreateChild,
  storedDraft,
  onDraftChange,
  onSaved,
  onClose
}: Props): React.JSX.Element {
  // Files changed under the panel (an undo, the Barbershop): read the character again
  const { dataRevision } = useApp()
  const [original, setOriginal] = useState<CharacterDetail | null>(null)
  const [draft, setDraft] = useState<CharacterDetail | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  /** The file changed on disk while this draft was dormant (external edit) */
  const [stale, setStale] = useState(false)
  /** Show file years instead of the mod calendar's era years in the date fields */
  const [showRawDates, setShowRawDates] = useState(false)
  const [dnaDialogOpen, setDnaDialogOpen] = useState(false)

  /** Debounced draft persist waiting to fire; flushed before switching characters */
  const pendingPersist = useRef<(() => void) | null>(null)
  const flushPersist = (): void => {
    pendingPersist.current?.()
    pendingPersist.current = null
  }

  useEffect(() => {
    setOriginal(null)
    setDraft(null)
    setError(null)
    setStale(false)
    setSavedFlash(false)
    window.ck3tools.getCharacter(modPath, file, id).then((parsed) => {
      const d = parsed === null ? null : withDefaults(parsed)
      setOriginal(d)
      if (!d) {
        setDraft(null)
        return
      }
      // Resume a persisted draft; `original` stays the file's CURRENT state so
      // dirty/save/revert all work against what's really on disk.
      if (storedDraft) {
        setDraft(withDefaults(structuredClone(storedDraft.draft), d))
        setStale(JSON.stringify(withDefaults(storedDraft.original, d)) !== JSON.stringify(d))
      } else {
        setDraft(structuredClone(d))
      }
    })
    return flushPersist
    // storedDraft is read once per open on purpose: our own persists update it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modPath, file, id, dataRevision])

  // Computed before the early return below so the hook order stays stable
  const dirty =
    draft !== null && original !== null && JSON.stringify(draft) !== JSON.stringify(original)

  // Persist the draft as it changes (cleared when it matches the file again),
  // debounced so typing doesn't write settings.json per keystroke.
  useEffect(() => {
    if (!draft || !original) return undefined
    const entry = dirty ? { draft, original } : null
    const originalId = original.id
    pendingPersist.current = () => onDraftChange(file, originalId, entry)
    const t = setTimeout(flushPersist, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, original])

  const badBirth = !!draft?.birth && !isValidCK3Date(draft.birth)
  const badDeath = !!draft?.death && !isValidCK3Date(draft.death)
  const badSpouses = spousesInvalid(draft?.spouses)
  const badRelations = relationsInvalid(draft?.relations)

  const save = async (): Promise<void> => {
    if (!draft || !original) return
    setSaving(true)
    setError(null)
    try {
      const toSave: CharacterDetail = {
        ...draft,
        birth: draft.birth || null,
        death: draft.death || null
      }
      const result = await window.ck3tools.saveCharacter(modPath, file, original.id, toSave)
      if (!result.ok) {
        setError(result.error)
        return
      }
      // Cancel any in-flight persist and clear the stored draft immediately
      pendingPersist.current = null
      onDraftChange(file, original.id, null)
      // Re-read rather than adopt the draft: script statements were found by
      // their on-disk text, which the save just changed
      const fresh = await window.ck3tools.getCharacter(modPath, file, toSave.id)
      const saved = fresh === null ? toSave : withDefaults(fresh)
      setOriginal(structuredClone(saved))
      setDraft(saved)
      setSavedFlash(true)
      setStale(false)
      onSaved(file, toSave.id)
    } finally {
      setSaving(false)
    }
  }

  useFormHotkeys({
    onSave: save,
    canSave:
      dirty &&
      !saving &&
      !badBirth &&
      !badDeath &&
      !badSpouses &&
      !badRelations &&
      !!draft?.id.trim(),
    onClose
  })

  if (!draft || !original) {
    return (
      <Card className="flex h-full w-full min-w-0 flex-col gap-0 py-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Character</h2>
          <Button variant="ghost" size="icon-sm" title="Close (Esc)" onClick={onClose}>
            <X />
          </Button>
        </div>
        <p className="p-4 text-sm text-muted-foreground">
          {original === null ? 'Loading…' : 'Character not found.'}
        </p>
      </Card>
    )
  }

  const set = (patch: Partial<CharacterDetail>): void => {
    setDraft({ ...draft, ...patch })
    setSavedFlash(false)
  }

  /**
   * A new child starts out in the parent's file, sharing culture and faith;
   * lineage follows the father, so it prefills only from a male parent. The
   * parent link uses the on-file id — an unsaved id rename would dangle.
   */
  const addChild = (): void => {
    const prefill: CharacterSearch = {
      file,
      culture: draft.culture ?? undefined,
      faith: draft.faith ?? undefined,
      rite: draft.rite ?? undefined
    }
    if (/^yes$/i.test(draft.female ?? '')) {
      prefill.mother = original.id
    } else {
      prefill.father = original.id
      prefill.dynasty = draft.dynasty ?? undefined
      prefill.house = draft.house ?? undefined
    }
    onCreateChild(prefill)
  }

  /**
   * The paste dialog writes the DNA/modifier files and the history wiring
   * itself, so afterwards the on-disk truth moved: re-read it, take it as the
   * new baseline, and carry only the fresh `dna` into the draft — any other
   * unsaved edits stay unsaved.
   */
  const dnaApplied = async (): Promise<void> => {
    try {
      const d = await window.ck3tools.getCharacter(modPath, file, original.id)
      if (!d) {
        setError('The DNA was applied, but the character could not be re-read from its file.')
        return
      }
      setOriginal(d)
      setDraft((prev) => (prev ? { ...prev, dna: d.dna } : prev))
      setStale(false)
    } catch (err) {
      console.error('[CharacterDetailPanel] reload after DNA paste failed:', err)
      setError(
        `The DNA was applied, but reloading the character failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  /** Parent ids resolve to a display name through the mod-wide character list */
  const charName = new Map(characters.map((c) => [c.id, c.name]))

  /**
   * A child's other parent: this character holds one side of the pair, so the
   * column shows the side they don't — the mother for a male character, the
   * father for a female one.
   */
  const thisIsMother = /^yes$/i.test(draft.female ?? '')
  const otherParentLabel = thisIsMother ? 'Father' : 'Mother'
  const otherParent = (c: CharacterSummary): string | null => (thisIsMother ? c.father : c.mother)

  /**
   * Same convention as the date fields: the era year alone while the calendar
   * is on, otherwise the raw file date with the era year as a muted hint.
   */
  const birthCell = (raw: string | null): React.ReactNode => {
    if (raw === null) return <em className="text-muted-foreground">—</em>
    const converted = formatCalendarDate(raw, calendar)
    if (converted === null) return raw
    if (!showRawDates) return converted
    return (
      <>
        {raw} <span className="text-muted-foreground">({converted})</span>
      </>
    )
  }

  /**
   * Children are derived from the other characters' father/mother keys, not
   * stored on this one, so the list is read-only; adding one creates a new
   * character with this one prefilled as a parent.
   */
  const childrenSlot = (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Children · {childCharacters.length}</FieldLabel>
        <Button
          variant="outline"
          size="sm"
          title="Create a new character with this one as a parent"
          onClick={addChild}
        >
          <Plus />
          Add child
        </Button>
      </div>
      {childCharacters.length === 0 ? (
        <p className="text-sm text-muted-foreground">none</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>{otherParentLabel}</TableHead>
                <TableHead>Birth</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {childCharacters.map((c) => (
                <TableRow key={`${c.file}:${c.id}`}>
                  <TableCell className="max-w-50 truncate">
                    <ReferenceDisplay
                      value={c.id}
                      name={c.name}
                      onNavigate={() => onNavigate(c.id)}
                      className="truncate"
                    />
                  </TableCell>
                  <TableCell className="max-w-50 truncate">
                    <ReferenceDisplay
                      value={otherParent(c)}
                      name={charName.get(otherParent(c) ?? '') ?? null}
                      onNavigate={() => onNavigate(otherParent(c) as string)}
                      className="truncate"
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{birthCell(c.birth)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )

  return (
    <Card className="flex h-full min-h-0 w-full min-w-0 flex-col gap-0 py-0">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          {original.name ?? original.id}
          {dirty && <span className="size-2 rounded-full bg-primary" title="Unsaved changes" />}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <DateFormatToggle calendar={calendar} showRaw={showRawDates} onChange={setShowRawDates} />
          <Button variant="ghost" size="icon-sm" title="Close (Esc)" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>

      <div className="@container min-h-0 flex-1 space-y-8 overflow-y-auto p-4">
        {stale && <StaleDraftAlert what="character" />}
        <CharacterForm
          draft={draft}
          set={set}
          modPath={modPath}
          gameDir={gameDir}
          replacePaths={replacePaths}
          calendar={calendar}
          showRawDates={showRawDates}
          refData={refData}
          characters={characters}
          onNavigate={onNavigate}
          onOpenLineage={onOpenLineage}
          onOpenCulture={onOpenCulture}
          onOpenFaith={onOpenFaith}
          onOpenRite={onOpenRite}
          badBirth={badBirth}
          badDeath={badDeath}
          identitySlot={
            <div className="space-y-1.5">
              <FieldLabel>ID</FieldLabel>
              <p className="font-mono text-sm">{draft.id}</p>
            </div>
          }
          childrenSlot={childrenSlot}
          onPasteDna={() => setDnaDialogOpen(true)}
          appearanceSlot={
            <Suspense fallback={null}>
              <CharacterPortrait id={id} name={original.name} />
            </Suspense>
          }
        />

        <RulerDesignerDnaDialog
          open={dnaDialogOpen}
          onOpenChange={setDnaDialogOpen}
          modPath={modPath}
          gameDir={gameDir}
          replacePaths={replacePaths}
          characterFile={file}
          characterId={original.id}
          onApplied={dnaApplied}
        />

        <EntityReferencesSection type="characters" id={id} />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
        <span
          className={cn(
            'mr-auto text-sm text-green-600 dark:text-green-500',
            !(savedFlash && !dirty) && 'invisible'
          )}
        >
          Saved ✓
        </span>
        <Button
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => {
            pendingPersist.current = null
            onDraftChange(file, original.id, null)
            setDraft(structuredClone(original))
            setError(null)
            setStale(false)
          }}
        >
          Revert
        </Button>
        <Button
          disabled={
            !dirty ||
            saving ||
            badBirth ||
            badDeath ||
            badSpouses ||
            badRelations ||
            !draft.id.trim()
          }
          title={SAVE_HOTKEY_LABEL}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Card>
  )
}
