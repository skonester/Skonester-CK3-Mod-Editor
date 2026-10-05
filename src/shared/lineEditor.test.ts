import { describe, expect, it } from 'vitest'
import { makeEditor, setScalar } from './lineEditor'
import type { LineEditor } from './lineEditor'

const bodyOf = (ed: LineEditor): string => ed.lines.join('\n')

describe('setScalar', () => {
  it('edits a statement on a line holding several statements', () => {
    const ed = makeEditor(' name = "A" motto = "B" ')
    setScalar(ed, ['name'], 'New', { quoteNew: true })
    expect(bodyOf(ed)).toBe(' name = "New" motto = "B" ')
  })

  it('no-op rewrite of a multi-statement line is byte-identical', () => {
    const before = ' name = "A" motto = "B" '
    const ed = makeEditor(before)
    setScalar(ed, ['name'], 'A', { quoteNew: true })
    setScalar(ed, ['motto'], 'B', { quoteNew: true })
    expect(bodyOf(ed)).toBe(before)
  })

  it('clears one statement from a shared line, keeping the rest', () => {
    const ed = makeEditor(' name = "A" motto = "B" ')
    setScalar(ed, ['motto'], null)
    expect(bodyOf(ed)).toBe(' name = "A" ')
  })

  it('an inline insert stays editable on the next save', () => {
    const ed = makeEditor(' name = "x" ')
    setScalar(ed, ['motto'], 'first', { quoteNew: true })
    expect(bodyOf(ed)).toBe(' name = "x" motto = "first" ')
    setScalar(ed, ['motto'], 'second', { quoteNew: true })
    expect(bodyOf(ed)).toBe(' name = "x" motto = "second" ')
    // And a full no-op pass doesn't duplicate anything
    setScalar(ed, ['name'], 'x', { quoteNew: true })
    setScalar(ed, ['motto'], 'second', { quoteNew: true })
    expect(bodyOf(ed)).toBe(' name = "x" motto = "second" ')
  })

  it('sees a value containing # inside quotes (no duplicate insert)', () => {
    const before = '\n\tmotto = "A#B"\n'
    const ed = makeEditor(before)
    setScalar(ed, ['motto'], 'A#B', { quoteNew: true })
    expect(bodyOf(ed)).toBe(before)
    setScalar(ed, ['motto'], 'C#D', { quoteNew: true })
    expect(bodyOf(ed)).toBe('\n\tmotto = "C#D"\n')
  })

  it('still treats # outside quotes as a comment', () => {
    const ed = makeEditor('\n\tculture = greek # keep me\n')
    setScalar(ed, ['culture'], 'norse')
    expect(bodyOf(ed)).toBe('\n\tculture = norse # keep me\n')
  })

  it('inserted lines carry \\r in a CRLF body', () => {
    const ed = makeEditor('\r\n\tname = "x"\r\n')
    setScalar(ed, ['motto'], 'm', { quoteNew: true })
    expect(bodyOf(ed)).toBe('\r\n\tname = "x"\r\n\tmotto = "m"\r\n')
  })

  it('does not mistake a block opener for a scalar', () => {
    const before = '\n\tdeath = {\n\t\tdeath_reason = x\n\t}\n'
    const ed = makeEditor(before)
    setScalar(ed, ['death'], null)
    expect(bodyOf(ed)).toBe(before)
  })
})
