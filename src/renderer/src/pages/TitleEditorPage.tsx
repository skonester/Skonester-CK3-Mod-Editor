import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowLeft, FilterX, Plus } from 'lucide-react'
import { useDefaultLayout } from 'react-resizable-panels'
import { toast } from 'sonner'
import { useApp } from '../AppContext'
import CoatOfArms from '../components/CoatOfArms'
import DebouncedInput from '../components/DebouncedInput'
import EntryHistoryBar from '../components/EntryHistoryBar'
import ModPicker from '../components/ModPicker'
import TitleCreatePanel from '../components/TitleCreatePanel'
import TitleDetailPanel from '../components/TitleDetailPanel'
import TitleHistoryPanel from '../components/TitleHistoryPanel'
import TitleTree from '../components/TitleTree'
import { colorTile, Swatch } from '../components/Swatch'
import { useEntryHistory } from '../hooks/useEntryHistory'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useSidebar } from '@/components/ui/sidebar'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { entryKey } from '@shared/entries'
import type {
  CharacterSummary,
  EntryRef,
  TitleData,
  TitleDetail,
  TitleHistoryEntry,
  TitleSummary
} from '@shared/types'
import type { TitleSearch } from '../router'
import {
  TIER_LABEL,
  buildTree,
  findTitle,
  flattenTree,
  normId,
  pruneToMod,
  titleName
} from '@/lib/titleView'

/**
 * The list view's state — drilled-open branches, scroll position, search and
 * scope — kept per mod for the whole app session, so opening a title (which
 * unmounts the list) or visiting another tool and coming back lands on the
 * tree exactly as it was left. Module-level like the app's other in-memory
 * caches (coats of arms); an app restart starts fresh.
 */
interface TitleListState {
  /** Normalized ids of expanded branches */
  expanded: Set<string>
  scrollTop: number
  query: string
  scope: 'mod' | 'all'
}

const listStates = new Map<string, TitleListState>()

/** A title's remembered ref: its id, labelled by whatever localization gives. */
const titleRef = (t: TitleSummary): EntryRef => ({ id: t.id, name: t.localizedName })

/** The remembered list state for a mod (keyed by .mod file name). */
function listStateFor(modFile: string): TitleListState {
  let state = listStates.get(modFile)
  if (state === undefined) {
    state = { expanded: new Set(), scrollTop: 0, query: '', scope: 'mod' }
    listStates.set(modFile, state)
  }
  return state
}

