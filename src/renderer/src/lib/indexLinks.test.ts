import { describe, expect, it } from 'vitest'
import { editorTarget, modTouchLabel, siteLabel } from './indexLinks'

const def = (file: string, inMod: boolean) => ({ file, path: null, line: 1, inMod })

describe('editorTarget', () => {
  it('opens a mod character by its history file name', () => {
    expect(
      editorTarget('characters', '223523', def('history/characters/zz_baldwin_characters.txt', true))
    ).toEqual({ to: '/characters', search: { file: 'zz_baldwin_characters.txt', id: '223523' } })
  })

  it("leaves game characters and subfolder files to the text editor", () => {
    expect(editorTarget('characters', '1', def('history/characters/french.txt', false))).toBeNull()
    expect(editorTarget('characters', '1', def('history/characters/sub/x.txt', true))).toBeNull()
    expect(editorTarget('characters', '1')).toBeNull()
  })

  it('tells dynasties from houses', () => {
    expect(editorTarget('dynasties', '723')).toEqual({
      to: '/dynasties',
      search: { id: '723', kind: 'dynasty' }
    })
    expect(editorTarget('dynasty_houses', 'house_anjou')).toEqual({
      to: '/dynasties',
      search: { id: 'house_anjou', kind: 'house' }
    })
  })

  it('maps the other edited types to their editors', () => {
    expect(editorTarget('culture/cultures', 'french')?.to).toBe('/cultures')
    expect(editorTarget('faith', 'catholic')?.to).toBe('/faiths')
    expect(editorTarget('religion/religion_types', 'christianity_religion')?.to).toBe('/religions')
    expect(editorTarget('religion/rite_types', 'roman_rite')?.to).toBe('/rites')
    expect(editorTarget('landed_titles', 'k_malte')).toEqual({
      to: '/titles',
      search: { id: 'k_malte' }
    })
  })

  it('has no editor for script types', () => {
    expect(editorTarget('events', 'skonester_malta.0003')).toBeNull()
    expect(editorTarget('scripted_effects', 'x')).toBeNull()
  })
})

describe('siteLabel', () => {
  it('keeps the file name and line', () => {
    expect(siteLabel('common/landed_titles/malta_titles.txt', 482)).toBe('malta_titles.txt:482')
    expect(siteLabel('top.txt', 3)).toBe('top.txt:3')
  })
})

describe('modTouchLabel', () => {
  it('is null for untouched entries', () => {
    expect(modTouchLabel(undefined)).toBeNull()
  })

  it('names each state', () => {
    expect(modTouchLabel({ state: 'added', mods: ['m.mod'] })?.label).toBe('Added by mod')
    expect(modTouchLabel({ state: 'overridden', mods: ['m.mod'] })?.label).toBe('Overrides game')
  })
})
