// Test-only binding injected by vitest.config.ts (miniflare.bindings). Kept global (no imports)
// so it merges into the wrangler-generated Cloudflare.Env.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('@cloudflare/vitest-plugin').D1Migration[];
  }
}
