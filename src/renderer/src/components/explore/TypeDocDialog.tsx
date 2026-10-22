import { useEffect, useState } from 'react'
import type { TypeSummary } from '@crusaderpope/shared/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'

/**
 * The documentation Paradox ships with the game for a type of entry — the
 * `.info` / readme files next to its definitions (`common/traits/_traits.info`
 * …) — as the game has them.
 */
export default function TypeDocDialog({
  type,
  onClose
}: {
  /** the type to show; null: closed */
  type: TypeSummary | null
  onClose: () => void
}): React.JSX.Element {
  const [docs, setDocs] = useState<{ file: string; text: string }[] | null>(null)

  useEffect(() => {
    setDocs(null)
    if (!type) return
    let live = true
    void window.api.typeDoc(type.id).then((d) => live && setDocs(d))
    return () => {
      live = false
    }
  }, [type])

  return (
    <Dialog open={type !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{type?.label}</DialogTitle>
          <DialogDescription>
            The documentation shipped with the game · <span className="font-mono">{type?.id}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {docs === null ? (
            <Spinner />
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">The game ships no documentation for this.</p>
          ) : (
            docs.map((d) => (
              <section key={d.file} className="mb-4">
                <h3 className="mb-1 font-mono text-xs text-muted-foreground">{d.file}</h3>
                <pre className="rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
                  {d.text}
                </pre>
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
