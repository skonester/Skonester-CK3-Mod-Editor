import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  addFaithHistoryEntry,
  deleteFaithHistoryEntry,
  getFaithHistory,
  listFaithHistoryFiles,
  prepareFaithHistoryScript,
  saveFaithHistoryEntry
} from './faithHistory'
import { validateScriptFragment } from '@shared/scriptValidation'

const scratch: string[] = []
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'ck3-faith-history-'))
  scratch.push(path)
  return path
}
function put(base: string, file: string, text: string): string {
  const path = join(base, 'history/faiths', file)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text, 'utf-8')
  return path
}
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

const source =
  '\uFEFF# shared history\r\nmy_faith = {\r\n  867.1.1 = { created = yes main_rite = roman_rite # keep me\r\n    permitted = { tenet_a # note\r\n      tenet_b }\r\n    rites = { roman_rite = { enabled = no tenet_setup = { dlc_feature = { by_god_alone } tenets = { tenet_a tenet_b } } } }\r\n    popularity = { tenet_a = 3 }\r\n  }\r\n  867.1.1 = { main_rite = other_rite }\r\n}\r\nmy_faith = { 1066 = { rite = { rite = old_rite enabled = yes } } }\r\nother_faith = { 867.1.1 = { created = yes } }\r\n'

describe('faith history', () => {
  it('addresses duplicate dates and faith blocks independently, including old and new rite syntax', () => {
    const mod = root()
    put(mod, 'nested/test.txt', source)
    const rows = getFaithHistory(null, mod, [], 'MY_FAITH')
    expect(rows.map((e) => [e.faithBlock, e.index, e.date])).toEqual([
      [0, 0, '867.1.1'],
      [0, 1, '867.1.1'],
      [1, 0, '1066']
    ])
    expect(rows[0]).toMatchObject({
      file: 'nested/test.txt',
      inMod: true,
      created: 'yes',
      mainRite: 'roman_rite',
      permitted: ['tenet_a', 'tenet_b'],
      rites: ['roman_rite']
    })
    expect(rows[2].rites).toEqual(['old_rite'])
    expect(listFaithHistoryFiles(mod)).toEqual(['nested/test.txt'])
  })

  it('resolves file overrides and recursive replace_path without merging hidden game entries', () => {
    const game = root(),
      mod = root()
    put(game, 'nested/same.txt', 'my_faith = { 867.1.1 = { created = yes } }')
    put(mod, 'nested/same.txt', 'my_faith = { 1066.1.1 = { main_rite = mod_rite } }')
    put(game, 'different.txt', 'my_faith = { 1178.1.1 = { created = yes } }')
    expect(
      getFaithHistory(game, mod, [], 'my_faith')
        .map((e) => e.date)
        .sort()
    ).toEqual(['1066.1.1', '1178.1.1'])
    expect(getFaithHistory(game, mod, ['history/faiths'], 'my_faith').map((e) => e.date)).toEqual([
      '1066.1.1'
    ])
  })

  it('round-trips every entry without changing BOM, comments, inline layout, CRLF or neighbors', () => {
    const mod = root(),
      path = put(mod, 'test.txt', source)
    const bytes = readFileSync(path)
    for (const e of getFaithHistory(null, mod, [], 'my_faith'))
      expect(saveFaithHistoryEntry(mod, 'my_faith', e, { date: e.date, script: e.script })).toEqual(
        { ok: true }
      )
    expect(readFileSync(path).equals(bytes)).toBe(true)
  })

  it('edits convenience fields while retaining complete nested rite, DLC and popularity scripts', () => {
    const mod = root(),
      path = put(mod, 'test.txt', source)
    const e = getFaithHistory(null, mod, [], 'my_faith')[0]
    const prepared = prepareFaithHistoryScript(e.script, {
      mainRite: 'new_rite',
      permitted: ['tenet_a', 'tenet_b'],
      known: ['tenet_c']
    })
    expect(prepared.error).toBeNull()
    expect(prepared.script).toContain('permitted = { tenet_a # note\r\n      tenet_b }')
    expect(prepared.script).toContain('dlc_feature = { by_god_alone }')
    expect(prepared.script).toContain('popularity = { tenet_a = 3 }')
    expect(
      saveFaithHistoryEntry(mod, 'my_faith', e, { date: '900.1.1', script: prepared.script })
    ).toEqual({ ok: true })
    const text = readFileSync(path, 'utf-8')
    expect(text.slice(text.indexOf('  867.1.1 = { main_rite'))).toBe(
      source.slice(source.indexOf('  867.1.1 = { main_rite'))
    )
    expect(getFaithHistory(null, mod, [], 'my_faith')[0]).toMatchObject({
      date: '900.1.1',
      mainRite: 'new_rite',
      known: ['tenet_c']
    })
  })

  it('rejects changed entries and changed ordinal addresses for saves and deletion', () => {
    const mod = root(),
      path = put(mod, 'test.txt', source)
    const e = getFaithHistory(null, mod, [], 'my_faith')[0]
    const changed = source.replace('main_rite = roman_rite', 'main_rite = changed_rite')
    writeFileSync(path, changed)
    expect(saveFaithHistoryEntry(mod, 'my_faith', e, e).ok).toBe(false)
    expect(deleteFaithHistoryEntry(mod, 'my_faith', e).ok).toBe(false)
    expect(readFileSync(path, 'utf-8')).toBe(changed)
    expect(saveFaithHistoryEntry(mod, 'my_faith', { ...e, index: 1 }, e).ok).toBe(false)
  })

  it('rejects invalid or escaping paths, dates and malformed scripts without altering the file', () => {
    const mod = root(),
      path = put(mod, 'test.txt', source)
    const e = getFaithHistory(null, mod, [], 'my_faith')[0]
    for (const script of ['rites = {', '}', 'main_rite = "oops', 'x = "oops\n"', '\0'])
      expect(saveFaithHistoryEntry(mod, 'my_faith', e, { date: e.date, script }).ok).toBe(false)
    for (const file of ['../test.txt', 'C:/test.txt', 'nested/../test.txt'])
      expect(addFaithHistoryEntry(mod, file, 'my_faith', e).ok).toBe(false)
    expect(addFaithHistoryEntry(mod, 'test.txt', 'my_faith', { date: 'oops', script: '' }).ok).toBe(
      false
    )
    expect(readFileSync(path, 'utf-8')).toBe(source)
  })

  it('appends new blocks to existing CRLF files without changing existing bytes and creates subfolders', () => {
    const mod = root(),
      path = put(mod, 'test.txt', source)
    expect(
      addFaithHistoryEntry(mod, 'test.txt', 'my_faith', {
        date: '1178.1.1',
        script: 'main_rite = new_rite\nrites = { new_rite = { enabled = yes } }'
      })
    ).toEqual({ ok: true })
    const text = readFileSync(path, 'utf-8')
    expect(text.startsWith(source)).toBe(true)
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
    expect(getFaithHistory(null, mod, [], 'my_faith').at(-1)?.mainRite).toBe('new_rite')
    expect(
      addFaithHistoryEntry(mod, 'extra/new.txt', 'other_faith', {
        date: '1.1.1',
        script: '# all braces { here ignored'
      })
    ).toEqual({ ok: true })
    expect(
      validateScriptFragment(readFileSync(join(mod, 'history/faiths/extra/new.txt'), 'utf-8'))
    ).toBeNull()
  })

  it('terminates a final script comment before the closing brace and retains the file EOL', () => {
    const mod = root(),
      path = put(mod, 'test.txt', source)
    const e = getFaithHistory(null, mod, [], 'my_faith')[0]
    expect(
      saveFaithHistoryEntry(mod, 'my_faith', e, {
        date: e.date,
        script: 'main_rite = new_rite # trailing comment'
      })
    ).toEqual({ ok: true })
    expect(validateScriptFragment(readFileSync(path, 'utf-8'))).toBeNull()
    expect(getFaithHistory(null, mod, [], 'my_faith')).toHaveLength(3)
  })

  it('deletes only the selected duplicate-date entry, including nested script', () => {
    const mod = root(),
      path = put(mod, 'test.txt', source)
    const e = getFaithHistory(null, mod, [], 'my_faith')[1]
    expect(deleteFaithHistoryEntry(mod, 'my_faith', e)).toEqual({ ok: true })
    expect(readFileSync(path, 'utf-8')).toBe(
      source.replace('  867.1.1 = { main_rite = other_rite }\r\n', '')
    )
  })
})
