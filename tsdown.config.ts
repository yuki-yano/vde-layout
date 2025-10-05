import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts'],
  outDir: 'dist',
  format: 'esm',
  clean: true,
  sourcemap: true,
  treeshake: true,
  dts: false,
  nodeProtocol: true,
})
