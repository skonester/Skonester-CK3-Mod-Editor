import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import type { EntityKey, PortraitEntityReport, PortraitReport as Report } from '@crusaderpope/shared/api'
import { useApp } from '../../AppContext'
import { assetTarget } from '@/lib/assetLinks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
const fmt = (x: number): string => (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(3))

/** A game file as a link to the Models page (a mesh, an asset, a texture) */
function AssetLink({ path, className }: { path: string; className?: string }): React.JSX.Element {
  const navigate = useNavigate()
  return (
    <Button
      variant="link"
      size="xs"
      className={cn('h-auto p-0 font-mono', className)}
      title={path}
      onClick={() => void navigate(assetTarget(path))}
    >
      {base(path)}
    </Button>
  )
}

function Entity({ e }: { e: PortraitEntityReport }): React.JSX.Element {
  const [open, setOpen] = useState(e.role === 'torso' || e.role === 'head')
  const [showZero, setShowZero] = useState(false)
  const problems = e.blendShapes.filter((b) => b.status === 'missing' || b.status === 'topology')
  const applied = e.blendShapes
    .filter((b) => b.status === 'applied')
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
  const zero = e.blendShapes.filter((b) => b.status === 'zero')
  const vertices = e.parts.reduce((s, p) => s + p.vertices, 0)
  const openAsset = async (): Promise<void> => {
    const r = await window.ck3tools.openInEditor(e.assetAbs)
    if (!r.ok) toast.error(r.error)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        <ChevronRight className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="font-medium">{e.role}</span>
        {e.accessory && <span className="truncate text-muted-foreground">· {e.accessory}</span>}
        {problems.length > 0 && (
          <Badge variant="destructive">{problems.length} blend shapes skipped</Badge>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {vertices.toLocaleString()} vertices · {applied.length} blend shapes · {e.boneMorphs.length} bone
          morphs
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 border-t px-3 py-2">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">entity</dt>
          <dd className="font-mono break-all">{e.entity}</dd>
          <dt className="text-muted-foreground">asset</dt>
          <dd className="flex items-center gap-1">
            <AssetLink path={e.asset} />
            <Button variant="ghost" size="icon-xs" title="Open it in the text editor" onClick={() => void openAsset()}>
              <FolderOpen />
            </Button>
          </dd>
          <dt className="text-muted-foreground">mesh</dt>
          <dd className="flex items-center gap-1">
            <AssetLink path={e.mesh} />
            <Button
              variant="ghost"
              size="icon-xs"
              title="Show the file in its folder"
              onClick={() => void window.api.revealFile(e.meshAbs)}
            >
              <FolderOpen />
            </Button>
          </dd>
          <dt className="text-muted-foreground">skeleton</dt>
          <dd>
            {e.pose} pose · {e.bones} bones
            {e.idle && <span className="text-muted-foreground"> · idle {base(e.idle)}</span>}
          </dd>
        </dl>

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
            {e.parts.map((p, i) => (
              <TableRow key={i}>
                <TableCell className="max-w-48 truncate font-mono text-xs" title={p.shape}>
                  {p.shape}
                </TableCell>
                <TableCell className="text-right text-xs">{p.vertices.toLocaleString()}</TableCell>
                <TableCell className="text-right text-xs">{p.triangles.toLocaleString()}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.shader}</TableCell>
                <TableCell
                  className="text-xs text-muted-foreground"
                  title={`min ${p.min.map(fmt).join(', ')}\nmax ${p.max.map(fmt).join(', ')}`}
                >
                  {p.max.map((x, k) => fmt(x - p.min[k])).join(' × ')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {problems.length + applied.length + zero.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Blend shape</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...problems, ...applied, ...(showZero ? zero : [])].map((b) => {
                const bad = b.status === 'missing' || b.status === 'topology'
                return (
                  <TableRow
                    key={b.attribute}
                    className={cn(bad && 'text-destructive', b.status === 'zero' && 'text-muted-foreground')}
                  >
                    <TableCell className="font-mono text-xs">{b.attribute}</TableCell>
                    <TableCell className="text-right text-xs">{b.weight.toFixed(3)}</TableCell>
                    <TableCell className="text-xs">
                      {b.target.endsWith('.mesh') ? <AssetLink path={b.target} /> : base(b.target)}
                    </TableCell>
                    <TableCell className="text-xs whitespace-normal">
                      {b.status}
                      {b.detail && ` — ${b.detail}`}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {zero.length > 0 && (
          <Button variant="link" size="xs" className="self-start p-0" onClick={() => setShowZero(!showZero)}>
            {showZero ? 'Hide' : 'Show'} {zero.length} blend shapes at zero
          </Button>
        )}

        {e.boneMorphs.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bone morph</TableHead>
                <TableHead className="text-right">u</TableHead>
                <TableHead>Animation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {e.boneMorphs.map((m) => (
                <TableRow key={m.attribute}>
                  <TableCell className="font-mono text-xs">{m.attribute}</TableCell>
                  <TableCell className="text-right text-xs">{m.u.toFixed(3)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground" title={m.animation}>
                    {base(m.animation)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * What a 3D portrait is built from (CrusaderPope's expert Portrait tab):
 * entities, mesh files, vertex counts, blend shapes — applied, at zero,
 * skipped and why — bone morphs, decals, tags and portrait modifiers. For
 * checking mesh mods.
 */
export default function PortraitReport({ entry }: { entry: EntityKey }): React.JSX.Element {
  const { indexStatus } = useApp()
  const revision = indexStatus.state === 'ready' ? (indexStatus.revision ?? 0) : null
  const [dressed, setDressed] = useState(true)
  const [figLeaf, setFigLeaf] = useState(true)
  const [report, setReport] = useState<Report | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setReport(undefined), [entry.type, entry.name, dressed, figLeaf])
  useEffect(() => {
    if (revision === null) return
    let live = true
    setError(null)
    window.api.portraitReport(entry.type, entry.name, { naked: !dressed, figLeaf }).then(
      (r) => live && setReport(r),
      (e: Error) => live && setError(e.message)
    )
    return () => {
      live = false
    }
  }, [entry.type, entry.name, dressed, figLeaf, revision])

  if (error) return <p className="text-sm text-destructive">The portrait report failed: {error}</p>
  if (report === undefined) {
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Building the portrait…
      </span>
    )
  }
  if (report === null) return <p className="text-sm text-muted-foreground">No portrait for this entry.</p>

  const vertices = report.entities.reduce((s, e) => s + e.parts.reduce((t, p) => t + p.vertices, 0), 0)
  const chips = (title: string, list: string[]): React.JSX.Element => (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">
        {title} · {list.length}
      </h3>
      <div className="flex flex-wrap gap-1">
        {list.map((t) => (
          <Badge key={t} variant="outline" className="font-mono">
            {t}
          </Badge>
        ))}
      </div>
    </section>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Badge>{report.kind}</Badge>
        <span>
          {report.label} · {report.gender}, {report.age}
        </span>
        <span className="text-xs text-muted-foreground">{report.source}</span>
        <span className="text-xs text-muted-foreground">
          {report.entities.length} entities · {vertices.toLocaleString()} vertices
        </span>
        <span className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <Switch id="report-dressed" size="sm" checked={dressed} onCheckedChange={setDressed} />
            <Label htmlFor="report-dressed" className="text-xs font-normal">
              Dressed
            </Label>
          </span>
          {!dressed && (
            <span className="flex items-center gap-1.5">
              <Switch id="report-figleaf" size="sm" checked={figLeaf} onCheckedChange={setFigLeaf} />
              <Label htmlFor="report-figleaf" className="text-xs font-normal">
                Fig leaf
              </Label>
            </span>
          )}
        </span>
      </div>

      {report.entities.map((e, i) => (
        <Entity key={e.role + i} e={e} />
      ))}

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-muted-foreground">Decals · {report.decals.length}</h3>
        <Table>
          <TableBody>
            {report.decals.map((d, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs text-muted-foreground">{d.bodyPart}</TableCell>
                <TableCell className="text-xs">
                  <AssetLink path={d.texture} />
                </TableCell>
                <TableCell className="text-right text-xs">{d.weight.toFixed(2)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {d.post ? 'after skin colour' : 'before skin colour'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      {chips('Tags', report.tags)}
      {chips('Portrait modifiers applied', report.modifiers)}
    </div>
  )
}
