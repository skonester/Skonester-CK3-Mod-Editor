import type { RefEntry } from '@shared/types'
import ReferenceBadge from './ReferenceBadge'
import ReferenceInput from './ReferenceInput'
import { findRef } from './ReferenceLabel'

/** Tenets have their own database in 1.20, independent of doctrine groups. */
export default function TenetEditor({
  values,
  options,
  disabled,
  onChange,
  gameDir,
  modPath,
  replacePaths
}: {
  values: string[]
  options: RefEntry[]
  disabled: boolean
  onChange: (values: string[]) => void
  gameDir: string | null
  modPath: string
  replacePaths: string[]
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {values.map((id, index) => (
          <ReferenceBadge
            key={`${id}:${index}`}
            entry={findRef(options, id)}
            locate={() => window.ck3tools.locateRef(gameDir, modPath, replacePaths, 'tenet', id)}
            onRemove={disabled ? undefined : () => onChange(values.filter((_, i) => i !== index))}
          />
        ))}
        {values.length === 0 && <span className="text-sm text-muted-foreground">none</span>}
      </div>
      {!disabled && (
        <ReferenceInput
          options={options.filter((o) => !values.includes(o.id))}
          placeholder="Add tenet…"
          onAdd={(id) => onChange([...values, id])}
        />
      )}
    </div>
  )
}
