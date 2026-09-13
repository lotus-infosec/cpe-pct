// `Env` is generated from wrangler.jsonc by `wrangler types`. The two Cloudflare Access variables
// are not declared in that file on purpose: an empty-string var is the documented trigger for the
// Deploy to Cloudflare button refusing a repository (cloudflare/developer-platform#35), and a
// placeholder value would switch the gate on with nonsense credentials. A deployer who wants the
// gate sets both after deploying, so they are optional here and absent by default.
declare global {
  interface Env {
    CF_ACCESS_TEAM?: string;
    CF_ACCESS_AUD?: string;
  }
}
export {};
