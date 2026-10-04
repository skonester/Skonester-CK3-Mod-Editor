import { useState } from 'react'
import type { ReligionData, RitePatch } from '@shared/types'
import { usePersistedDraft } from '../hooks/usePersistedDraft'
import { SAVE_HOTKEY_LABEL, useFormHotkeys } from '../hooks/useFormHotkeys'
import { useFaithIcons } from '../useGameIcons'
import DoctrineEditor from './DoctrineEditor'
import TenetEditor from './TenetEditor'
import { RiteOptionsForm } from './ReligionOptionsForm'
import { migrateDefinitionDraft } from '@/lib/definitionDraft'
import FormSection from './FormSection'
import ReferenceInput, { openReferenceTarget } from './ReferenceInput'
import ReferenceDisplay from './ReferenceDisplay'
import StaleDraftAlert from './StaleDraftAlert'
import { IconTile, Swatch } from './Swatch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normId, setGroupPicks } from '@/lib/faithView'

export default function RitePanel({
  id,
  prefillFaith,
  data,
  files,
  iconNames,
  modPath,
  gameDir,
  replacePaths,
  onSaved,
  onClose,
  onOpenFaith,
  onOpenCharacter
}: {
  id: string | null
  prefillFaith: string | null
  data: ReligionData
  files: string[]
  iconNames: string[]
  modPath: string
  gameDir: string | null
  replacePaths: string[]
  onSaved: (id: string) => void
  onClose: () => void
  onOpenFaith: (id: string) => void
  onOpenCharacter: (id: string, file: string) => void
}): React.JSX.Element {
  const creating = id === null
  const rite = (data.rites ?? []).find((r) => normId(r.id) === normId(id ?? '')) ?? null
  const original: RitePatch | null = rite
    ? {
        faith: rite.faith,
        color: rite.color?.hex ?? null,
        icon: rite.icon,
        founder: rite.founder,
        create: rite.create,
        convert: rite.convert,
        doctrines: rite.doctrines,
        tenets: rite.tenets,
        options: rite.options ?? {}
      }
    : null
  const persisted = usePersistedDraft<RitePatch>({
    tool: 'rites',
    ref: rite ? { id: rite.id, name: rite.localizedName } : null,
    original,
    editable: rite?.inMod ?? false,
    migrate: migrateDefinitionDraft
  })
  const [newDraft, setNewDraft] = useState<RitePatch>({
    faith: prefillFaith,
    color: '#808080',
    icon: null,
    founder: null,
    create: null,
    convert: null,
    doctrines: [],
    tenets: []
  })
  const [newId, setNewId] = useState('')
  const [file, setFile] = useState('00_my_rites.txt')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const draft = creating ? newDraft : persisted.draft
  const editable = creating || (rite?.inMod ?? false)
  const set = (patch: Partial<RitePatch>): void => {
    if (!draft || !editable) return
    const next = { ...draft, ...patch }
    if (creating) setNewDraft(next)
    else persisted.setDraft(next)
    setError(null)
  }
  const validId = /^[A-Za-z0-9_.\-']+$/.test(newId.trim())
  const clash = (data.rites ?? []).some((r) => r.inMod && normId(r.id) === normId(newId))
  const shadowsGame = (data.rites ?? []).some((r) => !r.inMod && normId(r.id) === normId(newId))
  const validFile = !!file.trim() && /^[^\\/]+\.txt$/i.test(file.trim())
  const validFlags =
    draft && [draft.create, draft.convert].every((v) => v === null || v === 'yes' || v === 'no')
  const canSave =
    editable &&
    !saving &&
    !!validFlags &&
    (creating ? validId && validFile && !clash : persisted.dirty)
  const save = async (): Promise<void> => {
    if (!draft || !canSave) return
    setSaving(true)
    setError(null)
    try {
      const result = creating
        ? await window.ck3tools.createRite(modPath, file.trim(), { id: newId.trim(), ...draft })
        : await window.ck3tools.saveRite(modPath, rite!.file, rite!.id, draft)
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (!creating) persisted.markSaved(draft)
      onSaved(creating ? newId.trim() : rite!.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }
  useFormHotkeys({ onSave: save, canSave: !!canSave, onClose })
  const faith = data.faiths.find((f) => normId(f.id) === normId(draft?.faith ?? ''))
  const religion = data.religions.find((r) => normId(r.id) === normId(faith?.religion ?? ''))
  // Religion groups take precedence over the faith's additive doctrines;
  // this rite's own choices can override either inherited source.
  let inherited = [...(faith?.doctrines ?? [])]
  for (const group of data.groups) {
    const picks = group.doctrines
      .filter((d) => religion?.doctrines.some((r) => normId(r) === normId(d.id)))
      .map((d) => d.id)
    if (picks.length) inherited = setGroupPicks(inherited, group, picks)
  }
  const iconFor = useFaithIcons({ gameDir, modPath, replacePaths }, draft?.icon ? [draft.icon] : [])
  const textField = (label: string, key: 'founder'): React.JSX.Element => (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <ReferenceInput
        value={draft?.[key] ?? null}
        onChange={(v) => set({ [key]: v })}
        options={[]}
        placeholder="none"
        disabled={!editable}
        locate={(value) =>
          window.ck3tools.locateRef(gameDir, modPath, replacePaths, 'title', value)
        }
      />
    </div>
  )
  const adherents = data.adherents.filter((a) => a.rite && normId(a.rite) === normId(id ?? ''))
  const implicitFaith =
    !creating && !rite
      ? data.faiths.find(
          (f) =>
            f.format === '1.20' &&
            normId(f.id) === normId(id ?? '') &&
            !(data.rites ?? []).some((r) => r.faith && normId(r.faith) === normId(f.id))
        )
      : null

  return (
    <Card className="flex h-full min-h-0 flex-col gap-0 py-0">
      <div className="flex items-center justify-between gap-2 border-b p-4">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
          <Swatch hex={draft?.color ?? null} />
          <span className="truncate">{creating ? 'New rite' : (rite?.localizedName ?? id)}</span>
          {persisted.dirty && <Badge variant="outline">Unsaved</Badge>}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {persisted.stale && <StaleDraftAlert what="rite" />}
        {!creating && !rite && (
          <Alert>
            <AlertDescription>
              {implicitFaith ? (
                <>
                  This rite is generated from its faith. Edit its seed settings in the Faith Editor.
                  <ReferenceDisplay
                    value={implicitFaith.id}
                    name={implicitFaith.localizedName}
                    onNavigate={onOpenFaith}
                  />
                </>
              ) : (
                <>No scripted rite definition found for {id}.</>
              )}
            </AlertDescription>
          </Alert>
        )}
        {rite && !rite.inMod && (
          <Alert>
            <AlertDescription>
              Defined in the base game ({rite.file}). Copy its definition into the mod to edit it.
            </AlertDescription>
          </Alert>
        )}
        {draft && (
          <>
            <FormSection title="Details">
              {creating ? (
                <>
                  <div className="space-y-1.5">
                    <Label>ID</Label>
                    <Input
                      value={newId}
                      className="font-mono"
                      placeholder="my_rite"
                      onChange={(e) => setNewId(e.target.value)}
                      aria-invalid={clash || (!!newId && !validId) || undefined}
                    />
                    {clash && (
                      <p className="text-xs text-destructive">
                        This rite already exists in the mod.
                      </p>
                    )}
                    {shadowsGame && !clash && (
                      <p className="text-xs text-muted-foreground">
                        This definition overrides a base-game rite.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>File</Label>
                    <ReferenceInput
                      value={file}
                      onChange={(v) => setFile(v ?? '')}
                      options={files.map((f) => ({ id: f, name: null }))}
                      placeholder="00_my_rites.txt"
                    />
                    <p className="text-xs text-muted-foreground">
                      Written under common/religion/rite_types.
                    </p>
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Label>ID</Label>
                  <Input value={rite!.id} readOnly disabled className="font-mono" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void openReferenceTarget(
                        () =>
                          window.ck3tools.locateRef(
                            gameDir,
                            modPath,
                            replacePaths,
                            'rite',
                            rite!.id
                          ),
                        rite!.id
                      )
                    }
                  >
                    Open definition
                  </Button>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Parent faith</Label>
                <ReferenceInput
                  value={draft.faith}
                  onChange={(faith) => set({ faith })}
                  options={data.faiths.map((f) => ({ id: f.id, name: f.localizedName }))}
                  placeholder="none (script-created only)"
                  disabled={!editable}
                  onNavigate={onOpenFaith}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Color</Label>
                <div className="flex items-center gap-2">
                  <Swatch hex={draft.color} />
                  <Input
                    value={draft.color ?? ''}
                    placeholder="#808080"
                    disabled={!editable || (!creating && !rite?.color?.editable)}
                    onChange={(e) => {
                      if (/^#[0-9a-fA-F]{6}$/.test(e.target.value))
                        set({ color: e.target.value.toLowerCase() })
                    }}
                  />
                </div>
                {rite?.color && !rite.color.editable && (
                  <p className="text-xs text-muted-foreground">
                    Color expression: {rite.color.raw}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Icon</Label>
                <div className="flex items-center gap-2">
                  <IconTile url={draft.icon ? iconFor(draft.icon) : null} size={36} />
                  <ReferenceInput
                    value={draft.icon}
                    onChange={(icon) => set({ icon })}
                    options={iconNames.map((icon) => ({ id: icon, name: null }))}
                    disabled={!editable}
                    placeholder="none"
                  />
                </div>
              </div>
              {textField('Founder title', 'founder')}
              {(['create', 'convert'] as const).map((key) => (
                <div key={key} className="space-y-1.5">
                  <Label>{key === 'create' ? 'Create from history' : 'Allow conversion'}</Label>
                  <ReferenceInput
                    value={draft[key]}
                    onChange={(value) => set({ [key]: value })}
                    disabled={!editable}
                    placeholder="default (yes)"
                    options={[
                      { id: 'yes', name: 'Yes' },
                      { id: 'no', name: 'No' }
                    ]}
                  />
                </div>
              ))}
            </FormSection>
            <RiteOptionsForm
              values={draft.options ?? {}}
              onChange={(options) => set({ options })}
              disabled={!editable}
              dynamicName={rite?.dynamicName}
              dynamicDescription={rite?.dynamicDescription}
              data={data}
              gameDir={gameDir}
              modPath={modPath}
              replacePaths={replacePaths}
            />
            <FormSection title="Core tenets">
              <TenetEditor
                values={draft.tenets}
                options={data.tenets ?? []}
                disabled={!editable}
                onChange={(tenets) => set({ tenets })}
                gameDir={gameDir}
                modPath={modPath}
                replacePaths={replacePaths}
              />
              <p className="text-xs text-muted-foreground">
                Conditional tenet selections and dynamic names remain in the definition file. Dated
                overrides can be edited through the parent faith&apos;s history.
              </p>
            </FormSection>
            <FormSection title="Doctrines">
              <DoctrineEditor
                groups={data.groups}
                doctrines={draft.doctrines}
                ungrouped={data.ungroupedDoctrines}
                inheritedFrom={
                  faith
                    ? { label: faith.localizedName ?? faith.id, doctrines: inherited }
                    : undefined
                }
                disabled={!editable}
                onChange={(doctrines) => set({ doctrines })}
                locate={(doctrine) =>
                  window.ck3tools.locateRef(gameDir, modPath, replacePaths, 'doctrine', doctrine)
                }
              />
            </FormSection>
          </>
        )}
        {!creating && (
          <FormSection title={`Adherents · ${adherents.length}`}>
            {adherents.map((a) => (
              <Button
                key={`${a.file}:${a.id}`}
                variant="ghost"
                className="w-full justify-start"
                onClick={() => onOpenCharacter(a.id, a.file)}
              >
                {a.name ?? a.id}
              </Button>
            ))}
            {!adherents.length && (
              <p className="text-sm text-muted-foreground">
                No character in this mod explicitly sets this rite.
              </p>
            )}
          </FormSection>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
      {editable && (
        <div className="flex justify-end gap-2 border-t p-4">
          {!creating && (
            <Button
              variant="outline"
              disabled={!persisted.dirty || saving}
              onClick={() => {
                persisted.revert()
                setError(null)
              }}
            >
              Revert
            </Button>
          )}
          <Button disabled={!canSave} title={SAVE_HOTKEY_LABEL} onClick={() => void save()}>
            {saving ? 'Saving…' : creating ? 'Create rite' : 'Save'}
          </Button>
        </div>
      )}
    </Card>
  )
}
