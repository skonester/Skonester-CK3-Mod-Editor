import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'

/**
 * The game index cache's code version (from CrusaderPope's config): a hash of
 * the code that decides what a cached index holds — GameIndex and the cache
 * format, with every module they import at run time (relative value imports,
 * followed transitively; `import type` is skipped, types don't change data).
 */
function indexCodeHash(): string {
  const roots = ['src/crusaderpope/main/indexer/gameIndex.ts', 'src/crusaderpope/main/indexer/cache.ts']
  const seen = new Set<string>()
  const hash = createHash('sha1')
  const visit = (file: string): void => {
    if (seen.has(file) || !existsSync(file)) return
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    hash.update(file.slice(__dirname.length)).update(text)
    for (const m of text.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^'"]*?\sfrom\s+['"](\.[^'"]+)['"]/gm)) {
      if (m[1]) continue
      const target = resolve(dirname(file), m[2])
      visit(existsSync(target) ? target : `${target}.ts`)
    }
  }
  for (const r of roots) visit(resolve(__dirname, r))
  return hash.digest('hex')
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __GAME_INDEX_CODE__: JSON.stringify(indexCodeHash()) },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Worker threads load these by file name from out/main
          gameIndexWorker: resolve(__dirname, 'src/main/gameIndexWorker.ts'),
          // CrusaderPope's own threads, under the names its code starts them by
          ...Object.fromEntries(
            [
              'cacheWriter',
              'imageWorker',
              'shaderWorker',
              'mapWorker',
              'mapTerrainWorker',
              'mapOverlaysWorker',
              'blenderWorker'
            ].map((name) => [name, resolve(__dirname, `src/crusaderpope/main/${name}.ts`)])
          )
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    // Honor an externally assigned port (e.g. tooling that sets PORT); vite default otherwise
    server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    }
  }
})
