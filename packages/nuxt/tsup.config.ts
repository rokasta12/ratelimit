import { defineConfig, type Options } from "tsup";

const config: Options = {
  entry: ["src/module.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  external: ["@nuxt/kit", "@nuxt/schema", "nuxt", "#imports", "h3"],
};

export default defineConfig(config);
