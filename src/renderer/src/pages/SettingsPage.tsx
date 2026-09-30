import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { useApp } from '../AppContext'
import Hint from '../components/Hint'
import ModPicker from '../components/ModPicker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { DirValidation, EditorInfo, ModFonts } from '@shared/types'

function PathRow({
  label,
  value,
  validation,
  onBrowse
}: {
  label: string
  value: string | null
  validation: DirValidation | null
  onBrowse: () => void
}): React.JSX.Element {
  const invalid = validation !== null && !validation.valid
  return (
    <div className="space-y-1.5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex gap-2">
        <div
          className={cn(
            'flex min-w-0 flex-1 select-text items-center gap-2 overflow-hidden rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs whitespace-nowrap',
            invalid && 'border-destructive'
          )}
        >
          <span className="truncate">
            {value ?? <em className="text-muted-foreground">not set</em>}
          </span>
          {validation?.valid && <Check className="ml-auto size-3.5 shrink-0 text-green-600 dark:text-green-500" />}
        </div>
        <Button variant="outline" onClick={onBrowse}>
          Browse…
        </Button>
      </div>
      {invalid && <p className="text-xs text-destructive">{validation.reason}</p>}
    </div>
  )
}

/** One line saying which fonts the app landed on, and why. */
function fontStatus(enabled: boolean, modName: string | null, fonts: ModFonts | null): string {
  if (!enabled) return 'Off — the app uses its own font.'
  if (!modName) return 'Select a mod to use its fonts.'
  if (!fonts) return `${modName} loads no fonts of its own.`
  const used: string[] = []
  if (fonts.standard) used.push(`text in ${fonts.standard.name}`)
  if (fonts.title) used.push(`headings in ${fonts.title.name}`)
  return `Using ${used.join(', ')}.`
}

export default function SettingsPage(): React.JSX.Element {
  const { settings, selectedMod, modFonts, updateSettings } = useApp()
  const [gameValidation, setGameValidation] = useState<DirValidation | null>(null)
  const [modValidation, setModValidation] = useState<DirValidation | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [editors, setEditors] = useState<EditorInfo[]>([])

  useEffect(() => {
    window.ck3tools.detectEditors().then(setEditors)
  }, [])

  useEffect(() => {
    if (settings?.gameDir) {
      window.ck3tools.validateGameDir(settings.gameDir).then(setGameValidation)
    } else {
      setGameValidation(null)
    }
  }, [settings?.gameDir])

  useEffect(() => {
    if (settings?.modDir) {
      window.ck3tools.validateModDir(settings.modDir).then(setModValidation)
    } else {
      setModValidation(null)
    }
  }, [settings?.modDir])

  if (!settings) return <></>

  const browseGame = async (): Promise<void> => {
    const dir = await window.ck3tools.pickDirectory('Select the CK3 game directory', 'game')
    if (dir) await updateSettings({ gameDir: dir })
  }

  const browseMod = async (): Promise<void> => {
    const dir = await window.ck3tools.pickDirectory('Select your CK3 mod directory', 'mod')
    if (dir) await updateSettings({ modDir: dir })
  }

  const browseEditor = async (): Promise<void> => {
    const path = await window.ck3tools.pickEditor()
    if (path) await updateSettings({ textEditorPath: path })
  }

  const fonts = fontStatus(settings.useModFonts, selectedMod?.name ?? null, modFonts)

  // Notepad is the built-in default, so picking it stores null
  const editorIsActive = (ed: EditorInfo): boolean =>
    ed.name === 'Notepad'
      ? settings.textEditorPath === null || settings.textEditorPath === ed.path
      : settings.textEditorPath === ed.path

  const redetect = async (): Promise<void> => {
    setDetecting(true)
    try {
      const detected = await window.ck3tools.detectPaths()
      await updateSettings({
        gameDir: detected.gameDir ?? settings.gameDir,
        modDir: detected.modDir ?? settings.modDir
      })
    } finally {
      setDetecting(false)
    }
  }

  return (
    <div className="max-w-4xl space-y-5 p-7">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Button variant="outline" onClick={redetect} disabled={detecting}>
          {detecting ? 'Detecting…' : 'Auto-detect paths'}
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Directories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PathRow
            label="CK3 game directory"
            value={settings.gameDir}
            validation={gameValidation}
            onBrowse={browseGame}
          />
          <PathRow
            label="Mod directory"
            value={settings.modDir}
            validation={modValidation}
            onBrowse={browseMod}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Text editor</CardTitle>
          <CardDescription>
            Used to open mod and game files that aren&apos;t managed by Skonester CK3 Mod Editor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md border bg-background px-2.5 py-1.5 font-mono text-xs whitespace-nowrap select-text">
              <span className="truncate">
                {settings.textEditorPath ?? (
                  <em className="text-muted-foreground">Notepad (default)</em>
                )}
              </span>
            </div>
            <Button variant="outline" onClick={browseEditor}>
              Browse…
            </Button>
          </div>
          {editors.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Detected:</span>
              {editors.map((ed) => (
                <Button
                  key={ed.path}
                  variant="outline"
                  size="sm"
                  className={cn(editorIsActive(ed) && 'border-primary/50 bg-muted')}
                  title={ed.path}
                  onClick={() =>
                    updateSettings({ textEditorPath: ed.name === 'Notepad' ? null : ed.path })
                  }
                >
                  {editorIsActive(ed) && <Check className="text-green-600 dark:text-green-500" />}
                  {ed.name}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="use-mod-fonts">Use mod fonts</FieldLabel>
              <FieldDescription>
                Show the app in the fonts the selected mod loads — its StandardGameFont for
                text, its TitleFont for headings.
              </FieldDescription>
              <Hint value={fonts} />
            </FieldContent>
            <Switch
              id="use-mod-fonts"
              checked={settings.useModFonts}
              onCheckedChange={(useModFonts) => updateSettings({ useModFonts })}
            />
          </Field>
        </CardContent>
      </Card>

      <ModPicker />
    </div>
  )
}
