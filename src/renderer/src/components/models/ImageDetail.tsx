import { useEffect, useState } from 'react'
import { GameImg } from '@crusaderpope/renderer/src/img'
import { useGfxRevision } from '@crusaderpope/renderer/src/revision'
import EntityReferencesSection from '../EntityReferencesSection'
import FormSection from '../FormSection'
import AssetMenu from './AssetMenu'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/** How the picture is shown: as it is, without alpha, or its alpha alone (packed data maps hide in it) */
type Channel = 'rgba' | 'rgb' | 'a'

/**
 * One image of the game or the mod: the picture, its size, the menu to export
 * it or replace it in the mod, the models whose materials use it, and what
 * refers to it (gui, script icons …).
 */
export default function ImageDetail({
  path,
  onOpenModel
}: {
  path: string
  onOpenModel: (path: string) => void
}): React.JSX.Element {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [channel, setChannel] = useState<Channel>('rgba')
  const [users, setUsers] = useState<{ asset: string; pdxmesh: string; role: string }[] | null>(null)
  // Again after an update that changed gfx files (a replaced texture)
  const gfx = useGfxRevision()

  useEffect(() => setSize(null), [path, gfx])
  useEffect(() => {
    let live = true
    void window.api.textureUsers(path).then((u) => live && setUsers(u))
    return () => {
      live = false
    }
  }, [path, gfx])

  return (
    <div className="flex flex-col gap-4 p-5">
      <header className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground uppercase">
          Image{size ? ` · ${size.w}×${size.h}` : ''}
        </span>
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 truncate font-heading text-xl font-semibold">{base(path)}</h2>
          <AssetMenu path={path} />
        </div>
        <span className="font-mono text-xs break-all text-muted-foreground">{path}</span>
      </header>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={channel}
        onValueChange={(v) => v && setChannel(v as Channel)}
      >
        <ToggleGroupItem value="rgba">As it is</ToggleGroupItem>
        <ToggleGroupItem value="rgb" title="Colour without transparency">
          RGB
        </ToggleGroupItem>
        <ToggleGroupItem value="a" title="The alpha channel as grey — packed data maps keep values there">
          Alpha
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 p-2">
        {/* (full size, fitted: the protocol scales nothing without a width) */}
        <GameImg
          key={`${path}:${gfx}`}
          path={path}
          ch={channel === 'rgba' ? undefined : channel}
          className="max-h-[60vh] max-w-full object-contain"
        />
        <img
          src={`ck3://img/${path.split('/').map(encodeURIComponent).join('/')}`}
          alt=""
          className="hidden"
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      </div>
      {users !== null && users.length > 0 && (
        <FormSection title={`Used by models · ${users.length}`}>
          <div className="flex flex-col gap-0.5 text-sm">
            {users.map((u, i) => (
              <span key={i} className="flex items-baseline gap-2">
                <Button variant="link" size="xs" className="h-auto p-0" onClick={() => onOpenModel(u.asset)}>
                  {base(u.asset)}
                </Button>
                <span className="font-mono text-xs text-muted-foreground">{u.pdxmesh}</span>
                <span className="text-xs text-muted-foreground">· {u.role}</span>
              </span>
            ))}
          </div>
        </FormSection>
      )}
      <EntityReferencesSection type="images" id={path} />
    </div>
  )
}
