import { describe, expect, it } from 'vitest'
import type { CharacterDetail } from '@shared/types'
import { normalizeCharacterDraft } from './characterDraft'

const current: CharacterDetail = {
  id: '1',
  file: 'people.txt',
  name: 'A',
  dynasty: null,
  house: null,
  birth: '800.1.1',
  death: null,
  culture: 'italian',
  faith: null,
  rite: 'roman_rite',
  father: null,
  mother: null,
  traits: [],
  spouses: [],
  relations: [],
  stats: {
    diplomacy: null,
    martial: null,
    stewardship: null,
    intrigue: null,
    learning: null,
    prowess: null
  },
  female: null,
  sexuality: null,
  dna: null
}

describe('character drafts saved before rite support', () => {
  it('inherits the existing rite without making a clean older draft dirty or stale', () => {
    const older = { ...current }
    delete older.rite
    expect(JSON.stringify(normalizeCharacterDraft(older, current))).toBe(
      JSON.stringify(normalizeCharacterDraft(current))
    )
    expect(normalizeCharacterDraft({ ...older, name: 'Edited' }, current)).toMatchObject({
      name: 'Edited',
      rite: 'roman_rite'
    })
    expect(older.rite).toBeUndefined()
  })
  it('keeps an explicit rite clear instead of restoring the file value', () => {
    expect(normalizeCharacterDraft({ ...current, rite: null }, current).rite).toBeNull()
  })
})
