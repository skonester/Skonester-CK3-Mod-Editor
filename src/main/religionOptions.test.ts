import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createFaith,
  createReligion,
  createRite,
  getReligionData,
  saveFaith,
  saveReligion,
  saveRite
} from './religions'
import { applyReligionOptions } from './religionOptions'
import { validateScriptFragment } from '@shared/scriptValidation'

const scratch: string[] = []
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'ck3-options-'))
  scratch.push(path)
  return path
}
function put(base: string, kind: string, text: string): string {
  const dir = join(base, 'common/religion', kind)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'test.txt')
  writeFileSync(path, text, 'utf-8')
  return path
}
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('expanded religion options', () => {
  it('parses and surgically saves modern faith settings, cultures and names', () => {
    const mod = root()
    const source =
      'my_faith = {\r\n faith_details = { religion = my_religion head_of_rite = "d_old" graphical_faith = catholic_gfx theocracy_government_type = theocracy_government }\r\n origin = older_faith # origin comment\r\n historical = no\r\n cultures = { latin # culture comment\r\n greek }\r\n reserved_male_names = { Isaac "Name # with space" }\r\n main_rite = my_rite\r\n custom_script = { x = yes }\r\n}\r\n'
    const path = put(mod, 'faith_types', source)
    const f = getReligionData(null, mod, []).faiths[0]
    expect(f.options).toMatchObject({
      headOfRite: 'd_old',
      origin: 'older_faith',
      historical: 'no',
      cultures: ['latin', 'greek'],
      reservedMaleNames: ['Isaac', 'Name # with space']
    })
    const patch = { ...f, color: f.color?.hex ?? null }
    expect(saveFaith(mod, f.file, f.religion, f.id, patch)).toEqual({ ok: true })
    expect(readFileSync(path, 'utf-8')).toBe(source)
    expect(
      saveFaith(mod, f.file, f.religion, f.id, {
        ...patch,
        options: {
          ...f.options,
          headOfRite: 'd_new',
          reservedMaleNames: ['Name # with space', 'New Name'],
          origin: null
        }
      })
    ).toEqual({ ok: true })
    const text = readFileSync(path, 'utf-8')
    expect(text).toContain('head_of_rite = "d_new"')
    expect(text).toContain('cultures = { latin # culture comment\r\n greek }')
    expect(text).toContain('custom_script = { x = yes }')
    const saved = getReligionData(null, mod, []).faiths[0]
    expect(saved.options?.reservedMaleNames).toEqual(['Name # with space', 'New Name'])
    expect(saved.options?.origin).toBeNull()
    expect(saved.options?.graphicalFaith).toBe('catholic_gfx')
  })

  it('preserves weighted virtues and sins exactly, including unknown trait options', () => {
    const mod = root()
    const source =
      'my_religion = {\n religion_details = { family = rf_pagan tenet_background_icon = "" theocracy_government_type = theocracy_government }\n main_holy_site = rome\n holy_sites_max = 12\n eminent_holy_sites_min = 0\n pagan_roots = yes\n traits = { virtues = { brave = 0.5 } sins = { stubborn = { scale = 2 weight = 3 unknown = yes } } # weights\n }\n faiths = {}\n}\n'
    const path = put(mod, 'religion_types', source)
    const r = getReligionData(null, mod, []).religions[0]
    expect(r.options).toMatchObject({
      tenetBackgroundIcon: '',
      mainHolySite: 'rome',
      holySitesMax: '12',
      eminentHolySitesMin: '0',
      paganRoots: 'yes'
    })
    expect(saveReligion(mod, r.file, r.id, r)).toEqual({ ok: true })
    expect(readFileSync(path, 'utf-8')).toBe(source)
    expect(
      saveReligion(mod, r.file, r.id, {
        ...r,
        options: { ...r.options, holySitesMax: '15', theocracyGovernmentType: 'custom_government' }
      })
    ).toEqual({ ok: true })
    expect(readFileSync(path, 'utf-8')).toContain(r.options!.traitsScript!)
    const beforeInvalid = readFileSync(path, 'utf-8')
    expect(saveReligion(mod, r.file, r.id, { ...r, options: { holySitesMax: '-1' } }).ok).toBe(
      false
    )
    expect(
      saveReligion(mod, r.file, r.id, { ...r, options: { traitsScript: 'virtues = {' } }).ok
    ).toBe(false)
    expect(readFileSync(path, 'utf-8')).toBe(beforeInvalid)
    const updated = applyReligionOptions(' traits = {} ', {
      traitsScript: 'virtues = { brave = { scale = 1 weight = 2 } } # comment'
    })
    expect(validateScriptFragment(`religion = { ${updated} }`)).toBeNull()
    const inserted = applyReligionOptions('family = rf_pagan ', {
      traitsScript: 'virtues = { brave } # trailing comment'
    })
    expect(validateScriptFragment(`religion = { ${inserted} }`)).toBeNull()
  })

  it('protects dynamic rite names/descriptions and preserves them while editing cultures', () => {
    const mod = root()
    const source =
      'my_rite = { name = { first_valid = { triggered_desc = { trigger = { always = yes } desc = rite_name } } } desc = { desc = rite_description } cultures = { greek } faith = my_faith tenets = {} doctrines = {} }'
    const path = put(mod, 'rite_types', source)
    const r = getReligionData(null, mod, []).rites![0]
    const patch = { ...r, color: r.color?.hex ?? null }
    expect(r).toMatchObject({ dynamicName: true, dynamicDescription: true })
    expect(saveRite(mod, r.file, r.id, patch)).toEqual({ ok: true })
    expect(readFileSync(path, 'utf-8')).toBe(source)
    expect(
      saveRite(mod, r.file, r.id, {
        ...patch,
        options: { ...r.options, cultures: ['greek', 'latin'] }
      })
    ).toEqual({ ok: true })
    expect(readFileSync(path, 'utf-8')).toContain('name = { first_valid')
    const bytes = readFileSync(path)
    expect(saveRite(mod, r.file, r.id, { ...patch, options: { nameKey: 'new_name' } }).ok).toBe(
      false
    )
    expect(readFileSync(path).equals(bytes)).toBe(true)
  })

  it('creates definitions with options in their correct 1.20 scopes', () => {
    const mod = root()
    expect(
      createReligion(mod, 'religions.txt', {
        id: 'my_religion',
        format: '1.20',
        family: 'rf_pagan',
        graphicalFaith: null,
        pietyIconGroup: null,
        doctrines: [],
        options: {
          mainHolySite: 'rome',
          holySitesMax: '9',
          tenetBackgroundIcon: 'gfx/icon.dds',
          traitsScript: 'virtues = { brave }',
          reservedMaleNames: ['A Name']
        }
      })
    ).toEqual({ ok: true })
    expect(
      createFaith(mod, 'my_religion', {
        id: 'my_faith',
        format: '1.20',
        color: null,
        icon: null,
        reformedIcon: null,
        religiousHead: null,
        doctrines: [],
        holySites: [],
        options: {
          headOfRite: 'd_head',
          origin: 'other_faith',
          historical: 'no',
          cultures: ['latin']
        }
      })
    ).toEqual({ ok: true })
    expect(
      createRite(mod, 'rites.txt', {
        id: 'my_rite',
        faith: 'my_faith',
        color: null,
        icon: null,
        founder: null,
        create: null,
        convert: null,
        doctrines: [],
        tenets: [],
        options: { nameKey: 'my_rite_name', descriptionKey: 'my_rite_desc', cultures: ['latin'] }
      })
    ).toEqual({ ok: true })
    const data = getReligionData(null, mod, [])
    expect(data.religions[0].options).toMatchObject({
      mainHolySite: 'rome',
      holySitesMax: '9',
      tenetBackgroundIcon: 'gfx/icon.dds',
      reservedMaleNames: ['A Name']
    })
    expect(data.faiths[0].options).toMatchObject({
      headOfRite: 'd_head',
      origin: 'other_faith',
      historical: 'no',
      cultures: ['latin']
    })
    expect(data.rites![0].options).toMatchObject({
      nameKey: 'my_rite_name',
      descriptionKey: 'my_rite_desc',
      cultures: ['latin']
    })
  })
})
