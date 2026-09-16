# button-test

Temporary diagnostic scaffolding. Delete once the Deploy to Cloudflare button works.

The dashboard refuses this repository at the clone step with "There was a problem parsing the
Wrangler configuration file", while an official Cloudflare template deploys fine from the same
session. The message is known to be misattributed: cloudflare/developer-platform#35 documents the
same error being produced by an unrelated empty string in `package.json`, and the endpoint behind
the button is dash-session authenticated, so the real error cannot be read from the CLI.

Three fixes have already been ruled out by clicking the button after each: trailing commas in
`wrangler.jsonc`, a `cloudflare` metadata block in `package.json`, and empty-string `vars`.

Each directory here is a complete, minimal Worker that differs from the control in exactly one way.
The dashboard caches its verdict per repository **and path**, so these can be tested back to back
without waiting out the cache between attempts.

| Directory | Adds | Reading |
|-----------|------|---------|
| `a-minimal` | nothing | Control. Must pass, or the harness is wrong |
| `b-full` | assets, D1, R2, cron, limits, observability | Should reproduce the failure |
| `c-d1-no-id` | D1 binding with no `database_id` | |
| `d-d1-with-id` | same plus a placeholder `database_id` | c fails and d passes: the missing id is the cause |
| `e-assets` | assets block with `run_worker_first` as an array | |
| `f-misc` | R2, cron, limits, observability off | |

Round one result, 2026-09-15: **all six reached the configure screen**, which clears `wrangler.jsonc`
as a whole. Round two isolates what `b-full` got wrong about the real config.

| Directory | Adds | Reading |
|-----------|------|---------|
| `g-assets-missing-dir` | `assets.directory` pointing at `./web/dist`, which is a build output and is gitignored, so it is absent from a fresh clone | Leading hypothesis. `b-full` pointed at a committed `./public` |
| `h-schema` | the `$schema` key | The only other key `b-full` omitted |
| `i-exact` | the real config byte for byte, name aside | Must fail, or the cause is outside `wrangler.jsonc` |

Test each at `https://deploy.workers.cloudflare.com/?url=https://github.com/lotus-infosec/cpe-pct/tree/main/button-test/<directory>`

Nothing here is part of the application. These projects are excluded from lint, formatting and the
Docker image, and they share no code with `src/`.
