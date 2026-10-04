/** Older drafts did not include advanced options; take those from the current file. */
export function migrateDefinitionDraft<T extends object>(stored: T, current: T): T {
  const previous = stored as T & { options?: unknown }
  const live = current as T & { options?: unknown }
  return { ...stored, options: previous.options ?? live.options }
}
