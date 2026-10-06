import { useEffect, useMemo, useRef, useState } from 'react'
import {
  columnFacetingFeature,
  columnFilteringFeature,
  createColumnHelper,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createSortedRowModel,
  filterFns,
  flexRender,
  globalFilteringFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable
} from '@tanstack/react-table'
import type { Column, Row, SortFn } from '@tanstack/react-table'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { FilterX, Plus } from 'lucide-react'
import { useDefaultLayout } from 'react-resizable-panels'
import { toast } from 'sonner'
import { useApp } from '../AppContext'
import ModPicker from '../components/ModPicker'
import DebouncedInput from '../components/DebouncedInput'
import EntryHistoryBar from '../components/EntryHistoryBar'
import FavoriteToggle from '../components/FavoriteToggle'
import { useEntryHistory } from '../hooks/useEntryHistory'
import FaithCreatePanel from '../components/FaithCreatePanel'
import FaithDetailPanel from '../components/FaithDetailPanel'
import ReferenceDisplay from '../components/ReferenceDisplay'
import ReferenceInput from '../components/ReferenceInput'
import { colorTile, Swatch } from '../components/Swatch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@/components/ui/resizable'
import { useSidebar } from '@/components/ui/sidebar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { buildFaithRows, normId } from '@/lib/faithView'
import type { FaithListRow } from '@/lib/faithView'
import { entryKey } from '@shared/entries'
import type { EntryRef, ReligionData } from '@shared/types'
import type { FaithSearch } from '../router'

/** Which control a column renders in the filter row under its header. */
interface FaithColumnMeta {
  filter: 'text' | 'religion' | 'none'
}

const features = tableFeatures({
  columnFilteringFeature,
  columnFacetingFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  // Faceting feeds the religion picker the values actually present in the
  // data; its facets ignore its own filter, so its options stay put while the
  // other columns narrow them.
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  sortedRowModel: createSortedRowModel(),
  columnMeta: {} as FaithColumnMeta,
  filterFns,
  sortFns
})

type Features = typeof features

/** Sort ids like numbers where they contain digits. */
function numericAware(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : -1
  if (b === null) return 1
  return a.localeCompare(b, undefined, { numeric: true })
}

const bySortableString: SortFn<Features, FaithListRow> = (
  rowA: Row<Features, FaithListRow>,
  rowB: Row<Features, FaithListRow>,
  columnId: string
) => numericAware(rowA.getValue<string | null>(columnId), rowB.getValue<string | null>(columnId))

const columnHelper = createColumnHelper<Features, FaithListRow>()

const columns = columnHelper.columns([
  columnHelper.accessor('id', {
    header: 'ID',
    sortFn: bySortableString,
    filterFn: 'includesString',
    meta: { filter: 'text' },
    cell: (info) => (
      <span className="flex items-center gap-2">
        <Swatch hex={info.row.original.color} className="size-3 shrink-0" />
        <span className="truncate font-mono">{info.getValue()}</span>
      </span>
    )
  }),
  columnHelper.accessor('name', {
    header: 'Name',
    sortFn: bySortableString,
    filterFn: 'includesString',
    meta: { filter: 'text' },
    cell: (info) => (
      <>
        {info.getValue() ?? <em className="text-muted-foreground">—</em>}
        {!info.row.original.defined && (
          <Badge variant="outline" className="ml-2 text-[10px]">
            undefined
          </Badge>
        )}
        {info.row.original.defined && !info.row.original.inMod && (
          <Badge variant="outline" className="ml-2 text-[10px]">
            game
          </Badge>
        )}
      </>
    )
  }),
  columnHelper.accessor('religion', {
    header: 'Religion',
    sortFn: bySortableString,
    filterFn: 'equalsString',
    meta: { filter: 'religion' }
    // Cell rendering is overridden in the body: it needs the navigate handler.
  }),
  columnHelper.accessor('adherents', {
    header: 'Adherents',
    meta: { filter: 'none' },
    enableColumnFilter: false,
    cell: (info) => info.getValue()
  })
])

interface ColumnFilterProps {
  column: Column<Features, FaithListRow>
  /** Display name for a religion id, so the picker can offer "Name (id)" */
  nameOf: (id: string) => string | null
}

