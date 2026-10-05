import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { RefEntry, ReligionData, SaveResult } from '@shared/types'
import { SAVE_HOTKEY_LABEL, useFormHotkeys } from '../hooks/useFormHotkeys'
import { useFaithIcons } from '../useGameIcons'
import type { IconContext } from '../useGameIcons'
import { FieldLabel } from './CharacterForm'
import ReferenceInput from './ReferenceInput'
import { idOnly } from './ReferenceLabel'
import { IconTile } from './Swatch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { normId } from '@/lib/faithView'

/** Same charset the backend accepts for a new block's key. */
const ID_CHARS = /^[A-Za-z0-9_.\-']+$/

/** A visible starting swatch, so a forgotten color isn't invisible-black. */
const DEFAULT_COLOR = '#808080'

interface Draft {
  id: string
  religion: string | null
  color: string
  icon: string | null
}

interface Props {
  modPath: string
  gameDir: string | null
  replacePaths: string[]
  /** Religions (parent options, clash checks) and faiths (clash checks) */
  data: ReligionData
  /** Icon names for the picker, from the game and mod folders */
  iconNames: string[]
  /** Parent religion seeded from the URL ("Add faith" on a religion) */
  prefillReligion: string | null
  /** Called after a successful create with the new faith's id */
  onCreated: (id: string) => void
  /** Jump to the Religion Editor (the religion field's follow button) */
  onOpenReligion: (id: string) => void
  onClose: () => void
}

/**
 * The right-hand panel for creating a brand-new faith. Deliberately minimal —
 * id, parent religion, color, icon — because the faith lands in the detail
 * panel right after creation, where holy sites and doctrines are edited with
 * the full controls rather than duplicated here.
 *
 * In 1.20 a faith gets its own <id>.txt file and may use any loaded religion.
 * Legacy faiths still nest inside a mod religion's block.
 */
export default function FaithCreatePanel({
  modPath,
  gameDir,
  replacePaths,
  data,
  iconNames,
  prefillReligion,
  onCreated,
  onOpenReligion,
  onClose
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => ({
    id: '',
    religion: prefillReligion,
    color: DEFAULT_COLOR,
    icon: null
  }))
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (patch: Partial<Draft>): void => {
    setDraft({ ...draft, ...patch })
    setError(null)
  }

  const iconCtx: IconContext = { gameDir, modPath, replacePaths }
  const iconFor = useFaithIcons(
    iconCtx,
    useMemo(() => (draft.icon === null ? [] : [draft.icon]), [draft.icon])
  )
  const iconOptions: RefEntry[] = useMemo(() => iconNames.map(idOnly), [iconNames])

  // Standalone 1.20 faiths can use game parents; legacy creation edits a mod parent.
  const modern = data.format === '1.20'
  const modReligions = data.religions.filter((r) => modern || r.inMod)
  const religionOptions = modReligions.map((r) => ({ id: r.id, name: r.localizedName }))

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
    data.faiths.some((f) => !f.inMod && normId(f.id) === normId(id))

  const canCreate =
    !creating && id !== '' && !idInvalid && clash === null && !!draft.religion?.trim()

  const create = async (): Promise<void> => {
    if (!canCreate) return
    setCreating(true)
    setError(null)
    try {
      const result: SaveResult = await window.ck3tools.createFaith(modPath, draft.religion!, {
        id,
        format: data.format,
        color: draft.color,
        icon: draft.icon,
        reformedIcon: null,
        religiousHead: null,
        holySites: [],
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

  return (
    <Card className="flex h-full min-h-0 w-full min-w-0 flex-col gap-0 py-0">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="truncate text-lg font-semibold text-foreground">New faith</h2>
        <Button variant="ghost" size="icon-sm" title="Close (Esc)" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div className="space-y-1.5">
          <FieldLabel required>Religion</FieldLabel>
          <ReferenceInput
            value={draft.religion}
            onChange={(v) => set({ religion: v })}
            options={religionOptions}
            placeholder="Parent religion…"
            followTitle="Go to this religion"
            onNavigate={onOpenReligion}
          />
          <p className="text-xs text-muted-foreground">
            {modern ? (
              <>
                The faith is written to{' '}
                <code className="font-mono">
                  common/religion/faith_types/{draft.id.trim() || '<id>'}.txt
                </code>
                . You can use a base-game religion as its parent.
              </>
            ) : (
              <>
                The faith is written into this religion&apos;s{' '}
                <code className="font-mono">faiths</code> block, so only religions the mod defines
                can take one.
              </>
            )}
          </p>
          {modReligions.length === 0 && (
            <p className="text-xs text-destructive">
              No parent religions are available — create one first.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <FieldLabel required>ID</FieldLabel>
          <Input
            type="text"
            className="font-mono"
            value={draft.id}
            placeholder="e.g. olympian_faith"
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
          <FieldLabel>Color</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              type="color"
              aria-label="Faith color"
              className="h-7 w-12 shrink-0 cursor-pointer p-0.5"
              value={draft.color}
              onChange={(e) => set({ color: e.target.value })}
            />
            <Input
              type="text"
              className="font-mono"
              placeholder="#rrggbb"
              value={draft.color}
              onChange={(e) => {
                const v = e.target.value.trim()
                if (/^#[0-9a-fA-F]{6}$/.test(v)) set({ color: v.toLowerCase() })
              }}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <FieldLabel>Icon</FieldLabel>
          <div className="flex items-center gap-2">
            <IconTile url={draft.icon === null ? null : iconFor(draft.icon)} size={36} />
            <ReferenceInput
              className="min-w-0 flex-1"
              value={draft.icon}
              onChange={(v) => set({ icon: v })}
              options={iconOptions}
              placeholder="none"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Holy sites, doctrines and tenets are picked in the editor once the faith exists.
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
