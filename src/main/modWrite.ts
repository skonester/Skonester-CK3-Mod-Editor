import { writeFileSync } from 'fs'

/**
 * How the editors write a mod's text files. The app records each write for
 * undo (modsHost.ts installs that at startup); without it — the unit tests,
 * scripts — a write is just a write.
 */
type Recorder = (path: string, write: () => string) => void

let record: Recorder = (_path, write) => {
  write()
}

export function setModWriteRecorder(r: Recorder): void {
  record = r
}

/** Writes a text file of the selected mod (UTF-8), recorded for undo when the app runs */
export function writeModText(path: string, text: string): void {
  record(path, () => {
    writeFileSync(path, text, 'utf-8')
    return text
  })
}