/** The filter control rendered under a column header. */
function ColumnFilter({ column, nameOf }: ColumnFilterProps): React.JSX.Element | null {
  const kind = column.columnDef.meta?.filter ?? 'text'
  const value = (column.getFilterValue() as string | undefined) ?? ''
  const facets = kind === 'religion' ? column.getFacetedUniqueValues() : null

  const options = useMemo(
    () =>
      facets === null
        ? []
        : [...facets.keys()]
            .filter((v): v is string => typeof v === 'string' && v !== '')
            .sort(numericAware)
            .map((id) => ({ id, name: nameOf(id) })),
    [facets, nameOf]
  )

  if (kind === 'none') return null

  if (kind === 'text') {
    return (
      <DebouncedInput
        className="font-normal"
        type="search"
        placeholder="Filter…"
        value={value}
        onChange={(v) => column.setFilterValue(v)}
      />
    )
  }

  return (
    <ReferenceInput
      className="font-normal"
      value={value === '' ? null : value}
      onChange={(v) => column.setFilterValue(v ?? '')}
      options={options}
      placeholder="Any"
    />
  )
}

export default function FaithEditorPage(): React.JSX.Element {
  // (dataRevision: files of the mod changed under the editor — an undo, a map edit: read again)
  const { settings, selectedMod, dataRevision } = useApp()
  const { isMobile, setOpen, setOpenMobile } = useSidebar()
  const navigate = useNavigate()
  const [data, setData] = useState<ReligionData | null>(null)
  const [loading, setLoading] = useState(false)
  const [iconNames, setIconNames] = useState<string[]>([])
  /** Hide the base game's definitions, leaving only what the mod defines */
  const [modOnly, setModOnly] = useState(false)
  // Which row is open lives in the URL, not in state, so opening one pushes a
  // history entry and the mouse "back" button returns to the list. `create`
  // opens the new-faith panel instead of a row.
  const search = useSearch({ from: '/faiths' })
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'faith-editor-detail',
    panelIds: ['list', 'detail'],
    onlySaveAfterUserInteractions: true
  })

  const modPath = selectedMod?.path ?? null
  const modKey = selectedMod?.file ?? null
  const gameDir = settings?.gameDir ?? null
  const replacePaths = useMemo(() => selectedMod?.replacePaths ?? [], [selectedMod])
  const history = useEntryHistory('faiths')

  const go = (next: FaithSearch, replace = false): void => {
    void navigate({ to: '/faiths', search: next, replace })
  }

  /** Give the list and the form the full width: fold the tools sidebar away. */
  const collapseSidebar = (): void => {
    if (isMobile) setOpenMobile(false)
    else setOpen(false)
  }

  const openRow = (id: string): void => {
    go({ id })
    collapseSidebar()
  }

  const openCreate = (religion?: string): void => {
    go({ create: true, religion })
    collapseSidebar()
  }

  // Closing replaces rather than pushes, so "back" from the list doesn't drop
  // straight back into the row that was just closed.
  const closeRow = (): void => {
    go({}, true)
  }

  const openReligion = (id: string): void => {
    void navigate({ to: '/religions', search: { id } })
  }

  const reload = async (): Promise<void> => {
    if (!modPath) {
      setData(null)
      return
    }
    setLoading(true)
    try {
      setData(await window.ck3tools.getReligionData(gameDir, modPath, replacePaths))
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), [modPath, dataRevision])

  // Switching mods invalidates the open row, but only on a real change: on the
  // first render the URL may already carry a deep link that must survive.
  const prevModPath = useRef(modPath)
  useEffect(() => {
    if (prevModPath.current !== modPath) {
      prevModPath.current = modPath
      closeRow()
    }
    if (!modPath) {
      setIconNames([])
      return
    }
    window.ck3tools.listFaithIcons(gameDir, modPath, replacePaths).then(setIconNames)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modPath, dataRevision])

  /** Display name for a religion id, matched lowercased like every other id. */
  const religionName = useMemo(() => {
    const names = new Map<string, string>()
    for (const r of data?.religions ?? []) {
      if (r.localizedName !== null) names.set(normId(r.id), r.localizedName)
    }
    return (id: string): string | null => names.get(normId(id)) ?? null
  }, [data])

  const allRows = useMemo(() => (data ? buildFaithRows(data) : []), [data])

  // Biggest congregations first. The table's own sorting layers on top when a
  // header is clicked.
  const rows = useMemo(() => {
    const visible = modOnly ? allRows.filter((r) => r.inMod || !r.defined) : allRows
    return [...visible].sort((a, b) => b.adherents - a.adherents || numericAware(a.id, b.id))
  }, [allRows, modOnly])

  const table = useTable({
    features,
    columns,
    data: rows,
    globalFilterFn: (row, columnId, filterValue) =>
      String(row.getValue(columnId) ?? '')
        .toLowerCase()
        .includes(String(filterValue).toLowerCase()),
    getRowId: (r: FaithListRow) => normId(r.id)
  })

  const globalFilter = (table.state.globalFilter as string | undefined) ?? ''
  const filtered = globalFilter !== '' || table.state.columnFilters.length > 0
  const visibleRows = table.getRowModel().rows

  const clearFilters = (): void => {
    table.resetColumnFilters(true)
    table.setGlobalFilter('')
  }

  // Resolve the id in the URL against the scan: a faith (defined or merely
  // professed) opens here; a religion's id belongs to the Religion Editor and
  // is handed over; anything else falls back to the list with a toast.
  const selected: string | null = useMemo(() => {
    if (!search.id || !data) return null
    const key = normId(search.id)
    const isFaith =
      data.faiths.some((f) => normId(f.id) === key) ||
      data.adherents.some((a) => normId(a.faith) === key)
    return isFaith ? search.id : null
  }, [search.id, data])

  useEffect(() => {
    if (!search.id || !data || selected) return
    if (data.religions.some((r) => normId(r.id) === normId(search.id!))) {
      void navigate({ to: '/religions', search: { id: search.id }, replace: true })
      return
    }
    toast.error(`"${search.id}" isn't a faith in ${selectedMod?.name ?? 'this mod'}`)
    closeRow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.id, data, selected])

  const openCharacter = (id: string, file: string): void => {
    void navigate({ to: '/characters', search: { file, id } })
  }

  /** The list row a remembered ref points at, matched the way every id is. */
  const rowFor = useMemo(() => {
    const byId = new Map(allRows.map((r) => [normId(r.id), r]))
    return (ref: EntryRef): FaithListRow | undefined => byId.get(normId(ref.id))
  }, [allRows])

  const selectedRow = selected === null ? null : (rowFor({ id: selected, name: null }) ?? null)

  // Whichever faith is open — clicked here, or deep-linked from another tool —
  // is recorded as a visit under the spelling the definition uses.
  useEffect(() => {
    if (selectedRow === null) return
    history.recordVisit({ id: selectedRow.id, name: selectedRow.name })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRow?.id, modKey])

  /**
   * A remembered ref against the current scan: the name it reads by now, and
   * null for a faith this mod no longer loads — hidden while it's missing,
   * but left in settings for when it comes back.
   */
  const resolveRef = (ref: EntryRef): EntryRef | null => {
    if (allRows.length === 0) return ref
    const row = rowFor(ref)
    return row === undefined ? null : { id: row.id, name: row.name }
  }

  if (!selectedMod) {
    return (
      <div className="max-w-4xl space-y-5 p-7">
        <header>
          <h1 className="text-2xl font-semibold">Faith Editor</h1>
        </header>
        <ModPicker />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 p-7 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Faith Editor</h1>
      </header>

      <EntryHistoryBar
        history={history}
        active={selectedRow && { id: selectedRow.id, name: selectedRow.name }}
        onOpen={(ref) => openRow(ref.id)}
        resolve={resolveRef}
        visual={(ref) => colorTile(rowFor(ref)?.color ?? null)}
      />

      {!loading && allRows.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              No faiths found for {selectedMod.name} in{' '}
              <code className="font-mono">
                common/religion/{data?.format === '1.20' ? 'faith_types' : 'religion_types'}
              </code>
              , and no character professes one.
            </p>
            <Button size="sm" className="shrink-0" onClick={() => openCreate()}>
              <Plus />
              New faith
            </Button>
          </CardContent>
        </Card>
      )}

      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        {/* Gated on the UNFILTERED rows: when "This mod" filters everything
            away the table just goes empty, keeping the toggle to switch back */}
        {allRows.length > 0 && (
          <ResizablePanel id="list" minSize={360} className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={() => openCreate()}>
                <Plus />
                New faith
              </Button>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={modOnly ? 'mod' : 'all'}
                onValueChange={(v) => v && setModOnly(v === 'mod')}
                aria-label="Which definitions to list"
              >
                <ToggleGroupItem value="mod">This mod</ToggleGroupItem>
                <ToggleGroupItem value="all">With base game</ToggleGroupItem>
              </ToggleGroup>
              <div className="ml-auto flex items-center gap-3">
                <DebouncedInput
                  className="w-64"
                  type="search"
                  placeholder="Filter by id, name, or religion…"
                  value={globalFilter}
                  onChange={(v) => table.setGlobalFilter(v)}
                />
                {filtered && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <FilterX />
                    Clear
                  </Button>
                )}
                <span className="text-xs whitespace-nowrap text-muted-foreground">
                  {loading ? 'Loading…' : `${visibleRows.length} / ${rows.length}`}
                </span>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card [&_[data-slot=table-container]]:overflow-visible">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((hg) => (
                    <TableRow key={hg.id} className="hover:bg-transparent">
                      <TableHead
                        className="sticky top-0 z-10 h-auto w-9 border-b bg-card"
                        aria-label="Favorite"
                      />
                      {hg.headers.map((header) => (
                        <TableHead
                          key={header.id}
                          className="sticky top-0 z-10 h-auto border-b bg-card py-1.5 align-top"
                        >
                          <div className="flex flex-col items-stretch gap-1">
                            <button
                              type="button"
                              className="cursor-pointer self-start select-none hover:text-primary"
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ??
                                ''}
                            </button>
                            <ColumnFilter column={header.column} nameOf={religionName} />
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn(
                        'group cursor-pointer',
                        selected !== null && normId(selected) === normId(row.original.id) && 'bg-muted'
                      )}
                      onClick={() => openRow(row.original.id)}
                    >
                      <TableCell className="w-9 py-0 pr-0 pl-2">
                        <FavoriteToggle
                          on={history.isFavorite(row.original)}
                          dot={entryKey(row.original) in history.drafts}
                          onToggle={() =>
                            history.toggleFavorite({ id: row.original.id, name: row.original.name })
                          }
                        />
                      </TableCell>
                      {row.getAllCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            'max-w-70 truncate',
                            cell.column.id === 'religion'
                              ? 'max-w-50'
                              : cell.column.id === 'id'
                                ? 'max-w-60'
                                : undefined
                          )}
                        >
                          {cell.column.id === 'religion' ? (
                            <ReferenceDisplay
                              value={row.original.religion}
                              name={
                                row.original.religion === null
                                  ? null
                                  : religionName(row.original.religion)
                              }
                              onNavigate={openReligion}
                            />
                          ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </ResizablePanel>
        )}
        {(selected || search.create) && data && modPath && (
          <>
            {allRows.length > 0 && (
              <ResizableHandle withHandle className="mx-2 bg-transparent hover:bg-border" />
            )}
            <ResizablePanel
              id="detail"
              defaultSize={440}
              minSize={340}
              maxSize={760}
              className="flex min-h-0 flex-col"
            >
              {selected ? (
                <FaithDetailPanel
                  id={selected}
                  data={data}
                  modPath={modPath}
                  gameDir={gameDir}
                  replacePaths={replacePaths}
                  iconNames={iconNames}
                  onOpenReligion={openReligion}
                  onOpenRite={(id) => void navigate({ to: '/rites', search: { id } })}
                  onAddRite={(faith) =>
                    void navigate({ to: '/rites', search: { create: true, faith } })
                  }
                  onOpenCharacter={openCharacter}
                  onSaved={() => void reload()}
                  onClose={closeRow}
                />
              ) : (
                <FaithCreatePanel
                  // Remount when a fresh deep link brings a different prefill
                  key={search.religion ?? ''}
                  modPath={modPath}
                  gameDir={gameDir}
                  replacePaths={replacePaths}
                  data={data}
                  iconNames={iconNames}
                  prefillReligion={search.religion ?? null}
                  onOpenReligion={openReligion}
                  onCreated={(id) => {
                    // Reload first: the row the URL is about to point at has to
                    // exist in the scan, or the deep-link guard bounces it back
                    void reload().then(() => go({ id }, true))
                  }}
                  onClose={closeRow}
                />
              )}
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  )
}
