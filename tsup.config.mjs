import { defineConfig } from 'tsup';

const production = process.env.NODE_ENV === 'production'

export default defineConfig({
  entry: ['src/extension.ts'],
  outDir: 'dist',
  format: ['cjs'],
  platform: 'node',
  external: ['vscode'],
  noExternal: ['@mistralai/mistralai', 'js-tiktoken', '@selfagency/llm-stream-parser'],
  // llm-stream-parser ships ESM-only subpath exports; resolve them to CJS via bundling
  bundle: true,
  sourcemap: !production,
  minify: production,
  clean: true,
  esbuildOptions(options) {
    options.sourcesContent = false
  },
})
