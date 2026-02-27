import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'src/test/vscode.mock.ts'),
    },
  },
  test: {
    environment: 'node',
  },
})
