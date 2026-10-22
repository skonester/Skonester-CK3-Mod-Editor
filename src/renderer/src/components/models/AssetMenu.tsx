import { useEffect, useState } from 'react'
import { Download, Ellipsis, FileDown, ImageDown, Replace, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AssetOverride, ImageSource, PickedImage } from '@crusaderpope/shared/api'
import { imgUrl } from '@crusaderpope/renderer/src/img'
import { useApp } from '../../AppContext'
import ImageCropDialog from './ImageCropDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'

const base = (p: string): string => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)

/** A picture's pixel size, or 0×0 when it doesn't load */
const sizeOf = (src: string): Promise<{ w: number; h: number }> =>
  new Promise((resolve) => {
    const el = new Image()
    el.onload = () => resolve({ w: el.naturalWidth, h: el.naturalHeight })
    el.onerror = () => resolve({ w: 0, h: 0 })
    el.src = src
  })

/**
 * An asset's menu (a texture, a mesh, an .asset's pdxmesh — CrusaderPope's
 * asset menu): export its file as it is, a texture as PNG, a mesh as glTF for
 * Blender; replace it in the selected mod with a file of one's own — converted
 * to the asset's format and saved under its path and name, a picture cropped
 * and turned first if wanted — or take the mod's own copy away again. Every
 * change is one undo step.
 */
export default function AssetMenu({
  path,
  pdxmesh,
  variant = 'outline'
}: {
  path: string
  pdxmesh?: string
  variant?: 'outline' | 'ghost'
}): React.JSX.Element {
  const { selectedMod } = useApp()
  const mesh = /\.(mesh|asset)$/i.test(path)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // The selected mod's own file for the asset, read as the menu opens
  const [own, setOwn] = useState<AssetOverride | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [cropping, setCropping] = useState<{ pic: PickedImage; w: number; h: number } | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    window.api.assetOverride(path, pdxmesh).then(
      (o) => live && setOwn(o),
      () => live && setOwn(null)
    )
    return () => {
      live = false
    }
  }, [open, path, pdxmesh, selectedMod?.file])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const exportAs = (as: 'original' | 'png' | 'gltf'): Promise<void> =>
    run(async () => {
      try {
        const r = await window.api.exportAsset(path, as, pdxmesh)
        if (!r) return
        toast.success(as === 'gltf' ? 'Exported for Blender' : as === 'png' ? 'Exported as PNG' : 'Exported', {
          description: [
            r.file,
            ...(as === 'gltf'
              ? [
                  'In Blender: File › Import › glTF 2.0; bring it back with Replace with a file… or Import from Blender…',
                  ...(r.gltf?.warnings ?? []).map((w) => `⚠ ${w}`)
                ]
              : [])
          ].join('\n'),
          duration: 10000,
          action: { label: 'Reveal', onClick: () => void window.api.revealFile(r.file) }
        })
      } catch (e) {
        toast.error('Export failed', { description: (e as Error).message })
      }
    })

  const replaceNow = (source?: ImageSource): Promise<void> =>
    run(async () => {
      setCropping(null)
      try {
        const r = await window.api.replaceAsset(path, pdxmesh, source)
        if (!r) return
        const first = r.files[0]
        toast.success(`Replaced ${base(first?.rel ?? path)} in ${r.mod.name} with ${base(r.source)}`, {
          description: [
            ...r.files.map((f) => `${f.rel} — ${f.what}`),
            ...r.notes,
            ...r.warnings.map((w) => `⚠ ${w}`)
          ].join('\n'),
          duration: 12000,
          action: first ? { label: 'Reveal', onClick: () => void window.api.revealFile(first.abs) } : undefined
        })
      } catch (e) {
        toast.error('Not replaced', { description: (e as Error).message })
      }
    })

  // A texture: the picked picture goes through the crop dialog, at the texture's own size
  const pickTexture = (): Promise<void> =>
    run(async () => {
      try {
        const pic = await window.api.pickImage(`Replace ${base(path)} — saved under that name, converted to its format`)
        if (!pic) return
        let size = await sizeOf(imgUrl(path))
        // (the texture's size unknown: the picked picture's own, cropped at its proportions)
        if (!size.w || !size.h) {
          const url = URL.createObjectURL(new Blob([pic.data as BlobPart], { type: pic.mime }))
          size = await sizeOf(url)
          URL.revokeObjectURL(url)
          size = { w: size.w || 1024, h: size.h || 1024 }
        }
        setCropping({ pic, ...size })
      } catch (e) {
        toast.error('Not replaced', { description: (e as Error).message })
      }
    })

  const removeOverride = (): Promise<void> =>
    run(async () => {
      try {
        const r = await window.api.removeAssetOverride(path, pdxmesh)
        toast.success(`Removed ${base(r.rel)} from ${r.mod}`, {
          description: `It's in the recycle bin; the game's ${base(r.rel)} counts again.`
        })
      } catch (e) {
        toast.error('Not removed', { description: (e as Error).message })
      }
    })

  const noMod = !selectedMod?.path ? 'Select a mod to write into first.' : undefined

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size="xs"
            disabled={busy}
            title={mesh ? 'Export or replace this mesh' : 'Export or replace this texture'}
          >
            {busy ? <Spinner /> : <Ellipsis />}
            {variant === 'outline' && 'File'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {mesh ? (
            <>
              <DropdownMenuItem onSelect={() => void exportAs('gltf')}>
                <Download />
                Export for Blender (glTF)…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportAs('original')}>
                <FileDown />
                Export the .mesh file…
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!!noMod}
                title={noMod ?? 'A .mesh, or a glTF / GLB from Blender — saved in the mod under this mesh’s path and name'}
                onSelect={() => void replaceNow()}
              >
                <Replace />
                Replace with a file…
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onSelect={() => void exportAs('png')}>
                <ImageDown />
                Export as PNG…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportAs('original')}>
                <FileDown />
                Export the file (.{path.split('.').pop()})…
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!!noMod}
                title={
                  noMod ??
                  'A PNG, DDS, JPEG or WebP — cropped and turned if wanted, converted to this texture’s format and saved in the mod under its path and name'
                }
                onSelect={() => void pickTexture()}
              >
                <Replace />
                Replace with a file…
              </DropdownMenuItem>
            </>
          )}
          {own?.file && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
                <Trash2 />
                Remove {own.mod}&apos;s copy…
              </DropdownMenuItem>
            </>
          )}
          {selectedMod && !noMod && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {own === null
                  ? 'Checking the mod…'
                  : own.file
                    ? `${own.mod} has its own ${base(own.rel)}`
                    : `Replacing writes into ${selectedMod.name}`}
              </DropdownMenuLabel>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {own?.mod}&apos;s copy?</AlertDialogTitle>
            <AlertDialogDescription>
              {own?.file} goes to the recycle bin, and the game&apos;s {own && base(own.rel)} counts
              again. Undo brings it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void removeOverride()}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {cropping && (
        <ImageCropDialog
          image={cropping.pic}
          out={{ w: cropping.w, h: cropping.h }}
          title={`Replace ${base(path)}: crop and turn`}
          note={`The frame keeps the texture's shape (${cropping.w}×${cropping.h}); the result is converted to its format and saved in ${selectedMod?.name ?? 'the mod'} under its path and name.`}
          onDone={(png) => void replaceNow({ png, name: cropping.pic.name })}
          onAsIs={() => void replaceNow({ file: cropping.pic.file })}
          onCancel={() => setCropping(null)}
        />
      )}
    </>
  )
}
