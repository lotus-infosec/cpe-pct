# Public demo

The `demo` branch runs CPE PCT as a public, shared, self-emptying instance so people can try it before
installing it. It is the same application with a thin layer in front. `main` carries none of it.

## What is different

| Area                   | Demo behaviour                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts               | None. Every request is the owner. Setup, login and logout return 403, and there is no log out control                                                                           |
| Reset                  | A second cron (`0 */12 * * *`) deletes everything a visitor can create at 00:00 and 12:00 UTC, in one batch, and empties the R2 bucket. The catalog stays                       |
| Caps                   | 10 held certifications, 100 activities (drafts from uploads and CSV import rows count), 10 memberships, 20 uploaded files of at most 2 MB, 10 exports                           |
| Uploads                | Stored, hashed and text-extracted, so the draft flow can be tried. Never served back: the view, open and content routes are refused, so the demo cannot be used as file hosting |
| Export and backup zips | Built, never downloadable (they contain uploaded files)                                                                                                                         |
| Notifications          | In-app only. Webhook settings and test sends are refused, so the demo cannot be used to send requests to arbitrary URLs                                                         |
| Restore                | Refused                                                                                                                                                                         |
| Interface              | A banner states that the instance is public and shared, the time to the next reset and the room left. Settings and Backup show a short notice instead of their forms            |

Caps are checked before the write, and D1 has no interactive transactions, so two requests racing at
the limit can each succeed and overshoot it by one. The next reset clears it.

## Where the code is

| File                          | Role                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `src/demo/index.ts`           | `demoApp` (auth grant, refused routes, caps, `/api/demo`), `resetDemo`, `DEMO_LIMITS`      |
| `src/entry.demo.ts`           | Workers entrypoint: `fetch` through `demoApp`; `scheduled` runs jobs or the reset by cron  |
| `wrangler.demo.jsonc`         | Its own Worker (`cpe-pct-demo`), D1 (`cpe-pct-demo`) and R2 (`cpe-pct-demo-evidence`)      |
| `web/src/components/demo.tsx` | Banner and the Settings and Backup notices                                                 |
| `test/node/demo*.test.ts`     | Caps, refused routes, reset keeps the catalog, config never points at production resources |

Everything else is `main`. The few edits to existing files (log out removed from the layout, two
routes swapped, the evidence view links and export download link removed) are small on purpose, so
merging `main` in stays easy.

## Deploy

Workers Paid, as for the main app. One-time, create the demo's own resources:

```
npx wrangler d1 create cpe-pct-demo
npx wrangler r2 bucket create cpe-pct-demo-evidence
```

Then, from the `demo` branch, every time:

```
npm run demo:release   # gitleaks sweep, web build, migrations to the demo D1, deploy cpe-pct-demo
```

Recommended in the Cloudflare dashboard, outside this repository: a rate limiting rule on the demo's
hostname for `POST` and `PUT` to `/api/*`, and a custom hostname if you want the link to read better
than `workers.dev`.

Local run on workerd with a local D1: `npm run demo:dev`, then trigger the reset with
`curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=0+*/12+*+*+*"`.

## Keeping it current

After a release on `main`, merge `main` into `demo` (never rebase it), run the tests, and run
`npm run demo:release`.
