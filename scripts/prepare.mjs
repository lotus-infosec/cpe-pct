// npm `prepare` hook: install the lefthook git hooks, but only in a real clone. The Docker build
// copies the source without `.git`, where `lefthook install` fails.
//
// This lives in a file rather than inline in package.json for a reason. The Deploy to Cloudflare
// button uploads `package.json` and `wrangler.jsonc` to the dashboard as a multipart body, and
// Cloudflare's own WAF blocks any request carrying `require("child_process").execSync(...)` as a
// command-injection payload. The dashboard then reports the 403 as "There was a problem parsing the
// Wrangler configuration file", which is how three unrelated fixes got made before the real cause
// turned up in a HAR. See CPETracker/TROUBLESHOOTING.md. Keep package.json free of anything that
// reads as an exploit payload.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

if (existsSync('.git')) execSync('npx lefthook install', { stdio: 'inherit' });