export default function TitleEditorPage(): React.JSX.Element {
  // (dataRevision: files of the mod changed under the editor — an undo, a map edit: read again)
  const { settings, selectedMod, dataRevision } = useApp()
  const { isMobile, setOpen, setOpenMobile } = useSidebar()
  const navigate = useNavigate()
  const modKey = selectedMod?.file ?? ''
  const [data, setData] = useState<TitleData | null>(null)
  const [titleFiles, setTitleFiles] = useState<string[] | null>(null)
  const [historyFiles, setHistoryFiles] = useState<string[]>([])
  const [characters, setCharacters] = useState<CharacterSummary[]>([])
  const [detail, setDetail] = useState<TitleDetail | null>(null)
  const [history, setHistory] = useState<TitleHistoryEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  // Seeded from (and written through to) the per-mod store above
  const [query, setQueryState] = useState(() => listStateFor(modKey).query)
  const [scope, setScopeState] = useState<'mod' | 'all'>(() => listStateFor(modKey).scope)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(listStateFor(modKey).expanded)
  )
  const [showRawDates, setShowRawDates] = useState(false)

  const setQuery = (next: string): void => {
    listStateFor(modKey).query = next
    setQueryState(next)
  }
  const setScope = (next: 'mod' | 'all'): void => {
    listStateFor(modKey).scope = next
    setScopeState(next)
  }
  const toggleExpanded = (id: string): void => {
    const state = listStateFor(modKey)
    const key = normId(id)
    if (state.expanded.has(key)) state.expanded.delete(key)
    else state.expanded.add(key)
    setExpanded(new Set(state.expanded))
  }
  /** While a history entry form is open, Escape cancels it rather than the page */
  const [historyFormOpen, setHistoryFormOpen] = useState(false)
  // Which title is open lives in the URL, not in state, so opening one pushes
  // a history entry and the mouse "back" button returns to the tree.
  const search = useSearch({ from: '/titles' })
  const creating = search.create === true
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'title-editor-detail',
    panelIds: ['detail', 'history'],
    onlySaveAfterUserInteractions: true
  })
  const createLayout = useDefaultLayout({
    id: 'title-editor-create',
    panelIds: ['list', 'create'],
    onlySaveAfterUserInteractions: true
  })

  const modPath = selectedMod?.path ?? null
  const gameDir = settings?.gameDir ?? null
  const replacePaths = useMemo(() => selectedMod?.replacePaths ?? [], [selectedMod])
  const calendar = selectedMod?.profile?.calendar ?? null
  // `history` here is already the open title's history entries — this is the
  // editor's own remembered rows.
  const entryHistory = useEntryHistory('titles')

  const go = (next: TitleSearch, replace = false): void => {
    void navigate({ to: '/titles', search: next, replace })
  }

  /** Give the panels the full width: fold the tools sidebar away if it's open. */
  const collapseSidebar = (): void => {
    if (isMobile) setOpenMobile(false)
    else setOpen(false)
  }

  const openRow = (id: string): void => {
    go({ id })
    collapseSidebar()
  }

  const openCreate = (parent?: string): void => {
    go({ create: true, parent })
    collapseSidebar()
  }

  // Closing replaces rather than pushes, so "back" from the tree doesn't drop
  // straight back into the title that was just closed.
  const closeRow = (): void => {
    go({}, true)
  }

  const reload = async (): Promise<void> => {
    if (!modPath) {
      setData(null)
      setTitleFiles(null)
      return
    }
    setLoading(true)
    try {
      const [next, files, hFiles, chars] = await Promise.all([
        window.ck3tools.getTitleData(gameDir, modPath, replacePaths),
        window.ck3tools.listTitleFiles(modPath),
        window.ck3tools.listTitleHistoryFiles(modPath),
        window.ck3tools.listCharacters(modPath)
      ])
      setData(next)
      setTitleFiles(files)
      setHistoryFiles(hFiles)
      setCharacters(chars)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modPath, dataRevision])

  // Switching mods invalidates the open title, but only on a real change: on
  // the first render the URL may already carry a deep link that must survive.
  // The list view swaps to the new mod's own remembered state.
  const prevModPath = useRef(modPath)
  useEffect(() => {
    if (prevModPath.current !== modPath) {
      prevModPath.current = modPath
      const state = listStateFor(modKey)
      setQueryState(state.query)
      setScopeState(state.scope)
      setExpanded(new Set(state.expanded))
      closeRow()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modPath, dataRevision])

  /**
   * The selected title's full parse and history, loaded per selection. The
   * token drops a slow response that lands after a NEWER load started, and
   * the id check drops one requested for a title that is no longer selected
   * (a panel's post-save callback can fire after the user navigated away) —
   * either way a stale response must not clobber the current selection.
   */
  const selectionToken = useRef(0)
  const selectedId = useRef<string | undefined>(undefined)
  selectedId.current = search.id
  const loadSelected = async (id: string): Promise<void> => {
    const token = ++selectionToken.current
    const [d, h] = await Promise.all([
      window.ck3tools.getTitle(gameDir, modPath, replacePaths, id),
      window.ck3tools.getTitleHistory(gameDir, modPath, replacePaths, id)
    ])
    if (token !== selectionToken.current || id !== selectedId.current) return
    setDetail(d)
    setHistory(h)
  }

  useEffect(() => {
    setDetail(null)
    setHistory(null)
    if (search.id && modPath) void loadSelected(search.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.id, modPath, dataRevision])

  const selected = search.id && data ? findTitle(data.titles, search.id) : null

  // An id in the URL that matches nothing (e.g. a deep link to a title the mod
  // doesn't load) falls back to the tree with a toast.
  useEffect(() => {
    if (!search.id || !data || selected) return
    toast.error(`"${search.id}" isn't a landed title in ${selectedMod?.name ?? 'this mod'}`)
    closeRow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.id, data, selected])

  // Put the tree back where it was scrolled to whenever the list view comes
  // (back) into existence — it unmounts while a title is open, and the rows
  // must be rendered before the offset can stick.
  const listScroll = useRef<HTMLDivElement>(null)
  const showingList = selected === null && data !== null
  useEffect(() => {
    if (showingList) listScroll.current?.scrollTo({ top: listStateFor(modKey).scrollTop })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showingList, modKey])

  // Whichever title is open — clicked here, or deep-linked from a history
  // entry — is recorded as a visit under the spelling landed_titles uses.
  useEffect(() => {
    if (selected === null) return
    entryHistory.recordVisit(titleRef(selected))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, modKey])

  /**
   * A remembered ref against the current scan: the name it reads by now, and
   * null for a title this mod no longer loads — hidden while it's missing,
   * but left in settings for when it comes back.
   */
  const resolveRef = (ref: EntryRef): EntryRef | null => {
    if (data === null) return ref
    const title = findTitle(data.titles, ref.id)
    return title === null ? null : titleRef(title)
  }

  /** The map colour a remembered title paints, as the chip's leading square. */
  const refColor = (ref: EntryRef): React.JSX.Element | null =>
    colorTile((data && findTitle(data.titles, ref.id)?.color) ?? null)

  const roots = useMemo(() => (data ? buildTree(data.titles) : []), [data])
  const visibleRoots = useMemo(
    () => (scope === 'mod' ? pruneToMod(roots) : roots),
    [roots, scope]
  )
  const visibleCount = useMemo(() => flattenTree(visibleRoots).length, [visibleRoots])
  const hasGameTitles = useMemo(() => data?.titles.some((t) => !t.inMod) ?? false, [data])

  if (!selectedMod) {
    return (
      <div className="max-w-4xl space-y-5 p-7">
        <header>
          <h1 className="text-2xl font-semibold">Title Editor</h1>
        </header>
        <ModPicker />
      </div>
    )
  }

  if (selected && data && modPath) {
    return (
      <div className="flex h-full flex-col gap-3 p-7 pt-6">
        <header className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" title="Back to tree (Esc)" onClick={closeRow}>
            <ArrowLeft />
          </Button>
          <CoatOfArms ids={[selected.id]} size={40} />
          <h1 className="flex min-w-0 items-center gap-2 text-2xl font-semibold">
            <Swatch hex={selected.color} className="size-5" />
            <span className="truncate">{titleName(selected)}</span>
            <span className="truncate font-mono text-sm font-normal text-muted-foreground">
              {selected.id}
            </span>
            <Badge variant="secondary">{TIER_LABEL[selected.tier].toLowerCase()}</Badge>
            {!selected.inMod && <Badge variant="outline">game</Badge>}
          </h1>
        </header>

      <EntryHistoryBar
        history={entryHistory}
        active={selected && titleRef(selected)}
        onOpen={(ref) => openRow(ref.id)}
        resolve={resolveRef}
        visual={refColor}
      />

        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <ResizablePanel id="detail" minSize={380} className="flex min-h-0 flex-col">
            <TitleDetailPanel
              id={selected.id}
              data={data}
              detail={detail}
              modPath={modPath}
              gameDir={gameDir}
              replacePaths={replacePaths}
              onOpenTitle={openRow}
              onAddChild={(parentId) => openCreate(parentId)}
              onSaved={() => {
                void reload()
                if (search.id) void loadSelected(search.id)
              }}
              onClose={() => {
                if (!historyFormOpen) closeRow()
              }}
            />
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-2 bg-transparent hover:bg-border" />
          <ResizablePanel
            id="history"
            defaultSize={460}
            minSize={360}
            maxSize={720}
            className="flex min-h-0 flex-col"
          >
            <TitleHistoryPanel
              titleId={selected.id}
              data={data}
              entries={history}
              historyFiles={historyFiles}
              characters={characters}
              calendar={calendar}
              showRawDates={showRawDates}
              onShowRawDatesChange={setShowRawDates}
              modPath={modPath}
              onOpenTitle={openRow}
              onOpenCharacter={(file, id) =>
                void navigate({ to: '/characters', search: { file, id } })
              }
              onChanged={() => {
                if (search.id) void loadSelected(search.id)
                void reload()
              }}
              onFormOpenChange={setHistoryFormOpen}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 p-7 pt-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Title Editor</h1>
      </header>

      <EntryHistoryBar
        history={entryHistory}
        active={selected && titleRef(selected)}
        onOpen={(ref) => openRow(ref.id)}
        resolve={resolveRef}
        visual={refColor}
      />

      {!loading && data !== null && data.titles.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              No landed titles found in {selectedMod.name}&apos;s{' '}
              <code className="font-mono">common/landed_titles</code> folder, or in the game files
              it loads.
            </p>
            <Button size="sm" className="shrink-0" onClick={() => openCreate()}>
              <Plus />
              New title
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
        {(data?.titles.length ?? 0) > 0 && (
          <ResizablePanel id="list" minSize={360} className="flex min-h-0 flex-col gap-2">
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={() => openCreate()}>
                <Plus />
                New title
              </Button>
              {hasGameTitles && (
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={scope}
                  onValueChange={(v) => v && setScope(v as 'mod' | 'all')}
                  aria-label="Which titles to list"
                >
                  <ToggleGroupItem value="mod">This mod</ToggleGroupItem>
                  <ToggleGroupItem value="all">With base game</ToggleGroupItem>
                </ToggleGroup>
              )}
              <DebouncedInput
                className="ml-auto w-72"
                type="search"
                placeholder="Search by name or id…"
                value={query}
                onChange={setQuery}
              />
              {query !== '' && (
                <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                  <FilterX />
                  Clear
                </Button>
              )}
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {loading ? 'Loading…' : `${visibleCount} titles`}
              </span>
            </div>
            <div
              ref={listScroll}
              className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card"
              onScroll={(e) => {
                listStateFor(modKey).scrollTop = e.currentTarget.scrollTop
              }}
            >
              <TitleTree
                nodes={visibleRoots}
                query={query}
                expanded={expanded}
                onToggle={toggleExpanded}
                onOpen={openRow}
                isFavorite={(t) => entryHistory.isFavorite(titleRef(t))}
                onToggleFavorite={(t) => entryHistory.toggleFavorite(titleRef(t))}
                hasDraft={(t) => entryKey(titleRef(t)) in entryHistory.drafts}
              />
            </div>
          </ResizablePanel>
        )}
        {creating && modPath && data && titleFiles && (
          <>
            {(data.titles.length ?? 0) > 0 && (
              <ResizableHandle withHandle className="mx-2 bg-transparent hover:bg-border" />
            )}
            <ResizablePanel
              id="create"
              defaultSize={420}
              minSize={340}
              maxSize={720}
              className="flex min-h-0 flex-col"
            >
              <TitleCreatePanel
                // Remount when a fresh deep link brings a different seed
                key={search.parent ?? ''}
                modPath={modPath}
                data={data}
                files={titleFiles}
                seedParent={search.parent ?? null}
                onOpenTitle={openRow}
                onCreated={(id) => {
                  // Reload first: the title the URL is about to point at has
                  // to exist in the scan, or the deep-link guard bounces it
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
