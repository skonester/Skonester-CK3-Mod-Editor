import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Box, Folder } from 'lucide-react'
import type { GalleryFolder, ModelFolderItem } from '@crusaderpope/shared/api'
import { useApp } from '../AppContext'
import { modTouchLabel } from '@/lib/indexLinks'
import { assetTarget } from '@/lib/assetLinks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

// three.js, the game-shader code and the Blender bar load with the first model opened
const ModelDetail = lazy(() => import('../components/models/ModelDetail'))
// (CrusaderPope's image helpers read its bridge at load, as the model views do)
const ImageGrid = lazy(() => import('../components/models/ImageGrid'))
const ImageDetail = lazy(() => import('../components/models/ImageDetail'))
// (CrusaderPope's bridge is read at load: imported only once the preload has run)
const bridge = (): typeof window.api => window.api

/** Rows drawn at most per list (the filter finds the rest) */
const ROWS = 400

/** A model's thumbnail: its diffuse texture, served by the image protocol */
function Thumb({ path }: { path?: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (!path || failed) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded border bg-muted/40">
        <Box className="size-4 text-muted-foreground" />
      </span>
    )
  }
  const src = `ck3://img/${path.split('/').map(encodeURIComponent).join('/')}?w=80`
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      className="size-10 shrink-0 rounded border object-cover"
      onError={() => setFailed(true)}
    />
  )
}

/**
 * Every 3D model and image the game and the selected mod load, by folder:
 * gfx/ .asset and .mesh files with a preview drawn with the game's shaders,
 * what each is made of and the Blender round trip (export as glTF, import
 * back into the mod); textures and icons as thumbnails, each with the models
 * using it. Any of them can be exported, or replaced in the mod with a file
 * of one's own. Ported from CrusaderPope's model and image galleries.
 */
