import { useEffect, useMemo, useState } from 'react'
import type { GalleryFile } from '@crusaderpope/shared/api'
import { GameImg } from '@crusaderpope/renderer/src/img'
import { modTouchLabel } from '@/lib/indexLinks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/** Tiles drawn at first (more on request) */
const TILES = 300

/**
 * The pictures of one folder as thumbnails (CrusaderPope's image gallery):
 * what the game and the loaded mods have there, the mod's files marked.
 * Pictures a mod's replace_path removed are left out — the game with the
 * mods has no such file.
 */
export default function ImageGrid({
  folder,
  selected,
  filter,
  revision,
  onPick,
  onCount
}: {
  folder: string
  selected?: string
  filter: string
  /** the index's revision: the folder is read again after an update */
  revision: number
  onPick: (path: string) => void
  onCount: (n: number | null) => void
}): React.JSX.Element {
  const [items, setItems] = useState<GalleryFile[] | null>(null)
  const [limit, setLimit] = useState(TILES)

  useEffect(() => {
    setItems(null)
    setLimit(TILES)
  }, [folder])
  useEffect(() => {
    let live = true
    void window.api.filesIn('images', folder).then((l) => live && setItems(l.filter((i) => !i.removed)))
    return () => {
      live = false
    }
  }, [folder, revision])
  useEffect(() => onCount(items?.length ?? null), [items, onCount])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (items ?? []).filter((i) => !q || i.file.toLowerCase().includes(q))
  }, [items, filter])

  if (items === null) return <Spinner className="m-2" />
  if (shown.length === 0) return <p className="p-2 text-sm text-muted-foreground">No images here.</p>

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-1.5">
        {shown.slice(0, limit).map((i) => {
          const touch = modTouchLabel(i.touch)
          return (
            <button
              key={i.name}
              type="button"
              title={touch ? `${i.name}\n${touch.label}` : i.name}
              onClick={() => onPick(i.name)}
              className={cn(
                'relative flex flex-col items-center gap-1 rounded-md border p-1 text-left hover:bg-accent',
                i.name === selected && 'border-primary bg-accent'
              )}
            >
              <span className="flex size-20 items-center justify-center overflow-hidden rounded-sm bg-muted/40">
                <GameImg path={i.name} size={80} className="max-h-full max-w-full object-contain" />
              </span>
              <span className="w-full truncate text-center text-[0.625rem]">
                {i.file.replace(/\.(dds|png|tga)$/i, '')}
              </span>
              {touch && (
                <Badge variant="secondary" className="absolute top-1 left-1 h-4 px-1 text-[0.5625rem]">
                  mod
                </Badge>
              )}
            </button>
          )
        })}
      </div>
      {shown.length > limit && (
        <Button variant="outline" size="xs" className="mt-2" onClick={() => setLimit((l) => l + 600)}>
          Show more ({(shown.length - limit).toLocaleString()} left)
        </Button>
      )}
    </>
  )
}
