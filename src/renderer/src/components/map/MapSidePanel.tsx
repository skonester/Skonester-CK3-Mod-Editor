import { Fragment, useEffect, useMemo, useState } from 'react'
import { Focus, Pencil, X } from 'lucide-react'
import type { MapInfo } from '@crusaderpope/shared/api'
import {
  TIER_NAMES,
  ancestorAt,
  provinceName,
  type Groups,
  type Mode
} from '@crusaderpope/renderer/src/components/map/model'
import { useOpenEntry } from '@/lib/openEntry'
import { useApp } from '../../AppContext'
import Hint from '../Hint'
import { EDITABLE_LAYERS, MapLayerEdit, MapTitleEdit } from './MapEditing'
import GameCoatOfArms from './GameCoatOfArms'
import { Swatch } from '../Swatch'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/ui/table'

/** The province under the pointer: its name, county, group in the mode and realm */
export function MapTooltip({
  info,
  groups,
  mode,
  p,
  x,
  y
}: {
  info: MapInfo
  groups: Groups
  mode: Mode
  p: number
  x: number
  y: number
}): React.JSX.Element {
  const P = info.province
  const kind = info.kinds[P.kind[p]]
  const g = groups.of[p]
  const county = ancestorAt(info, p, 'c')
  const realm = P.realm[p]
  return (
    <div
      className="pointer-events-none absolute z-10 max-w-64 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
      style={{ left: x + 16, top: y + 12 }}
    >
      <span className="font-medium">{provinceName(info, p)}</span>
      {kind !== 'land' && (
        <span className="text-muted-foreground"> · {kind.replace('_', ' ')}</span>
      )}
      {county >= 0 && county !== P.barony[p] && <div>{info.titles[county].name}</div>}
      {g >= 0 && mode !== 'c' && mode !== 'b' && (
        <div className="text-primary">{groups.name(g)}</div>
      )}
      {mode !== 'realm' && realm >= 0 && (
        <div className="text-muted-foreground">Realm: {info.titles[realm].name}</div>
      )}
    </div>
  )
}

/**
 * The selected province (from CrusaderPope's MapPanel): its group in the mode
 * with a "Zoom to it", then its titles, realm and holder and every layer's
 * value. Each title, character, culture and faith opens in its editor here;
 * ✎ on a row changes it from the map — history at the map's date (or a
 * title's colour), written into the selected mod.
 */
