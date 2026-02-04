<template>
  <div style="font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem;">
    <h1>Nuxt Rate Limit Example</h1>
    <p>This app demonstrates <code>@jfungus/ratelimit-nuxt</code> with per-route config.</p>

    <h2>API Endpoints</h2>
    <ul>
      <li><code>GET /api/public</code> &mdash; 10 req/min (global)</li>
      <li><code>POST /api/auth/login</code> &mdash; 5 req/min</li>
      <li><code>POST /api/upload</code> &mdash; 3 req/5min</li>
      <li><code>GET /api/health</code> &mdash; no rate limit</li>
    </ul>
  </div>
</template>
