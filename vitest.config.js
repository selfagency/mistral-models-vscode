import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'src/test/vscode.mock.ts'),
    },
  },
  test: {
    environment: 'node',
    restoreMocks: true,
  },
})
