import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://rokasta12.github.io",
  base: "/ratelimit",
  integrations: [
    starlight({
      title: "@jf/ratelimit",
      description:
        "Open-source rate limiting for Node.js and Edge. Protect APIs with Hono, Express, H3, Nuxt.",
      social: {
        github: "https://github.com/rokasta12/ratelimit",
      },
      head: [
        {
          tag: "meta",
          attrs: {
            name: "keywords",
            content:
              "rate limiting, nodejs, hono, express, nuxt, h3, redis, cloudflare workers, api protection, typescript",
          },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "https://rokasta12.github.io/ratelimit/og-image.png",
          },
        },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "guides/introduction" },
            { label: "Quick Start", slug: "guides/quickstart" },
          ],
        },
        {
          label: "Packages",
          items: [
            { label: "@jf/ratelimit (Core)", slug: "packages/core" },
            { label: "@jf/ratelimit-hono", slug: "packages/hono" },
            { label: "@jf/ratelimit-express", slug: "packages/express" },
            { label: "@jf/ratelimit-h3", slug: "packages/h3" },
            { label: "@jf/ratelimit-nuxt", slug: "packages/nuxt" },
            { label: "@jf/ratelimit-unstorage", slug: "packages/unstorage" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Algorithms", slug: "concepts/algorithms" },
            { label: "Stores", slug: "concepts/stores" },
          ],
        },
      ],
    }),
  ],
});
