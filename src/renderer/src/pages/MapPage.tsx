import { lazy, Suspense } from 'react'
import { useSearch } from '@tanstack/react-router'
import { Spinner } from '@/components/ui/spinner'

// three.js, the WebGL map code and its shaders load with the page
const GameMap = lazy(() => import('../components/map/GameMap'))

/**
 * The game's map in 2D and 3D at any history date — realms, de jure titles,
 * cultures, faiths, terrain — as the game plus the selected mod lay it out.
 * `focus` ("landed_titles:k_jerusalem") opens on an entry: "Show on map".
 */
export default function MapPage(): React.JSX.Element {
  const { focus } = useSearch({ from: '/map' })
  return (
    <div className="flex h-full flex-col">
      <header className="px-6 pt-5 pb-3">
        <h1 className="font-heading text-2xl font-semibold">Map</h1>
      </header>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <GameMap focus={focus} />
      </Suspense>
    </div>
  )
}
