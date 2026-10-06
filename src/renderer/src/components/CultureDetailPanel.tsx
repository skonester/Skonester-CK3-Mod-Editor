import { useEffect, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { CalendarConfig, CultureData, CulturePatch } from '@shared/types'
import { SAVE_HOTKEY_LABEL, useFormHotkeys } from '../hooks/useFormHotkeys'
import { usePersistedDraft } from '../hooks/usePersistedDraft'
import { FieldLabel } from './CharacterForm'
import CultureForm from './CultureForm'
import Hint from './Hint'
import DateFormatToggle from './DateFormatToggle'
import StaleDraftAlert from './StaleDraftAlert'
import { openReferenceTarget } from './ReferenceInput'
import EntityReferencesSection from './EntityReferencesSection'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { draftOf, findCulture, swatchForeground } from '@/lib/cultureView'

interface Props {
  id: string
  data: CultureData
  modPath: string
  gameDir: string | null
  replacePaths: string[]
  calendar: CalendarConfig | null
  /** Show file years instead of the mod calendar's era years; shared with the related panel */
  showRawDates: boolean
  onShowRawDatesChange: (showRaw: boolean) => void
  /** Switch the editor to another culture row */
  onOpenCulture: (id: string) => void
  /** Called after a successful save so the page can reload definitions */
  onSaved: () => void
  /** Leave the row and go back to the list (the header arrow, and Esc) */
  onClose: () => void
}

/**
 * The editing panel for one culture: the shared CultureForm, plus the header,
 * the draft/dirty bookkeeping and the save footer around it.
 */
export default function CultureDetailPanel({
  id,
  data,
  modPath,
  gameDir,
  replacePaths,
  calendar,
  showRawDates,
  onShowRawDatesChange,
  onOpenCulture,
  onSaved,
  onClose
}: Props): React.JSX.Element {
  const def = findCulture(data, id)
  // The dirty check compares JSON, so both sides must be built the same way
  const original: CulturePatch | null = def === null ? null : draftOf(def)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const body = useRef<HTMLDivElement>(null)

  const editable = def !== null && def.inMod
  // Edits outlive the row: closing it, switching tools or restarting the app
  // all leave the draft where it was, listed above the list as unsaved.
  const { draft, setDraft, dirty, stale, revert, markSaved } = usePersistedDraft<CulturePatch>({
    tool: 'cultures',
    ref: def === null ? null : { id: def.id, name: def.localizedName },
    original,
    editable
  })

  useEffect(() => {
    setError(null)
  }, [id, data])

  // The "Saved ✓" flash must survive the post-save data reload (which re-runs
  // the reseed above), so it resets only when a different row is opened — and
  // a different culture starts at the top of the form rather than wherever the
  // last one was scrolled to.
  useEffect(() => {
    setSavedFlash(false)
    body.current?.scrollTo({ top: 0 })
  }, [id])

  const set = (patch: Partial<CulturePatch>): void => {
    if (!draft) return
    setDraft({ ...draft, ...patch })
    setSavedFlash(false)
  }

  const save = async (): Promise<void> => {
    if (!def || !draft) return
    setSaving(true)
    setError(null)
    try {
      const result = await window.ck3tools.saveCulture(
        gameDir,
        modPath,
        replacePaths,
        def.file,
        def.id,
        draft
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      markSaved(draft)
      setSavedFlash(true)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  useFormHotkeys({ onSave: save, canSave: editable && dirty && !saving, onClose })

  if (def === null) {
    return (
      <Card className="flex h-full min-h-0 w-full flex-col items-start gap-3 p-4">
        <Alert>
          <AlertDescription>
            No culture named <code className="font-mono">{id}</code> is defined in this mod or the
            game files it loads.
          </AlertDescription>
        </Alert>
      </Card>
    )
  }

  const swatch = def.color?.hex ?? null

  return (
    <Card className="flex h-full min-h-0 w-full min-w-0 flex-col gap-0 py-0">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-foreground">
          {swatch !== null && (
            <span
              aria-hidden
              className="size-4 shrink-0 rounded-sm border"
              style={{ backgroundColor: swatch, borderColor: swatchForeground(swatch) + '40' }}
            />
          )}
          <span className="truncate">{def.localizedName ?? def.id}</span>
          {dirty && (
            <span className="size-2 shrink-0 rounded-full bg-primary" title="Unsaved changes" />
          )}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <DateFormatToggle
            calendar={calendar}
            showRaw={showRawDates}
            onChange={onShowRawDatesChange}
          />
          <Badge variant="secondary">{def.file}</Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Open definition in text editor"
            onClick={() =>
              void openReferenceTarget(
                () => window.ck3tools.locateRef(gameDir, modPath, replacePaths, 'culture', def.id),
                def.id
              )
            }
          >
            <ExternalLink />
          </Button>
        </div>
      </div>

      <div ref={body} className="min-h-0 flex-1 space-y-8 overflow-y-auto p-4">
        {stale && <StaleDraftAlert what="culture" />}
        {!def.inMod && (
          <Alert>
            <AlertDescription>
              Defined in the base game (<code className="font-mono">{def.file}</code>). Editing game
              files isn&apos;t supported — copy the definition into the mod to change it.
            </AlertDescription>
          </Alert>
        )}

        {draft && (
          <CultureForm
            draft={draft}
            set={set}
            data={data}
            modPath={modPath}
            gameDir={gameDir}
            replacePaths={replacePaths}
            calendar={calendar}
            showRawDates={showRawDates}
            editable={editable}
            onOpenCulture={onOpenCulture}
            identitySlot={
              <div className="space-y-1.5">
                <FieldLabel>ID</FieldLabel>
                <Input type="text" value={def.id} disabled readOnly className="font-mono" />
                <Hint
                  label="Display name"
                  value={
                    def.localizedName ??
                    `not localized — add "${def.id}" to the mod's localization files`
                  }
                />
              </div>
            }
            notes={{
              color: def.color ? (
                <Hint
                  label="In file"
                  value={
                    def.color.format === 'named'
                      ? `${def.color.raw} (named — an edit writes rgb)`
                      : def.color.raw
                  }
                />
              ) : undefined
            }}
          />
        )}

        <EntityReferencesSection type="culture/cultures" id={id} />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      {editable && (
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
              revert()
              setError(null)
            }}
          >
            Revert
          </Button>
          <Button disabled={!dirty || saving} title={SAVE_HOTKEY_LABEL} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </Card>
  )
}
