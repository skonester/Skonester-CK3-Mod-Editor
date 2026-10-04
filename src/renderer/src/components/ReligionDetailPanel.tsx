import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ExternalLink, Plus } from 'lucide-react'
import type { RefLocation, ReligionData, SaveResult } from '@shared/types'
import { SAVE_HOTKEY_LABEL, useFormHotkeys } from '../hooks/useFormHotkeys'
import { usePersistedDraft } from '../hooks/usePersistedDraft'
import DoctrineEditor from './DoctrineEditor'
import ReferenceInput, { openReferenceTarget } from './ReferenceInput'
import { Swatch } from './Swatch'
import FormSection from './FormSection'
import StaleDraftAlert from './StaleDraftAlert'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { adherentsOfFaith, adherentsOfReligion, faithsOfReligion, normId } from '@/lib/faithView'

/** The editable fields of a religion. */
interface ReligionDraft {
  family: string | null
  graphicalFaith: string | null
  pietyIconGroup: string | null
  doctrines: string[]
}

interface Props {
  id: string
  data: ReligionData
  modPath: string
  gameDir: string | null
  replacePaths: string[]
  /** Jump to the Faith Editor */
  onOpenFaith: (id: string) => void
  /** Open the Faith Editor's create panel with this religion prefilled */
  onAddFaith: () => void
  /** Jump to the character editor */
  onOpenCharacter: (id: string, file: string) => void
  /** Called after a successful save so the page can reload definitions */
  onSaved: () => void
  /** Leave the row and go back to the list (Esc) */
  onClose: () => void
}

