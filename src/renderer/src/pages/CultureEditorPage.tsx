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
import { ArrowLeft, FilterX, Plus } from 'lucide-react'
import { useDefaultLayout } from 'react-resizable-panels'
import { toast } from 'sonner'
import { useApp } from '../AppContext'
import ModPicker from '../components/ModPicker'
import DebouncedInput from '../components/DebouncedInput'
import CultureCreatePanel from '../components/CultureCreatePanel'
import CultureDetailPanel from '../components/CultureDetailPanel'
import CultureRelationsPanel from '../components/CultureRelationsPanel'
import EntryHistoryBar from '../components/EntryHistoryBar'
import FavoriteToggle from '../components/FavoriteToggle'
import ReferenceInput from '../components/ReferenceInput'
import { colorTile } from '../components/Swatch'
import { useEntryHistory } from '../hooks/useEntryHistory'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useSidebar } from '@/components/ui/sidebar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { entryKey } from '@shared/entries'
import type { CultureData, EntryRef } from '@shared/types'
import type { CharacterSearch, CultureSearch } from '../router'
import {
  allPillars,
  buildRows,
  findCulture,
  nameLookup,
  normId,
  swatchForeground
} from '@/lib/cultureView'
import type { CultureListRow } from '@/lib/cultureView'

/** The colour a culture paints on the map, as a small square. */
function Swatch({ color, className }: { color: string | null; className?: string }): React.JSX.Element {
  if (color === null) {
    return (
      <span
        aria-hidden
        className={cn('size-3.5 shrink-0 rounded-sm border border-dashed border-muted-foreground/50', className)}
        title="No colour"
      />
    )
  }
  return (
    <span
      aria-hidden
      className={cn('size-3.5 shrink-0 rounded-sm border', className)}
      style={{ backgroundColor: color, borderColor: swatchForeground(color) + '40' }}
      title={color}
    />
  )
}

/**
 * A pillar in a list cell. Seven columns leave no room for the app's usual
 * "Name (id)" reference treatment, so the name carries the cell and the id
 * moves to the tooltip; an unlocalized pillar falls back to its bare id, the
 * way raw ids read everywhere else. The full reference — with its jump to the
 * defining file — lives in the detail panel and the column's own filter.
 */
function PillarCell({
  value,
  name
}: {
  value: string | null
  name: string | null
}): React.JSX.Element {
  if (value === null) return <em className="text-muted-foreground">—</em>
  return (
    <span className={cn('min-w-0 truncate', name === null && 'font-mono')} title={value}>
      {name ?? value}
    </span>
  )
}

/** Which control a column renders in the filter row under its header. */
interface CultureColumnMeta {
  filter: 'text' | 'pillar' | 'none'
}

const features = tableFeatures({
  columnFilteringFeature,
  columnFacetingFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  // Faceting feeds the pillar pickers the values actually present in the data;
  // each column's facets ignore its own filter, so its options stay put while
  // the other columns narrow them.
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  sortedRowModel: createSortedRowModel(),
  columnMeta: {} as CultureColumnMeta,
  filterFns,
  sortFns
})

type Features = typeof features

/** Sort ids like numbers where they contain digits, nulls first. */
function numericAware(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : -1
  if (b === null) return 1
  return a.localeCompare(b, undefined, { numeric: true })
}

const bySortableString: SortFn<Features, CultureListRow> = (
  rowA: Row<Features, CultureListRow>,
  rowB: Row<Features, CultureListRow>,
  columnId: string
) => numericAware(rowA.getValue<string | null>(columnId), rowB.getValue<string | null>(columnId))

const columnHelper = createColumnHelper<Features, CultureListRow>()

