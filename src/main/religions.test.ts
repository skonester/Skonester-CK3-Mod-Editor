import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createFaith,
  createReligion,
  getReligionData,
  listReligionFiles,
  saveFaith,
  saveReligion
} from './religions'

// Synthetic game/mod layout in a temp dir — never touches real CK3 files
const root = mkdtempSync(join(tmpdir(), 'ck3-tools-religions-'))
const gameDir = join(root, 'game')
const modPath = join(root, 'mod')

function writeFixture(base: string, rel: string, content: string): void {
  const full = join(base, ...rel.split('/'))
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content, 'utf-8')
}

// Deliberately messy, mirroring real religion files: annotated doctrine lines,
// commented-out holy sites, mixed colour scales, an inline single-line faith
const MOD_RELIGION = [
  'hellenism_religion = {',
  '\tfamily = rf_pagan',
  '\tgraphical_faith = pagan_gfx',
  '\tpiety_icon_group = "pagan"',
  '',
  '\tdoctrine = doctrine_no_head',
  '\tdoctrine = doctrine_monogamy # for now',
  '',
  '\ttraits = {',
  '\t\tvirtues = { just honest }',
  '\t\tsins = { arbitrary }',
  '\t}',
  '',
  '\tfaiths = {',
  '\t\tolympian = {',
  '\t\t\tcolor = { 0.6 0.1 0.1 }',
  '\t\t\ticon = mycenaean_shield',
  '\t\t\treformed_icon = hellenic_reformed',
  '',
  '\t\t\t#holy_site = rome',
  '\t\t\tholy_site = delphi',
  '\t\t\tholy_site = olympia',
  '',
  '\t\t\tdoctrine = tenet_hero_cult # the big one',
  '\t\t\tdoctrine = tenet_astrology',
  '',
  '\t\t\tlocalization = {',
  '\t\t\t\tLongName = olympian_long_name',
  '\t\t\t\tHighGodName = zeus # not a doctrine',
  '\t\t\t}',
  '\t\t}',
  '',
  '\t\tdelian = { color = { 25 150 175 } icon = delos_palm }',
  '\t}',
  '}',
  ''
].join('\n')

const GAME_RELIGION = [
  '﻿judaism_religion = {',
  '\tfamily = rf_abrahamic',
  '\tdoctrine = doctrine_monotheist',
  '\tfaiths = {',
  '\t\trabbinism = {',
  '\t\t\tcolor = hsv{ 0.5 1.0 1.0 }',
  '\t\t\tholy_site = jerusalem',
  '\t\t}',
  '\t\tkaraism = {',
  '\t\t\tcolor = mock_indigo',
  '\t\t\treligious_head = d_karaism',
  '\t\t}',
  '\t}',
  '}',
  ''
].join('\n')

// A mod religion sharing an id with a game one, in a differently named file
const MOD_OVERRIDE = ['judaism_religion = {', '\tfamily = rf_mod', '}', ''].join('\n')

const GROUPS = [
  '﻿doctrine_head_of_faith = {',
  '\tcategory = "main_group"',
  '\tdoctrine_types = {',
  '\t\tdoctrine_no_head',
  '\t\tdoctrine_spiritual_head # the usual one',
  '\t}',
  '}',
  'doctrine_core_tenets = {',
  '\tcategory = "core_tenets"',
  '\tnumber_of_picks = 3',
  '\tdoctrine_types = {',
  '\t\ttenet_hero_cult tenet_astrology tenet_adaptive',
  '\t}',
  '}',
  ''
].join('\n')

const DOCTRINES = [
  'doctrine_no_head = { parameters = { x = yes } }',
  'doctrine_spiritual_head = { }',
  'tenet_hero_cult = { }',
  'tenet_astrology = { }',
  'tenet_adaptive = { }',
  'special_doctrine_ungrouped = { }',
  ''
].join('\n')

