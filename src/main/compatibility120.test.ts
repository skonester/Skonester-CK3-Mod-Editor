import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createFaith,
  createReligion,
  createRite,
  getReligionData,
  saveFaith,
  saveReligion,
  saveRite
} from './religions'
import { createCharacter, getCharacter, saveCharacter } from './characters'
import { effectiveFiles, getReferenceData, locateRef } from './refdata'
import { getTitleData } from './titles'
import { parseRulerDesignerDna } from './dna'
import {
  addTitleHistoryEntry,
  getTitleHistory,
  listTitleHistoryFiles,
  saveTitleHistoryEntry
} from './titleHistory'
import type { FaithDef, FaithPatch, RiteDef, RitePatch } from '@shared/types'

let root: string
let game: string
let mod: string
function fixture(base: string, file: string, text: string): void {
  const path = join(base, file)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text, 'utf-8')
}

const religion =
  '\uFEFFsample_religion = {\r\n\treligion_details = {\r\n\t\tfamily = rf_test # family\r\n\t\tpiety_icon_group = "sample"\r\n\t\ttheocracy_government_type = ecclesiastical_government\r\n\t}\r\n\tdoctrine = doctrine_monogamy # inherited\r\n\tmain_holy_site = rome\r\n}\r\n'
const faith =
  '\uFEFFsample_faith = {\r\n\tmain_rite = sample_rite # main\r\n\tfaith_details = {\r\n\t\treligion = sample_religion\r\n\t\tcolor = { 0.8 0.8 0.6 } # color\r\n\t\ticon = christianity_papal_cross_01\r\n\t\treligious_head = k_papal_state\r\n\t\thead_of_rite = d_head\r\n\t}\r\n\tholy_sites = { rome } # local\r\n\teminent_holy_sites = { jerusalem }\r\n\tdoctrines = {\r\n\t\tdoctrine_monogamy # choice\r\n\t}\r\n\ttenets = { tenet_communion }\r\n\ttenet_selection_pair = { requires_dlc_flag = by_god_alone tenet = tenet_dulia fallback_tenet = tenet_astrology }\r\n\tcultures = { italian }\r\n}\r\n'
const rite =
  '\uFEFFsample_rite = {\r\n\tname = { first_valid = { triggered_desc = { trigger = { always = yes } desc = rite_label } } }\r\n\tdesc = sample_rite_desc\r\n\tfaith = sample_faith\r\n\tcolor = { 204 204 153 }\r\n\ticon = christianity_papal_cross_01\r\n\tfounder = k_papal_state # keep\r\n\tcreate = no\r\n\tdoctrines = { doctrine_polygamy }\r\n\ttenets = {\r\n\t\ttenet_communion # first\r\n\t}\r\n\ttenet_selection_pair = { tenet = tenet_dulia fallback_tenet = tenet_astrology }\r\n\tcultures = { italian roman }\r\n}\r\n'