const columns = columnHelper.columns([
  columnHelper.accessor('name', {
    header: 'Name',
    sortFn: bySortableString,
    filterFn: 'includesString',
    meta: { filter: 'text' },
    cell: (info) => (
      <span className="flex min-w-0 items-center gap-2">
        <Swatch color={info.row.original.color} />
        <span className="min-w-0 truncate">
          {info.getValue() ?? <em className="text-muted-foreground">{info.row.original.id}</em>}
        </span>
        {!info.row.original.inMod && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            game
          </Badge>
        )}
      </span>
    )
  }),
  columnHelper.accessor('id', {
    header: 'ID',
    sortFn: bySortableString,
    filterFn: 'includesString',
    meta: { filter: 'text' },
    cell: (info) => <span className="font-mono">{info.getValue()}</span>
  }),
  columnHelper.accessor('heritage', {
    header: 'Heritage',
    sortFn: bySortableString,
    filterFn: 'equalsString',
    meta: { filter: 'pillar' }
    // Cell rendering is overridden in the body: it needs the pillar names.
  }),
  columnHelper.accessor('ethos', {
    header: 'Ethos',
    sortFn: bySortableString,
    filterFn: 'equalsString',
    meta: { filter: 'pillar' }
  }),
  columnHelper.accessor('language', {
    header: 'Language',
    sortFn: bySortableString,
    filterFn: 'equalsString',
    meta: { filter: 'pillar' }
  }),
  columnHelper.accessor('traditions', {
    header: 'Traditions',
    meta: { filter: 'none' },
    enableColumnFilter: false,
    cell: (info) => info.getValue()
  }),
  columnHelper.accessor('members', {
    header: 'Characters',
    meta: { filter: 'none' },
    enableColumnFilter: false,
    cell: (info) => info.getValue()
  })
])

/** The three pillar columns all filter the same way, so they share one control. */
const PILLAR_COLUMNS = new Set(['heritage', 'ethos', 'language'])

interface ColumnFilterProps {
  column: Column<Features, CultureListRow>
  gameDir: string | null
  modPath: string | null
  replacePaths: string[]
  nameOf: (id: string) => string | null
}

function ColumnFilter({
  column,
  gameDir,
  modPath,
  replacePaths,
  nameOf
}: ColumnFilterProps): React.JSX.Element | null {
  const kind = column.columnDef.meta?.filter ?? 'text'
  const value = (column.getFilterValue() as string | undefined) ?? ''
  const facets = kind === 'pillar' ? column.getFacetedUniqueValues() : null

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
      locate={async (v) => window.ck3tools.locateRef(gameDir, modPath, replacePaths, 'pillar', v)}
    />
  )
}

