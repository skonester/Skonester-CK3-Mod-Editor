import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { getReligionData, saveFaith, saveReligion, saveRite } from './religions'
import { effectiveFiles, getReferenceData } from './refdata'
import { getTitleData } from './titles'
import { getTitleHistory } from './titleHistory'

// Opt-in audit of real game data. All writes target isolated temporary copies.
// CK3_GAME_DIR should point to .../ck3-mod-base/base/game or an installed game data folder.
const game = process.env.CK3_GAME_DIR
describe.skipIf(!game)('supplied CK3 1.20 game data', () => {
  it('loads the religion hierarchy, doctrine options, and top-level succession laws', () => {
    const data = getReligionData(game!, null, [])
    expect(data.format).toBe('1.20')
    expect(data.faiths.length).toBeGreaterThan(100)
    expect(data.rites?.length).toBeGreaterThan(100)
    expect(data.faiths.find((f) => f.id === 'christian_faith')?.religion).toBe(
      'christianity_religion'
    )
    expect(data.rites?.find((r) => r.id === 'roman_rite')?.faith).toBe('christian_faith')
    expect(
      data.groups.find((g) => g.id === 'doctrine_marriage_type')?.doctrines.map((d) => d.id)
    ).toContain('doctrine_monogamy')
    expect(data.tenets?.map((t) => t.id)).toContain('tenet_communion')
    const refs = getReferenceData(game!, null, [])
    expect(refs.faiths.map((f) => f.id)).toContain('christian_faith')
    expect(refs.rites?.map((r) => r.id)).toContain('roman_rite')
    expect(getTitleData(game!, null, []).successionLaws.map((l) => l.id)).toContain(
      'male_preference_law'
    )
    expect(
      getTitleHistory(game!, null, [], 'd_cd_ostia').some((e) => e.file.startsWith('ce3/'))
    ).toBe(true)
  }, 30000)

  it('round-trips every supplied religion, faith, and rite definition without byte changes', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'ck3-live-audit-'))
    const dirs = [
      'common/religion/religion_types',
      'common/religion/faith_types',
      'common/religion/rite_types'
    ]
    try {
      for (const dir of dirs) {
        mkdirSync(join(scratch, dir), { recursive: true })
        cpSync(join(game!, dir), join(scratch, dir), { recursive: true })
      }
      const originals = new Map(
        dirs
          .flatMap((dir) => effectiveFiles(null, scratch, [], dir))
          .map((file) => [file, readFileSync(file)])
      )
      const data = getReligionData(game!, scratch, [])
      for (const r of data.religions)
        expect(saveReligion(scratch, r.file, r.id, r), r.id).toEqual({ ok: true })
      for (const f of data.faiths)
        expect(
          saveFaith(scratch, f.file, f.religion, f.id, {
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
          }),
          f.id
        ).toEqual({ ok: true })
      for (const r of data.rites ?? [])
        expect(
          saveRite(scratch, r.file, r.id, {
            faith: r.faith,
            color: r.color?.hex ?? null,
            icon: r.icon,
            founder: r.founder,
            create: r.create,
            convert: r.convert,
            doctrines: r.doctrines,
            tenets: r.tenets
          }),
          r.id
        ).toEqual({ ok: true })
      for (const [file, before] of originals)
        expect(readFileSync(file).equals(before), file).toBe(true)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }, 30000)
})
