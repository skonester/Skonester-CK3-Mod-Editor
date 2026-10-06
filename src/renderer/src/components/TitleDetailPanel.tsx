import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Plus, X } from 'lucide-react'
import type { RefEntry, SaveResult, TitleData, TitleDetail, TitleFlagKey } from '@shared/types'
import { TITLE_FLAG_KEYS } from '@shared/types'
import { SAVE_HOTKEY_LABEL, useFormHotkeys } from '../hooks/useFormHotkeys'
import { usePersistedDraft } from '../hooks/usePersistedDraft'
import { FieldLabel } from './CharacterForm'
import CoatOfArms from './CoatOfArms'
import FormSection from './FormSection'
import Hint from './Hint'
import ReferenceBadge from './ReferenceBadge'
import ReferenceDisplay from './ReferenceDisplay'
import ReferenceInput, { openReferenceTarget } from './ReferenceInput'
import StaleDraftAlert from './StaleDraftAlert'
import { Swatch } from './Swatch'
import EntityReferencesSection from './EntityReferencesSection'
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
import { cn } from '@/lib/utils'
import { TIER_LABEL, findTitle, titleName } from '@/lib/titleView'
import type { TitleCulturalName, TitleFlags } from '@shared/types'

/** Flags whose game default is yes; every other flag defaults to no. */
const DEFAULT_YES = new Set<TitleFlagKey>([
  'ruler_uses_title_name',
  'can_be_named_after_dynasty',
  'allow_domicile'
])

/** Sentinel Select value for "key absent" (Radix Select can't hold ''). */
const UNSET = '__unset__'

const flagLabel = (key: TitleFlagKey): string => key.replaceAll('_', ' ')

/** The editable fields of a title. */
interface TitleDraft {
  color: string | null
  capital: string | null
  province: string | null
  flags: TitleFlags
  culturalNames: TitleCulturalName[]
}

interface Props {
  id: string
  data: TitleData
  /** Full parse of the selected title; null while loading or when not found */
  detail: TitleDetail | null
  modPath: string
  gameDir: string | null
  replacePaths: string[]
  onOpenTitle: (id: string) => void
  /** Open the create panel with this title as the parent */
  onAddChild: (parentId: string) => void
  onSaved: () => void
  onClose: () => void
}

