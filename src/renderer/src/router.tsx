import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect
} from '@tanstack/react-router'
import RootLayout from './RootLayout'
import SettingsPage from './pages/SettingsPage'
import CharacterEditorPage from './pages/CharacterEditorPage'
import CultureEditorPage from './pages/CultureEditorPage'
import DynastyEditorPage from './pages/DynastyEditorPage'
import FaithEditorPage from './pages/FaithEditorPage'
import ReligionEditorPage from './pages/ReligionEditorPage'
import RiteEditorPage from './pages/RiteEditorPage'
import TitleEditorPage from './pages/TitleEditorPage'

/**
 * Deep-link target for the character editor (e.g. from a family-tree node).
 * With `create` set, the page opens the new-character panel instead of a
 * character, and the remaining fields act as prefills — so "Add child" can
 * pass the parent, or "Add member" the dynasty. `file` doubles as the
 * pre-selected target file in create mode.
 */
export interface CharacterSearch {
  file?: string
  id?: string
  create?: boolean
  name?: string
  birth?: string
  culture?: string
  faith?: string
  rite?: string
  father?: string
  mother?: string
  dynasty?: string
  house?: string
}

/**
 * Deep-link target for the dynasty editor (e.g. a character's Dynasty or
 * House field). `kind` says which list to open the id in; the page falls back
 * to the other list when the id isn't found there, so a file that puts a house
 * id under `dynasty =` still lands somewhere useful.
 *
 * With `create` set, the page opens the new-definition panel for that kind
 * instead of a row, and `dynasty` acts as a prefill — so "New house" from a
 * dynasty can pass itself as the parent.
 */
export interface DynastySearch {
  id?: string
  kind?: 'dynasty' | 'house'
  create?: 'dynasty' | 'house'
  dynasty?: string
}

/**
 * Deep-link target for the faith editor (e.g. a character's Faith field, or a
 * religion's faith list). An id that turns out to be a religion is handed over
 * to the Religion Editor. With `create` set, the page opens the new-faith
 * panel instead of a row, and `religion` prefills the parent — so "Add faith"
 * on a religion can pass itself.
 */
export interface FaithSearch {
  id?: string
  create?: boolean
  religion?: string
}

/**
 * Deep-link target for the religion editor (e.g. a faith's Religion field).
 * An id that turns out to be a faith is handed over to the Faith Editor.
 * With `create` set, the page opens the new-religion panel instead of a row.
 */
export interface ReligionSearch {
  id?: string
  create?: boolean
}

/**
 * Deep-link target for the culture editor (e.g. a character's or dynasty's
 * Culture field). An id that matches no culture falls back to the list.
 *
 * With `create` set the page opens the new-culture panel instead of a row,
 * and `from` seeds every field from an existing culture and makes it the new
 * culture's parent — which is what "Derive" on a culture passes.
 */
export interface CultureSearch {
  id?: string
  create?: boolean
  from?: string
}

/**
 * Deep-link target for the title editor (e.g. a faith's religious-head field
 * one day, or a history entry's liege). With `create` set, the page opens the
 * new-title panel instead of a title, and `parent` prefills the de jure liege
 * — which is what "Add child title" on a title passes.
 */
export interface TitleSearch {
  id?: string
  create?: boolean
  parent?: string
}

const rootRoute = createRootRoute({
  component: RootLayout
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings' })
  }
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage
})

const charactersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/characters',
  component: CharacterEditorPage,
  validateSearch: (search: Record<string, unknown>): CharacterSearch => {
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
    return {
      file: str(search.file),
      id: str(search.id),
      create: search.create === true || search.create === 'true' ? true : undefined,
      name: str(search.name),
      birth: str(search.birth),
      culture: str(search.culture),
      faith: str(search.faith),
      rite: str(search.rite),
      father: str(search.father),
      mother: str(search.mother),
      dynasty: str(search.dynasty),
      house: str(search.house)
    }
  }
})

const dynastiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dynasties',
  component: DynastyEditorPage,
  validateSearch: (search: Record<string, unknown>): DynastySearch => {
    const defKind = (v: unknown): 'dynasty' | 'house' | undefined =>
      v === 'dynasty' || v === 'house' ? v : undefined
    return {
      id: typeof search.id === 'string' ? search.id : undefined,
      kind: defKind(search.kind),
      create: defKind(search.create),
      dynasty: typeof search.dynasty === 'string' ? search.dynasty : undefined
    }
  }
})

const faithsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/faiths',
  component: FaithEditorPage,
  validateSearch: (search: Record<string, unknown>): FaithSearch => ({
    id: typeof search.id === 'string' ? search.id : undefined,
    create: search.create === true || search.create === 'true' ? true : undefined,
    religion: typeof search.religion === 'string' ? search.religion : undefined
  })
})

const religionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/religions',
  component: ReligionEditorPage,
  validateSearch: (search: Record<string, unknown>): ReligionSearch => ({
    id: typeof search.id === 'string' ? search.id : undefined,
    create: search.create === true || search.create === 'true' ? true : undefined
  })
})

const ritesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rites',
  component: RiteEditorPage,
  validateSearch: (
    search: Record<string, unknown>
  ): { id?: string; create?: boolean; faith?: string } => ({
    id: typeof search.id === 'string' ? search.id : undefined,
    create: search.create === true || search.create === 'true' ? true : undefined,
    faith: typeof search.faith === 'string' ? search.faith : undefined
  })
})

const culturesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cultures',
  component: CultureEditorPage,
  validateSearch: (search: Record<string, unknown>): CultureSearch => {
    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
    return {
      id: str(search.id),
      create: search.create === true || search.create === 'true' ? true : undefined,
      from: str(search.from)
    }
  }
})

const titlesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/titles',
  component: TitleEditorPage,
  validateSearch: (search: Record<string, unknown>): TitleSearch => ({
    id: typeof search.id === 'string' ? search.id : undefined,
    create: search.create === true || search.create === 'true' ? true : undefined,
    parent: typeof search.parent === 'string' ? search.parent : undefined
  })
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  settingsRoute,
  charactersRoute,
  dynastiesRoute,
  titlesRoute,
  faithsRoute,
  ritesRoute,
  religionsRoute,
  culturesRoute
])

// Hash history keeps routing working when the packaged app loads index.html from file://
export const router = createRouter({
  routeTree,
  history: createHashHistory()
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
