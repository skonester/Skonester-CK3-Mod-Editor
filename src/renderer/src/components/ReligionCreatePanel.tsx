import { useState } from 'react'
import { X } from 'lucide-react'
import type { ReligionData, SaveResult } from '@shared/types'
import { SAVE_HOTKEY_LABEL, useFormHotkeys } from '../hooks/useFormHotkeys'
import { FieldLabel } from './CharacterForm'
import ReferenceInput from './ReferenceInput'
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
import { normId } from '@/lib/faithView'

/** Sentinel Select value for "type a new file name" (no real file is named this) */
const NEW_FILE = '__new-file__'

/** Same charset the backend accepts for a new block's key. */
const ID_CHARS = /^[A-Za-z0-9_.\-']+$/

interface Draft {
  id: string
  family: string | null
  graphicalFaith: string | null
  pietyIconGroup: string | null
}

interface Props {
  modPath: string
  /** Religions and faiths for clash checks, families for the picker */
  data: ReligionData
  /** Existing .txt files under the mod's religion_types folder */
  files: string[]
  /** Called after a successful create with the new religion's id */
  onCreated: (id: string) => void
  onClose: () => void
}

/**
 * The right-hand panel for creating a brand-new religion. Deliberately minimal
 * — id, target file, family and the graphical hints — because the religion
 * lands in the detail panel right after creation, where doctrines are edited
 * with the full controls. The block is written with an empty `faiths` list;
 * faiths are added from the Faith Editor.
 */
export default function ReligionCreatePanel({
  modPath,
  data,
  files,
  onCreated,
  onClose
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => ({
    id: '',
    family: null,
    graphicalFaith: null,
    pietyIconGroup: null
  }))
  const [fileChoice, setFileChoice] = useState('')
  const [newFileName, setNewFileName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (patch: Partial<Draft>): void => {
    setDraft({ ...draft, ...patch })
    setError(null)
  }

  const choice = fileChoice || (files.length === 0 ? NEW_FILE : '')
  const typedName = newFileName.trim()

  /** The file the definition will be written to; a new name gets .txt appended. */
  const targetFile =
    choice === NEW_FILE
      ? typedName === ''
        ? ''
        : typedName.toLowerCase().endsWith('.txt')
          ? typedName
          : `${typedName}.txt`
      : choice

  const id = draft.id.trim()
  const idInvalid = id !== '' && !ID_CHARS.test(id)

  // A mod definition with this id (of either kind) blocks the create; the
  // backend rejects it too. Religions and faiths are separate databases in the
  // game, but the editors resolve a deep-linked id against both.
  const clash =
    id === ''
      ? null
      : ((
          [
            ['religion', data.religions.find((r) => r.inMod && normId(r.id) === normId(id))],
            ['faith', data.faiths.find((f) => f.inMod && normId(f.id) === normId(id))]
          ] as const
        ).find(([, hit]) => hit !== undefined) ?? null)

  // Not a clash: shadowing a base-game id is how you override one, but it's
  // worth saying out loud before it happens by accident
  const shadowsGame =
    id !== '' &&
    clash === null &&
    data.religions.some((r) => !r.inMod && normId(r.id) === normId(id))

  const canCreate =
    !creating &&
    id !== '' &&
    !idInvalid &&
    clash === null &&
    targetFile !== '' &&
    !!draft.family?.trim()

  const create = async (): Promise<void> => {
    if (!canCreate) return
    setCreating(true)
    setError(null)
    try {
      const result: SaveResult = await window.ck3tools.createReligion(modPath, targetFile, {
        format: data.format,
        id,
        family: draft.family,
        graphicalFaith: draft.graphicalFaith,
        pietyIconGroup: draft.pietyIconGroup,
        doctrines: []
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onCreated(id)
    } finally {
      setCreating(false)
    }
  }

  useFormHotkeys({ onSave: create, canSave: canCreate, onClose })

  const textField = (
    label: string,
    value: string | null,
    onChange: (v: string | null) => void,
    placeholder: string
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="text"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    </div>
  )

  return (
    <Card className="flex h-full min-h-0 w-full min-w-0 flex-col gap-0 py-0">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="truncate text-lg font-semibold text-foreground">New religion</h2>
        <Button variant="ghost" size="icon-sm" title="Close (Esc)" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div className="space-y-1.5">
          <FieldLabel required>File</FieldLabel>
          <Select value={choice || undefined} onValueChange={setFileChoice}>
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
          {choice === NEW_FILE && (
            <Input
              type="text"
              className="font-mono"
              value={newFileName}
              placeholder="00_my_religion.txt"
              onChange={(e) => setNewFileName(e.target.value)}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Under <code className="font-mono">common/religion/religion_types</code>
          </p>
        </div>

        <div className="space-y-1.5">
          <FieldLabel required>ID</FieldLabel>
          <Input
            type="text"
            className="font-mono"
            value={draft.id}
            placeholder="e.g. hellenism_religion"
            aria-invalid={idInvalid || clash !== null || undefined}
            onChange={(e) => set({ id: e.target.value })}
          />
          {clash !== null && (
            <p className="text-xs text-destructive">
              Already {clash[0] === 'religion' ? 'a religion' : 'a faith'} in the mod (
              <span className="font-mono">{clash[1]!.file}</span>).
            </p>
          )}
          {idInvalid && (
            <p className="text-xs text-destructive">
              Letters, digits, _ . - &apos; only — no spaces.
            </p>
          )}
          {shadowsGame && (
            <p className="text-xs text-muted-foreground">
              The base game defines this id — your definition will override it.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            The display name comes from a localization entry under this id — add it to the
            mod&apos;s <code className="font-mono">localization</code> files.
          </p>
        </div>

        <div className="space-y-1.5">
          <FieldLabel required>Family</FieldLabel>
          <ReferenceInput
            value={draft.family}
            onChange={(v) => set({ family: v })}
            options={data.families}
            placeholder="e.g. Pagan (rf_pagan)"
          />
        </div>

        {textField('Graphical faith', draft.graphicalFaith, (v) => set({ graphicalFaith: v }), 'e.g. pagan_gfx')}
        {textField('Piety icon group', draft.pietyIconGroup, (v) => set({ pietyIconGroup: v }), 'e.g. pagan')}

        <p className="text-xs text-muted-foreground">
          {data.format === '1.20' ? 'Create the religion, then add standalone faiths from the Faith Editor.' : <>The religion is created with an empty <code className="font-mono">faiths</code> list. Add faiths from the Faith Editor.</>}
          {' '}Doctrines are picked in the editor once it exists.
        </p>

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
