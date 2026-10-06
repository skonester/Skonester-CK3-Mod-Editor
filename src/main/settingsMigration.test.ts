import { describe, expect, it } from 'vitest'
import { migrateCharacterStores } from './settingsMigration'
import type { AppSettings, CharacterDetail } from '@shared/types'

const BASE: AppSettings = {
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

const character = (id: string, name: string | null): CharacterDetail =>
  ({ id, file: 'chars.txt', name }) as CharacterDetail

describe('migrateCharacterStores', () => {
  it('leaves settings without the old keys alone', () => {
    const settings = { ...BASE, recentEntries: { cultures: { 'A.mod': [{ id: 'greek', name: 'Greek' }] } } }
    expect(migrateCharacterStores(settings)).toEqual(settings)
  })

  it('folds the character lists into the per-tool store, file as scope', () => {
    const migrated = migrateCharacterStores({
      ...BASE,
      recentCharacters: { 'A.mod': [{ file: 'chars.txt', id: '219', name: 'Alexios' }] },
      favoriteCharacters: { 'A.mod': [{ file: 'norse.txt', id: '3410', name: null }] }
    })
    expect(migrated.recentEntries.characters).toEqual({
      'A.mod': [{ id: '219', name: 'Alexios', scope: 'chars.txt' }]
    })
    expect(migrated.favoriteEntries.characters).toEqual({
      'A.mod': [{ id: '3410', name: null, scope: 'norse.txt' }]
    })
  })

  it('drops the old keys so the next save writes them out of the file', () => {
    const migrated = migrateCharacterStores({
      ...BASE,
      recentCharacters: { 'A.mod': [] },
      favoriteCharacters: {},
      draftCharacters: {}
    })
    expect('recentCharacters' in migrated).toBe(false)
    expect('favoriteCharacters' in migrated).toBe(false)
    expect('draftCharacters' in migrated).toBe(false)
  })

  it('rekeys drafts off the parse, keeping the draft and the file it came from', () => {
    const original = character('Bob', 'Bob')
    const draft = character('Bob', 'Robert')
    const migrated = migrateCharacterStores({
      ...BASE,
      draftCharacters: { 'A.mod': { 'chars.txt:Bob': { draft, original } } }
    })
    expect(migrated.entryDrafts.characters).toEqual({
      'A.mod': {
        'chars.txt:bob': { draft, original, ref: { id: 'Bob', name: 'Robert', scope: 'chars.txt' } }
      }
    })
  })

  it('keeps the other tools\u2019 entries while folding characters in', () => {
    const migrated = migrateCharacterStores({
      ...BASE,
      favoriteEntries: { titles: { 'A.mod': [{ id: 'e_mockia', name: 'Mockia' }] } },
      favoriteCharacters: { 'A.mod': [{ file: 'chars.txt', id: '219', name: 'Alexios' }] }
    })
    expect(migrated.favoriteEntries.titles).toEqual({
      'A.mod': [{ id: 'e_mockia', name: 'Mockia' }]
    })
    expect(migrated.favoriteEntries.characters?.['A.mod']).toHaveLength(1)
  })

  it('survives a settings.json whose stores are not the per-mod maps', () => {
    const migrated = migrateCharacterStores({ ...BASE, recentCharacters: ['junk'] })
    expect(migrated.recentEntries.characters).toEqual({})
  })
})
