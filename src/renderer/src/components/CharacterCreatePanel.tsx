import { useState } from 'react'
import { X } from 'lucide-react'
import type { CalendarConfig, CharacterDetail, RefEntry, ReferenceData } from '@shared/types'
import { SAVE_HOTKEY_LABEL, useFormHotkeys } from '../hooks/useFormHotkeys'
import CharacterForm, { FieldLabel, relationsInvalid, spousesInvalid } from './CharacterForm'
import DateFormatToggle from './DateFormatToggle'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { isValidCK3Date } from '@/lib/ck3Date'

/** Sentinel Select value for "type a new file name" (no real file ends in `…`) */
const NEW_FILE = '__new-file__'

/** Same charset the backend accepts for a new block's key. */
const ID_CHARS = /^[A-Za-z0-9_.\-']+$/

interface Props {
  modPath: string
  gameDir: string | null
  replacePaths: string[]
  /** The mod's offset-calendar display convention, if it declares one */
  calendar: CalendarConfig | null
  refData: ReferenceData | null
  /** Every character in the mod (parent options, duplicate check) */
  characters: RefEntry[]
  /** Existing .txt files under history/characters */
  characterFiles: string[]
  /** Field values seeded from the URL (Add child, Add member, …) */
  prefill: Partial<CharacterDetail>
  /** Pre-selected target file, e.g. the parent's file when adding a child */
  initialFile: string | null
  onNavigate: (id: string) => void
  onOpenLineage: (kind: 'dynasty' | 'house', id: string) => void
  /** Open a culture in the Culture Editor */
  onOpenCulture: (id: string) => void
  /** Open a faith in the Faith Editor */
  onOpenFaith: (id: string) => void
  onOpenRite: (id: string) => void
  /** Called after a successful create with the target file and new id */
  onCreated: (file: string, id: string) => void
  onClose: () => void
}

/**
 * The right-hand panel for creating a brand-new character. Reuses the shared
 * CharacterForm; what's specific here is the editable ID, the target-file
 * picker (an existing history file or a new one), and mandatory-field gating.
 * Remounted (keyed) by the caller when the URL prefills change.
 */
export default function CharacterCreatePanel({
  modPath,
  gameDir,
  replacePaths,
  calendar,
  refData,
  characters,
  characterFiles,
  prefill,
  initialFile,
  onNavigate,
  onOpenLineage,
  onOpenCulture,
  onOpenFaith,
  onOpenRite,
  onCreated,
  onClose
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState<CharacterDetail>(() => ({
    id: '',
    file: '',
    name: null,
    dynasty: null,
    house: null,
    birth: null,
    death: null,
    culture: null,
    faith: null,
    rite: null,
    father: null,
    mother: null,
    traits: [],
    spouses: [],
    relations: [],
    stats: {
      diplomacy: null,
      martial: null,
      stewardship: null,
      intrigue: null,
      learning: null,
      prowess: null
    },
    female: null,
    sexuality: null,
    dna: null,
    ...prefill
  }))
  const [fileChoice, setFileChoice] = useState<string>(() => {
    if (initialFile && characterFiles.includes(initialFile)) return initialFile
    return characterFiles.length === 0 ? NEW_FILE : ''
  })
  const [newFileName, setNewFileName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Show file years instead of the mod calendar's era years in the date fields */
  const [showRawDates, setShowRawDates] = useState(false)

  const set = (patch: Partial<CharacterDetail>): void => setDraft({ ...draft, ...patch })

  /** The file the character will be written to; a new name gets .txt appended. */
  const typedName = newFileName.trim()
  const targetFile =
    fileChoice === NEW_FILE
      ? typedName === ''
        ? ''
        : typedName.toLowerCase().endsWith('.txt')
          ? typedName
          : `${typedName}.txt`
      : fileChoice

  const id = draft.id.trim()
  const idInvalid = id !== '' && !ID_CHARS.test(id)
  const idTaken = id !== '' && characters.some((c) => c.id === id)
  const badBirth = !!draft.birth && !isValidCK3Date(draft.birth)
  const badDeath = !!draft.death && !isValidCK3Date(draft.death)
  const badSpouses = spousesInvalid(draft.spouses)
  const badRelations = relationsInvalid(draft.relations)

  const canCreate =
    !creating &&
    id !== '' &&
    !idInvalid &&
    !idTaken &&
    targetFile !== '' &&
    !!draft.name?.trim() &&
    !!draft.culture &&
    (!!draft.faith || !!draft.rite) &&
    !!draft.birth &&
    !badBirth &&
    !badDeath &&
    !badSpouses &&
    !badRelations

  const create = async (): Promise<void> => {
    if (!canCreate) return
    setCreating(true)
    setError(null)
    try {
      const toSave: CharacterDetail = {
        ...draft,
        id,
        file: targetFile,
        birth: draft.birth || null,
        death: draft.death || null
      }
      const result = await window.ck3tools.createCharacter(modPath, targetFile, toSave)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onCreated(targetFile, id)
    } finally {
      setCreating(false)
    }
  }

  useFormHotkeys({ onSave: create, canSave: canCreate, onClose })

  const identitySlot = (
    <>
      <div className="space-y-1.5">
        <FieldLabel required>File</FieldLabel>
        <Select value={fileChoice || undefined} onValueChange={setFileChoice}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a file…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEW_FILE}>New file…</SelectItem>
            {characterFiles.map((f) => (
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
            placeholder="my_characters.txt"
            onChange={(e) => setNewFileName(e.target.value)}
          />
        )}
      </div>
      <div className="space-y-1.5">
        <FieldLabel required>ID</FieldLabel>
        <Input
          type="text"
          className="font-mono"
          value={draft.id}
          placeholder="e.g. 1001"
          aria-invalid={idInvalid || idTaken || undefined}
          onChange={(e) => set({ id: e.target.value })}
        />
        {idTaken && <p className="text-xs text-destructive">This id already exists in the mod.</p>}
        {idInvalid && (
          <p className="text-xs text-destructive">
            Letters, digits, _ . - &apos; only — no spaces.
          </p>
        )}
      </div>
    </>
  )

  return (
    <Card className="flex h-full min-h-0 w-full min-w-0 flex-col gap-0 py-0">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-lg font-semibold text-foreground">New character</h2>
        <div className="flex shrink-0 items-center gap-2">
          <DateFormatToggle calendar={calendar} showRaw={showRawDates} onChange={setShowRawDates} />
          <Button variant="ghost" size="icon-sm" title="Close (Esc)" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>

      <div className="@container min-h-0 flex-1 space-y-8 overflow-y-auto p-4">
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
          markRequired
          identitySlot={identitySlot}
        />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
        <span className="text-xs text-muted-foreground">
          <span className="text-destructive">*</span> required
        </span>
        <Button disabled={!canCreate} title={SAVE_HOTKEY_LABEL} onClick={create}>
          {creating ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </Card>
  )
}
