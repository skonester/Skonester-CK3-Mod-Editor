import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { ArrowLeft, BookText, Boxes, FileText, Layers } from 'lucide-react'
import type { EntityListItem, SearchResult, TypeSummary } from '@crusaderpope/shared/api'
import { useApp } from '../../AppContext'
import { useOpenEntry } from '@/lib/openEntry'
import { modTouchLabel } from '@/lib/indexLinks'
import GameThumb from './GameThumb'
import TypeDocDialog from './TypeDocDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { Spinner } from '@/components/ui/spinner'
import { Toggle } from '@/components/ui/toggle'

/** Rows drawn at most (the query narrows the rest down) */
const ROWS = 200
const SEARCH_LIMIT = 150

/** One row of the palette: a search result, or an entry of a browsed type */
interface Row {
  type: string
  typeLabel?: string
  name: string
  /** what the row shows under its key: the entry's name in game, or the text that matched */
  sub?: string
  icon?: string
  mod?: SearchResult['mod']
}

const PaletteCtx = createContext<() => void>(() => {})

/** Opens the search palette (Ctrl+K) */
export const useSearchPalette = (): (() => void) => useContext(PaletteCtx)

function EntryRow({
  row,
  showType,
  onPick
}: {
  row: Row
  showType: boolean
  onPick: (row: Row) => void
}): React.JSX.Element {
  const touch = modTouchLabel(row.mod)
  return (
    <CommandItem value={`${row.type}\u0000${row.name}`} onSelect={() => onPick(row)}>
      <GameThumb
        path={row.icon}
        size={24}
        className="rounded-sm"
        fallback={<span className="size-6 shrink-0" />}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono">{row.name}</span>
        {row.sub && row.sub !== row.name && (
          <span className="truncate text-muted-foreground">{row.sub}</span>
        )}
      </span>
      {touch && (
        <Badge variant="outline" title={touch.detail}>
          {touch.label}
        </Badge>
      )}
      {showType && row.typeLabel && <Badge variant="secondary">{row.typeLabel}</Badge>}
    </CommandItem>
  )
}

/**
 * Ctrl+K: everything the game index knows, by key or name — events, traits,
 * decisions, scripted effects, localization keys, characters … — across the
 * game and the loaded mods (CrusaderPope's explorer search). With nothing
 * typed it lists the index's types to browse one by one, each with the game's
 * own .info documentation where it ships some. Picking an entry opens it where
 * it is edited — the app's editor for it — or else in the reader.
 */
