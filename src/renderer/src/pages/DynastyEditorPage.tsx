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
import { ArrowLeft, FilterX, House, Plus } from 'lucide-react'
import { useDefaultLayout } from 'react-resizable-panels'
import { toast } from 'sonner'
import { useApp } from '../AppContext'
import ModPicker from '../components/ModPicker'
import CoatOfArms from '../components/CoatOfArms'
import DebouncedInput from '../components/DebouncedInput'
import DynastyCreatePanel from '../components/DynastyCreatePanel'
import DynastyDetailPanel from '../components/DynastyDetailPanel'
import EntryHistoryBar from '../components/EntryHistoryBar'
import FamilyTree from '../components/FamilyTree'
import FavoriteToggle from '../components/FavoriteToggle'
import { useEntryHistory } from '../hooks/useEntryHistory'
import ReferenceInput from '../components/ReferenceInput'
import ReferenceDisplay from '../components/ReferenceDisplay'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupText } from '@/components/ui/button-group'
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
import { entryKey } from '@shared/entries'
import type { DynastyData, DynastyFiles, EntryRef, ReferenceData } from '@shared/types'
import type { CharacterSearch, DynastySearch } from '../router'
import {
  buildRows,
  buildTreeNodes,
  housesOfDynasty,
  makeAffiliationName,
  membersOfDynasty,
  membersOfHouse,
  normId
} from '@/lib/dynastyView'
import type { DynastyListRow } from '@/lib/dynastyView'

/**
 * Deterministic house id → color: an FNV-1a hash of the id picks a hue, spread
 * by the golden angle so similarly named houses don't land on similar hues.
 * Fixed OKLCH lightness/chroma keeps every hue legible in both themes.
 */
function houseColor(id: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  const hue = Math.round(((hash >>> 0) * 137.508) % 360)
  return `oklch(0.62 0.16 ${hue})`
}

/** Badge for a row's `dynasty`/`house` kind: gold-tinted filled house for
 *  dynasty, blue-tinted outline house for house. */
function KindBadge({ kind }: { kind: 'dynasty' | 'house' }): React.JSX.Element {
  const isDynasty = kind === 'dynasty'
  return (
    <Badge
      variant="outline"
      className={
        isDynasty
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400'
      }
    >
      <House className={cn(isDynasty && 'fill-current')} />
      {isDynasty ? 'Dynasty' : 'House'}
    </Badge>
  )
}

/** Which control a column renders in the filter row under its header. */
interface DynastyColumnMeta {
  filter: 'text' | 'kind' | 'culture' | 'parent' | 'none'
}

const features = tableFeatures({
  columnFilteringFeature,
  columnFacetingFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  // Faceting feeds the reference pickers the values actually present in the
  // data; each column's facets ignore its own filter, so its options stay put
  // while the other columns narrow them.
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  sortedRowModel: createSortedRowModel(),
  columnMeta: {} as DynastyColumnMeta,
  filterFns,
  sortFns
})

type Features = typeof features

/** Sort ids like numbers where they contain digits ("house_2" < "house_10"). */
function numericAware(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : -1
  if (b === null) return 1
  return a.localeCompare(b, undefined, { numeric: true })
}

const bySortableString: SortFn<Features, DynastyListRow> = (
  rowA: Row<Features, DynastyListRow>,
  rowB: Row<Features, DynastyListRow>,
  columnId: string
) => numericAware(rowA.getValue<string | null>(columnId), rowB.getValue<string | null>(columnId))

const columnHelper = createColumnHelper<Features, DynastyListRow>()

