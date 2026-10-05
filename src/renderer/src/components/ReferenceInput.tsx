import { useMemo, useRef, useState } from 'react'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Combobox as ComboboxPrimitive } from '@base-ui/react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import type { RefEntry, RefLocation } from '@shared/types'
import ReferenceLabel, { findRef, refLabel } from './ReferenceLabel'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from '@/components/ui/combobox'
import { cn } from '@/lib/utils'

/** Locate a reference's definition and open it in the user's text editor. */
export async function openReferenceTarget(
  locate: () => Promise<RefLocation | null>,
  label: string
): Promise<void> {
  const loc = await locate()
  if (!loc) {
    toast.error(`Couldn't find where "${label}" is defined`)
    return
  }
  const result = await window.ck3tools.openInEditor(loc.path, loc.line)
  if (!result.ok) toast.error(result.error)
}

interface Props {
  /** Single-value mode: the id of the current selection. Omit when using onAdd. */
  value?: string | null
  onChange?: (value: string | null) => void
  /**
   * Add mode (multi-value fields like traits): selecting an option calls this
   * and resets the input, so several entries can be added in a row. The follow
   * button is omitted — a committed value never lingers in the input; put a
   * ReferenceBadge on the added entries instead.
   */
  onAdd?: (value: string) => void
  /**
   * The selectable references. Entries carrying a name are listed and filtered
   * as "Name (id)", so typing either half finds them; name-less ones fall back
   * to the bare id.
   */
  options: readonly RefEntry[]
  placeholder?: string
  /**
   * Managed data: the button switches to the referenced item inside the app
   * (e.g. a father/mother field jumping to that character).
   */
  onNavigate?: (value: string) => void
  /**
   * Unmanaged data: the button locates the defining file and opens it in the
   * user's text editor. Ignored when onNavigate is provided.
   */
  locate?: (value: string) => Promise<RefLocation | null>
  /**
   * Custom option rendering (e.g. trait icons); defaults to a ReferenceLabel.
   * The list is virtualized, so this only runs for the rows in view.
   */
  renderItem?: (item: RefEntry) => React.ReactNode
  /** Tooltip for the follow button; defaults to wording for a definition site. */
  followTitle?: string
  /**
   * Read-only mode for a field whose entity can't be edited (a base-game
   * definition). The follow button stays live — going to where a value is
   * defined is exactly what you want when you can't change it here.
   */
  disabled?: boolean
  className?: string
}

export default function ReferenceInput({
  value = null,
  onChange,
  onAdd,
  options,
  placeholder,
  onNavigate,
  locate,
  renderItem,
  followTitle,
  disabled = false,
  className
}: Props): React.JSX.Element {
  const [opening, setOpening] = useState(false)
  const [inputText, setInputText] = useState('')
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null)
  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, Element> | null>(null)

  // Keep a value that isn't in the reference lists (typo, unscanned file) visible
  const items = useMemo(
    () =>
      value !== null && !options.some((o) => o.id === value)
        ? [findRef(options, value), ...options]
        : options,
    [options, value]
  )
  const selected = value === null ? null : findRef(items, value)

  const follow = async (): Promise<void> => {
    if (!value) return
    if (onNavigate) {
      onNavigate(value)
      return
    }
    if (!locate) return
    setOpening(true)
    try {
      await openReferenceTarget(() => locate(value), value)
    } finally {
      setOpening(false)
    }
  }

  const select = (v: RefEntry | null): void => {
    if (onAdd) {
      if (v) onAdd(v.id)
      setInputText('')
      return
    }
    onChange?.(v?.id ?? null)
  }

  const showFollow = !onAdd && Boolean(onNavigate ?? locate)

  return (
    <ButtonGroup className={cn('w-full', className)}>
      <Combobox
        items={items as RefEntry[]}
        // Mod lists (dynasties, titles) run to thousands, so only the rows in
        // view are rendered; every option stays reachable by scrolling.
        virtualized
        onItemHighlighted={(_, { reason, index }) => {
          // Keyboard navigation can land on a row that isn't rendered yet
          if (reason === 'pointer' || index < 0) return
          virtualizerRef.current?.scrollToIndex(index)
        }}
        value={onAdd ? null : selected}
        onValueChange={select}
        // Options are objects, so the combobox needs telling how to turn one
        // into text (this is also what it filters on) and how to match the
        // selected value back to its item — they aren't the same reference.
        itemToStringLabel={refLabel}
        isItemEqualToValue={(item: RefEntry, v: RefEntry) => item.id === v.id}
        inputValue={onAdd ? inputText : undefined}
        onInputValueChange={(text, details) => {
          // In add mode, selecting an item syncs the label back into the input;
          // ignore that so the reset in select() sticks and only typing counts
          if (onAdd && details.reason !== 'input-change') return
          setInputText(text)
        }}
      >
        <ComboboxInput
          className="flex-1"
          placeholder={placeholder}
          showClear={!onAdd}
          disabled={disabled}
        />
        <ComboboxContent>
          <ComboboxEmpty>No matches.</ComboboxEmpty>
          <ComboboxList ref={setListEl}>
            <VirtualItems
              scrollElement={listEl}
              virtualizerRef={virtualizerRef}
              renderItem={renderItem}
            />
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {showFollow && (
        <Button
          variant="outline"
          size="icon"
          disabled={!value || opening}
          title={followTitle ?? (onNavigate ? 'Go to this entry' : 'Open definition in text editor')}
          onClick={follow}
        >
          {onNavigate ? <ArrowRight /> : <ExternalLink />}
        </Button>
      )}
    </ButtonGroup>
  )
}

/** The filtered options, rendering only the rows scrolled into view. */
function VirtualItems({
  scrollElement,
  virtualizerRef,
  renderItem
}: {
  scrollElement: HTMLDivElement | null
  virtualizerRef: React.RefObject<Virtualizer<HTMLDivElement, Element> | null>
  renderItem?: (item: RefEntry) => React.ReactNode
}): React.JSX.Element | null {
  const filtered = ComboboxPrimitive.useFilteredItems<RefEntry>()
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 28,
    overscan: 12
  })
  virtualizerRef.current = virtualizer

  if (filtered.length === 0) return null
  return (
    <div role="presentation" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => {
        const item = filtered[row.index]
        return (
          <ComboboxItem
            key={row.key}
            index={row.index}
            value={item}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {renderItem ? renderItem(item) : <ReferenceLabel entry={item} />}
          </ComboboxItem>
        )
      })}
    </div>
  )
}
