import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://rokasta12.github.io",
  base: "/ratelimit",
  integrations: [
    starlight({
      title: "@jf/ratelimit",
      description: "Multi-framework rate limiting for JavaScript/TypeScript",
      social: {
        github: "https://github.com/rokasta12/ratelimit",
      },
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "guides/introduction" },
            { label: "Quick Start", slug: "guides/quickstart" },
          ],
        },
        {
          label: "Frameworks",
          items: [
            { label: "Hono", slug: "frameworks/hono" },
            { label: "Express", slug: "frameworks/express" },
            { label: "H3 / Nitro", slug: "frameworks/h3" },
            { label: "Nuxt", slug: "frameworks/nuxt" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Algorithms", slug: "concepts/algorithms" },
            { label: "Stores", slug: "concepts/stores" },
          ],
        },
        {
          label: "API Reference",
          items: [{ label: "Core", slug: "api/core" }],
        },
      ],
    }),
  ],
});