const faithPatch = (f: FaithDef): FaithPatch => ({
  format: f.format,
  color: f.color?.hex ?? null,
  icon: f.icon,
  reformedIcon: f.reformedIcon,
  religiousHead: f.religiousHead,
  doctrines: f.doctrines,
  holySites: f.holySites,
  mainRite: f.mainRite,
  tenets: f.tenets,
  eminentHolySites: f.eminentHolySites
})
const ritePatch = (r: RiteDef): RitePatch => ({
  faith: r.faith,
  color: r.color?.hex ?? null,
  icon: r.icon,
  founder: r.founder,
  create: r.create,
  convert: r.convert,
  doctrines: r.doctrines,
  tenets: r.tenets
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ck3-120-'))
  game = join(root, 'game')
  mod = join(root, 'mod')
  fixture(mod, 'common/religion/religion_types/shared.txt', religion)
  fixture(mod, 'common/religion/faith_types/shared.txt', faith)
  fixture(mod, 'common/religion/rite_types/shared.txt', rite)
  fixture(
    game,
    'common/religion/doctrine_group_types/groups.txt',
    'marriage = { category = marriage }'
  )
  fixture(
    game,
    'common/religion/doctrine_types/doctrines.txt',
    'doctrine_polygamy = { doctrine_group_type = marriage index = 1 }\ndoctrine_monogamy = { doctrine_group_type = marriage index = 0 }'
  )
  fixture(
    game,
    'common/religion/tenet_types/tenets.txt',
    'tenet_communion = {}\ntenet_astrology = {}'
  )
  fixture(
    mod,
    'history/characters/people.txt',
    '1 = {\n name = "A"\n faith = sample_faith\n rite = sample_rite # rite\n culture = italian\n 800.1.1 = { birth = yes }\n}\n2 = {\n rite = sample_rite\n}\n3 = {\n rite = implicit_faith\n}\n'
  )
  fixture(
    mod,
    'common/religion/faith_types/implicit.txt',
    'implicit_faith = { faith_details = { religion = sample_religion } }'
  )
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('CK3 1.20 religion compatibility', () => {
  it('detects 1.20 in a mod containing only religion_details and creates its first faith', () => {
    const freshMod = join(root, 'fresh-mod')
    fixture(freshMod, 'common/religion/religion_types/new.txt', religion)
    const data = getReligionData(null, freshMod, [])
    expect(data.format).toBe('1.20')
    expect(
      createFaith(freshMod, 'sample_religion', {
        id: 'first_faith',
        color: null,
        icon: null,
        reformedIcon: null,
        religiousHead: null,
        doctrines: [],
        holySites: []
      })
    ).toEqual({ ok: true })
    expect(
      readFileSync(join(freshMod, 'common/religion/faith_types/first_faith.txt'), 'utf-8')
    ).toContain('faith_details = {')
  })
  it('edits a rite without rewriting dynamic names, conditional tenets, or unchanged doctrines', () => {
    const current = getReligionData(game, mod, []).rites![0]
    expect(
      saveRite(mod, current.file, current.id, {
        ...ritePatch(current),
        founder: 'd_new_head',
        tenets: ['tenet_astrology']
      })
    ).toEqual({ ok: true })
    const updated = readFileSync(join(mod, 'common/religion/rite_types/shared.txt'), 'utf-8')
    expect(updated).toContain('founder = d_new_head # keep')
    expect(updated).toContain(
      'name = { first_valid = { triggered_desc = { trigger = { always = yes } desc = rite_label } } }'
    )
    expect(updated).toContain(
      'tenet_selection_pair = { tenet = tenet_dulia fallback_tenet = tenet_astrology }'
    )
    expect(updated).toContain('doctrines = { doctrine_polygamy }')
    expect(updated).toContain('cultures = { italian roman }')
    expect(getReligionData(game, mod, []).rites![0].tenets).toEqual(['tenet_astrology'])
  })
  it('uses mod rite overrides for localization and implicit-rite membership', () => {
    fixture(
      game,
      'common/religion/rite_types/base.txt',
      'foreign_rite = { faith = implicit_faith }'
    )
    fixture(
      mod,
      'common/religion/rite_types/override.txt',
      'foreign_rite = { faith = sample_faith name = public_rite_name }'
    )
    fixture(
      mod,
      'localization/english/rites_l_english.yml',
      'l_english:\n public_rite_name:0 "Named Rite"\n'
    )
    const refs = getReferenceData(game, mod, [])
    expect(refs.rites).toContainEqual({ id: 'foreign_rite', name: 'Named Rite' })
    expect(refs.rites?.map((r) => r.id)).toContain('implicit_faith')
    expect(getReligionData(game, mod, []).rites?.find((r) => r.id === 'foreign_rite')?.faith).toBe(
      'sample_faith'
    )
  })
  it('reads standalone faiths, rites, nested details, and index-ordered doctrine groups', () => {
    const data = getReligionData(game, mod, [])
    expect(data.format).toBe('1.20')
    expect(data.religions[0]).toMatchObject({ family: 'rf_test', pietyIconGroup: 'sample' })
    expect(data.faiths.find((f) => f.id === 'sample_faith')).toMatchObject({
      religion: 'sample_religion',
      mainRite: 'sample_rite',
      holySites: ['rome'],
      eminentHolySites: ['jerusalem'],
      tenets: ['tenet_communion'],
      color: { hex: '#cccc99' }
    })
    expect(data.rites?.[0]).toMatchObject({
      faith: 'sample_faith',
      founder: 'k_papal_state',
      create: 'no'
    })
    expect(data.groups[0].doctrines.map((d) => d.id)).toEqual([
      'doctrine_monogamy',
      'doctrine_polygamy'
    ])
    expect(data.tenets?.map((t) => t.id)).toEqual(['tenet_astrology', 'tenet_communion'])
    expect(data.adherents.map((a) => [a.id, a.faith, a.rite])).toEqual([
      ['1', 'sample_faith', 'sample_rite'],
      ['2', 'sample_faith', 'sample_rite'],
      ['3', 'implicit_faith', 'implicit_faith']
    ])
  })
  it('round-trips no-op religion, faith, and rite saves byte-for-byte', () => {
    const data = getReligionData(game, mod, [])
    const r = data.religions[0],
      f = data.faiths.find((f) => f.id === 'sample_faith')!,
      t = data.rites![0]
    expect(saveReligion(mod, r.file, r.id, r)).toEqual({ ok: true })
    expect(saveFaith(mod, f.file, f.religion, f.id, faithPatch(f))).toEqual({ ok: true })
    expect(saveRite(mod, t.file, t.id, ritePatch(t))).toEqual({ ok: true })
    expect(readFileSync(join(mod, 'common/religion/religion_types/shared.txt'), 'utf-8')).toBe(
      religion
    )
    expect(readFileSync(join(mod, 'common/religion/faith_types/shared.txt'), 'utf-8')).toBe(faith)
    expect(readFileSync(join(mod, 'common/religion/rite_types/shared.txt'), 'utf-8')).toBe(rite)
  })
  it('edits the correct levels without touching unrelated blocks or a same-named religion file', () => {
    const data = getReligionData(game, mod, [])
    const f = data.faiths.find((f) => f.id === 'sample_faith')!
    expect(
      saveFaith(mod, f.file, f.religion, f.id, {
        ...faithPatch(f),
        holySites: ['delphi'],
        tenets: ['tenet_astrology'],
        icon: 'new_icon'
      })
    ).toEqual({ ok: true })
    const updated = readFileSync(join(mod, 'common/religion/faith_types/shared.txt'), 'utf-8')
    expect(updated).toContain('icon = new_icon')
    expect(updated).toContain('head_of_rite = d_head')
    expect(updated).toContain(
      'tenet_selection_pair = { requires_dlc_flag = by_god_alone tenet = tenet_dulia fallback_tenet = tenet_astrology }'
    )
    expect(updated).toContain('doctrine_monogamy # choice')
    expect(updated).toContain('eminent_holy_sites = { jerusalem }')
    expect(readFileSync(join(mod, 'common/religion/religion_types/shared.txt'), 'utf-8')).toBe(
      religion
    )
    expect(
      saveReligion(mod, 'shared.txt', 'sample_religion', {
        ...data.religions[0],
        family: 'rf_other'
      })
    ).toEqual({ ok: true })
    expect(getReligionData(game, mod, []).religions[0].family).toBe('rf_other')
  })
  it('creates standalone faiths under a game religion and allows a rite to share its faith id', () => {
    const def = {
      ...faithPatch(getReligionData(game, mod, []).faiths.find((f) => f.id === 'sample_faith')!),
      id: 'new_faith'
    }
    expect(createFaith(mod, 'base_religion', def)).toEqual({ ok: true })
    const created = readFileSync(join(mod, 'common/religion/faith_types/new_faith.txt'), 'utf-8')
    expect(created).toContain('faith_details = {')
    expect(created).toContain('religion = base_religion')
    expect(created).not.toContain('holy_site =')
    const newRite = {
      ...ritePatch(getReligionData(game, mod, []).rites![0]),
      id: 'new_faith',
      faith: 'new_faith'
    }
    expect(createRite(mod, 'new_rites.txt', newRite)).toEqual({ ok: true })
    expect(createRite(mod, 'another.txt', newRite).ok).toBe(false)
    expect(createFaith(mod, 'base_religion', def).ok).toBe(false)
  })
  it('creates 1.20 religions without nested faiths and rejects overlapping holy sites', () => {
    expect(
      createReligion(mod, 'new_religions.txt', {
        id: 'new_religion',
        family: 'rf_test',
        graphicalFaith: null,
        pietyIconGroup: null,
        doctrines: [],
        format: '1.20'
      })
    ).toEqual({ ok: true })
    const created = readFileSync(
      join(mod, 'common/religion/religion_types/new_religions.txt'),
      'utf-8'
    )
    expect(created).toContain('religion_details = {')
    expect(created).not.toContain('faiths =')
    const f = getReligionData(game, mod, []).faiths.find((f) => f.id === 'sample_faith')!
    expect(
      saveFaith(mod, f.file, f.religion, f.id, { ...faithPatch(f), holySites: ['jerusalem'] }).ok
    ).toBe(false)
  })
  it('resolves new references and keeps the new database replace_paths independent', () => {
    const refs = getReferenceData(game, mod, [])
    expect(refs.faiths.map((f) => f.id)).toContain('sample_faith')
    expect(refs.rites?.map((r) => r.id)).toEqual(['implicit_faith', 'sample_rite'])
    expect(locateRef(game, mod, [], 'faith', 'sample_faith')?.path).toContain('faith_types')
    expect(locateRef(game, mod, [], 'rite', 'sample_rite')?.path).toContain('rite_types')
    expect(locateRef(game, mod, [], 'tenet', 'tenet_communion')?.path).toContain('tenet_types')
    fixture(
      game,
      'common/religion/faith_types/base.txt',
      'base_faith = { faith_details = { religion = base_religion } }'
    )
    expect(
      getReligionData(game, mod, ['common/religion/religion_types']).faiths.some(
        (f) => f.id === 'base_faith'
      )
    ).toBe(true)
    expect(
      getReligionData(game, mod, ['common/religion/faith_types']).faiths.some(
        (f) => f.id === 'base_faith'
      )
    ).toBe(false)
  })
  it('lets mod doctrine declarations override game membership and ordering', () => {
    fixture(
      mod,
      'common/religion/doctrine_types/override.txt',
      'doctrine_polygamy = { doctrine_group_type = marriage index = -1 }'
    )
    expect(getReligionData(game, mod, []).groups[0].doctrines.map((d) => d.id)).toEqual([
      'doctrine_polygamy',
      'doctrine_monogamy'
    ])
  })
})

describe('CK3 1.20 character and title compatibility', () => {
  it('preserves accessory gene indices above 255 in ruler-designer DNA', () => {
    const parsed = parseRulerDesignerDna(
      'ruler_designer_1 = { genes = { eye_accessory = { "normal_eyes" 300 "no_eyes" 2147483647 } } }'
    )
    expect(parsed).toMatchObject({
      genes: [{ key: 'eye_accessory', value: '"normal_eyes" 300 "no_eyes" 2147483647' }]
    })
  })
  it('keeps faith and rite independent and supports rite-only character creation', () => {
    const before = readFileSync(join(mod, 'history/characters/people.txt'), 'utf-8')
    const detail = getCharacter(mod, 'people.txt', '1')!
    expect(detail).toMatchObject({ faith: 'sample_faith', rite: 'sample_rite' })
    expect(saveCharacter(mod, 'people.txt', '1', detail)).toEqual({ ok: true })
    expect(readFileSync(join(mod, 'history/characters/people.txt'), 'utf-8')).toBe(before)
    expect(saveCharacter(mod, 'people.txt', '1', { ...detail, rite: 'different_rite' })).toEqual({
      ok: true
    })
    expect(getCharacter(mod, 'people.txt', '1')?.faith).toBe('sample_faith')
    const oldDraft = { ...detail }
    delete oldDraft.rite
    expect(saveCharacter(mod, 'people.txt', '1', oldDraft)).toEqual({ ok: true })
    expect(getCharacter(mod, 'people.txt', '1')?.rite).toBe('different_rite')
    expect(createCharacter(mod, 'new.txt', { ...detail, id: 'new_person', faith: null })).toEqual({
      ok: true
    })
    expect(getCharacter(mod, 'new.txt', 'new_person')).toMatchObject({
      faith: null,
      rite: 'sample_rite'
    })
  })
  it('offers top-level succession laws and reads nested ecclesiastical title history', () => {
    fixture(game, 'common/laws/new.txt', 'test_succession_law = { group = succession }')
    fixture(game, 'common/landed_titles/titles.txt', 'd_bishop = {}')
    fixture(game, 'history/titles/ce3/bishops.txt', 'd_bishop = { 800.1.1 = { holder = 1 } }')
    expect(getTitleData(game, mod, []).successionLaws.map((l) => l.id)).toContain(
      'test_succession_law'
    )
    expect(getTitleHistory(game, mod, [], 'd_bishop')[0]).toMatchObject({
      file: 'ce3/bishops.txt',
      holder: '1',
      inMod: false
    })
    expect(getTitleData(game, mod, []).titles.find((t) => t.id === 'd_bishop')?.hasHistory).toBe(
      true
    )
    fixture(mod, 'history/titles/ce3/bishops.txt', 'd_bishop = { 800.1.1 = { holder = 2 } }')
    expect(listTitleHistoryFiles(mod)).toContain('ce3/bishops.txt')
    const entry = getTitleHistory(game, mod, [], 'd_bishop')[0]
    expect(
      saveTitleHistoryEntry(mod, entry.file, 'd_bishop', 0, 0, { ...entry, holder: '3' })
    ).toEqual({ ok: true })
    expect(getTitleHistory(game, mod, [], 'd_bishop')[0].holder).toBe('3')
    expect(effectiveFiles(game, null, ['history/titles/ce3'], 'history/titles', true)).toEqual([])
    expect(addTitleHistoryEntry(mod, '../outside.txt', 'd_bishop', entry).ok).toBe(false)
    expect(addTitleHistoryEntry(mod, 'ce3/.. /outside.txt', 'd_bishop', entry).ok).toBe(false)
    expect(addTitleHistoryEntry(mod, 'ce3/new_clergy.txt', 'd_bishop', entry)).toEqual({ ok: true })
    expect(listTitleHistoryFiles(mod)).toContain('ce3/new_clergy.txt')
  })
})
