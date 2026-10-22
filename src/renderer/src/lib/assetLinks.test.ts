import { describe, expect, it } from 'vitest'
import { assetTarget, isModelFile } from './assetLinks'

describe('assetTarget', () => {
  it('opens a model file in its folder on the models half', () => {
    expect(assetTarget('gfx/models/portraits/male_head/male_head.mesh')).toEqual({
      to: '/models',
      search: { folder: 'gfx/models/portraits/male_head', path: 'gfx/models/portraits/male_head/male_head.mesh' }
    })
  })

  it('opens anything else on the images half', () => {
    expect(assetTarget('gfx/interface/icons/traits/brave.dds')).toEqual({
      to: '/models',
      search: { kind: 'images', folder: 'gfx/interface/icons/traits', path: 'gfx/interface/icons/traits/brave.dds' }
    })
  })

  it('tells model files by extension, in any case', () => {
    expect(isModelFile('a/b.ASSET')).toBe(true)
    expect(isModelFile('a/b.mesh')).toBe(true)
    expect(isModelFile('a/b.dds')).toBe(false)
  })
})
