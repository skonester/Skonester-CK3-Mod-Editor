import { describe, expect, it } from 'vitest'
import { migrateDefinitionDraft } from './definitionDraft'

describe('draft options migration', () => {
  it('takes newly supported settings from disk while preserving older unsaved edits', () => {
    const current = { icon: 'disk', options: { origin: 'old_faith', cultures: ['latin'] } }
    const old = { icon: 'unsaved' }
    expect(migrateDefinitionDraft(old, current)).toEqual({
      icon: 'unsaved',
      options: current.options
    })
  })
  it('keeps explicit cleared settings in existing drafts', () => {
    expect(
      migrateDefinitionDraft(
        { options: { origin: null, cultures: [] } },
        { options: { origin: 'old_faith', cultures: ['latin'] } }
      )
    ).toEqual({ options: { origin: null, cultures: [] } })
  })
})
