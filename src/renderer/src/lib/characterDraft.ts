import type { CharacterDetail } from '@shared/types'

/** Supply fields older persisted drafts did not know, without clearing a file's rite. */
export function normalizeCharacterDraft(
  detail: CharacterDetail,
  current?: CharacterDetail
): CharacterDetail {
  const { rite, ...fields } = detail
  return {
    ...fields,
    house: detail.house ?? null,
    female: detail.female ?? null,
    sexuality: detail.sexuality ?? null,
    spouses: (detail.spouses ?? []).map((s) => ({ ...s, concubine: s.concubine === true })),
    relations: detail.relations ?? [],
    dna: detail.dna ?? null,
    // Drafts from before the script view carry none: take the file's
    scripts: detail.scripts ?? current?.scripts,
    // Undefined means the older editor never saw this field; null is an explicit clear.
    // Append it consistently so JSON-based draft comparisons ignore property order.
    rite: rite === undefined ? (current?.rite ?? null) : rite
  }
}
