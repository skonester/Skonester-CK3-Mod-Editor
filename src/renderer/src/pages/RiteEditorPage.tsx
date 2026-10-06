import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { ReligionData } from '@shared/types'
import { entryKey } from '@shared/entries'
import { useApp } from '../AppContext'
import { useEntryHistory } from '../hooks/useEntryHistory'
import ModPicker from '../components/ModPicker'
import EntryHistoryBar from '../components/EntryHistoryBar'
import FavoriteToggle from '../components/FavoriteToggle'
import ReferenceDisplay from '../components/ReferenceDisplay'
import RitePanel from '../components/RitePanel'
import { Swatch } from '../components/Swatch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { normId } from '@/lib/faithView'
import { cn } from '@/lib/utils'

export default function RiteEditorPage(): React.JSX.Element {
  // (dataRevision: files of the mod changed under the editor — an undo, a map edit: read again)
  const { settings, selectedMod, dataRevision } = useApp()
  const navigate = useNavigate()
  const search = useSearch({ from: '/rites' })
  const history = useEntryHistory('rites')
  const [data, setData] = useState<ReligionData | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [iconNames, setIconNames] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const modPath = selectedMod?.path ?? null
  const gameDir = settings?.gameDir ?? null
  const replacePaths = selectedMod?.replacePaths ?? []
  const loadId = useRef(0)
  const reload = async (): Promise<void> => {
    const request = ++loadId.current
    if (!modPath) {
      setData(null)
      return
    }
    try {
      const [next, nextFiles, icons] = await Promise.all([
        window.ck3tools.getReligionData(gameDir, modPath, replacePaths),
        window.ck3tools.listRiteFiles(modPath),
        window.ck3tools.listFaithIcons(gameDir, modPath, replacePaths)
      ])
      if (request !== loadId.current) return
      setData(next)
      setFiles(nextFiles)
      setIconNames(icons)
      setError(null)
    } catch (err) {
      if (request === loadId.current) setError(err instanceof Error ? err.message : String(err))
    }
  }
  useEffect(() => {
    setData(null)
    void reload()
    return () => {
      loadId.current++
    }
  }, [modPath, gameDir, JSON.stringify(replacePaths), dataRevision])
  const previousMod = useRef(modPath)
  useEffect(() => {
    if (previousMod.current !== modPath) {
      previousMod.current = modPath
      void navigate({ to: '/rites', search: {}, replace: true })
    }
  }, [modPath, navigate])
  const selected = (data?.rites ?? []).find((r) => normId(r.id) === normId(search.id ?? ''))
  const visit = useRef(history.recordVisit)
  visit.current = history.recordVisit
  useEffect(() => {
    if (selected) visit.current({ id: selected.id, name: selected.localizedName })
  }, [selected?.id, selected?.localizedName])
  const open = (id: string): void => {
    void navigate({ to: '/rites', search: { id } })
  }
  const openFaith = (id: string): void => {
    void navigate({ to: '/faiths', search: { id } })
  }
  const rows = (data?.rites ?? []).filter((r) =>
    [r.id, r.localizedName, r.faith].some((v) => v?.toLowerCase().includes(filter.toLowerCase()))
  )
  const panelOpen = !!search.id || search.create

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Rite Editor</h1>
        <ModPicker />
      </div>
      {!modPath ? (
        <p className="text-muted-foreground">Select a mod to view and edit rites.</p>
      ) : (
        <>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!data && !error && <p className="text-muted-foreground">Loading rites…</p>}
          {data && (
            <>
              <EntryHistoryBar
                history={history}
                active={selected ? { id: selected.id, name: selected.localizedName } : null}
                onOpen={(ref) => open(ref.id)}
                resolve={(ref) => {
                  const rite = (data.rites ?? []).find((r) => normId(r.id) === normId(ref.id))
                  return rite ? { id: rite.id, name: rite.localizedName } : null
                }}
              />
              {data.format !== '1.20' && (
                <Alert>
                  <AlertDescription>
                    Rites require CK3 1.20. Select the 1.20 game data directory in Settings to use
                    this editor.
                  </AlertDescription>
                </Alert>
              )}
              <div className={cn('grid min-h-0 flex-1 gap-4', panelOpen && 'lg:grid-cols-2')}>
                <Card className="flex min-h-0 flex-col gap-0 py-0">
                  <div className="flex gap-2 border-b p-4">
                    <Input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Filter by id, name, or faith…"
                    />
                    <Button
                      disabled={data.format !== '1.20'}
                      onClick={() => void navigate({ to: '/rites', search: { create: true } })}
                    >
                      <Plus />
                      New rite
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10" />
                          <TableHead>Rite</TableHead>
                          <TableHead>Faith</TableHead>
                          <TableHead>Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((r) => (
                          <TableRow
                            key={r.id}
                            data-state={selected?.id === r.id ? 'selected' : undefined}
                          >
                            <TableCell>
                              <FavoriteToggle
                                on={history.isFavorite({ id: r.id, name: r.localizedName })}
                                dot={
                                  entryKey({ id: r.id, name: r.localizedName }) in history.drafts
                                }
                                onToggle={() =>
                                  history.toggleFavorite({ id: r.id, name: r.localizedName })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                className="h-auto w-full justify-start gap-2 whitespace-normal"
                                onClick={() => open(r.id)}
                              >
                                <Swatch hex={r.color?.hex ?? null} />
                                <span className="text-left">
                                  {r.localizedName ?? r.id}
                                  <span className="block font-mono text-xs text-muted-foreground">
                                    {r.id}
                                  </span>
                                </span>
                              </Button>
                            </TableCell>
                            <TableCell>
                              <ReferenceDisplay
                                value={r.faith}
                                name={
                                  data.faiths.find((f) => normId(f.id) === normId(r.faith ?? ''))
                                    ?.localizedName ?? null
                                }
                                onNavigate={openFaith}
                              />
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {r.inMod ? 'Mod' : 'Game'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {!rows.length && (
                      <p className="p-4 text-sm text-muted-foreground">
                        No scripted rites found. Faiths without scripted rites receive a dynamic
                        rite from CK3.
                      </p>
                    )}
                  </div>
                </Card>
                {panelOpen && (
                  <RitePanel
                    key={search.id ?? `new:${search.faith ?? ''}`}
                    id={search.create ? null : (search.id ?? null)}
                    prefillFaith={search.faith ?? null}
                    data={data}
                    files={files}
                    iconNames={iconNames}
                    modPath={modPath}
                    gameDir={gameDir}
                    replacePaths={replacePaths}
                    onClose={() => void navigate({ to: '/rites', search: {} })}
                    onOpenFaith={openFaith}
                    onOpenCharacter={(id, file) =>
                      void navigate({ to: '/characters', search: { id, file } })
                    }
                    onSaved={(id) => {
                      void reload().then(() => open(id))
                    }}
                  />
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