export default function ReligionDetailPanel({
  id,
  data,
  modPath,
  gameDir,
  replacePaths,
  onOpenFaith,
  onAddFaith,
  onOpenCharacter,
  onSaved,
  onClose
}: Props): React.JSX.Element {
  const religion = data.religions.find((r) => normId(r.id) === normId(id)) ?? null

  const original: ReligionDraft | null = religion
    ? {
        family: religion.family,
        graphicalFaith: religion.graphicalFaith,
        pietyIconGroup: religion.pietyIconGroup,
        doctrines: religion.doctrines
      }
    : null

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const editable = religion !== null && religion.inMod
  // Edits outlive the row: closing it, switching tools or restarting the app
  // all leave the draft where it was, listed above the list as unsaved.
  const { draft, setDraft, dirty, stale, revert, markSaved } = usePersistedDraft<ReligionDraft>({
    tool: 'religions',
    ref: religion === null ? null : { id: religion.id, name: religion.localizedName },
    original,
    editable
  })

  useEffect(() => {
    setError(null)
  }, [id, data])

  // The "Saved ✓" flash must survive the post-save data reload (which re-runs
  // the reseed above), so it resets only when a different row is opened — and
  // a new row starts at the top of the form rather than wherever the last one
  // was scrolled to
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setSavedFlash(false)
    body.current?.scrollTo({ top: 0 })
  }, [id])

  const faiths = useMemo(() => faithsOfReligion(data, id), [data, id])
  const adherents = useMemo(() => adherentsOfReligion(data, id), [data, id])

  const set = (patch: Partial<ReligionDraft>): void => {
    if (!draft) return
    setDraft({ ...draft, ...patch })
    setSavedFlash(false)
  }

  const save = async (): Promise<void> => {
    if (!religion || !draft) return
    setSaving(true)
    setError(null)
    try {
      const result: SaveResult = await window.ck3tools.saveReligion(
        modPath,
        religion.file,
        religion.id,
        {
          family: draft.family,
          graphicalFaith: draft.graphicalFaith,
          pietyIconGroup: draft.pietyIconGroup,
          doctrines: draft.doctrines
        }
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

  const locateDoctrine = (v: string): Promise<RefLocation | null> =>
    window.ck3tools.locateRef(gameDir, modPath, replacePaths, 'doctrine', v)

  const fieldLabel = (text: string): React.JSX.Element => (
    <Label className="text-xs tracking-wide text-muted-foreground uppercase">{text}</Label>
  )

  const textField = (
    label: string,
    value: string | null,
    onChange: (v: string | null) => void
  ): React.JSX.Element => (
    <div className="space-y-1.5">
      {fieldLabel(label)}
      <Input
        type="text"
        value={value ?? ''}
        placeholder="none"
        disabled={!editable}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    </div>
  )

  return (
    <Card className="flex h-full min-h-0 w-full min-w-0 flex-col gap-0 py-0">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-foreground">
          <span className="truncate">{religion?.localizedName ?? id}</span>
          {dirty && (
            <span className="size-2 shrink-0 rounded-full bg-primary" title="Unsaved changes" />
          )}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <Badge variant="secondary">religion</Badge>
          {religion && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Open definition in text editor"
              onClick={() =>
                void openReferenceTarget(
                  () =>
                    window.ck3tools.locateRef(
                      gameDir,
                      modPath,
                      replacePaths,
                      'religion',
                      religion.id
                    ),
                  religion.id
                )
              }
            >
              <ExternalLink />
            </Button>
          )}
        </div>
      </div>

      <div ref={body} className="min-h-0 flex-1 space-y-8 overflow-y-auto p-4">
        {stale && <StaleDraftAlert what="religion" />}
        {religion === null && (
          <Alert>
            <AlertDescription>
              No definition found for <code className="font-mono">{id}</code> in the mod (or the
              game files it loads).
            </AlertDescription>
          </Alert>
        )}
        {religion !== null && !religion.inMod && (
          <Alert>
            <AlertDescription>
              Defined in the base game (<code className="font-mono">{religion.file}</code>).
              Editing game files isn&apos;t supported — copy the definition into the mod to change
              it.
            </AlertDescription>
          </Alert>
        )}

        {draft && religion && (
          <FormSection title="Details">
            <div className="space-y-1.5">
              {fieldLabel('ID')}
              <Input type="text" value={religion.id} disabled readOnly className="font-mono" />
            </div>
            <div className="space-y-1.5">
              {fieldLabel('Name')}
              <Input
                type="text"
                value={religion.localizedName ?? ''}
                placeholder="not localized"
                disabled
                readOnly
              />
              <p className="text-xs text-muted-foreground">
                From localization key <code className="font-mono">{religion.id}</code> — edit it in
                the mod&apos;s localization files.
              </p>
            </div>
            <div className="space-y-1.5">
              {fieldLabel('Family')}
              <ReferenceInput
                value={draft.family}
                onChange={(v) => set({ family: v })}
                options={data.families}
                placeholder="none"
                disabled={!editable}
              />
            </div>
            {textField('Graphical faith', draft.graphicalFaith, (v) =>
              set({ graphicalFaith: v })
            )}
            {textField('Piety icon group', draft.pietyIconGroup, (v) =>
              set({ pietyIconGroup: v })
            )}
          </FormSection>
        )}

        {draft && religion && (
          <FormSection title="Doctrines & tenets">
            <DoctrineEditor
              groups={data.groups}
              doctrines={draft.doctrines}
              ungrouped={data.ungroupedDoctrines}
              disabled={!editable}
              onChange={(doctrines) => set({ doctrines })}
              locate={locateDoctrine}
            />
          </FormSection>
        )}

        <FormSection
          title={<>Faiths · {faiths.length}</>}
          legendClassName="flex-nowrap"
          action={
            (editable || data.format === '1.20') && (
              <Button
                variant="outline"
                size="xs"
                title="Create a new faith in this religion"
                onClick={onAddFaith}
              >
                <Plus />
                Add
              </Button>
            )
          }
        >
          {faiths.length === 0 ? (
            <p className="text-sm text-muted-foreground">This religion defines no faiths.</p>
          ) : (
            <div>
              {faiths.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
                  title={`Open ${f.id} in the Faith Editor`}
                  onClick={() => onOpenFaith(f.id)}
                >
                  <Swatch hex={f.color?.hex ?? null} className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {f.localizedName ?? (
                      <span className="font-mono text-muted-foreground">{f.id}</span>
                    )}
                  </span>
                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    {adherentsOfFaith(data, f.id).length}
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </FormSection>

        <FormSection title={<>Adherents · {adherents.length}</>}>
          {adherents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No character in this mod&apos;s history professes any of its faiths.
            </p>
          ) : (
            <div>
              {adherents.map((a) => (
                <button
                  key={`${a.file}:${a.id}`}
                  type="button"
                  className="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
                  title={`${a.id} — ${a.file}`}
                  onClick={() => onOpenCharacter(a.id, a.file)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {a.name ?? <span className="font-mono text-muted-foreground">{a.id}</span>}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {a.faith}
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}
        </FormSection>

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
