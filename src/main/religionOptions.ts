import type { FaithOptions, ReligionOptions, RiteOptions } from '@shared/types'
import { terminateScriptComment, validateScriptFragment } from '@shared/scriptValidation'
import { makeEditor, setBlockBody, setBlockList, setScalar } from './lineEditor'
import { scanBlocks, scanScalarsCI } from './pdx'
import { blockList, nestedBody } from './religionSchema'
import { KEY_CHARS } from './scriptFile'

type ScalarSpec = readonly [field: string, key: string, kind?: 'flag' | 'number' | 'text']
const faithDetails: ScalarSpec[] = [
  ['headOfRite', 'head_of_rite'],
  ['graphicalFaith', 'graphical_faith'],
  ['theocracyGovernmentType', 'theocracy_government_type']
]
const faithScalars: ScalarSpec[] = [
  ['origin', 'origin'],
  ['historical', 'historical', 'flag']
]
const religionDetails: ScalarSpec[] = [
  ['tenetBackgroundIcon', 'tenet_background_icon', 'text'],
  ['theocracyGovernmentType', 'theocracy_government_type']
]
const religionScalars: ScalarSpec[] = [
  ['mainHolySite', 'main_holy_site'],
  ['paganRoots', 'pagan_roots', 'flag'],
  ['eminentHolySitesMin', 'eminent_holy_sites_min', 'number'],
  ['eminentHolySitesMax', 'eminent_holy_sites_max', 'number'],
  ['holySitesMin', 'holy_sites_min', 'number'],
  ['holySitesMax', 'holy_sites_max', 'number']
]
const riteScalars: ScalarSpec[] = [
  ['nameKey', 'name'],
  ['descriptionKey', 'desc']
]
const names = [
  ['reservedMaleNames', 'reserved_male_names'],
  ['reservedFemaleNames', 'reserved_female_names']
] as const
const faithLists = [...names, ['cultures', 'cultures']] as const
const religionLists = [...names, ['customFaithIcons', 'custom_faith_icons']] as const

function scalarValues(body: string, specs: ScalarSpec[]): Record<string, string | null> {
  const scalars = scanScalarsCI(body)
  return Object.fromEntries(specs.map(([field, key]) => [field, scalars.get(key) ?? null]))
}
function listValues(
  body: string,
  specs: readonly (readonly [string, string])[]
): Record<string, string[]> {
  return Object.fromEntries(specs.map(([field, key]) => [field, blockList(body, key)]))
}
export function readFaithOptions(body: string): FaithOptions {
  return {
    ...scalarValues(nestedBody(body, 'faith_details') ?? body, faithDetails),
    ...scalarValues(body, faithScalars),
    ...listValues(body, faithLists)
  }
}
export function readReligionOptions(body: string): ReligionOptions {
  return {
    ...scalarValues(nestedBody(body, 'religion_details') ?? body, religionDetails),
    ...scalarValues(body, religionScalars),
    ...listValues(body, religionLists),
    traitsScript: nestedBody(body, 'traits')
  }
}
export function readRiteOptions(body: string): RiteOptions {
  return { ...scalarValues(body, riteScalars), cultures: blockList(body, 'cultures') }
}

function applyScalars(body: string, options: object, specs: ScalarSpec[]): string {
  const ed = makeEditor(body)
  const current = scanScalarsCI(body)
  for (const [field, key, kind] of specs) {
    const value = (options as Record<string, string | null | undefined>)[field]
    if (value === undefined) continue
    if (value === (current.get(key) ?? null)) continue
    if (value !== null) {
      const valid =
        kind === 'flag'
          ? /^(yes|no)$/.test(value)
          : kind === 'number'
            ? /^\d+$/.test(value)
            : kind === 'text'
              ? !/[\s{}"#=\0]/.test(value)
              : KEY_CHARS.test(value)
      if (!valid) throw new Error(`Invalid ${key} value`)
    }
    // A dynamic name/description block must never be deleted by a missing scalar.
    if (scanBlocks(body).some((b) => b.key.toLowerCase() === key)) {
      if (value !== null)
        throw new Error(`${key} is a scripted block; edit it in the definition file`)
      continue
    }
    setScalar(ed, [key], value, { ignoreCase: true, quoteNew: kind === 'text' })
  }
  return ed.lines.join('\n')
}
function applyLists(
  body: string,
  options: object,
  specs: readonly (readonly [string, string])[]
): string {
  const ed = makeEditor(body)
  for (const [field, key] of specs) {
    const values = (options as Record<string, string[] | undefined>)[field]
    if (values === undefined || JSON.stringify(blockList(body, key)) === JSON.stringify(values))
      continue
    const isName = key.startsWith('reserved_')
    for (const value of values) {
      if (isName ? !value || /["\r\n\0]/.test(value) : !KEY_CHARS.test(value))
        throw new Error(`Invalid value in ${key}`)
    }
    setBlockList(
      ed,
      key,
      values.map((v) => (isName && !KEY_CHARS.test(v) ? `"${v}"` : v))
    )
  }
  return ed.lines.join('\n')
}
function applyDetails(body: string, key: string, options: object, specs: ScalarSpec[]): string {
  const details = scanBlocks(body).find((b) => b.key.toLowerCase() === key)
  if (!details) return applyScalars(body, options, specs)
  const updated = applyScalars(body.slice(details.bodyStart, details.bodyEnd), options, specs)
  return body.slice(0, details.bodyStart) + updated + body.slice(details.bodyEnd)
}
export function applyFaithOptions(body: string, options?: FaithOptions): string {
  if (!options) return body
  return applyLists(
    applyScalars(applyDetails(body, 'faith_details', options, faithDetails), options, faithScalars),
    options,
    faithLists
  )
}
export function applyReligionOptions(body: string, options?: ReligionOptions): string {
  if (!options) return body
  let updated = applyLists(
    applyScalars(
      applyDetails(body, 'religion_details', options, religionDetails),
      options,
      religionScalars
    ),
    options,
    religionLists
  )
  if (
    options.traitsScript !== undefined &&
    options.traitsScript !== nestedBody(updated, 'traits')
  ) {
    const script = options.traitsScript
    if (script !== null) {
      const error = validateScriptFragment(script)
      if (error) throw new Error(`Traits: ${error}`)
    }
    const existing = scanBlocks(updated).find((b) => b.key.toLowerCase() === 'traits')
    if (existing && script !== null) {
      const eol = body.includes('\r\n') ? '\r\n' : '\n'
      updated =
        updated.slice(0, existing.bodyStart) +
        terminateScriptComment(script.replace(/\r?\n/g, eol), eol) +
        updated.slice(existing.bodyEnd)
    } else {
      const ed = makeEditor(updated)
      setBlockBody(
        ed,
        'traits',
        script === null
          ? null
          : (indent) => ({
              single: ` ${terminateScriptComment(script.trim(), body.includes('\r\n') ? '\r\n' : '\n')} `,
              multi: script
                .trim()
                .split(/\r?\n/)
                .map((l) => `${indent}${l}`)
            })
      )
      updated = ed.lines.join('\n')
    }
  }
  return updated
}
export function applyRiteOptions(body: string, options?: RiteOptions): string {
  return options
    ? applyLists(applyScalars(body, options, riteScalars), options, [['cultures', 'cultures']])
    : body
}
