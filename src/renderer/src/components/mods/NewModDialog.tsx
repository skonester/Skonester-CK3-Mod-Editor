import { useState } from 'react'
import type { ModsState, NewModRequest } from '@shared/types'
import {
  descriptorTextProblem,
  folderFromName,
  modFolderProblem,
  supportedVersionFor,
  versionMatches
} from '@crusaderpope/shared/modRules'
import { errorText } from './modParts'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Toggle } from '@/components/ui/toggle'

/** Tags the launcher and the Workshop offer for CK3 mods */
const STANDARD_TAGS = [
  'Alternative History',
  'Balance',
  'Bookmarks',
  'Character Focuses',
  'Character Interactions',
  'Culture',
  'Decisions',
  'Events',
  'Fixes',
  'Gameplay',
  'Graphics',
  'Historical',
  'Map',
  'Portraits',
  'Religion',
  'Schemes',
  'Sound',
  'Total Conversion',
  'Translation',
  'Utilities',
  'Warfare'
]

/** Where a new mod goes: '' = no list, 'new' = a new list named after it, else a custom list's ref */
export type NewModTarget = string

const NO_LIST = '__none'

/**
 * A new local mod (CrusaderPope's NewModDialog): its folder with
 * descriptor.mod and the outer .mod for the game and the launcher. It becomes
 * the selected mod.
 */
export default function NewModDialog({
  state,
  defaultTarget,
  onCreate,
  onClose
}: {
  state: ModsState
  defaultTarget: NewModTarget
  onCreate: (req: NewModRequest, target: NewModTarget) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const game = state.gameVersion
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [folderEdited, setFolderEdited] = useState(false)
  const [version, setVersion] = useState('1.0')
  const [supported, setSupported] = useState(supportedVersionFor(game))
  const [tags, setTags] = useState<string[]>([])
  const [otherTags, setOtherTags] = useState('')
  const [target, setTarget] = useState<NewModTarget>(defaultTarget)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const folderValue = folderEdited ? folder : folderFromName(name)
  const taken = state.mods.some(
    (m) => m.id.toLowerCase() === `mod/${folderValue}.mod`.toLowerCase()
  )
  const allTags = [...tags, ...otherTags.split(',').map((t) => t.trim())].filter(Boolean)
  const problem =
    (name.trim() ? undefined : 'Enter a name.') ??
    descriptorTextProblem('Name', name) ??
    modFolderProblem(folderValue) ??
    (taken ? `mod/${folderValue}.mod exists already.` : undefined) ??
    descriptorTextProblem('Version', version) ??
    (supported.trim() && !/^v?[0-9*]+(\.[0-9*]+){0,3}$/i.test(supported.trim())
      ? 'Supported version: numbers or * separated by dots, like 1.20.*'
      : undefined) ??
    allTags.map((t) => descriptorTextProblem('Tags', t)).find(Boolean)
  const customs = state.lists.filter((l) => l.kind === 'custom')
  const fits = versionMatches(supported, game)

  const create = async (): Promise<void> => {
    if (problem || busy) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(
        {
          name: name.trim(),
          folder: folderValue,
          version: version.trim(),
          supportedVersion: supported.trim(),
          tags: [...new Set(allTags)]
        },
        target
      )
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New mod</DialogTitle>
          <DialogDescription>
            It becomes the selected mod — the one the editors write into.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="new-mod-name">Name</FieldLabel>
            <Input
              id="new-mod-name"
              autoFocus
              value={name}
              placeholder="My Mod"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-mod-folder">Folder</FieldLabel>
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {state.userDir.replace(/[\\/]+$/, '')}\mod\
              </span>
              <Input
                id="new-mod-folder"
                value={folderValue}
                onChange={(e) => {
                  setFolder(e.target.value)
                  setFolderEdited(true)
                }}
              />
            </div>
            <FieldDescription>
              Creates the folder with its descriptor.mod, and mod\{folderValue || '…'}.mod for the
              game and the launcher.
            </FieldDescription>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="new-mod-version">Version</FieldLabel>
              <Input
                id="new-mod-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-mod-supported">Supported game version</FieldLabel>
              <Input
                id="new-mod-supported"
                value={supported}
                onChange={(e) => setSupported(e.target.value)}
              />
              <FieldDescription className={fits === false ? 'text-destructive' : undefined}>
                {game
                  ? `The installed game is ${game}${fits === false ? ' — this does not match it' : ''}.`
                  : 'Game version unknown.'}
              </FieldDescription>
            </Field>
          </div>
          <Field>
            <FieldLabel>Tags</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {STANDARD_TAGS.map((t) => (
                <Toggle
                  key={t}
                  size="sm"
                  variant="outline"
                  pressed={tags.includes(t)}
                  onPressedChange={(on) =>
                    setTags((v) => (on ? [...v, t] : v.filter((x) => x !== t)))
                  }
                >
                  {t}
                </Toggle>
              ))}
            </div>
            <Input
              value={otherTags}
              onChange={(e) => setOtherTags(e.target.value)}
              placeholder="Other tags, comma separated"
            />
          </Field>
          <Field>
            <FieldLabel>Add to a mod list</FieldLabel>
            <Select
              value={target || NO_LIST}
              onValueChange={(v) => setTarget(v === NO_LIST ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">
                  A new list “{name.trim() || 'the mod’s name'}” (the game plus this mod)
                </SelectItem>
                {customs.map((l) => (
                  <SelectItem key={l.ref} value={l.ref}>
                    {l.name}
                    {state.selected === l.ref ? ' (loaded in the game index)' : ''}
                  </SelectItem>
                ))}
                <SelectItem value={NO_LIST}>Don’t add it to a list</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              Launcher playsets can list it once the launcher has registered it.
            </FieldDescription>
          </Field>
          {(error || (problem && name.trim())) && (
            <p className="text-sm text-destructive">{error ?? problem}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!problem || busy} onClick={() => void create()}>
            {busy && <Spinner />}
            Create mod
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