const LOC = [
  'l_english:',
  ' hellenism_religion:0 "Hellenism"',
  ' olympian:0 "Olympian Faith"',
  ' doctrine_head_of_faith_name:0 "Head of Faith"',
  ' doctrine_no_head_name:0 "No Head of Faith"',
  ' tenet_hero_cult_name:0 "Hero Cult"',
  ' holy_site_delphi_name:0 "Delphi"',
  ' rf_pagan:0 "Pagan"',
  ''
].join('\n')

beforeEach(() => {
  rmSync(root, { recursive: true, force: true })
  writeFixture(modPath, 'common/religion/religion_types/HAAO_hellenic.txt', MOD_RELIGION)
  writeFixture(gameDir, 'common/religion/religion_types/00_judaism.txt', GAME_RELIGION)
  writeFixture(gameDir, 'common/religion/doctrine_group_types/00_groups.txt', GROUPS)
  writeFixture(gameDir, 'common/religion/doctrine_types/00_doctrines.txt', DOCTRINES)
  writeFixture(gameDir, 'common/religion/holy_site_types/00_sites.txt', 'delphi = { county = c_delphi }\nolympia = { }\njerusalem = { }\n')
  writeFixture(gameDir, 'common/religion/religion_family_types/00_families.txt', 'rf_pagan = { }\nrf_abrahamic = { }\n')
  writeFixture(gameDir, 'common/named_colors/00_colors.txt', 'colors = {\n\tmock_indigo = { 0.2 0.1 0.6 }\n}\n')
  writeFixture(gameDir, 'localization/english/religion/religion_l_english.yml', LOC)
  writeFixture(
    modPath,
    'history/characters/mock.txt',
    ['1 = {', '\tname = "Alexios"', '\tfaith = olympian', '}', '2 = {', '\treligion = delian', '}', '3 = { name = "Faithless" }', ''].join('\n')
  )
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

const load = (replacePaths: string[] = []) => getReligionData(gameDir, modPath, replacePaths)

describe('getReligionData', () => {
  it('reads religions and their nested faiths from mod and game files', () => {
    const data = load()
    expect(data.religions.map((r) => r.id).sort()).toEqual([
      'hellenism_religion',
      'judaism_religion'
    ])
    expect(data.faiths.map((f) => f.id).sort()).toEqual([
      'delian',
      'karaism',
      'olympian',
      'rabbinism'
    ])
    const hellenism = data.religions.find((r) => r.id === 'hellenism_religion')!
    expect(hellenism).toMatchObject({
      inMod: true,
      family: 'rf_pagan',
      graphicalFaith: 'pagan_gfx',
      pietyIconGroup: 'pagan',
      localizedName: 'Hellenism'
    })
    // Religion doctrines must not swallow the ones nested in its faiths
    expect(hellenism.doctrines).toEqual(['doctrine_no_head', 'doctrine_monogamy'])
    expect(data.religions.find((r) => r.id === 'judaism_religion')!.inMod).toBe(false)
  })

  it('parses a faith’s fields, ignoring commented-out and nested statements', () => {
    const olympian = load().faiths.find((f) => f.id === 'olympian')!
    expect(olympian).toMatchObject({
      religion: 'hellenism_religion',
      file: 'HAAO_hellenic.txt',
      inMod: true,
      icon: 'mycenaean_shield',
      reformedIcon: 'hellenic_reformed',
      religiousHead: null,
      localizedName: 'Olympian Faith'
    })
    expect(olympian.holySites).toEqual(['delphi', 'olympia'])
    expect(olympian.doctrines).toEqual(['tenet_hero_cult', 'tenet_astrology'])
  })

  it('reads every colour form, marking only rewritable triples editable', () => {
    const byId = new Map(load().faiths.map((f) => [f.id, f.color]))
    // 0-1 floats and 0-255 integers both resolve to the same swatch space
    expect(byId.get('olympian')).toMatchObject({ hex: '#991a1a', editable: true })
    expect(byId.get('delian')).toMatchObject({ hex: '#1996af', editable: true })
    expect(byId.get('rabbinism')).toMatchObject({ hex: '#00ffff', editable: false })
    // A named colour resolves through common/named_colors but stays read-only
    expect(byId.get('karaism')).toMatchObject({ hex: '#331a99', editable: false })
  })

  it('layers doctrine groups, holy sites and families with display names', () => {
    const data = load()
    const tenets = data.groups.find((g) => g.id === 'doctrine_core_tenets')!
    expect(tenets.picks).toBe(3)
    expect(tenets.category).toBe('core_tenets')
    expect(tenets.doctrines.map((d) => d.id)).toEqual([
      'tenet_hero_cult',
      'tenet_astrology',
      'tenet_adaptive'
    ])
    expect(tenets.doctrines[0].name).toBe('Hero Cult')

    const head = data.groups.find((g) => g.id === 'doctrine_head_of_faith')!
    expect(head.picks).toBe(1)
    expect(head.name).toBe('Head of Faith')
    // The trailing comment is not a doctrine of its own
    expect(head.doctrines.map((d) => d.id)).toEqual(['doctrine_no_head', 'doctrine_spiritual_head'])

    expect(data.ungroupedDoctrines.map((d) => d.id)).toEqual(['special_doctrine_ungrouped'])
    expect(data.holySites.find((h) => h.id === 'delphi')!.name).toBe('Delphi')
    expect(data.families.find((f) => f.id === 'rf_pagan')!.name).toBe('Pagan')
  })

  it('lets a mod definition beat a game one of the same id', () => {
    writeFixture(modPath, 'common/religion/religion_types/HAAO_judaism.txt', MOD_OVERRIDE)
    const judaism = load().religions.find((r) => r.id === 'judaism_religion')!
    expect(judaism).toMatchObject({ inMod: true, family: 'rf_mod' })
    // Its faiths came with the losing definition, so they are gone too
    expect(load().faiths.some((f) => f.id === 'rabbinism')).toBe(false)
  })

  it('hides game religions when the mod replaces the folder', () => {
    const data = load(['common/religion/religion_types'])
    expect(data.religions.map((r) => r.id)).toEqual(['hellenism_religion'])
    // Doctrines and holy sites are NOT replaced, so they still come from the game
    expect(data.groups.length).toBe(2)
  })

  it('reads colours and doctrines out of a CRLF file', () => {
    writeFixture(
      modPath,
      'common/religion/religion_types/crlf.txt',
      MOD_RELIGION.replace(/\n/g, '\r\n')
        .replace('hellenism_religion', 'crlf_religion')
        .replace(/olympian/g, 'crlf_faith')
    )
    const faith = load().faiths.find((f) => f.id === 'crlf_faith')!
    // The \r every line of a CRLF file carries must not hide its value
    expect(faith.color).toMatchObject({ hex: '#991a1a', editable: true })
    expect(faith.icon).toBe('mycenaean_shield')
    expect(faith.holySites).toEqual(['delphi', 'olympia'])
  })

  it('follows a display name that aliases another localization key', () => {
    writeFixture(
      gameDir,
      'localization/english/religion/aliases_l_english.yml',
      [
        'l_english:',
        ' doctrine_core_tenets_name:0 "$tenets_shorthand$"',
        ' tenets_shorthand:0 "Tenets"',
        ''
      ].join('\n')
    )
    expect(load().groups.find((g) => g.id === 'doctrine_core_tenets')!.name).toBe('Tenets')
  })

  it('collects adherents from the mod history, under either key spelling', () => {
    const adherents = load().adherents
    expect(adherents).toEqual([
      { id: '1', file: 'mock.txt', name: 'Alexios', faith: 'olympian', rite: null },
      { id: '2', file: 'mock.txt', name: null, faith: 'delian', rite: null }
    ])
  })
})

describe('saveFaith', () => {
  const faithFile = join(modPath, 'common/religion/religion_types/HAAO_hellenic.txt')
  const read = (): string => readFileSync(faithFile, 'utf-8')

  const patchOf = (id: string) => {
    const f = getReligionData(gameDir, modPath, []).faiths.find((x) => x.id === id)!
    return {
      color: f.color?.hex ?? null,
      icon: f.icon,
      reformedIcon: f.reformedIcon,
      religiousHead: f.religiousHead,
      doctrines: [...f.doctrines],
      holySites: [...f.holySites]
    }
  }

  it('round-trips a no-op save byte-for-byte', () => {
    const before = read()
    expect(saveFaith(modPath, 'HAAO_hellenic.txt', 'hellenism_religion', 'olympian', patchOf('olympian'))).toEqual({ ok: true })
    expect(read()).toBe(before)
  })

  it('edits only the lines it touches, keeping doctrine comments', () => {
    const patch = patchOf('olympian')
    patch.icon = 'tripod'
    patch.religiousHead = 'd_olympia'
    patch.doctrines = ['tenet_hero_cult', 'tenet_adaptive']
    expect(saveFaith(modPath, 'HAAO_hellenic.txt', 'hellenism_religion', 'olympian', patch)).toEqual({ ok: true })
    const text = read()
    expect(text).toContain('\t\t\ticon = tripod')
    // Surviving doctrines keep their annotations; only the surplus line goes
    expect(text).toContain('doctrine = tenet_hero_cult # the big one')
    expect(text).not.toContain('tenet_astrology')
    expect(text).toContain('doctrine = tenet_adaptive')
    // New scalars land inside the faith, not in the religion around it
    expect(text).toContain('\t\t\treligious_head = d_olympia')
    // The rest of the file is untouched
    expect(text).toContain('\t\t\t#holy_site = rome')
    expect(text).toContain('LongName = olympian_long_name')
    expect(text).toContain('\tdoctrine = doctrine_monogamy # for now')
  })

  it('rewrites a colour in the numeric style the line already used', () => {
    const patch = patchOf('olympian')
    patch.color = '#3366cc'
    saveFaith(modPath, 'HAAO_hellenic.txt', 'hellenism_religion', 'olympian', patch)
    expect(read()).toContain('color = { 0.2 0.4 0.8 }')

    const inline = patchOf('delian')
    inline.color = '#3366cc'
    saveFaith(modPath, 'HAAO_hellenic.txt', 'hellenism_religion', 'delian', inline)
    expect(read()).toContain('delian = { color = { 51 102 204 } icon = delos_palm }')
  })

  it('leaves a colour it cannot rewrite alone', () => {
    writeFixture(modPath, 'common/religion/religion_types/00_judaism.txt', GAME_RELIGION)
    const path = join(modPath, 'common/religion/religion_types/00_judaism.txt')
    const patch = {
      color: '#123456',
      icon: null,
      reformedIcon: null,
      religiousHead: null,
      doctrines: [],
      holySites: ['jerusalem']
    }
    expect(saveFaith(modPath, '00_judaism.txt', 'judaism_religion', 'rabbinism', patch)).toEqual({ ok: true })
    expect(readFileSync(path, 'utf-8')).toContain('color = hsv{ 0.5 1.0 1.0 }')
  })

  it('clears a scalar by dropping its line', () => {
    const patch = patchOf('olympian')
    patch.reformedIcon = null
    saveFaith(modPath, 'HAAO_hellenic.txt', 'hellenism_religion', 'olympian', patch)
    expect(read()).not.toContain('reformed_icon')
    expect(read()).toContain('icon = mycenaean_shield')
  })

  it('keeps a single-line faith on one line when adding repeats', () => {
    const patch = patchOf('delian')
    patch.doctrines = ['tenet_hero_cult']
    patch.holySites = ['delphi']
    saveFaith(modPath, 'HAAO_hellenic.txt', 'hellenism_religion', 'delian', patch)
    expect(read()).toContain(
      'delian = { color = { 25 150 175 } icon = delos_palm holy_site = delphi doctrine = tenet_hero_cult }'
    )
  })

  it('reports a missing faith, religion or file', () => {
    const patch = patchOf('olympian')
    expect(saveFaith(modPath, 'HAAO_hellenic.txt', 'hellenism_religion', 'nope', patch)).toEqual({
      ok: false,
      error: 'nope not found in hellenism_religion'
    })
    expect(saveFaith(modPath, 'HAAO_hellenic.txt', 'nope_religion', 'olympian', patch).ok).toBe(false)
    expect(saveFaith(modPath, 'missing.txt', 'hellenism_religion', 'olympian', patch)).toEqual({
      ok: false,
      error: 'File not found: missing.txt'
    })
  })
})

describe('saveReligion', () => {
  const path = join(modPath, 'common/religion/religion_types/HAAO_hellenic.txt')
  const read = (): string => readFileSync(path, 'utf-8')

  const patchOf = () => {
    const r = getReligionData(gameDir, modPath, []).religions.find((x) => x.id === 'hellenism_religion')!
    return {
      family: r.family,
      graphicalFaith: r.graphicalFaith,
      pietyIconGroup: r.pietyIconGroup,
      doctrines: [...r.doctrines]
    }
  }

  it('round-trips a no-op save byte-for-byte', () => {
    const before = read()
    expect(saveReligion(modPath, 'HAAO_hellenic.txt', 'hellenism_religion', patchOf())).toEqual({ ok: true })
    expect(read()).toBe(before)
  })

  it('edits religion scalars without reaching into its faiths', () => {
    const patch = patchOf()
    patch.family = 'rf_abrahamic'
    patch.doctrines = ['doctrine_no_head', 'doctrine_monogamy', 'doctrine_spiritual_head']
    expect(saveReligion(modPath, 'HAAO_hellenic.txt', 'hellenism_religion', patch)).toEqual({ ok: true })
    const text = read()
    expect(text).toContain('\tfamily = rf_abrahamic')
    expect(text).toContain('\tdoctrine = doctrine_spiritual_head')
    // The faiths' own doctrines and colours are untouched
    expect(text).toContain('\t\t\tdoctrine = tenet_hero_cult # the big one')
    expect(text).toContain('\t\t\tcolor = { 0.6 0.1 0.1 }')
  })

  it('quotes a newly inserted piety_icon_group, matching the game’s style', () => {
    writeFixture(modPath, 'common/religion/religion_types/bare.txt', 'bare_religion = {\n\tfamily = rf_pagan\n}\n')
    expect(
      saveReligion(modPath, 'bare.txt', 'bare_religion', {
        family: 'rf_pagan',
        graphicalFaith: null,
        pietyIconGroup: 'pagan',
        doctrines: []
      })
    ).toEqual({ ok: true })
    expect(readFileSync(join(modPath, 'common/religion/religion_types/bare.txt'), 'utf-8')).toContain(
      '\tpiety_icon_group = "pagan"'
    )
  })
})
describe('createReligion', () => {
  const path = join(modPath, 'common/religion/religion_types/HAAO_new.txt')
  const def = (over = {}) => ({
    id: 'illyrian_religion',
    family: 'rf_pagan',
    graphicalFaith: 'pagan_gfx',
    pietyIconGroup: 'pagan',
    doctrines: ['doctrine_no_head'],
    ...over
  })

  it('appends a new block with an empty faiths list to a fresh file', () => {
    expect(createReligion(modPath, 'HAAO_new.txt', def())).toEqual({ ok: true })
    expect(readFileSync(path, 'utf-8')).toBe(
      [
        'illyrian_religion = {',
        '\tfamily = rf_pagan',
        '\tgraphical_faith = pagan_gfx',
        '\tpiety_icon_group = "pagan"',
        '\tdoctrine = doctrine_no_head',
        '',
        '\tfaiths = {',
        '\t}',
        '}',
        ''
      ].join('\n')
    )
    // The scan picks the new religion up, editable
    const created = load().religions.find((r) => r.id === 'illyrian_religion')!
    expect(created).toMatchObject({ inMod: true, family: 'rf_pagan', file: 'HAAO_new.txt' })
  })

  it('appends to an existing file without touching its bytes', () => {
    const target = join(modPath, 'common/religion/religion_types/HAAO_hellenic.txt')
    const before = readFileSync(target, 'utf-8')
    expect(createReligion(modPath, 'HAAO_hellenic.txt', def())).toEqual({ ok: true })
    const after = readFileSync(target, 'utf-8')
    expect(after.startsWith(before)).toBe(true)
    expect(after).toContain('illyrian_religion = {')
  })

  it('skips blank optional fields', () => {
    createReligion(modPath, 'HAAO_new.txt', def({ graphicalFaith: null, pietyIconGroup: '  ', doctrines: [] }))
    const text = readFileSync(path, 'utf-8')
    expect(text).not.toContain('graphical_faith')
    expect(text).not.toContain('piety_icon_group')
    expect(text).not.toContain('doctrine =')
  })

  it('rejects a missing family, a bad id, a clash, and a bad file name', () => {
    expect(createReligion(modPath, 'x.txt', def({ family: null }))).toEqual({
      ok: false,
      error: 'Family is required'
    })
    expect(createReligion(modPath, 'x.txt', def({ id: 'has space' })).ok).toBe(false)
    expect(createReligion(modPath, 'x.txt', def({ id: 'Hellenism_Religion' }))).toEqual({
      ok: false,
      error: 'ID Hellenism_Religion already exists in HAAO_hellenic.txt'
    })
    // A faith id can't become a religion id either — deep links resolve both
    expect(createReligion(modPath, 'x.txt', def({ id: 'olympian' }))).toEqual({
      ok: false,
      error: 'ID olympian is already a faith, defined in HAAO_hellenic.txt'
    })
    expect(createReligion(modPath, 'sub/dir.txt', def()).ok).toBe(false)
    // Only mod ids block: shadowing the game's judaism_religion is legal
    expect(createReligion(modPath, 'x.txt', def({ id: 'judaism_religion' }))).toEqual({ ok: true })
  })
})

describe('createFaith', () => {
  const path = join(modPath, 'common/religion/religion_types/HAAO_hellenic.txt')
  const def = (over = {}) => ({
    id: 'ionian_faith',
    color: '#3366cc',
    icon: 'delos_palm',
    reformedIcon: null,
    religiousHead: null,
    holySites: ['delphi'],
    doctrines: ['tenet_hero_cult'],
    ...over
  })

  it('nests the new faith into the religion, keeping every original byte', () => {
    const before = readFileSync(path, 'utf-8')
    expect(createFaith(modPath, 'hellenism_religion', def())).toEqual({ ok: true })
    const after = readFileSync(path, 'utf-8')
    const block = [
      '\t\tionian_faith = {',
      '\t\t\tcolor = { 51 102 204 }',
      '\t\t\ticon = delos_palm',
      '\t\t\tholy_site = delphi',
      '\t\t\tdoctrine = tenet_hero_cult',
      '\t\t}'
    ].join('\n')
    expect(after).toContain(block)
    // Removing exactly the inserted lines (with the blank line before them)
    // recovers the original file
    expect(after.replace('\n\n' + block, '')).toBe(before)
    // The scan reads it back
    const created = load().faiths.find((f) => f.id === 'ionian_faith')!
    expect(created).toMatchObject({
      religion: 'hellenism_religion',
      inMod: true,
      icon: 'delos_palm',
      holySites: ['delphi'],
      doctrines: ['tenet_hero_cult']
    })
    expect(created.color).toMatchObject({ hex: '#3366cc', editable: true })
  })

  it('creates the faiths block when the religion has none', () => {
    writeFixture(
      modPath,
      'common/religion/religion_types/bare.txt',
      ['bare_religion = {', '\tfamily = rf_pagan', '}', ''].join('\n')
    )
    expect(createFaith(modPath, 'bare_religion', def())).toEqual({ ok: true })
    const text = readFileSync(join(modPath, 'common/religion/religion_types/bare.txt'), 'utf-8')
    expect(text).toBe(
      [
        'bare_religion = {',
        '\tfamily = rf_pagan',
        '',
        '\tfaiths = {',
        '\t\tionian_faith = {',
        '\t\t\tcolor = { 51 102 204 }',
        '\t\t\ticon = delos_palm',
        '\t\t\tholy_site = delphi',
        '\t\t\tdoctrine = tenet_hero_cult',
        '\t\t}',
        '\t}',
        '}',
        ''
      ].join('\n')
    )
  })

  it('matches a CRLF file’s line endings and space indentation', () => {
    writeFixture(
      modPath,
      'common/religion/religion_types/crlf.txt',
      ['crlf_religion = {', '  family = rf_pagan', '  faiths = {', '  }', '}', ''].join('\r\n')
    )
    expect(createFaith(modPath, 'crlf_religion', def({ holySites: [], doctrines: [] }))).toEqual({
      ok: true
    })
    const text = readFileSync(join(modPath, 'common/religion/religion_types/crlf.txt'), 'utf-8')
    expect(text).toBe(
      [
        'crlf_religion = {',
        '  family = rf_pagan',
        '  faiths = {',
        '    ionian_faith = {',
        '      color = { 51 102 204 }',
        '      icon = delos_palm',
        '    }',
        '  }',
        '}',
        ''
      ].join('\r\n')
    )
  })

  it('rejects clashes, cross-kind ids, and a religion the mod does not define', () => {
    expect(createFaith(modPath, 'hellenism_religion', def({ id: 'Olympian' }))).toEqual({
      ok: false,
      error: 'ID Olympian already exists in HAAO_hellenic.txt'
    })
    expect(createFaith(modPath, 'hellenism_religion', def({ id: 'hellenism_religion' }))).toEqual({
      ok: false,
      error: 'ID hellenism_religion is already a religion, defined in HAAO_hellenic.txt'
    })
    const gameParent = createFaith(modPath, 'judaism_religion', def())
    expect(!gameParent.ok && gameParent.error).toContain(
      "isn't defined in the mod"
    )
    // Shadowing a game faith id is legal
    expect(createFaith(modPath, 'hellenism_religion', def({ id: 'rabbinism' }))).toEqual({
      ok: true
    })
  })

  it('a created faith round-trips through a no-op save byte-for-byte', () => {
    createFaith(modPath, 'hellenism_religion', def())
    const before = readFileSync(path, 'utf-8')
    const f = load().faiths.find((x) => x.id === 'ionian_faith')!
    expect(
      saveFaith(modPath, f.file, f.religion, f.id, {
        color: f.color?.hex ?? null,
        icon: f.icon,
        reformedIcon: f.reformedIcon,
        religiousHead: f.religiousHead,
        doctrines: [...f.doctrines],
        holySites: [...f.holySites]
      })
    ).toEqual({ ok: true })
    expect(readFileSync(path, 'utf-8')).toBe(before)
  })
})

describe('listReligionFiles', () => {
  it('lists only the mod folder, sorted, and tolerates a missing folder', () => {
    expect(listReligionFiles(modPath)).toEqual(['HAAO_hellenic.txt'])
    expect(listReligionFiles(join(modPath, 'nope'))).toEqual([])
  })
})
