import { useState } from 'react'
import { cn } from '@/lib/utils'

/** ck3:// URL of a game image (DDS/PNG decoded by the main process), at most `w` px on its longer side */
export const gameImageUrl = (path: string, w?: number): string =>
  `ck3://img/${path.split('/').map(encodeURIComponent).join('/')}${w ? `?w=${w}` : ''}`

/**
 * A game image as a small square — an entry's icon, a texture's thumbnail —
 * or `fallback` when there is none or it doesn't load. Unlike CrusaderPope's
 * GameImg it doesn't touch `window.api`, so eagerly loaded views can use it.
 */
export default function GameThumb({
  path,
  size,
  className,
  fallback = null
}: {
  path?: string
  /** CSS pixels; the image is fetched at twice that for sharp HiDPI */
  size: number
  className?: string
  fallback?: React.ReactNode
}): React.JSX.Element | null {
  const [failed, setFailed] = useState<string | null>(null)
  if (!path || failed === path) return <>{fallback}</>
  return (
    <img
      src={gameImageUrl(path, Math.min(1024, size * 2))}
      alt=""
      loading="lazy"
      draggable={false}
      style={{ width: size, height: size }}
      className={cn('shrink-0 object-contain', className)}
      onError={() => setFailed(path)}
    />
  )
}
