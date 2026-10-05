import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { characterScripts, getCharacter, saveCharacter } from './characters'
import type { CharacterDetail, ScriptSite } from '@shared/types'

// Synthetic mod shaped like a bookmark total conversion: the character's record
// is thin, and the rest of who they are is set up by script — never touches real files
const modPath = mkdtempSync(join(tmpdir(), 'ck3-tools-script-sites-'))

const FILES: Record<string, string> = {
  'history/characters/court.txt': [
    '100 = {',
    '\thistory_override_priority = 1',
    '\tname = "Boudewijn"',
    '\ttrait = brave',
    '\t1171.7.1 = {',
    '\t\tbirth = yes',
    '\t}',
    '\t1204.10.2 = {',
    '\t\temployer = 300',
    '\t\teffect = {',
    '\t\t\tadd_character_flag = is_bookmark_character',
    '\t\t\tadd_trait = conqueror',
    '\t\t\tset_relation_friend = character:200',
    '\t\t}',
    '\t}',
    '}',
    '',
    '200 = {',
    '\tname = "Helene"',
    '\t1204.10.2 = {',
    '\t\temployer = 100',
    '\t}',
    '}',
    ''
  ].join('\n'),
  'common/on_action/game_start.txt': [
    'on_game_start = {',
    '\ton_actions = { tc_set_up }',
    '}',
    'tc_set_up = {',
    '\ttrigger = { game_start_date = 1204.10.2 }',
    '\teffect = { tc_set_up_effect = yes }',
    '}'
  ].join('\r\n'),
  'common/scripted_effects/tc_effects.txt': [
    'tc_set_up_effect = {',
    '\tif = {',
    '\t\tlimit = { current_date > 1204.1.1 }',
    '\t\tcharacter:100 = { #Baldwin',
    '\t\t\tadd_trait = cynical',
    '\t\t\tadd_trait = humble',
    '\t\t\tadd_piety = 300',
    '\t\t\tcopy_inheritable_appearance_from = character:100',
    '\t\t\tcharacter:200 = { set_employer = character:100 }',
    '\t\t}',
    '\t}',
    '\ttc_set_liege_effect = { VASSAL = 200 LIEGE = 100 }',
    '}',
    'tc_set_liege_effect = {',
    '\tcharacter:$VASSAL$ = { change_liege = { liege = character:$LIEGE$ change = scope:c } }',
    '}'
  ].join('\n'),
  'history/titles/e_latin.txt': [
    'e_latin_empire = {',
    '\t1204.10.1 = {',
    '\t\tholder = 100 # Baudouin I',
    '\t}',
    '}',
    'c_chios = { 1204.10.1 = { holder = 100 } }'
  ].join('\n'),
  'common/bookmarks/bookmarks/tc.txt': [
    'bm_1204 = {',
    '\tcharacter = {',
    '\t\tname = "bookmark_baldwin"',
    '\t\thistory_id = 100',
    '\t}',
    '}'
  ].join('\n'),
  'common/decisions/tc_decisions.txt': [
    'tc_council = {',
    '\tis_shown = { this = character:100 }',
    '\teffect = { add_gold = 5 }',
    '}'
  ].join('\n'),
  'gfx/ignored.txt': 'x = { holder = 100 character:100 = { } }'
}

const abs = (rel: string): string => join(modPath, ...rel.split('/'))

beforeEach(() => {
  for (const [rel, text] of Object.entries(FILES)) {
    mkdirSync(dirname(abs(rel)), { recursive: true })
    writeFileSync(abs(rel), text, 'utf-8')
  }
})
afterAll(() => rmSync(modPath, { recursive: true, force: true }))

const read = (): CharacterDetail => {
  const detail = getCharacter(modPath, 'court.txt', '100') as CharacterDetail
  return { ...detail, scripts: characterScripts(modPath, 'court.txt', '100') }
}
const site = (detail: CharacterDetail, file: string, text: string): ScriptSite => {
  const found = detail.scripts?.find((s) => s.file === file && s.diskText.includes(text))
  if (!found) throw new Error(`no site in ${file} containing ${text}`)
  return found
}
const withText = (detail: CharacterDetail, target: ScriptSite, text: string): CharacterDetail => ({
  ...detail,
  scripts: detail.scripts?.map((s) => (s.id === target.id ? { ...s, text } : s))
})

describe('characterScripts', () => {
  it('finds everything that shapes the character across the mod', () => {
    const sites = read().scripts ?? []
    const summary = sites.map((s) => `${s.role}|${s.context}|${s.file}|${s.summary}|${s.diskText.split('\n')[0]}`)
    expect(summary).toEqual([
      'reference|effect|common/bookmarks/bookmarks/tc.txt|Bookmark character in bm_1204|character = {',
      'reference|trigger|common/decisions/tc_decisions.txt|Condition in tc_council (is_shown)|this = character:100',
      'scope|effect|common/scripted_effects/tc_effects.txt|Runs on this character|character:100 = { #Baldwin',
      'reference|effect|common/scripted_effects/tc_effects.txt|Passed to tc_set_liege_effect as LIEGE|tc_set_liege_effect = { VASSAL = 200 LIEGE = 100 }',
      'own|effect|history/characters/court.txt|History record|history_override_priority = 1',
      'own|effect|history/characters/court.txt|History at 1204.10.2|employer = 300',
      'own|effect|history/characters/court.txt|History at 1204.10.2|add_character_flag = is_bookmark_character',
      'own|effect|history/characters/court.txt|History at 1204.10.2|add_trait = conqueror',
      'reference|effect|history/characters/court.txt|Employs 200 from 1204.10.2|employer = 100',
      'reference|effect|history/titles/e_latin.txt|Holds e_latin_empire from 1204.10.1|holder = 100',
      'reference|effect|history/titles/e_latin.txt|Holds c_chios from 1204.10.1|holder = 100'
    ])
  })

  it('traces how the game reaches a scope block, with its gates', () => {
    const scope = site(read(), 'common/scripted_effects/tc_effects.txt', '#Baldwin')
    expect(scope.path).toEqual(['tc_set_up_effect', 'if', 'character:100'])
    expect(scope.line).toBe(4)
    expect(scope.conditions).toEqual(['current_date > 1204.1.1'])
    expect(scope.reachedFrom).toEqual([
      [
        { name: 'on_game_start', kind: 'on_action', condition: null },
        { name: 'tc_set_up', kind: 'on_action', condition: 'game_start_date = 1204.10.2' },
        { name: 'tc_set_up_effect', kind: 'scripted_effect', condition: null }
      ]
    ])
  })
})