export default function CultureEditorPage(): React.JSX.Element {
  // (dataRevision: files of the mod changed under the editor — an undo, a map edit: read again)
  const { settings, selectedMod, dataRevision } = useApp()
  const { isMobile, setOpen, setOpenMobile } = useSidebar()
  const navigate = useNavigate()
  const [data, setData] = useState<CultureData | null>(null)
  /** The mod's culture files, for the create panel's target picker */
  const [cultureFiles, setCultureFiles] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [showRawDates, setShowRawDates] = useState(false)
  // Which row is open lives in the URL, not in state, so opening one pushes a
  // history entry and the mouse "back" button returns to the list.
  const search = useSearch({ from: '/cultures' })
  const creating = search.create === true
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'culture-editor-detail',
    panelIds: ['detail', 'related'],
    onlySaveAfterUserInteractions: true
  })
  const createLayout = useDefaultLayout({
    id: 'culture-editor-create',
    panelIds: ['list', 'create'],
    onlySaveAfterUserInteractions: true
  })

  const modPath = selectedMod?.path ?? null
  const modKey = selectedMod?.file ?? null
  const gameDir = settings?.gameDir ?? null
  const replacePaths = useMemo(() => selectedMod?.replacePaths ?? [], [selectedMod])
  const calendar = selectedMod?.profile?.calendar ?? null
  const history = useEntryHistory('cultures')

  const go = (next: CultureSearch, replace = false): void => {
    void navigate({ to: '/cultures', search: next, replace })
  }

  /** Give the form the full width: fold the tools sidebar away if it's open. */
  const collapseSidebar = (): void => {
    if (isMobile) setOpenMobile(false)
    else setOpen(false)
  }

  const openRow = (id: string): void => {
    go({ id })
    collapseSidebar()
  }

  /** Open the create panel, optionally seeded from an existing culture. */
  const openCreate = (from?: string): void => {
    go({ create: true, from })
    collapseSidebar()
  }

  // Closing replaces rather than pushes, so "back" from the list doesn't drop
  // straight back into the row that was just closed.
  const closeRow = (): void => {
    go({}, true)
  }

  const reload = async (): Promise<void> => {
    if (!modPath) {
      setData(null)
      setCultureFiles(null)
      return
    }
    setLoading(true)
    try {
      const [next, files] = await Promise.all([
        window.ck3tools.getCultureData(gameDir, modPath, replacePaths),
        window.ck3tools.listCultureFiles(modPath)
      ])
      setData(next)
      setCultureFiles(files)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modPath, dataRevision])

  // Switching mods invalidates the open row, but only on a real change: on the
  // first render the URL may already carry a deep link that must survive.
  const prevModPath = useRef(modPath)
  useEffect(() => {
    if (prevModPath.current !== modPath) {
      prevModPath.current = modPath
      closeRow()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modPath, dataRevision])

  /** Display name for any pillar id, for the list columns and their filters. */
  const pillarName = useMemo(
    () => nameLookup(data ? allPillars(data) : []),
    [data]
  )

  // Pre-sorted the way the list reads best: the cultures the mod actually uses
  // first. The table's own sorting layers on top when a header is clicked.
  const rows = useMemo(
    () =>
      (data ? buildRows(data) : []).sort(
        (a, b) =>
          b.members - a.members ||
          Number(b.inMod) - Number(a.inMod) ||
          numericAware(a.name ?? a.id, b.name ?? b.id)
      ),
    [data]
  )

  const table = useTable({
    features,
    columns,
    data: rows,
    globalFilterFn: (row, columnId, filterValue) =>
      String(row.getValue(columnId) ?? '')
        .toLowerCase()
        .includes(String(filterValue).toLowerCase()),
    getRowId: (r: CultureListRow) => normId(r.id)
  })

  const globalFilter = (table.state.globalFilter as string | undefined) ?? ''
  const filtered = globalFilter !== '' || table.state.columnFilters.length > 0
  const visibleRows = table.getRowModel().rows

  const clearFilters = (): void => {
    table.resetColumnFilters(true)
    table.setGlobalFilter('')
  }

  const selected = search.id && data ? findCulture(data, search.id) : null

  // Whichever culture is open — clicked here, or deep-linked from another
  // tool — is recorded as a visit under the spelling the definition uses.
  useEffect(() => {
    if (selected === null) return
    history.recordVisit({ id: selected.id, name: selected.localizedName })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, modKey])

  /**
   * A remembered ref against the current scan: its name and colour as they
   * read now, and null for a culture this mod doesn't load — hidden while
   * it's missing, but left in settings for when it comes back.
   */
  const rowFor = useMemo(() => {
    const byId = new Map(rows.map((r) => [normId(r.id), r]))
    return (ref: EntryRef): CultureListRow | undefined => byId.get(normId(ref.id))
  }, [rows])

  const resolveRef = (ref: EntryRef): EntryRef | null => {
    if (rows.length === 0) return ref
    const row = rowFor(ref)
    return row === undefined ? null : { id: row.id, name: row.name }
  }

  // An id in the URL that matches nothing (e.g. a deep link from a character
  // whose culture isn't defined) falls back to the list with a toast.
  useEffect(() => {
    if (!search.id || !data || selected) return
    toast.error(`"${search.id}" isn't a culture in ${selectedMod?.name ?? 'this mod'}`)
    closeRow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.id, data, selected])

  if (!selectedMod) {
    return (
      <div className="max-w-4xl space-y-5 p-7">
        <header>
          <h1 className="text-2xl font-semibold">Culture Editor</h1>
        </header>
        <ModPicker />
      </div>
    )
  }

  if (selected && data) {
    const swatch = selected.color?.hex ?? null
    return (
      <div className="flex h-full flex-col gap-3 p-7 pt-6">
        <header className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" title="Back to list (Esc)" onClick={closeRow}>
            <ArrowLeft />
          </Button>
          <h1 className="flex min-w-0 items-center gap-2 text-2xl font-semibold">
            <Swatch color={swatch} className="size-5" />
            <span className="truncate">{selected.localizedName ?? selected.id}</span>
            <span className="truncate font-mono text-sm font-normal text-muted-foreground">
              {selected.id}
            </span>
            {!selected.inMod && <Badge variant="outline">game</Badge>}
          </h1>
        </header>

      <EntryHistoryBar
        history={history}
        active={selected && { id: selected.id, name: selected.localizedName }}
        onOpen={(ref) => openRow(ref.id)}
        resolve={resolveRef}
        visual={(ref) => colorTile(rowFor(ref)?.color ?? null)}
      />

        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <ResizablePanel id="detail" minSize={380} className="flex min-h-0 flex-col">
            <CultureDetailPanel
              id={selected.id}
              data={data}
              modPath={modPath!}
              gameDir={gameDir}
              replacePaths={replacePaths}
              calendar={calendar}
              showRawDates={showRawDates}
              onShowRawDatesChange={setShowRawDates}
              onOpenCulture={openRow}
              onSaved={reload}
              onClose={closeRow}
            />
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-2 bg-transparent hover:bg-border" />
          <ResizablePanel
            id="related"
            defaultSize={380}
            minSize={300}
            maxSize={640}
            className="flex min-h-0 flex-col"
          >
            <CultureRelationsPanel
              id={selected.id}
              data={data}
              calendar={calendar}
              showRawDates={showRawDates}
              onOpenCulture={openRow}
              onDeriveCulture={() => openCreate(selected.id)}
              onOpenCharacter={(c) =>
                void navigate({ to: '/characters', search: { file: c.file, id: c.id } })
              }
              onAddCharacter={() => {
                const search: CharacterSearch = { create: true, culture: selected.id }
                void navigate({ to: '/characters', search })
              }}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 p-7 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Culture Editor</h1>
      </header>

      <EntryHistoryBar
        history={history}
        active={selected && { id: selected.id, name: selected.localizedName }}
        onOpen={(ref) => openRow(ref.id)}
        resolve={resolveRef}
        visual={(ref) => colorTile(rowFor(ref)?.color ?? null)}
      />

      {!loading && rows.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              No cultures found in {selectedMod.name}&apos;s{' '}
              <code className="font-mono">common/culture/cultures</code> folder, or in the game
              files it loads.
            </p>
            <Button size="sm" className="shrink-0" onClick={() => openCreate()}>
              <Plus />
              New culture
            </Button>
          </CardContent>
        </Card>
      )}

      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={createLayout.defaultLayout}
        onLayoutChanged={createLayout.onLayoutChanged}
      >
        {rows.length > 0 && (
          <ResizablePanel id="list" minSize={360} className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center gap-3">
                <Button size="sm" onClick={() => openCreate()}>
                  <Plus />
                  New culture
                </Button>
                <DebouncedInput
                  className="ml-auto w-72"
                  type="search"
                  placeholder="Filter by name, id, heritage, ethos or language…"
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
                              {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? ''}
                            </button>
                            <ColumnFilter
                              column={header.column}
                              gameDir={gameDir}
                              modPath={modPath}
                              replacePaths={replacePaths}
                              nameOf={pillarName}
                            />
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
                      className="group cursor-pointer"
                      data-state={
                        selected !== null && normId(selected.id) === normId(row.original.id)
                          ? 'selected'
                          : undefined
                      }
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
                          className="max-w-60 truncate"
                        >
                          {PILLAR_COLUMNS.has(cell.column.id) ? (
                            <PillarCell
                              value={cell.getValue<string | null>()}
                              name={pillarName(cell.getValue<string>() ?? '')}
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
        {creating && modPath && data && cultureFiles && (
          <>
            {rows.length > 0 && (
              <ResizableHandle withHandle className="mx-2 bg-transparent hover:bg-border" />
            )}
            <ResizablePanel
              id="create"
              defaultSize={420}
              minSize={340}
              maxSize={720}
              className="flex min-h-0 flex-col"
            >
              <CultureCreatePanel
                // Remount when a fresh deep link brings a different seed
                key={search.from ?? ''}
                modPath={modPath}
                gameDir={gameDir}
                replacePaths={replacePaths}
                data={data}
                calendar={calendar}
                files={cultureFiles}
                seedId={search.from ?? null}
                onOpenCulture={openRow}
                onCreated={(id) => {
                  // Reload first: the row the URL is about to point at has to
                  // exist in the scan, or the deep-link guard bounces it back
                  void reload().then(() => go({ id }, true))
                }}
                onClose={closeRow}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  )
}