export default function TitleDetailPanel({
  id,
  data,
  detail,
  modPath,
  gameDir,
  replacePaths,
  onOpenTitle,
  onAddChild,
  onSaved,
  onClose
}: Props): React.JSX.Element {
  const summary = findTitle(data.titles, id)

  const original: TitleDraft | null = detail
    ? {
        color: detail.color?.hex ?? null,
        capital: detail.capital,
        province: detail.province,
        flags: detail.flags,
        culturalNames: detail.culturalNames
      }
    : null

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const editable = detail !== null && detail.inMod
  // Edits outlive the row: closing it, switching tools or restarting the app
  // all leave the draft where it was, listed above the tree as unsaved.
  const { draft, setDraft, dirty, stale, revert, markSaved } = usePersistedDraft<TitleDraft>({
    tool: 'titles',
    ref: detail === null ? null : { id: detail.id, name: summary?.localizedName ?? null },
    original,
    editable
  })

  useEffect(() => {
    setError(null)
  }, [id, detail])

  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setSavedFlash(false)
    body.current?.scrollTo({ top: 0 })
  }, [id])


  const set = (patch: Partial<TitleDraft>): void => {
    if (!draft) return
    setDraft({ ...draft, ...patch })
    setSavedFlash(false)
  }

  const save = async (): Promise<void> => {
    if (!detail || !draft) return
    setSaving(true)
    setError(null)
    try {
      // The Add button starts a row blank; an unfilled one is not an error
      const saved: TitleDraft = {
        ...draft,
        culturalNames: draft.culturalNames.filter(
          (n) => n.key.trim() !== '' && n.value.trim() !== ''
        )
      }
      const result: SaveResult = await window.ck3tools.saveTitle(
        modPath,
        detail.file,
        detail.id,
        saved
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      markSaved(saved)
      setSavedFlash(true)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  useFormHotkeys({ onSave: save, canSave: editable && dirty && !saving, onClose })

  const countyOptions: RefEntry[] = useMemo(
    () =>
      data.titles
        .filter((t) => t.tier === 'county')
        .map((t) => ({ id: t.id, name: t.localizedName })),
    [data.titles]
  )

  const nameOf = (titleId: string): string | null =>
    findTitle(data.titles, titleId)?.localizedName ?? null

  const colorField = (): React.JSX.Element => {
    const current = detail!.color
    return (
      <div className="space-y-1.5">
        <FieldLabel>Map color</FieldLabel>
        {current !== null && !current.editable ? (
          <div className="flex items-center gap-2">
            <Swatch hex={current.hex} className="size-7" />
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {current.raw}
            </code>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              type="color"
              aria-label="Title color"
              className="h-7 w-12 shrink-0 cursor-pointer p-0.5"
              value={draft?.color ?? '#000000'}
              disabled={!editable || current === null}
              onChange={(e) => set({ color: e.target.value })}
            />
            <Input
              type="text"
              className="font-mono"
              placeholder={current === null ? 'no color line' : '#rrggbb'}
              value={draft?.color ?? ''}
              disabled={!editable || current === null}
              onChange={(e) => {
                const v = e.target.value.trim()
                if (/^#[0-9a-fA-F]{6}$/.test(v)) set({ color: v.toLowerCase() })
              }}
            />
          </div>
        )}
        {current === null && (
          <p className="text-xs text-muted-foreground">
            This title has no <code className="font-mono">color</code> line; add one in the file to
            edit it here.
          </p>
        )}
      </div>
    )
  }

  const flagField = (key: TitleFlagKey): React.JSX.Element => {
    const value = draft?.flags[key] ?? null
    // Exact-match: a raw `YES` needs its own item or the Select renders blank
    const known = value === null || value === 'yes' || value === 'no'
    return (
      <div key={key} className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm" title={key}>
          {flagLabel(key)}
        </span>
        <Select
          value={value ?? UNSET}
          disabled={!editable}
          onValueChange={(v) =>
            set({ flags: { ...draft!.flags, [key]: v === UNSET ? null : v } })
          }
        >
          <SelectTrigger size="sm" className="w-28 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>
              <span className="text-muted-foreground">
                — ({DEFAULT_YES.has(key) ? 'yes' : 'no'})
              </span>
            </SelectItem>
            <SelectItem value="yes">yes</SelectItem>
            <SelectItem value="no">no</SelectItem>
            {/* A raw spelling other than yes/no stays selectable so it isn't lost */}
            {!known && <SelectItem value={value}>{value}</SelectItem>}
          </SelectContent>
        </Select>
      </div>
    )
  }

  const culturalNamesSection = (): React.JSX.Element => {
    const names = draft?.culturalNames ?? []
    return (
      <FormSection
        title={<>Cultural names · {names.length}</>}
        action={
          editable && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => set({ culturalNames: [...names, { key: '', value: '' }] })}
            >
              <Plus />
              Add
            </Button>
          )
        }
      >
        {names.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No per-culture names — every culture sees the localized name.
          </p>
        )}
        {names.map((n, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              type="text"
              className="font-mono"
              placeholder="name_list_…"
              value={n.key}
              disabled={!editable}
              onChange={(e) =>
                set({
                  culturalNames: names.map((x, j) => (j === i ? { ...x, key: e.target.value } : x))
                })
              }
            />
            <Input
              type="text"
              className="font-mono"
              placeholder="cn_… (localization key)"
              value={n.value}
              disabled={!editable}
              onChange={(e) =>
                set({
                  culturalNames: names.map((x, j) =>
                    j === i ? { ...x, value: e.target.value } : x
                  )
                })
              }
            />
            {editable && (
              <Button
                variant="ghost"
                size="icon-sm"
                title="Remove"
                onClick={() => set({ culturalNames: names.filter((_, j) => j !== i) })}
              >
                <X />
              </Button>
            )}
          </div>
        ))}
        {names.length > 0 && (
          <Hint value="Keys are name-list (or culture) ids; values are localization keys. Comments inside the block are lost when the list is edited." />
        )}
      </FormSection>
    )
  }

  return (
    <Card className="flex h-full min-h-0 w-full min-w-0 flex-col gap-0 py-0">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold text-foreground">
          <Swatch hex={draft?.color ?? summary?.color ?? null} className="size-4 shrink-0" />
          <span className="truncate">{summary ? titleName(summary) : id}</span>
          {dirty && (
            <span className="size-2 shrink-0 rounded-full bg-primary" title="Unsaved changes" />
          )}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {summary && <Badge variant="secondary">{TIER_LABEL[summary.tier].toLowerCase()}</Badge>}
          <Button
            variant="ghost"
            size="icon-sm"
            title="Open definition in text editor"
            onClick={() =>
              void openReferenceTarget(
                () => window.ck3tools.locateRef(gameDir, modPath, replacePaths, 'title', id),
                id
              )
            }
          >
            <ExternalLink />
          </Button>
        </div>
      </div>

      <div ref={body} className="min-h-0 flex-1 space-y-8 overflow-y-auto p-4">
        {stale && <StaleDraftAlert what="title" />}
        {detail === null && summary !== null && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {detail !== null && !detail.inMod && (
          <Alert>
            <AlertDescription>
              Defined in the base game (<code className="font-mono">{detail.file}</code>). Editing
              game files isn&apos;t supported — copy the definition into the mod to change it.
            </AlertDescription>
          </Alert>
        )}

        {detail && draft && (
          <FormSection title="Details">
            <div className="flex items-start gap-4">
              <CoatOfArms ids={[detail.id]} size={72} />
              <div className="min-w-0 flex-1 space-y-3.5">
                <div className="space-y-1.5">
                  <FieldLabel>ID</FieldLabel>
                  <Input type="text" value={detail.id} disabled readOnly className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <FieldLabel>Name</FieldLabel>
                  <Input
                    type="text"
                    value={summary?.localizedName ?? ''}
                    placeholder="not localized"
                    disabled
                    readOnly
                  />
                  {detail.flags.noble_family?.trim().toLowerCase() === 'yes' ? (
                    <p className="text-xs text-muted-foreground">
                      A noble-family title is named in game after the holding house — shown here
                      from the last holder in the title&apos;s history (a{' '}
                      <code className="font-mono">{detail.id}</code> localization key would
                      override it).
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      From localization key <code className="font-mono">{detail.id}</code> — edit
                      it in the mod&apos;s localization files.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {colorField()}

            <div className="space-y-1.5">
              <FieldLabel>Capital county</FieldLabel>
              <ReferenceInput
                value={draft.capital}
                onChange={(v) => set({ capital: v })}
                options={countyOptions}
                placeholder="none"
                disabled={!editable}
                onNavigate={onOpenTitle}
                followTitle="Go to this county"
              />
              {draft.capital !== null && findTitle(data.titles, draft.capital) === null && (
                <p className="text-xs text-destructive">
                  No title with this id exists — the game will ignore it.
                </p>
              )}
            </div>

            {(detail.tier === 'barony' || detail.province !== null) && (
              <div className="space-y-1.5">
                <FieldLabel>Province</FieldLabel>
                <Input
                  type="text"
                  inputMode="numeric"
                  className="font-mono"
                  placeholder="map province id"
                  value={draft.province ?? ''}
                  disabled={!editable}
                  onChange={(e) =>
                    set({ province: e.target.value.trim() === '' ? null : e.target.value.trim() })
                  }
                />
                <Hint value="The map province this barony occupies (baronies only)." />
              </div>
            )}
          </FormSection>
        )}

        {detail && (
          <FormSection
            title={<>De jure · {detail.children.length} direct</>}
            action={
              editable && (
                <Button variant="outline" size="xs" onClick={() => onAddChild(detail.id)}>
                  <Plus />
                  Add child title
                </Button>
              )
            }
          >
            <div className="space-y-1.5">
              <FieldLabel>Liege chain</FieldLabel>
              {detail.dejurePath.length === 0 ? (
                <p className="text-sm text-muted-foreground">Top-level title — no de jure liege.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-1 text-sm">
                  {detail.dejurePath.map((ancestor, i) => (
                    <span key={ancestor} className="flex items-center gap-1">
                      {i > 0 && <span className="text-muted-foreground">›</span>}
                      <ReferenceDisplay
                        value={ancestor}
                        name={nameOf(ancestor)}
                        onNavigate={onOpenTitle}
                      />
                    </span>
                  ))}
                </div>
              )}
              <Hint value="De jure position comes from the block's nesting; moving a title means moving its block in a text editor." />
            </div>
            <div className="space-y-1.5">
              <FieldLabel>De jure children</FieldLabel>
              <div className="flex min-h-6 flex-wrap gap-1.5">
                {detail.children.map((child) => (
                  <ReferenceBadge
                    key={child}
                    entry={{ id: child, name: nameOf(child) }}
                    leading={
                      <CoatOfArms
                        ids={[child]}
                        size={36}
                        className="rounded-none border-0 shadow-none"
                      />
                    }
                    onNavigate={() => onOpenTitle(child)}
                  />
                ))}
                {detail.children.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    none — a childless title is titular
                  </span>
                )}
              </div>
            </div>
          </FormSection>
        )}

        {detail && draft && (
          <FormSection title="Flags">
            <div className="space-y-2">{TITLE_FLAG_KEYS.map(flagField)}</div>
            <Hint value="— leaves the key out of the file; the game then uses the default shown in parentheses." />
          </FormSection>
        )}

        {detail && culturalNamesSection()}

        {detail && detail.scriptBlocks.length > 0 && (
          <FormSection title="Scripted blocks">
            <div className="flex flex-wrap gap-1.5">
              {detail.scriptBlocks.map((key) => (
                <Badge key={key} variant="outline" className="font-mono">
                  {key}
                </Badge>
              ))}
            </div>
            <Hint value="Trigger and script blocks are preserved untouched — edit them in a text editor." />
          </FormSection>
        )}

        <EntityReferencesSection type="landed_titles" id={id} />

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
