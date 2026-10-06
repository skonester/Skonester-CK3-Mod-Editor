import { configDefaults, defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@crusaderpope': resolve(__dirname, 'src/crusaderpope'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    // Concurrent sessions keep git worktrees of this repo under .claude/, each
    // with its own copy of these tests. Without this they are all collected and
    // run against THIS worktree's aliases, inflating the count and letting an
    // unrelated branch fail the suite here.
    exclude: [...configDefaults.exclude, '**/.claude/**']
  }
})