export function MapSidePanel({
  info,
  groups,
  mode,
  sel: p,
  onClose,
  onZoom
}: {
  info: MapInfo
  groups: Groups
  mode: Mode
  sel: number
  onClose: () => void
  onZoom: () => void
}): React.JSX.Element {
  const open = useOpenEntry()
  const { selectedMod } = useApp()
  const P = info.province
  // The row whose editor is open (another province closes it)
  const [editing, setEditing] = useState<string | null>(null)
  useEffect(() => setEditing(null), [p])
  const link = (type: string | undefined, key: string, text: string): React.ReactNode =>
    type ? (
      <Button
        variant="link"
        size="xs"
        className="h-auto p-0 font-normal text-inherit underline decoration-dotted underline-offset-2"
        title={`Open ${key}`}
        onClick={() => void open(type, key)}
      >
        {text}
      </Button>
    ) : (
      text
    )
  // A realm is shown with its banner: the government's shape, the tier's bar
  const title = (t: number, kind: 'title' | 'realm' = 'title'): React.ReactNode =>
    t >= 0 ? (
      <span className="inline-flex items-center gap-1.5">
        <GameCoatOfArms kind={kind} name={info.titles[t].key} size={18} date={info.date} />
        {link('landed_titles', info.titles[t].key, info.titles[t].name)}
      </span>
    ) : (
      '—'
    )
  // A holder: name and house, age, culture and faith at the date
  const holderOf = (h: NonNullable<MapInfo['titles'][number]['holder']>): React.ReactNode => (
    <>
      {link('characters', h.id, h.house ? `${h.name} ${h.house}` : h.name)}
      {h.age !== undefined && `, ${h.age}`}
      {h.culture && <> · {link('culture/cultures', h.culture.key, h.culture.name)}</>}
      {h.faith && <> · {link('faith', h.faith.key, h.faith.name)}</>}
    </>
  )
  const realm = P.realm[p]
  const holder = realm >= 0 ? info.titles[realm].holder : undefined
  const g = groups.of[p]
  const gl = g >= 0 ? groups.link(g) : undefined
  const counties = useMemo(() => {
    if (g < 0) return 0
    const set = new Set<number>()
    for (let q = 0; q < info.count; q++) if (groups.of[q] === g) set.add(ancestorAt(info, q, 'c'))
    set.delete(-1)
    return set.size
  }, [g, groups, info])
  const realmMode = mode === 'realm' || mode === 'vassal'
  // (culture and faith are the county's, the holding its barony's)
  const layerEditable = (id: string): boolean =>
    EDITABLE_LAYERS.has(id) && (id === 'holding' ? P.barony[p] >= 0 : ancestorAt(info, p, 'c') >= 0)
  const rows: { k: string; v: React.ReactNode; edit?: { title: number } | { layer: string } }[] = [
    ...(['b', 'c', 'd', 'k', 'e', 'h'] as const)
      .filter((t) => info.titles.some((x) => x.tier === t))
      .map((tier) => {
        const t = ancestorAt(info, p, tier)
        return { k: TIER_NAMES[tier][0], v: title(t), edit: t >= 0 ? { title: t } : undefined }
      }),
    {
      k: 'Realm',
      edit: realm >= 0 ? { title: realm } : undefined,
      v:
        realm >= 0 ? (
          <>
            {title(realm, 'realm')}
            {holder && (
              <span className="text-muted-foreground">
                {' '}
                · {link('characters', holder.id, holder.name)}
              </span>
            )}
          </>
        ) : (
          '—'
        )
    },
    ...info.layers.map((l) => {
      const v = l.values[p]
      const edit = layerEditable(l.id) ? { layer: l.id } : undefined
      if (l.things) {
        return {
          k: l.row,
          edit,
          v: v >= 0 ? link(l.things[v].type, l.things[v].key, l.things[v].name) : '—'
        }
      }
      return {
        k: l.row,
        edit,
        v: Number.isFinite(v)
          ? `${Math.round(v * 10) / 10}${l.scale?.unit ? ` ${l.scale.unit}` : ''}`
          : '—'
      }
    })
  ]

  return (
    <Card className="flex w-96 shrink-0 flex-col gap-3 rounded-none border-y-0 border-r-0 py-3">
      <div className="flex items-start gap-2 px-4">
        {g >= 0 && gl?.type === 'landed_titles' && (
          <GameCoatOfArms
            kind={mode === 'realm' || mode === 'vassal' ? 'realm' : 'title'}
            name={gl.name}
            size={56}
            date={info.date}
          />
        )}
        <div className="min-w-0 flex-1">
          {g >= 0 && (
            <>
              <h2 className="flex items-center gap-1.5 font-heading text-base font-medium">
                <Swatch hex={groups.color(g) ?? null} className="size-3 shrink-0" />
                {gl ? link(gl.type, gl.name, groups.name(g)) : groups.name(g)}
              </h2>
              {realmMode && info.titles[g].baseName && (
                <p className="text-xs text-muted-foreground">{info.titles[g].baseName}</p>
              )}
              {groups.note(g) && <p className="text-xs text-muted-foreground">{groups.note(g)}</p>}
              <p className="text-xs text-muted-foreground">
                {counties} {counties === 1 ? 'county' : 'counties'}
                {realmMode && info.titles[g].holder && <> · {holderOf(info.titles[g].holder!)}</>}
                {mode === 'vassal' && info.titles[g].liege !== undefined && (
                  <> · under {title(info.titles[g].liege!)}</>
                )}
              </p>
            </>
          )}
        </div>
        <Button variant="ghost" size="icon-xs" title="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      {g >= 0 && (
        <div className="px-4">
          <Button variant="outline" size="xs" onClick={onZoom}>
            <Focus />
            Zoom to it
          </Button>
        </div>
      )}
      <div className="px-4">
        <h3 className="font-heading text-sm font-medium">{provinceName(info, p)}</h3>
        <p className="text-xs text-muted-foreground">
          Province {p}
          {P.name[p] ? ` · ${P.name[p]}` : ''} · {info.kinds[P.kind[p]].replace('_', ' ')}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <Table>
          <TableBody>
            {rows.map((r) => {
              const on = editing === r.k
              return (
                <Fragment key={r.k}>
                  <TableRow>
                    <TableHead className="h-auto py-1 align-top text-xs">{r.k}</TableHead>
                    <TableCell className="py-1 text-xs whitespace-normal">
                      <span className="flex items-start gap-1">
                        <span className="min-w-0 flex-1">{r.v}</span>
                        {r.edit && (
                          <Button
                            variant={on ? 'secondary' : 'ghost'}
                            size="icon-xs"
                            disabled={!selectedMod}
                            title={
                              selectedMod
                                ? `Change it in ${selectedMod.name}`
                                : 'Select a mod to edit from the map'
                            }
                            onClick={() => setEditing(on ? null : r.k)}
                          >
                            <Pencil />
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                  {on && r.edit && (
                    <TableRow>
                      <TableCell colSpan={2} className="py-1 whitespace-normal">
                        {'title' in r.edit ? (
                          <MapTitleEdit key={r.edit.title} info={info} t={r.edit.title} />
                        ) : (
                          <MapLayerEdit
                            info={info}
                            layer={info.layers.find(
                              (l) => l.id === (r.edit as { layer: string }).layer
                            )!}
                            p={p}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <div className="px-4">
        <Hint
          value={
            selectedMod
              ? `✎ on a row changes it in ${selectedMod.name}, at ${info.date}. Undo takes an edit back.`
              : 'Select a mod to change the map in it.'
          }
        />
      </div>
    </Card>
  )
}
