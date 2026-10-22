import { useEffect, useMemo, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import { ExternalLink } from 'lucide-react'
import type { EntityKey, GraphData, GraphNode } from '@crusaderpope/shared/api'
import { typeColor } from '@crusaderpope/renderer/src/typeColors'
import { useApp } from '../../AppContext'
import { tokenColor } from '@/lib/tokenColor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'

type Layout = 'flow' | 'concentric' | 'breadthfirst' | 'cose'

/** Types that make up "event flow": what fires what */
const FLOW_TYPES = [
  'events',
  'on_action',
  'scripted_effects',
  'decisions',
  'character_interactions',
  'story_cycles',
  'activities/activity_types',
  'schemes/scheme_types',
  'activities/pulse_actions',
  'situation/situations'
]

/**
 * "Flow" layout (CrusaderPope's GraphView): incoming references in columns to
 * the left of the centre, outgoing to the right, one column per distance,
 * nodes grouped by type; tall columns wrap into sub-columns.
 */
function flowPositions(data: GraphData): {
  pos: Record<string, { x: number; y: number }>
  halign: Record<string, string>
} {
  const COL_W = 420
  const SUB_W = 300
  const ROW_H = 26
  const MAX_ROWS = 30
  const center = data.nodes.find((n) => n.distance === 0)
  const pos: Record<string, { x: number; y: number }> = {}
  const halign: Record<string, string> = {}
  if (!center) return { pos, halign }

  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const side = new Map<string, number>([[center.id, 0]])
  const maxDist = Math.max(...data.nodes.map((n) => n.distance))
  // A node takes the side of the node it was reached from; for the centre's
  // neighbours the edge direction decides (centre → n: right). Outgoing wins.
  const assign = (id: string, s: number): void => {
    if (!side.has(id) || s === 1) side.set(id, s)
  }
  for (let d = 1; d <= maxDist; d++) {
    for (const e of data.edges) {
      const src = byId.get(e.source)
      const tgt = byId.get(e.target)
      if (!src || !tgt) continue
      if (src.distance === d - 1 && tgt.distance === d)
        assign(tgt.id, src.distance === 0 ? 1 : (side.get(src.id) ?? 1))
      if (tgt.distance === d - 1 && src.distance === d)
        assign(src.id, tgt.distance === 0 ? -1 : (side.get(tgt.id) ?? -1))
    }
  }

  const columns = new Map<string, GraphNode[]>()
  for (const n of data.nodes) {
    if (n.distance === 0) continue
    const key = `${side.get(n.id) ?? 1}:${n.distance}`
    columns.set(key, [...(columns.get(key) ?? []), n])
  }
  pos[center.id] = { x: 0, y: 0 }
  halign[center.id] = 'center'
  for (const [key, col] of columns) {
    const [s, d] = key.split(':').map(Number)
    col.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
    const subCols = Math.ceil(col.length / MAX_ROWS)
    const rows = Math.ceil(col.length / subCols)
    col.forEach((n, i) => {
      const sub = Math.floor(i / rows)
      const row = i % rows
      pos[n.id] = { x: s * (d * COL_W + sub * SUB_W), y: (row - (rows - 1) / 2) * ROW_H }
      halign[n.id] = s < 0 ? 'left' : 'right'
    })
  }
  // Deeper columns go beyond the sub-columns of shallower ones
  for (const s of [-1, 1]) {
    let offset = 0
    for (let d = 1; d <= maxDist; d++) {
      const col = columns.get(`${s}:${d}`)
      if (!col) continue
      for (const n of col) pos[n.id].x += s * offset
      offset += (Math.ceil(col.length / MAX_ROWS) - 1) * SUB_W
    }
  }
  return { pos, halign }
}

function TypeDot({ type }: { type: string }): React.JSX.Element {
  // (a type's identity colour, the same the graph's nodes wear — data, not theme)
  return <span className="size-2 shrink-0 rounded-full" style={{ background: typeColor(type) }} />
}

/**
 * What links to an entry and what it links to, as a graph a few steps deep —
 * CrusaderPope's reference graph. Click a node to highlight its links,
 * double-click (or Open) to go to it.
 */
export default function GraphView({
  entry,
  onOpen
}: {
  entry: EntityKey
  onOpen: (entry: EntityKey) => void
}): React.JSX.Element {
  const { indexStatus } = useApp()
  const revision = indexStatus.state === 'ready' ? (indexStatus.revision ?? 0) : null
  const [depth, setDepth] = useState(1)
  const [layout, setLayout] = useState<Layout>('flow')
  const [hideLoc, setHideLoc] = useState(true)
  const [hideImplicit, setHideImplicit] = useState(false)
  const [flowOnly, setFlowOnly] = useState(false)
  const [data, setData] = useState<GraphData | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const openRef = useRef(onOpen)
  openRef.current = onOpen

  // An index update brings the same graph again: laid out anew only when it changed
  const shown = useRef('')
  useEffect(() => {
    if (revision === null) return
    let live = true
    const exclude = [...(hideLoc ? ['localization'] : []), ...(hideImplicit ? ['flag', 'variable'] : [])]
    void window.api
      .graph(entry.type, entry.name, {
        depth,
        excludeTypes: exclude,
        onlyTypes: flowOnly ? FLOW_TYPES : null,
        maxNodes: depth > 1 ? 220 : 160
      })
      .then((d) => {
        if (!live) return
        const key = JSON.stringify(d)
        if (key === shown.current) return
        shown.current = key
        setData(d)
        setSelected(null)
      })
    return () => {
      live = false
    }
  }, [entry.type, entry.name, depth, hideLoc, hideImplicit, flowOnly, revision])

  useEffect(() => {
    if (!data || !container.current) return
    const text = tokenColor('--foreground')
    const muted = tokenColor('--muted-foreground')
    // (opaque: cytoscape fades lines with line-opacity, not the colour's alpha)
    const edge = tokenColor('--muted-foreground', 1)
    const accent = tokenColor('--primary')
    const halo = tokenColor('--background')
    const flow = layout === 'flow' ? flowPositions(data) : null
    const cy = cytoscape({
      container: container.current,
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 3,
      elements: [
        ...data.nodes.map((n) => ({
          data: {
            id: n.id,
            label: n.name.length > 34 ? `${n.name.slice(0, 32)}…` : n.name,
            color: typeColor(n.type),
            distance: n.distance,
            center: n.distance === 0 ? 1 : 0,
            halign: flow ? flow.halign[n.id] : 'center',
            valign: flow && n.distance > 0 ? 'center' : 'bottom',
            node: n
          },
          position: flow?.pos[n.id]
        })),
        ...data.edges.map((e, i) => ({
          data: {
            id: `e${i}`,
            source: e.source,
            target: e.target,
            ctx: e.ctx + (e.count > 1 ? ` ×${e.count}` : '')
          }
        }))
      ],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            color: text,
            'font-size': 10,
            'font-family': 'ui-monospace, Consolas, monospace',
            'text-valign': 'data(valign)' as 'bottom',
            'text-halign': 'data(halign)' as 'center',
            'text-margin-y': (n: cytoscape.NodeSingular) => (n.data('valign') === 'bottom' ? 4 : 0),
            'text-margin-x': (n: cytoscape.NodeSingular) =>
              n.data('halign') === 'left' ? -6 : n.data('halign') === 'right' ? 6 : 0,
            width: 14,
            height: 14,
            'text-outline-color': halo,
            'text-outline-width': 2
          }
        },
        {
          selector: 'node[center = 1]',
          style: { width: 28, height: 28, 'border-width': 3, 'border-color': accent, 'font-size': 13 }
        },
        {
          selector: 'edge',
          style: {
            width: 1.2,
            'line-color': edge,
            'target-arrow-color': edge,
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 0.8,
            'line-opacity': 0.45
          }
        },
        {
          selector: 'edge.hl',
          style: {
            'line-opacity': 1,
            'line-color': accent,
            'target-arrow-color': accent,
            width: 2,
            label: 'data(ctx)',
            'font-size': 9,
            color: muted,
            'text-rotation': 'autorotate',
            'text-outline-color': halo,
            'text-outline-width': 2
          }
        },
        { selector: 'node:selected', style: { 'border-width': 2, 'border-color': text } },
        { selector: '.faded', style: { opacity: 0.18 } }
      ],
      layout: flow
        ? { name: 'preset' }
        : layout === 'concentric'
          ? {
              name: 'concentric',
              concentric: (n: cytoscape.NodeSingular) => 10 - (n.data('distance') as number),
              levelWidth: () => 1,
              minNodeSpacing: 34,
              animate: false
            }
          : layout === 'breadthfirst'
            ? {
                name: 'breadthfirst',
                directed: false,
                roots: data.nodes.filter((n) => n.distance === 0).map((n) => `#${n.id}`),
                spacingFactor: 1.15,
                animate: false
              }
            : { name: 'cose', animate: false, nodeRepulsion: () => 9000, idealEdgeLength: () => 90, numIter: 1500 }
    })
    // Small graphs would otherwise be zoomed in until the labels are huge
    cy.fit(undefined, 40)
    if (cy.zoom() > 1.1) {
      cy.zoom(1.1)
      cy.center()
    }
    const clear = (): void => void cy.elements().removeClass('faded hl')
    cy.on('tap', 'node', (e) => {
      const n = e.target as cytoscape.NodeSingular
      clear()
      cy.elements().not(n.closedNeighborhood()).addClass('faded')
      n.connectedEdges().addClass('hl')
      setSelected(n.data('node') as GraphNode)
    })
    cy.on('dbltap', 'node', (e) => {
      const n = (e.target as cytoscape.NodeSingular).data('node') as GraphNode
      openRef.current({ type: n.type, name: n.name })
    })
    cy.on('tap', (e) => {
      if (e.target === cy) {
        clear()
        setSelected(null)
      }
    })
    cy.on('mouseover', 'edge', (e) => void (e.target as cytoscape.EdgeSingular).addClass('hl'))
    cy.on('mouseout', 'edge', (e) => {
      const edgeEl = e.target as cytoscape.EdgeSingular
      if (edgeEl.connectedNodes(':selected').length === 0) edgeEl.removeClass('hl')
    })
    return () => cy.destroy()
  }, [data, layout])

  const legend = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of data?.nodes ?? []) m.set(n.type, (m.get(n.type) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }, [data])

  const toggles: [string, boolean, (v: boolean) => void, string][] = [
    ['graph-flow', flowOnly, setFlowOnly, 'Event flow only'],
    ['graph-loc', hideLoc, setHideLoc, 'Hide localization'],
    ['graph-implicit', hideImplicit, setHideImplicit, 'Hide flags and variables']
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5">
          <Label className="text-xs font-normal">Depth</Label>
          <Select value={String(depth)} onValueChange={(v) => setDepth(Number(v))}>
            <SelectTrigger size="sm" className="w-16">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
        <span className="flex items-center gap-1.5">
          <Label className="text-xs font-normal">Layout</Label>
          <Select value={layout} onValueChange={(v) => setLayout(v as Layout)}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flow">Flow (in → out)</SelectItem>
              <SelectItem value="concentric">Radial</SelectItem>
              <SelectItem value="breadthfirst">Tree</SelectItem>
              <SelectItem value="cose">Force</SelectItem>
            </SelectContent>
          </Select>
        </span>
        {toggles.map(([id, on, set, label]) => (
          <span key={id} className="flex items-center gap-1.5">
            <Switch id={id} size="sm" checked={on} onCheckedChange={set} />
            <Label htmlFor={id} className="text-xs font-normal">
              {label}
            </Label>
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {data
          ? `${data.nodes.length} nodes · ${data.edges.length} links${data.truncated ? ' (cut short — try less depth)' : ''}`
          : 'Building the graph…'}{' '}
        · click a node to highlight its links, double-click to open it
      </p>
      <div className="relative min-h-96 flex-1 overflow-hidden rounded-lg border bg-background">
        {/* (cytoscape makes its container position: relative — so sized, not inset) */}
        <div ref={container} className="size-full" />
        {!data && <Spinner className="absolute top-1/2 left-1/2" />}
        {legend.length > 0 && (
          <div className="pointer-events-none absolute top-2 left-2 flex max-w-[60%] flex-wrap gap-1">
            {legend.map(([t, n]) => (
              <Badge key={t} variant="outline" className="bg-background/80">
                <TypeDot type={t} />
                {t} · {n}
              </Badge>
            ))}
          </div>
        )}
        {selected && (
          <div className="absolute right-2 bottom-2 flex max-w-80 flex-col gap-1 rounded-lg border bg-popover p-3 text-xs shadow-md">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <TypeDot type={selected.type} />
              {selected.type}
            </span>
            <span className="font-mono break-all">{selected.name}</span>
            {selected.display && selected.display !== selected.name && (
              <span className="text-muted-foreground">{selected.display}</span>
            )}
            <Button
              size="xs"
              variant="outline"
              className="self-start"
              onClick={() => onOpen({ type: selected.type, name: selected.name })}
            >
              <ExternalLink />
              Open
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
