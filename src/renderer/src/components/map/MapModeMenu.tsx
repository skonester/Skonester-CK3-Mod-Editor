import { useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Mode, ModeDef } from '@crusaderpope/renderer/src/components/map/model'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/** The modes in sections, as CrusaderPope's mode bar groups them */
const SECTIONS: [string, string[]][] = [
  ['Political', ['realm', 'vassal', 'government', 'dynasty', 'house', 'liege', 'council']],
  ['De jure', ['h', 'e', 'k', 'd', 'c', 'b']],
  [
    'Society',
    [
      'culture',
      'heritage',
      'language',
      'ethnicity',
      'faith',
      'religion',
      'religionfamily',
      'holysite',
      'doctrine'
    ]
  ],
  [
    'Land',
    [
      'terrain',
      'holding',
      'development',
      'building',
      'specialbuilding',
      'region',
      'province',
      'climate',
      'winter'
    ]
  ]
]

/** A mode id's section, singular or plural ('holy_sites' → Society, 'dynasties' → Political) */
function sectionOf(id: Mode): string {
  const key = id.toLowerCase().replace(/[^a-z]/g, '')
  const is = (k: string): boolean =>
    key === k || key === k + 's' || (k.endsWith('y') && key === k.slice(0, -1) + 'ies')
  return SECTIONS.find(([, ids]) => ids.some(is))?.[0] ?? 'Other'
}

/**
 * The map's modes in sections — Political, De jure, Society, Land, Other —
 * each a button showing the section's current (or last used) mode, with a
 * menu of the rest of its modes.
 */
export default function MapModeMenu({
  modes,
  mode,
  onMode
}: {
  modes: ModeDef[]
  mode: Mode
  onMode: (m: Mode) => void
}): React.JSX.Element {
  // Each section's last mode, so going back to a section shows it again
  const last = useRef(new Map<string, Mode>())
  const active = sectionOf(mode)
  last.current.set(active, mode)
  const sections = [...SECTIONS.map(([s]) => s), 'Other']
    .map((s) => ({ s, modes: modes.filter((m) => sectionOf(m.id) === s) }))
    .filter((x) => x.modes.length > 0)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {sections.map(({ s, modes: inSection }) => {
        const shown = inSection.find((m) => m.id === last.current.get(s)) ?? inSection[0]
        const on = s === active
        return (
          <ButtonGroup key={s}>
            <Button
              variant={on ? 'default' : 'outline'}
              size="sm"
              title={shown.title ?? shown.label}
              onClick={() => onMode(shown.id)}
            >
              <span className="text-[0.65rem] uppercase opacity-70">{s}</span>
              {shown.label}
            </Button>
            {inSection.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={on ? 'default' : 'outline'} size="icon-sm" title={`${s} modes`}>
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-96">
                  <DropdownMenuRadioGroup value={on ? mode : ''} onValueChange={onMode}>
                    {inSection.map((m) => (
                      <DropdownMenuRadioItem key={m.id} value={m.id} title={m.title}>
                        {m.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </ButtonGroup>
        )
      })}
    </div>
  )
}
