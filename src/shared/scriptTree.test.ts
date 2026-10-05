import { describe, expect, it } from 'vitest'
import { compactScript, lineAt, parseScript, walkScript } from './scriptTree'

const slice = (text: string, n: { start: number; end: number }): string => text.slice(n.start, n.end)

describe('parseScript', () => {
  it('keeps exact spans for nested blocks, scalars and bare list values', () => {
    const text = [
      'effect_a = {',
      '\tif = {',
      '\t\tlimit = { current_date > 1204.1.1 }',
      '\t\tcharacter:205523 = { #Baldwin',
      '\t\t\tadd_trait = brave',
      '\t\t}',
      '\t}',
      '}',
      'on_x = { on_actions = { a b } }'
    ].join('\n')
    const tree = parseScript(text)
    expect(tree.map((n) => n.key)).toEqual(['effect_a', 'on_x'])
    const found: string[] = []
    walkScript(tree, (node, ancestors) => {
      if (node.key === 'character:205523') {
        found.push(ancestors.map((a) => a.key).join('>'))
        expect(slice(text, node)).toBe('character:205523 = { #Baldwin\n\t\t\tadd_trait = brave\n\t\t}')
        expect(node.children?.map((c) => [c.key, c.value])).toEqual([['add_trait', 'brave']])
      }
      if (node.key === null) found.push(`bare:${node.value}`)
      if (node.key === 'current_date') expect([node.op, node.value]).toEqual(['>', '1204.1.1'])
    })
    expect(found).toEqual(['effect_a>if', 'bare:a', 'bare:b'])
  })

  it('ignores braces in comments and strings, and tolerates stray or missing ones', () => {
    const text = 'a = { name = "x { y" # }\n b = 1 }\n}\nc = { d = 2'
    const tree = parseScript(text)
    expect(tree.map((n) => n.key)).toEqual(['a', 'c'])
    expect(tree[0].children?.map((c) => [c.key, c.value, c.quoted])).toEqual([
      ['name', 'x { y', true],
      ['b', '1', false]
    ])
    // The unclosed block runs to the end of the text
    expect(tree[1].end).toBe(text.length)
    expect(tree[1].children?.[0].value).toBe('2')
  })

  it('reads ?=, <=, != operators and a BOM', () => {
    const tree = parseScript('﻿x ?= y\nz <= 3\nw != q')
    expect(tree.map((n) => [n.key, n.op, n.value])).toEqual([
      ['x', '?=', 'y'],
      ['z', '<=', '3'],
      ['w', '!=', 'q']
    ])
  })
})

describe('helpers', () => {
  it('lineAt counts 1-based lines', () => {
    expect(lineAt('a\nb\nc', 0)).toBe(1)
    expect(lineAt('a\nb\nc', 4)).toBe(3)
  })

  it('compactScript drops comments and collapses whitespace', () => {
    expect(compactScript('\n\tcurrent_date > 1204.1.1 # from\n\tcurrent_date < 1205.1.1\n')).toBe(
      'current_date > 1204.1.1 current_date < 1205.1.1'
    )
  })
})