export default function SearchPaletteProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const { indexStatus } = useApp()
  const ready = indexStatus.state === 'ready'
  const revision = ready ? (indexStatus.revision ?? 0) : null
  const openEntry = useOpenEntry()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [inText, setInText] = useState(false)
  const [modOnly, setModOnly] = useState(false)
  /** the type being browsed; null: the whole index */
  const [type, setType] = useState<TypeSummary | null>(null)
  const [types, setTypes] = useState<TypeSummary[] | null>(null)
  const [entries, setEntries] = useState<EntityListItem[] | null>(null)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [doc, setDoc] = useState<TypeSummary | null>(null)

  const show = useCallback(() => setOpen(true), [])
  useHotkeys('mod+k, mod+p', show, { enableOnFormTags: true, preventDefault: true })

  // The index's types (with their counts), read again after an update
  useEffect(() => {
    if (!open || revision === null) return
    let live = true
    void window.api.types().then((t) => live && setTypes(t))
    return () => {
      live = false
    }
  }, [open, revision])

  // A browsed type's entries, when it has few enough to list
  useEffect(() => {
    setEntries(null)
    if (!open || !type || type.searchOnly || revision === null) return
    let live = true
    void window.api.list(type.id).then((l) => live && setEntries(l))
    return () => {
      live = false
    }
  }, [open, type, revision])

  // The index's search: everything, or within a type too big to list
  const query = q.trim()
  const searching = query !== '' && (!type || type.searchOnly)
  useEffect(() => {
    setResults(null)
    if (!open || !searching || revision === null) return
    let live = true
    const t = setTimeout(() => {
      void window.api
        .search(query, {
          limit: SEARCH_LIMIT,
          text: inText,
          modOnly,
          noRemoved: true,
          types: type ? [type.id] : undefined
        })
        .then((r) => live && setResults(r))
    }, 110)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [open, searching, query, inText, modOnly, type, revision])

  const close = (): void => {
    setOpen(false)
    setQ('')
    setType(null)
  }
  const pick = (row: Row): void => {
    close()
    void openEntry(row.type, row.name)
  }
  const browse = (t: TypeSummary): void => {
    setType(t)
    setQ('')
  }

  const rows: Row[] | null = useMemo(() => {
    if (searching) {
      return (
        results?.map((r) => ({
          type: r.type,
          typeLabel: r.typeLabel,
          name: r.name,
          sub: r.match ?? r.display,
          icon: r.icon,
          mod: r.mod
        })) ?? null
      )
    }
    if (!type || !entries) return null
    const needle = query.toLowerCase()
    return entries
      .filter((e) => !modOnly || (e.mod && e.mod.state !== 'removed'))
      .filter(
        (e) =>
          !needle ||
          e.name.toLowerCase().includes(needle) ||
          e.display?.toLowerCase().includes(needle)
      )
      .map((e) => ({ type: type.id, name: e.name, sub: e.display, icon: e.icon, mod: e.mod }))
  }, [searching, results, type, entries, query, modOnly])

  /** The types by group, the biggest groups' order kept as the index gives it */
  const typeGroups = useMemo(() => {
    const needle = query.toLowerCase()
    const groups = new Map<string, TypeSummary[]>()
    for (const t of [...(types ?? [])].sort((a, b) => a.order - b.order)) {
      if (t.count === 0) continue
      if (modOnly && !t.modCount) continue
      if (needle && !t.label.toLowerCase().includes(needle) && !t.id.toLowerCase().includes(needle))
        continue
      const list = groups.get(t.group) ?? []
      list.push(t)
      groups.set(t.group, list)
    }
    return [...groups]
  }, [types, query, modOnly])

  let body: React.ReactNode
  if (!ready) {
    body = (
      <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
        {indexStatus.state === 'indexing' && <Spinner />}
        {indexStatus.state === 'indexing'
          ? `Indexing the game — ${indexStatus.phase ?? 'starting'}…`
          : 'Searching needs the game index. Turn it on in Settings.'}
      </p>
    )
  } else if (!type && !query) {
    // Nothing typed: the index's types, to browse
    body =
      types === null ? (
        <Spinner className="mx-auto my-6" />
      ) : (
        typeGroups.map(([group, list]) => (
          <CommandGroup key={group} heading={group}>
            {list.map((t) => (
              <CommandItem key={t.id} value={`type\u0000${t.id}`} onSelect={() => browse(t)}>
                <Boxes />
                <span className="min-w-0 flex-1 truncate">{t.label}</span>
                {!!t.modCount && (
                  <Badge variant="outline" title="Entries the loaded mods add, change or remove">
                    {t.modCount.toLocaleString()} mod
                  </Badge>
                )}
                <span className="text-muted-foreground">{t.count.toLocaleString()}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))
      )
  } else {
    // Matching types first (on the index-wide search), then the entries
    const matchingTypes = !type ? typeGroups.flatMap(([, list]) => list).slice(0, 6) : []
    body = (
      <>
        {matchingTypes.length > 0 && (
          <CommandGroup heading="Types">
            {matchingTypes.map((t) => (
              <CommandItem key={t.id} value={`type\u0000${t.id}`} onSelect={() => browse(t)}>
                <Boxes />
                <span className="min-w-0 flex-1 truncate">Browse {t.label}</span>
                <span className="text-muted-foreground">{t.count.toLocaleString()}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {type?.hasDoc && !query && (
          <CommandGroup heading="Documentation">
            <CommandItem value="doc" onSelect={() => setDoc(type)}>
              <BookText />
              The game&apos;s documentation of {type.label}
            </CommandItem>
          </CommandGroup>
        )}
        {type?.searchOnly && !query ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Too many to list — type to search {type.count.toLocaleString()} {type.label}.
          </p>
        ) : rows === null ? (
          <Spinner className="mx-auto my-6" />
        ) : (
          <CommandGroup
            heading={
              type
                ? `${type.label} · ${rows.length.toLocaleString()}`
                : `Entries${rows.length >= SEARCH_LIMIT ? ` · first ${SEARCH_LIMIT}` : ''}`
            }
          >
            {rows.slice(0, ROWS).map((r) => (
              <EntryRow key={`${r.type}\u0000${r.name}`} row={r} showType={!type} onPick={pick} />
            ))}
            {rows.length > ROWS && (
              <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
                … {(rows.length - ROWS).toLocaleString()} more — type to narrow them down
              </p>
            )}
          </CommandGroup>
        )}
        <CommandEmpty>
          {modOnly ? 'Nothing the loaded mods touch matches.' : 'No matches.'}
        </CommandEmpty>
      </>
    )
  }

  return (
    <PaletteCtx.Provider value={show}>
      {children}
      <CommandDialog
        open={open}
        onOpenChange={(o) => (o ? setOpen(true) : close())}
        title="Search the game"
        description="Every entry of the game and the loaded mods, by key or name"
        className="sm:max-w-2xl"
      >
        <Command shouldFilter={false}>
          {/* (the input first: the dialog focuses its first control) */}
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder={
              type
                ? `Filter ${type.label}…`
                : 'Search events, traits, decisions, effects, loc keys…'
            }
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !q && type) {
                e.preventDefault()
                setType(null)
              }
            }}
          />
          <CommandList className="max-h-[50vh]">{body}</CommandList>
          <div className="flex items-center gap-2 border-t px-2 py-1 text-[0.625rem] text-muted-foreground">
            {type ? (
              <Button
                variant="ghost"
                size="xs"
                title="Back to every type (Backspace in the empty search)"
                onClick={() => {
                  setType(null)
                  setQ('')
                }}
              >
                <ArrowLeft />
                All types
              </Button>
            ) : (
              <span className="px-1">
                <Kbd>↵</Kbd> opens it in its editor, or reads it
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              <Toggle
                size="sm"
                pressed={inText}
                onPressedChange={setInText}
                disabled={!!type && !type.searchOnly}
                title="Also search display names and localization text"
              >
                <FileText />
                In text
              </Toggle>
              <Toggle
                size="sm"
                pressed={modOnly}
                onPressedChange={setModOnly}
                title="Only entries the loaded mods add, change or remove"
              >
                <Layers />
                Mod only
              </Toggle>
            </span>
          </div>
        </Command>
      </CommandDialog>
      <TypeDocDialog type={doc} onClose={() => setDoc(null)} />
    </PaletteCtx.Provider>
  )
}