export default function ModelsPage(): React.JSX.Element {
  const { indexStatus } = useApp()
  const { kind, folder, path } = useSearch({ from: '/models' })
  const images = kind === 'images'
  const [imageCount, setImageCount] = useState<number | null>(null)
  const onImageCount = useCallback((n: number | null) => setImageCount(n), [])
  const navigate = useNavigate()
  const revision = indexStatus.state === 'ready' ? (indexStatus.revision ?? 0) : null
  const [folders, setFolders] = useState<GalleryFolder[] | null>(null)
  const [items, setItems] = useState<ModelFolderItem[] | null>(null)
  const [folderFilter, setFolderFilter] = useState('')
  const [itemFilter, setItemFilter] = useState('')

  useEffect(() => {
    if (revision === null) return
    let live = true
    setFolders(null)
    void bridge()
      .fileFolders(images ? 'images' : 'models')
      .then((f) => live && setFolders(f))
    return () => {
      live = false
    }
  }, [revision, images])

  useEffect(() => {
    setItems(null)
    if (revision === null || !folder || images) return
    let live = true
    void bridge()
      .modelFolder(folder)
      .then((list) => live && setItems(list))
    return () => {
      live = false
    }
  }, [folder, revision, images])

  const shownFolders = useMemo(() => {
    const q = folderFilter.trim().toLowerCase()
    return (folders ?? []).filter((f) => !q || f.folder.toLowerCase().includes(q))
  }, [folders, folderFilter])
  const shownItems = useMemo(() => {
    const q = itemFilter.trim().toLowerCase()
    return (items ?? []).filter((i) => !q || i.file.toLowerCase().includes(q))
  }, [items, itemFilter])

  const go = (next: { folder?: string; path?: string }): void =>
    void navigate({ to: '/models', search: { kind, folder, path, ...next } })
  /** A model or image linked from another (an asset's mesh file, a texture's model): its folder opens with it */
  const openModel = (p: string): void => void navigate(assetTarget(p))

  if (revision === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        {indexStatus.state === 'indexing' && <Spinner />}
        {indexStatus.state === 'indexing'
          ? `Indexing the game — ${indexStatus.phase ?? 'starting'}…`
          : 'The model browser needs the game index. Turn it on in Settings.'}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 px-6 pt-5 pb-3">
        <h1 className="font-heading text-2xl font-semibold">{images ? 'Images' : '3D Models'}</h1>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={images ? 'images' : 'models'}
          onValueChange={(v) =>
            v &&
            void navigate({ to: '/models', search: v === 'images' ? { kind: 'images' } : {} })
          }
        >
          <ToggleGroupItem value="models">3D Models</ToggleGroupItem>
          <ToggleGroupItem value="images">Images</ToggleGroupItem>
        </ToggleGroup>
      </header>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 border-t">
        <ResizablePanel defaultSize="22%" minSize="14%" className="flex min-h-0 flex-col gap-2 p-3">
          <Input
            className="h-8"
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value)}
            placeholder={`Filter ${folders?.length ?? ''} folders…`}
          />
          {/* (a plain scroller: ScrollArea sizes its content to the widest row, so rows wouldn't truncate) */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {folders === null && <Spinner className="m-2" />}
            {shownFolders.slice(0, ROWS).map((f) => (
              <Button
                key={f.folder}
                variant="ghost"
                size="xs"
                className={cn(
                  'w-full justify-start gap-2 font-normal',
                  f.folder === folder && 'bg-accent'
                )}
                title={f.folder}
                onClick={() => go({ folder: f.folder, path: undefined })}
              >
                <Folder className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {f.folder.replace(/^gfx\//, '')}
                </span>
                {!!f.modCount && <Badge variant="outline">{f.modCount} mod</Badge>}
                <span className="text-muted-foreground">{f.count}</span>
              </Button>
            ))}
            {shownFolders.length > ROWS && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                … {shownFolders.length - ROWS} more (filter to find them)
              </p>
            )}
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="26%" minSize="16%" className="flex min-h-0 flex-col gap-2 p-3">
          {!folder ? (
            <p className="p-2 text-sm text-muted-foreground">Pick a folder.</p>
          ) : (
            <>
              <Input
                className="h-8"
                value={itemFilter}
                onChange={(e) => setItemFilter(e.target.value)}
                placeholder={
                  images
                    ? `Filter ${imageCount ?? ''} images…`
                    : `Filter ${items?.length ?? ''} models…`
                }
              />
              <div className="min-h-0 flex-1 overflow-y-auto">
                {images && revision !== null && (
                  <Suspense fallback={<Spinner className="m-2" />}>
                    <ImageGrid
                      folder={folder}
                      selected={path}
                      filter={itemFilter}
                      revision={revision}
                      onPick={(p) => go({ path: p })}
                      onCount={onImageCount}
                    />
                  </Suspense>
                )}
                {!images && items === null && <Spinner className="m-2" />}
                {shownItems.slice(0, ROWS).map((m) => {
                  const touch = modTouchLabel(m.touch)
                  return (
                    <Button
                      key={m.name}
                      variant="ghost"
                      className={cn(
                        'h-auto w-full justify-start gap-2 py-1.5 font-normal',
                        m.name === path && 'bg-accent'
                      )}
                      title={m.name}
                      onClick={() => go({ path: m.name })}
                    >
                      <Thumb path={m.thumb} />
                      <span className="flex min-w-0 flex-1 flex-col text-left">
                        <span className="truncate text-sm">
                          {m.file.replace(/\.(asset|mesh)$/i, '')}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {m.kind}
                          {m.summary ? ` · ${m.summary}` : ''}
                        </span>
                      </span>
                      {touch && (
                        <Badge variant="outline" title={touch.detail}>
                          {touch.label}
                        </Badge>
                      )}
                    </Button>
                  )
                })}
                {!images && items !== null && shownItems.length === 0 && (
                  <p className="p-2 text-sm text-muted-foreground">No models here.</p>
                )}
              </div>
            </>
          )}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel minSize="30%" className="min-h-0">
          <div className="h-full overflow-y-auto">
            {path ? (
              <Suspense fallback={<Spinner className="m-6" />}>
                {images ? (
                  <ImageDetail path={path} onOpenModel={openModel} />
                ) : (
                  <ModelDetail path={path} onOpenModel={openModel} />
                )}
              </Suspense>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                {images ? 'Pick an image.' : 'Pick a model to see it in 3D.'}
              </p>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
