import type { GraphicsSettings } from '@shared/types'
import { GRAPHICS_PRESETS, resolveGraphics } from '@crusaderpope/renderer/src/graphics'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

type Preset = NonNullable<GraphicsSettings['preset']>

const PRESETS: { value: Preset; label: string; title: string }[] = [
  {
    value: 'low',
    label: 'Low',
    title: 'Weaker graphics cards: no supersampling, edge smoothing, shadows or map objects'
  },
  { value: 'medium', label: 'Medium', title: 'Full resolution and edge smoothing, no shadows' },
  { value: 'high', label: 'High', title: 'Supersampled, with shadows and every map object' }
]
const SCALES = [0.5, 0.75, 1, 1.5, 2]
const ANISOTROPY = [1, 2, 4, 8, 16]

/**
 * The 3D views' quality (CrusaderPope's graphics settings): a preset, each
 * value overridable. A change applies to views opened afterwards.
 */
export default function GraphicsSettingsCard({
  value,
  onChange
}: {
  value: GraphicsSettings | undefined
  onChange: (next: GraphicsSettings) => void
}): React.JSX.Element {
  const preset: Preset = value?.preset ?? 'high'
  const resolved = resolveGraphics(value)
  const base = GRAPHICS_PRESETS[preset]
  /** Sets one value; the preset's own value drops the override */
  const set = <K extends keyof typeof base>(key: K, v: (typeof base)[K]): void => {
    const next: GraphicsSettings = { ...value, preset }
    if (v === base[key]) delete next[key]
    else next[key] = v
    onChange(next)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>3D graphics</CardTitle>
        <CardDescription>
          Quality of the portraits, the model viewer and the map. Applies to views opened after the
          change.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Preset</FieldLabel>
            <FieldDescription>Low for weaker graphics cards.</FieldDescription>
          </FieldContent>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={preset}
            onValueChange={(p) => p && onChange({ preset: p as Preset })}
          >
            {PRESETS.map((p) => (
              <ToggleGroupItem key={p.value} value={p.value} title={p.title}>
                {p.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Render scale</FieldLabel>
            <FieldDescription>
              × the display&apos;s resolution; above 1 supersamples the viewers.
            </FieldDescription>
          </FieldContent>
          <Select
            value={String(resolved.renderScale)}
            onValueChange={(v) => set('renderScale', Number(v))}
          >
            <SelectTrigger size="sm" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCALES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel>Texture filtering</FieldLabel>
            <FieldDescription>
              Anisotropic filtering, sharper textures at an angle.
            </FieldDescription>
          </FieldContent>
          <Select
            value={String(resolved.anisotropy)}
            onValueChange={(v) => set('anisotropy', Number(v))}
          >
            <SelectTrigger size="sm" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANISOTROPY.map((a) => (
                <SelectItem key={a} value={String(a)}>
                  {a}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {(
          [
            ['antialias', 'Edge smoothing', 'MSAA in every 3D view.'],
            ['shadows', 'Shadows', 'In the portrait and model viewers.'],
            ['mapObjects', 'Map objects', 'Trees, cliffs, bridges and cities on the 3D map.']
          ] as const
        ).map(([key, label, description]) => (
          <Field key={key} orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`gfx-${key}`}>{label}</FieldLabel>
              <FieldDescription>{description}</FieldDescription>
            </FieldContent>
            <Switch
              id={`gfx-${key}`}
              checked={resolved[key]}
              onCheckedChange={(v) => set(key, v)}
            />
          </Field>
        ))}
      </CardContent>
    </Card>
  )
}
