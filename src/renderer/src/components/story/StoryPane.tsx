import type { EntityKey } from '@crusaderpope/shared/api'
import { ReadCtx } from './rich'
import StoryView from './StoryView'

/** The reader sheet's body: one entry's readable view, its links followed by `follow` */
export default function StoryPane({
  entry,
  follow,
  showHidden
}: {
  entry: EntityKey
  follow: (key: EntityKey) => void
  showHidden: boolean
}): React.JSX.Element {
  return (
    <ReadCtx.Provider value={{ follow, showHidden }}>
      <StoryView entry={entry} />
    </ReadCtx.Provider>
  )
}
