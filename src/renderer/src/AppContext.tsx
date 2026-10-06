import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useModFonts } from './useModFonts'
import { setGraphics } from '@crusaderpope/renderer/src/graphics'
import type { AppSettings, IndexStatus, ModFonts, ModInfo, UndoStep } from '@shared/types'

interface AppContextValue {
  settings: AppSettings | null
  mods: ModInfo[]
  selectedMod: ModInfo | null
  /** The mod fonts the app is currently dressed in; null when it uses its own */
  modFonts: ModFonts | null
  /** The game index (game + selected mod) behind every editor's References section */
  indexStatus: IndexStatus
  /** Build the game index again — after an error, or to pick up changes it missed */
  reindex: () => void
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  refreshMods: () => Promise<void>
  /**
   * Bumped when files of the selected mod change under the editors — an undo,
   * an edit from the map, the Barbershop: the editors read their data again.
   */
  dataRevision: number
  /** The selected mod's undoable changes, newest first */
  undoSteps: UndoStep[]
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [mods, setMods] = useState<ModInfo[]>([])
  const [indexStatus, setIndexStatus] = useState<IndexStatus>({ state: 'idle' })
  const [dataRevision, setDataRevision] = useState(0)
  const [undoSteps, setUndoSteps] = useState<UndoStep[]>([])

  // Settings the main process changed (the Mods page set the active mod, a list …),
  // files changed under the editors, and the undo history
  useEffect(() => {
    const offSettings = window.ck3tools.onSettingsChanged(setSettings)
    const offFiles = window.ck3tools.onModFilesChanged(() => setDataRevision((n) => n + 1))
    const offUndo = window.ck3tools.onUndoChanged(setUndoSteps)
    return () => {
      offSettings()
      offFiles()
      offUndo()
    }
  }, [])

  // Initial load: read settings, auto-detect any missing paths once
  useEffect(() => {
    ;(async () => {
      let s = await window.ck3tools.getSettings()
      if (!s.gameDir || !s.modDir) {
        const detected = await window.ck3tools.detectPaths()
        const patch: Partial<AppSettings> = {}
        if (!s.gameDir && detected.gameDir) patch.gameDir = detected.gameDir
        if (!s.modDir && detected.modDir) patch.modDir = detected.modDir
        if (Object.keys(patch).length > 0) {
          s = await window.ck3tools.setSettings(patch)
        }
      }
      setSettings(s)
    })()
  }, [])

  /** The mod directory `mods` was listed from; undefined until the first listing */
  const [modsFrom, setModsFrom] = useState<string | null | undefined>(undefined)

  // Reload mod list whenever the mod directory changes
  useEffect(() => {
    const dir = settings?.modDir ?? null
    if (dir) {
      window.ck3tools.listMods(dir).then((list) => {
        setMods(list)
        setModsFrom(dir)
      })
    } else {
      setMods([])
      setModsFrom(null)
    }
  }, [settings?.modDir])

  const selectedMod = mods.find((m) => m.file === settings?.selectedModFile) ?? null
  // Another mod, another history
  useEffect(() => {
    void window.ck3tools.listUndo().then(setUndoSteps)
  }, [settings?.selectedModFile])
  // The 3D views read the graphics settings when they open
  setGraphics(settings?.graphics)

  const modFonts = useModFonts(
    settings?.useModFonts ?? false,
    settings?.gameDir ?? null,
    selectedMod?.path ?? null,
    selectedMod?.replacePaths ?? []
  )

  useEffect(() => {
    void window.ck3tools.getGameIndexStatus().then(setIndexStatus)
    return window.ck3tools.onGameIndexStatus(setIndexStatus)
  }, [])

  // (Re)build the index whenever what it layers changes; main skips a build
  // it already has, so a fresh mod list with the same mod costs nothing
  const indexEnabled = settings !== null && settings.gameIndex !== false
  const gameDir = settings?.gameDir ?? null
  // (the mod list the index loads is part of it — chosen on the Mods page)
  const indexedMod = JSON.stringify([
    selectedMod && [selectedMod.file, selectedMod.path, selectedMod.replacePaths],
    settings?.modManager?.modList ?? null
  ])
  // Wait for the mod list first, or startup would index the game alone and
  // then all over again with the mod
  const modsListed = settings !== null && modsFrom === (settings.modDir ?? null)
  useEffect(() => {
    if (!modsListed) return
    void window.ck3tools.ensureGameIndex(gameDir, selectedMod, indexEnabled)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modsListed, gameDir, indexedMod, indexEnabled])

  const reindex = useCallback(() => {
    void window.ck3tools.ensureGameIndex(gameDir, selectedMod, indexEnabled, true)
  }, [gameDir, selectedMod, indexEnabled])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await window.ck3tools.setSettings(patch)
    setSettings(next)
  }, [])

  const refreshMods = useCallback(async () => {
    if (settings?.modDir) {
      setMods(await window.ck3tools.listMods(settings.modDir))
    }
  }, [settings?.modDir])

  return (
    <AppContext.Provider
      value={{
        settings,
        mods,
        selectedMod,
        modFonts,
        indexStatus,
        reindex,
        updateSettings,
        refreshMods,
        dataRevision,
        undoSteps
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
