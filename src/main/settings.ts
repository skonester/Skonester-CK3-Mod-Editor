import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { migrateCharacterStores } from './settingsMigration'
import type { AppSettings } from '@shared/types'

const DEFAULTS: AppSettings = {
  gameDir: null,
  modDir: null,
  selectedModFile: null,
  recentEntries: {},
  favoriteEntries: {},
  entryDrafts: {},
  textEditorPath: null,
  useModFonts: true,
  gameIndex: true
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf-8')
    return migrateCharacterStores({ ...DEFAULTS, ...JSON.parse(raw) })
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const merged = { ...loadSettings(), ...patch }
  const file = settingsPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}
