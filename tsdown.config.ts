import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["./src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  treeshake: true,
  dts: true,
  shims: false,
  nodeProtocol: true,
})
