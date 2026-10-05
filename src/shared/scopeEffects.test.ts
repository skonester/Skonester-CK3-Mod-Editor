import { describe, expect, it } from 'vitest'
import { readScopeEffects, readStatement, setScopeList, setScopeScalar } from './scopeEffects'

const BLOCK = [
  'character:205523 = { #Baldwin',
  '\t\t\tMatts_remove_personality_traits_effect = yes',
  '\t\t\tset_sexuality = heterosexual',
  '\t\t\tadd_trait = cynical # doubts',
  '\t\t\tadd_trait = humble',
  '\t\t\tadd_perk = pedagogy_perk',
  '\t\t\tadd_piety = 300',
  '\t\t\tadd_martial_skill = 2',
  '\t\t\tif = { limit = { always = yes } add_trait = brave }',
  '\t\t\tcharacter:94030 = {',
  '\t\t\t\tadd_perk = tax_man_perk',
  '\t\t\t}',
  '\t\t}'
].join('\n')

describe('readScopeEffects', () => {
  it('reads the top level only, leaving conditional effects to the script', () => {
    expect(readScopeEffects(BLOCK)).toEqual({
      addTraits: ['cynical', 'humble'],
      removeTraits: [],
      perks: ['pedagogy_perk'],
      flags: [],
      sexuality: 'heterosexual',
      amounts: [
        { key: 'add_piety', value: '300' },
        { key: 'add_martial_skill', value: '2' }
      ],
      calls: ['Matts_remove_personality_traits_effect'],
      nested: [{ key: 'character:94030', kind: 'character', id: '94030' }],
      other: ['if = { limit = { always = yes } add_trait = brave }']
    })
  })

  it('is null for a statement that is not a block', () => {
    expect(readScopeEffects('holder = 205523')).toBeNull()
  })
})

describe('scope writers', () => {
  it('removes one trait line, keeping comments and every other byte', () => {
    const next = setScopeList(BLOCK, 'add_trait', ['cynical'])
    expect(next).toBe(BLOCK.replace('\t\t\tadd_trait = humble\n', ''))
  })

  it('adds a trait under the last trait line in the block indentation', () => {
    const next = setScopeList(BLOCK, 'add_trait', ['cynical', 'humble', 'brave'])
    expect(next).toBe(
      BLOCK.replace('add_trait = humble\n', 'add_trait = humble\n\t\t\tadd_trait = brave\n')
    )
  })

  it('a no-op list leaves the text identical', () => {
    expect(setScopeList(BLOCK, 'add_trait', ['cynical', 'humble'])).toBe(BLOCK)
  })

  it('changes and removes single-valued effects', () => {
    expect(setScopeScalar(BLOCK, 'add_piety', '500')).toBe(BLOCK.replace('add_piety = 300', 'add_piety = 500'))
    expect(setScopeScalar(BLOCK, 'set_sexuality', null)).toBe(
      BLOCK.replace('\t\t\tset_sexuality = heterosexual\n', '')
    )
    expect(setScopeScalar(BLOCK, 'Matts_remove_personality_traits_effect', null)).toBe(
      BLOCK.replace('\t\t\tMatts_remove_personality_traits_effect = yes\n', '')
    )
  })
})

describe('readStatement', () => {
  it('reads a lone key = value', () => {
    expect(readStatement('add_trait = conqueror')).toEqual({ key: 'add_trait', value: 'conqueror' })
    expect(readStatement('a = b c = d')).toBeNull()
    expect(readStatement('a = { b = c }')).toBeNull()
  })
})