const columns = columnHelper.columns([
  columnHelper.accessor('kind', {
    header: 'Kind',
    filterFn: 'equalsString',
    meta: { filter: 'kind' },
    cell: (info) => <KindBadge kind={info.getValue()} />
  }),
  columnHelper.accessor('id', {
    header: 'ID',
    sortFn: bySortableString,
    filterFn: 'includesString',
    meta: { filter: 'text' },
    cell: (info) => <span className="font-mono">{info.getValue()}</span>
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
  columnHelper.accessor('culture', {
    header: 'Culture',
    sortFn: bySortableString,
    filterFn: 'equalsString',
    meta: { filter: 'culture' },
    cell: (info) => info.getValue() ?? <em className="text-muted-foreground">—</em>
  }),
  columnHelper.accessor('parent', {
    header: 'Parent',
    sortFn: bySortableString,
    filterFn: 'equalsString',
    meta: { filter: 'parent' }
    // Cell rendering is overridden in the body: it needs openRow to navigate.
  }),
  columnHelper.accessor('members', {
    header: 'Members',
    meta: { filter: 'none' },
    enableColumnFilter: false,
    cell: (info) => info.getValue()
  })
])

interface ColumnFilterProps {
  column: Column<Features, DynastyListRow>
  gameDir: string | null
  modPath: string | null
  replacePaths: string[]
  /** Display name for a culture or dynasty id, so the picker can offer "Name (id)" */
  nameOf: (kind: 'culture' | 'parent', id: string) => string | null
}

/** The filter control rendered under a column header. */
function ColumnFilter({
  column,
  gameDir,
  modPath,
  replacePaths,
  nameOf
}: ColumnFilterProps): React.JSX.Element | null {
  const kind = column.columnDef.meta?.filter ?? 'text'
  const value = (column.getFilterValue() as string | undefined) ?? ''
  const facets = kind === 'culture' || kind === 'parent' ? column.getFacetedUniqueValues() : null

  const options = useMemo(
    () =>
      facets === null || (kind !== 'culture' && kind !== 'parent')
        ? []
        : [...facets.keys()]
            .filter((v): v is string => typeof v === 'string' && v !== '')
            .sort(numericAware)
            .map((id) => ({ id, name: nameOf(kind, id) })),
    [facets, kind, nameOf]
  )

  if (kind === 'none') return null

  if (kind === 'kind') {
    return (
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        className="font-normal"
        value={value === '' ? 'all' : value}
        onValueChange={(v) => v && column.setFilterValue(v === 'all' ? '' : v)}
        aria-label="Filter by kind"
      >
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="dynasty">Dynasties</ToggleGroupItem>
        <ToggleGroupItem value="house">Houses</ToggleGroupItem>
      </ToggleGroup>
    )
  }

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
      locate={async (v) =>
        window.ck3tools.locateRef(
          gameDir,
          modPath,
          replacePaths,
          kind === 'culture' ? 'culture' : 'dynasty',
          v
        )
      }
    />
  )
}

interface Selection {
  kind: 'dynasty' | 'house'
  id: string
}

/**
 * A lineage's remembered ref. Dynasties and houses are separate databases
 * whose ids can collide, so which of the two a row belongs to is the ref's
 * scope — the same coordinate the URL carries as `kind`.
 */
const lineageRef = (
  kind: 'dynasty' | 'house',
  id: string,
  name: string | null = null
): EntryRef => ({ id, name, scope: kind })

export default function DynastyEditorPage(): React.JSX.Element {
  // (dataRevision: files of the mod changed under the editor — an undo, a map edit: read again)
  const { settings, selectedMod, dataRevision } = useApp()
  const { isMobile, setOpen, setOpenMobile } = useSidebar()
  const navigate = useNavigate()
  const [data, setData] = useState<DynastyData | null>(null)
  const [loading, setLoading] = useState(false)
  const [refData, setRefData] = useState<ReferenceData | null>(null)
  /** The mod's definition files, for the create panel's target picker */
  const [defFiles, setDefFiles] = useState<DynastyFiles | null>(null)
  const [includeHouseMembers, setIncludeHouseMembers] = useState(true)
  const [treeSelected, setTreeSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ id: string | null; nonce: number }>({ id: null, nonce: 0 })
  // Which row is open lives in the URL, not in state, so opening one pushes a
  // history entry and the mouse "back" button returns to the list. `create`
  // opens the new-definition panel for that kind instead of a row.
  const search = useSearch({ from: '/dynasties' })
  const creating = search.create ?? null
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'dynasty-editor-detail',
    panelIds: ['tree', 'detail'],
    onlySaveAfterUserInteractions: true
  })
  const createLayout = useDefaultLayout({
    id: 'dynasty-editor-create',
    panelIds: ['list', 'create'],
    onlySaveAfterUserInteractions: true
  })

  const modPath = selectedMod?.path ?? null
  const gameDir = settings?.gameDir ?? null
  const replacePaths = useMemo(() => selectedMod?.replacePaths ?? [], [selectedMod])
  const calendar = selectedMod?.profile?.calendar ?? null
  const modKey = selectedMod?.file ?? null
  const history = useEntryHistory('dynasties')

  const go = (next: DynastySearch, replace = false): void => {
    void navigate({ to: '/dynasties', search: next, replace })
  }

  /** Give the tree or the form the full width: fold the tools sidebar away. */
  const collapseSidebar = (): void => {
    if (isMobile) setOpenMobile(false)
    else setOpen(false)
  }

  const openRow = (kind: 'dynasty' | 'house', id: string): void => {
    go({ id, kind })
    collapseSidebar()
  }

  const openCreate = (kind: 'dynasty' | 'house', dynasty?: string): void => {
    go({ create: kind, dynasty })
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
      setDefFiles(null)
      return
    }
    setLoading(true)
    try {
      const [next, files] = await Promise.all([
        window.ck3tools.getDynastyData(gameDir, modPath, replacePaths),
        window.ck3tools.listDynastyFiles(modPath)
      ])
      setData(next)
      setDefFiles(files)
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
    setTreeSelected(null)
    if (!modPath) {
      setRefData(null)
      return
    }
    window.ck3tools.getReferenceData(gameDir, modPath, replacePaths).then(setRefData)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modPath, dataRevision])

  /**
   * Display name for a culture id (from the reference data) or a parent
   * dynasty id (from the rows the list already built, so an undefined dynasty
   * that only exists as a reference simply has none). Ids are matched
   * lowercased: real files reference `Phokus` as `phokus`.
   */
  const referenceName = useMemo(() => {
    const cultures = new Map<string, string>()
    for (const c of refData?.cultures ?? []) {
      if (c.name !== null) cultures.set(normId(c.id), c.name)
    }
    const dynasties = new Map<string, string>()
    for (const d of data?.dynasties ?? []) {
      const name = d.localizedName ?? d.name
      if (name !== null) dynasties.set(normId(d.id), name)
    }
    return (kind: 'culture' | 'parent', id: string): string | null =>
      (kind === 'culture' ? cultures : dynasties).get(normId(id)) ?? null
  }, [refData, data])

  // Pre-sorted the way the list has always read: biggest families first. The
  // table's own sorting layers on top when a header is clicked.
  const rows = useMemo(
    () =>
      (data ? buildRows(data) : []).sort(
        (a, b) => b.members - a.members || numericAware(a.id, b.id)
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
    getRowId: (r: DynastyListRow) => `${r.kind}:${normId(r.id)}`
  })

  const globalFilter = (table.state.globalFilter as string | undefined) ?? ''
  const filtered = globalFilter !== '' || table.state.columnFilters.length > 0
  const visibleRows = table.getRowModel().rows

  const clearFilters = (): void => {
    table.resetColumnFilters(true)
    table.setGlobalFilter('')
  }

  // Resolve the id in the URL against the scan. The caller's `kind` is trusted
  // when it matches, but falls back to the other list rather than erroring:
  // files do put house ids under `dynasty =`.
  const selected: Selection | null = useMemo(() => {
    if (!search.id || !data) return null
    const norm = normId(search.id)
    const has = {
      dynasty: data.dynasties.some((d) => normId(d.id) === norm),
      house: data.houses.some((h) => normId(h.id) === norm)
    }
    const preferred = search.kind ?? 'dynasty'
    const other = preferred === 'dynasty' ? 'house' : 'dynasty'
    const kind = has[preferred] ? preferred : has[other] ? other : null
    return kind === null ? null : { kind, id: search.id }
  }, [search.id, search.kind, data])

  // An id that survives the scan but matches nothing (e.g. a deep link from a
  // character whose dynasty isn't defined) falls back to the list with a toast.
  useEffect(() => {
    if (!search.id || !data || selected) return
    toast.error(`"${search.id}" isn't a dynasty or house in ${selectedMod?.name ?? 'this mod'}`)
    closeRow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.id, data, selected])

  // A different row means the previous tree selection no longer applies.
  useEffect(() => {
    setTreeSelected(null)
  }, [selected?.kind, selected?.id])

  const selectedRow: DynastyListRow | null =
    selected === null
      ? null
      : (rows.find((r) => r.kind === selected.kind && normId(r.id) === normId(selected.id)) ?? null)

  const members = useMemo(() => {
    if (!data || !selected) return []
    return selected.kind === 'dynasty'
      ? membersOfDynasty(data, selected.id, includeHouseMembers)
      : membersOfHouse(data, selected.id)
  }, [data, selected, includeHouseMembers])

  const treeNodes = useMemo(
    () => (data ? buildTreeNodes(members, data.characters, makeAffiliationName(data)) : []),
    [data, members]
  )

  /** Stable house → accent color assignment for the tree and the member list */
  const groupColors = useMemo(() => {
    if (!data || !selected) return {}
    const ids =
      selected.kind === 'house'
        ? [normId(selected.id)]
        : [
            ...housesOfDynasty(data, selected.id).map((h) => normId(h.id)),
            ...membersOfDynasty(data, selected.id, true)
              .filter((c) => c.house !== null)
              .map((c) => normId(c.house!))
          ]
    const colors: Record<string, string> = {}
    for (const id of ids) {
      if (!(id in colors)) colors[id] = houseColor(id)
    }
    return colors
  }, [data, selected])

  /** The list row a remembered ref points at — its kind rides in the scope. */
  const rowFor = useMemo(() => {
    const byKey = new Map(rows.map((r) => [`${r.kind}:${normId(r.id)}`, r]))
    return (ref: EntryRef): DynastyListRow | undefined =>
      byKey.get(`${ref.scope}:${normId(ref.id)}`)
  }, [rows])

  // Whichever lineage is open — clicked here, or deep-linked from a character
  // — is recorded as a visit under the spelling the definition uses.
  useEffect(() => {
    if (selectedRow === null) return
    history.recordVisit(lineageRef(selectedRow.kind, selectedRow.id, selectedRow.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRow?.kind, selectedRow?.id, modKey])

  /**
   * A remembered ref against the current scan: the name it reads by now, and
   * null for a lineage this mod no longer has — hidden while it's missing,
   * but left in settings for when it comes back.
   */
  const resolveRef = (ref: EntryRef): EntryRef | null => {
    if (rows.length === 0) return ref
    const row = rowFor(ref)
    return row === undefined ? null : lineageRef(row.kind, row.id, row.name)
  }

  /**
   * The chip's coat of arms. A house without one of its own inherits its
   * dynasty's, exactly as the game does.
   */
  const refCoa = (ref: EntryRef): React.JSX.Element => (
    <CoatOfArms
      ids={[ref.id, rowFor(ref)?.parent]}
      size={36}
      className="rounded-none border-0 shadow-none"
    />
  )

  const focusMember = (id: string): void => {
    // A house member clicked while the tree shows "dynasty only" — widen first
    if (
      selected?.kind === 'dynasty' &&
      !includeHouseMembers &&
      !members.some((c) => c.id === id)
    ) {
      setIncludeHouseMembers(true)
    }
    setTreeSelected(id)
    setFocus((f) => ({ id, nonce: f.nonce + 1 }))
  }

  const openCharacter = (id: string): void => {
    const target = data?.characters.find((c) => normId(c.id) === normId(id))
    if (!target) {
      toast.error(`Character "${id}" isn't defined in ${selectedMod?.name ?? 'this mod'}`)
      return
    }
    void navigate({ to: '/characters', search: { file: target.file, id: target.id } })
  }

  if (!selectedMod) {
    return (
      <div className="max-w-4xl space-y-5 p-7">
        <header>
          <h1 className="text-2xl font-semibold">Dynasty &amp; House Editor</h1>
        </header>
        <ModPicker />
      </div>
    )
  }

  if (selected && data) {
    const title = selectedRow?.name ?? selectedRow?.id ?? selected.id
    return (
      <div className="flex h-full flex-col gap-3 p-7 pt-6">
        <header className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Back to list (Esc)"
            onClick={closeRow}
          >
            <ArrowLeft />
          </Button>
          <h1 className="flex min-w-0 items-center gap-2 text-2xl font-semibold">
            <span className="truncate">{title}</span>
            <KindBadge kind={selected.kind} />
            <span className="truncate font-mono text-sm font-normal text-muted-foreground">
              {selectedRow?.id ?? selected.id}
            </span>
          </h1>
          <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
            {members.length} member{members.length === 1 ? '' : 's'}
          </span>
        </header>

      <EntryHistoryBar
        history={history}
        active={selected && lineageRef(selected.kind, selected.id)}
        onOpen={(ref) => openRow(ref.scope === 'house' ? 'house' : 'dynasty', ref.id)}
        resolve={resolveRef}
        visual={refCoa}
      />

        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <ResizablePanel id="tree" minSize={360} className="flex min-h-0 flex-col">
            <FamilyTree
              className="min-h-0 flex-1"
              nodes={treeNodes}
              calendar={calendar}
              selectedId={treeSelected}
              onSelect={setTreeSelected}
              onOpenCharacter={openCharacter}
              groupColors={groupColors}
              focusId={focus.id}
              focusNonce={focus.nonce}
              fitKey={`${selected.kind}:${normId(selected.id)}`}
              toolbar={
                selected.kind === 'dynasty' ? (
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    spacing={0}
                    value={includeHouseMembers ? 'all' : 'no-house'}
                    onValueChange={(v) => v && setIncludeHouseMembers(v === 'all')}
                    aria-label="Which members the tree shows"
                  >
                    <ToggleGroupItem value="all">With houses</ToggleGroupItem>
                    <ToggleGroupItem value="no-house">Dynasty only</ToggleGroupItem>
                  </ToggleGroup>
                ) : undefined
              }
            />
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-2 bg-transparent hover:bg-border" />
          <ResizablePanel
            id="detail"
            defaultSize={400}
            minSize={320}
            maxSize={720}
            className="flex min-h-0 flex-col"
          >
            <DynastyDetailPanel
              kind={selected.kind}
              id={selected.id}
              data={data}
              modPath={modPath!}
              gameDir={gameDir}
              replacePaths={replacePaths}
              calendar={calendar}
              refData={refData}
              groupColors={groupColors}
              selectedMemberId={treeSelected}
              onMemberClick={focusMember}
              onOpenCharacter={openCharacter}
              onAddMember={() => {
                const search: CharacterSearch = { create: true }
                if (selected.kind === 'house') search.house = selected.id
                else search.dynasty = selected.id
                void navigate({ to: '/characters', search })
              }}
              onAddHouse={() => openCreate('house', selected.id)}
              onOpenRow={openRow}
              onOpenCulture={(id) => void navigate({ to: '/cultures', search: { id } })}
              onSaved={reload}
              onClose={closeRow}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 p-7 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dynasty &amp; House Editor</h1>
      </header>

      <EntryHistoryBar
        history={history}
        active={selected && lineageRef(selected.kind, selected.id)}
        onOpen={(ref) => openRow(ref.scope === 'house' ? 'house' : 'dynasty', ref.id)}
        resolve={resolveRef}
        visual={refCoa}
      />

      {!loading && rows.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              No dynasties or houses found in {selectedMod.name}&apos;s{' '}
              <code className="font-mono">common/dynasties</code> folder, and no characters
              reference any.
            </p>
            <Button size="sm" className="shrink-0" onClick={() => openCreate('dynasty')}>
              <Plus />
              New dynasty
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
              <ButtonGroup>
                <ButtonGroupText>
                  <Plus />
                  New
                </ButtonGroupText>
                <Button size="sm" variant="outline" onClick={() => openCreate('dynasty')}>
                  Dynasty
                </Button>
                <Button size="sm" variant="outline" onClick={() => openCreate('house')}>
                  House
                </Button>
              </ButtonGroup>
              <div className="ml-auto flex items-center gap-3">
                <DebouncedInput
                  className="w-72"
                  type="search"
                  placeholder="Filter by id, name, culture, or parent…"
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
                            {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? ''}
                          </button>
                          <ColumnFilter
                            column={header.column}
                            gameDir={gameDir}
                            modPath={modPath}
                            replacePaths={replacePaths}
                            nameOf={referenceName}
                          />
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => {
                  const rowRef = lineageRef(row.original.kind, row.original.id, row.original.name)
                  return (
                    <TableRow
                      key={row.id}
                      className="group cursor-pointer"
                      onClick={() => openRow(row.original.kind, row.original.id)}
                    >
                      <TableCell className="w-9 py-0 pr-0 pl-2">
                        <FavoriteToggle
                          on={history.isFavorite(rowRef)}
                          dot={entryKey(rowRef) in history.drafts}
                          onToggle={() => history.toggleFavorite(rowRef)}
                        />
                      </TableCell>
                      {row.getAllCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            'max-w-70 truncate',
                            cell.column.id === 'culture' || cell.column.id === 'parent'
                              ? 'max-w-50'
                              : cell.column.id === 'id'
                                ? 'max-w-60'
                                : undefined
                          )}
                        >
                          {cell.column.id === 'parent' ? (
                            <ReferenceDisplay
                              value={row.original.parent}
                              name={
                                row.original.parent === null
                                  ? null
                                  : referenceName('parent', row.original.parent)
                              }
                              onNavigate={(v) => openRow('dynasty', v)}
                            />
                          ) : (
                            flexRender(cell.column.columnDef.cell, cell.getContext())
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  )
                })}
              </TableBody>
              </Table>
            </div>
          </ResizablePanel>
        )}
        {creating && modPath && data && defFiles && (
          <>
            {rows.length > 0 && (
              <ResizableHandle withHandle className="mx-2 bg-transparent hover:bg-border" />
            )}
            <ResizablePanel
              id="create"
              defaultSize={400}
              minSize={320}
              maxSize={720}
              className="flex min-h-0 flex-col"
            >
              <DynastyCreatePanel
                // Remount when a fresh deep link brings a different prefill;
                // the kind toggle deliberately isn't part of the key, so
                // switching kinds keeps what's already typed
                key={search.dynasty ?? ''}
                kind={creating}
                onKindChange={(next) => go({ create: next, dynasty: search.dynasty }, true)}
                modPath={modPath}
                gameDir={gameDir}
                replacePaths={replacePaths}
                data={data}
                refData={refData}
                files={defFiles}
                prefillDynasty={search.dynasty ?? null}
                onOpenRow={openRow}
                onCreated={(kind, id) => {
                  // Reload first: the row the URL is about to point at has to
                  // exist in the scan, or the deep-link guard bounces it back
                  void reload().then(() => go({ id, kind }, true))
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
