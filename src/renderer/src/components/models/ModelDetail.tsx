import { useEffect, useState } from 'react'
import { Download, ExternalLink, FolderOpen, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type {
  AssetFileInfo,
  MeshFileInfo,
  ModelImportPlan,
  ModelInfo,
  ModelTexture
} from '@crusaderpope/shared/api'
import { api } from '@crusaderpope/renderer/src/api'
import { GameImg } from '@crusaderpope/renderer/src/img'
import { digest, useGfxRevision } from '@crusaderpope/renderer/src/revision'
import { useApp } from '../../AppContext'
import FormSection from '../FormSection'
import Hint from '../Hint'
import ModelViewer from './ModelViewer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
const size = (b: number): string =>
  b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(b / 1024))} KB`
const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`
const fmt = (x: number): string => (Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(1))

/** Packed data maps look black as RGBA: properties keep roughness in alpha, normals read best without it */
const thumbChannel = (role: string): string | undefined =>
  role === 'diffuse' ? undefined : role === 'properties' ? 'a' : 'rgb'

function Textures({ textures }: { textures: ModelTexture[] }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {textures.map((t, i) => (
        <figure key={i} className="w-24" title={t.path ?? `Not found: ${t.ref}`}>
          <div className="flex size-24 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
            {t.path ? (
              <GameImg path={t.path} size={96} ch={thumbChannel(t.role)} className="size-full object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">missing</span>
            )}
          </div>
          <figcaption className="mt-1 truncate text-xs">
            <span className="text-muted-foreground">{t.role}</span> ·{' '}
            {base(t.path ?? t.ref).replace(/\.(dds|png|tga)$/i, '')}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

/**
 * The Blender round trip for a .mesh or an .asset's pdxmesh: export as glTF
 * with PNG textures, import an edited glTF/GLB back into the selected mod.
 */
function BlenderBar({ path, pdxmesh }: { path: string; pdxmesh?: string }): React.JSX.Element {
  const { selectedMod } = useApp()
  const [plan, setPlan] = useState<ModelImportPlan | null>(null)
  const [busy, setBusy] = useState<'' | 'export' | 'import'>('')

  useEffect(() => {
    let alive = true
    setPlan(null)
    api.importModelPlan(path, pdxmesh).then(
      (p) => alive && setPlan(p),
      (e: Error) => alive && setPlan({ problem: e.message })
    )
    return () => {
      alive = false
    }
  }, [path, pdxmesh, selectedMod?.file])

  const exportModel = async (): Promise<void> => {
    setBusy('export')
    try {
      const r = await api.exportModel(path, pdxmesh)
      if (!r) return
      const c = r.counts
      const counts = [
        plural(c.shapes, 'shape'),
        plural(c.triangles, 'triangle'),
        plural(c.materials, 'material'),
        plural(c.textures, 'texture'),
        ...(c.joints ? [plural(c.joints, 'joint')] : []),
        ...(c.blendShapes ? [`${plural(c.blendShapes, 'blend shape')} (shape keys)`] : [])
      ]
      toast.success('Exported for Blender', {
        description: `${counts.join(', ')} — ${plural(r.files.length, 'file')} written. In Blender: File › Import › glTF 2.0; export glTF again and bring it back with Import from Blender.${r.warnings.length ? `\n⚠ ${r.warnings.join('\n⚠ ')}` : ''}`,
        duration: 12000,
        action: { label: 'Reveal', onClick: () => void api.revealFile(r.gltf) }
      })
    } catch (e) {
      toast.error('Export failed', { description: (e as Error).message })
    } finally {
      setBusy('')
    }
  }

  const importModel = async (): Promise<void> => {
    setBusy('import')
    try {
      const r = await api.importModel(path, pdxmesh)
      if (!r) return
      toast.success(`Imported ${plural(r.files.length, 'file')} into ${r.mod.name}`, {
        description: [
          ...r.files.map((f) => `${f.rel} — ${f.what}`),
          ...r.notes,
          ...r.warnings.map((w) => `⚠ ${w}`)
        ].join('\n'),
        duration: 15000,
        action: r.files[0] ? { label: 'Reveal', onClick: () => void api.revealFile(r.files[0].abs) } : undefined
      })
    } catch (e) {
      toast.error('Nothing imported', { description: (e as Error).message })
    } finally {
      setBusy('')
    }
  }

  const importTitle = !plan
    ? 'Checking the selected mod…'
    : (plan.problem ??
      `Writes ${plan.mesh} and the textures you changed into ${plan.mod!.name} — a file of the same path in a mod replaces the game's`)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy !== ''}
        title="Writes the mesh as glTF 2.0 (.gltf + .bin), its textures as PNG and a manifest into a folder you choose — for Blender (File › Import › glTF 2.0)"
        onClick={() => void exportModel()}
      >
        {busy === 'export' ? <Spinner /> : <Download />}
        Export for Blender…
      </Button>
      <span title={importTitle}>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== '' || !plan || !!plan.problem}
          onClick={() => void importModel()}
        >
          {busy === 'import' ? <Spinner /> : <Upload />}
          Import from Blender…
        </Button>
      </span>
      {plan?.mod && !plan.problem && <span className="text-xs text-muted-foreground">into {plan.mod.name}</span>}
    </div>
  )
}

function AssetBody({
  info,
  onOpenModel
}: {
  info: AssetFileInfo
  onOpenModel: (path: string) => void
}): React.JSX.Element {
  const withFile = info.meshes.filter((m) => m.file)
  const [sel, setSel] = useState<string | undefined>(withFile[0]?.name)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setSel(withFile[0]?.name), [info.path])
  return (
    <>
      {sel ? (
        <>
          {withFile.length > 1 && (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              className="flex-wrap"
              value={sel}
              onValueChange={(v) => v && setSel(v)}
            >
              {withFile.map((m) => (
                <ToggleGroupItem key={m.name} value={m.name}>
                  {m.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <BlenderBar path={info.path} pdxmesh={sel} />
          <ModelViewer path={info.path} pdxmesh={sel} />
        </>
      ) : (
        <Hint value="No mesh is declared here — the entities below use meshes from other files." />
      )}
      {info.meshes.length > 0 && (
        <FormSection title={`Meshes · ${info.meshes.length}`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>pdxmesh</TableHead>
                <TableHead>Mesh file</TableHead>
                <TableHead>Shaders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {info.meshes.map((m) => (
                <TableRow key={m.name + m.line} data-state={m.name === sel ? 'selected' : undefined}>
                  <TableCell className="font-mono text-xs">{m.name}</TableCell>
                  <TableCell className="text-xs">
                    {m.file ? (
                      <Button variant="link" size="xs" className="h-auto p-0" onClick={() => onOpenModel(m.file!)}>
                        {base(m.file)}
                      </Button>
                    ) : (
                      <span className="text-destructive">{m.fileRef || '—'} (not found)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs whitespace-normal text-muted-foreground">
                    {[...new Set(m.settings.map((s) => s.shader).filter(Boolean))].join(', ')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FormSection>
      )}
      {info.entities.length > 0 && (
        <FormSection title={`Entities · ${info.entities.length}`}>
          <div className="flex flex-wrap gap-1.5">
            {info.entities.map((e) => (
              <Badge key={e.name + e.line} variant="outline" className="font-mono" title={e.pdxmesh}>
                {e.name}
              </Badge>
            ))}
          </div>
        </FormSection>
      )}
      {info.textures.length > 0 && (
        <FormSection title={`Textures · ${info.textures.length}`}>
          <Textures textures={info.textures} />
        </FormSection>
      )}
    </>
  )
}

function MeshBody({
  info,
  onOpenModel
}: {
  info: MeshFileInfo
  onOpenModel: (path: string) => void
}): React.JSX.Element {
  const textures = [
    ...new Map(info.shapes.flatMap((s) => s.textures).map((t) => [t.path ?? t.ref, t])).values()
  ]
  if (info.error) return <p className="text-sm text-destructive">Could not read this mesh: {info.error}</p>
  return (
    <>
      <BlenderBar path={info.path} />
      <ModelViewer path={info.path} />
      {(info.declaredIn.length > 0 || info.blendShapeOf.length > 0) && (
        <FormSection title="Declared in">
          <div className="flex flex-col gap-1 text-sm">
            {info.declaredIn.map((d, i) => (
              <span key={i}>
                <Button variant="link" size="xs" className="h-auto p-0" onClick={() => onOpenModel(d.asset)}>
                  {base(d.asset)}
                </Button>{' '}
                <span className="text-muted-foreground">pdxmesh</span>{' '}
                <span className="font-mono text-xs">{d.pdxmesh}</span>
              </span>
            ))}
            {info.blendShapeOf.map((d, i) => (
              <span key={`b${i}`}>
                <span className="text-muted-foreground">blend shape</span>{' '}
                <span className="font-mono text-xs">{d.id}</span> <span className="text-muted-foreground">of</span>{' '}
                <Button variant="link" size="xs" className="h-auto p-0" onClick={() => onOpenModel(d.asset)}>
                  {d.pdxmesh}
                </Button>
              </span>
            ))}
          </div>
        </FormSection>
      )}
      {info.shapes.length > 0 && (
        <FormSection title={`Parts · ${info.shapes.length}`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Part</TableHead>
                <TableHead className="text-right">Vertices</TableHead>
                <TableHead className="text-right">Triangles</TableHead>
                <TableHead>Shader</TableHead>
                <TableHead>Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {info.shapes.map((s, i) => (
                <TableRow key={i}>
                  <TableCell className="max-w-48 truncate font-mono text-xs" title={s.name}>
                    {s.name}
                  </TableCell>
                  <TableCell className="text-right text-xs">{s.vertices.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-xs">{s.triangles.toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.shader}
                    {s.skinned ? ' · skinned' : ''}
                    {s.uvSets > 1 ? ` · ${s.uvSets} UV sets` : ''}
                    {s.lod ? ` · LOD ${s.lod}` : ''}
                    {s.decal ? ' · decal' : ''}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.max.map((x, k) => fmt(x - s.min[k])).join(' × ')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FormSection>
      )}
      {textures.length > 0 && (
        <FormSection title={`Textures · ${textures.length}`}>
          <Textures textures={textures} />
        </FormSection>
      )}
      {info.bones.length > 0 && (
        <FormSection title={`Skeleton · ${info.bones.length} bones`}>
          <p className="font-mono text-xs break-words text-muted-foreground">{info.bones.join(' · ')}</p>
        </FormSection>
      )}
    </>
  )
}

/** One model file of the game or the mod: its 3D preview, the Blender round trip, what it's made of */
export default function ModelDetail({
  path,
  onOpenModel
}: {
  path: string
  onOpenModel: (path: string) => void
}): React.JSX.Element {
  const [info, setInfo] = useState<ModelInfo | null | undefined>(undefined)
  // Again after an index update that changed gfx files (an import); kept when it's the same
  const gfx = useGfxRevision()
  useEffect(() => setInfo(undefined), [path])
  useEffect(() => {
    let cancelled = false
    void api
      .modelInfo(path)
      .then((i) => !cancelled && setInfo((old) => (old && i && digest(old) === digest(i) ? old : i)))
    return () => {
      cancelled = true
    }
  }, [path, gfx])

  if (info === undefined) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner />
        Reading the model…
      </div>
    )
  }
  if (info === null) return <p className="p-6 text-sm text-muted-foreground">Model file not found.</p>

  const open = async (): Promise<void> => {
    const r = await window.ck3tools.openInEditor(info.abs)
    if (!r.ok) toast.error(r.error)
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <header className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground uppercase">
          3D model · {info.kind === 'asset' ? 'asset file' : 'mesh file'}
        </span>
        <h2 className="font-heading text-xl font-semibold">{base(info.path)}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{info.path}</span>
          <span>· {size(info.bytes)}</span>
          {info.kind === 'mesh' && (
            <span>
              · {plural(info.shapes.length, 'part')} ·{' '}
              {info.shapes.reduce((s, p) => s + p.triangles, 0).toLocaleString()} triangles
            </span>
          )}
          <Button variant="ghost" size="xs" title="Show the file in its folder" onClick={() => void api.revealFile(info.abs)}>
            <FolderOpen />
            Reveal
          </Button>
          {info.kind === 'asset' && (
            <Button variant="ghost" size="xs" title="Open it in the text editor" onClick={() => void open()}>
              <ExternalLink />
              Open
            </Button>
          )}
        </div>
      </header>
      {info.kind === 'asset' ? (
        <AssetBody info={info} onOpenModel={onOpenModel} />
      ) : (
        <MeshBody info={info} onOpenModel={onOpenModel} />
      )}
    </div>
  )
}
