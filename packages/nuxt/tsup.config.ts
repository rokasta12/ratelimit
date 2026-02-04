import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/module.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['@nuxt/kit', '@nuxt/schema', 'nuxt', '#imports', 'h3'],
})