describe('saving script sites with the character', () => {
  it('a no-op save leaves every file byte-identical', () => {
    expect(saveCharacter(modPath, 'court.txt', '100', read())).toEqual({ ok: true })
    for (const [rel, text] of Object.entries(FILES)) expect(readFileSync(abs(rel), 'utf-8')).toBe(text)
  })

  it('edits a scope block, deletes a holder line and an own statement in one save', () => {
    let detail = read()
    const scope = site(detail, 'common/scripted_effects/tc_effects.txt', '#Baldwin')
    detail = withText(detail, scope, scope.text.replace('\t\t\tadd_trait = humble\n', ''))
    const empire = detail.scripts?.find((s) => s.path[0] === 'e_latin_empire') as ScriptSite
    detail = withText(detail, empire, '')
    detail = withText(detail, site(detail, 'history/characters/court.txt', 'add_trait = conqueror'), '')
    detail = { ...detail, name: 'Baudouin' }
    expect(saveCharacter(modPath, 'court.txt', '100', detail)).toEqual({ ok: true })

    expect(readFileSync(abs('common/scripted_effects/tc_effects.txt'), 'utf-8')).toBe(
      FILES['common/scripted_effects/tc_effects.txt'].replace('\t\t\tadd_trait = humble\n', '')
    )
    // The holder line goes whole, comment included; the block around it stays
    expect(readFileSync(abs('history/titles/e_latin.txt'), 'utf-8')).toBe(
      FILES['history/titles/e_latin.txt'].replace('\t\tholder = 100 # Baudouin I\n', '')
    )
    expect(readFileSync(abs('history/characters/court.txt'), 'utf-8')).toBe(
      FILES['history/characters/court.txt']
        .replace('name = "Boudewijn"', 'name = "Baudouin"')
        .replace('\t\t\tadd_trait = conqueror\n', '')
    )
  })

  it('deletes a statement sharing its line, leaving the rest of the line', () => {
    const detail = read()
    const chios = detail.scripts?.find((s) => s.path[0] === 'c_chios') as ScriptSite
    expect(saveCharacter(modPath, 'court.txt', '100', withText(detail, chios, ''))).toEqual({ ok: true })
    expect(readFileSync(abs('history/titles/e_latin.txt'), 'utf-8')).toContain(
      'c_chios = { 1204.10.1 = { } }'
    )
  })

  it('finds an own statement again after the same save renames the character', () => {
    let detail = read()
    detail = withText(detail, site(detail, 'history/characters/court.txt', 'employer = 300'), 'employer = 301')
    detail = { ...detail, id: '101' }
    expect(saveCharacter(modPath, 'court.txt', '100', detail)).toEqual({ ok: true })
    const text = readFileSync(abs('history/characters/court.txt'), 'utf-8')
    expect(text).toContain('101 = {')
    expect(text).toContain('\t\temployer = 301\n')
  })

  it("ends a trailing comment before code that follows on its line, in the file's line endings", () => {
    const path = abs('history/titles/e_latin.txt')
    const crlf = FILES['history/titles/e_latin.txt'].replace(/\n/g, '\r\n')
    writeFileSync(path, crlf)
    const detail = read()
    const chios = detail.scripts?.find((s) => s.path[0] === 'c_chios') as ScriptSite
    expect(
      saveCharacter(modPath, 'court.txt', '100', withText(detail, chios, 'holder = 101 # moved'))
    ).toEqual({ ok: true })
    expect(readFileSync(path, 'utf-8')).toBe(
      crlf.replace('{ holder = 100 } }', '{ holder = 101 # moved\r\n } }')
    )
  })

  it('refuses the whole save when a statement moved on disk, writing nothing', () => {
    let detail = read()
    const scope = site(detail, 'common/scripted_effects/tc_effects.txt', '#Baldwin')
    detail = withText(detail, scope, scope.text.replace('add_piety = 300', 'add_piety = 400'))
    detail = { ...detail, name: 'Changed' }
    // Someone edits the block in another editor meanwhile
    const path = abs('common/scripted_effects/tc_effects.txt')
    writeFileSync(path, FILES['common/scripted_effects/tc_effects.txt'].replace('cynical', 'zealous'))
    const result = saveCharacter(modPath, 'court.txt', '100', detail)
    expect(result.ok).toBe(false)
    expect(readFileSync(abs('history/characters/court.txt'), 'utf-8')).toBe(FILES['history/characters/court.txt'])
  })

  it('rejects unbalanced script', () => {
    const detail = read()
    const scope = site(detail, 'common/scripted_effects/tc_effects.txt', '#Baldwin')
    const result = saveCharacter(modPath, 'court.txt', '100', withText(detail, scope, 'character:100 = {'))
    expect(result).toEqual({ ok: false, error: expect.stringContaining('unclosed brace') })
  })
})
