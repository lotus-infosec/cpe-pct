#!/bin/sh
# Apply migrations first (Drizzle migrate(), same SQL folder wrangler applies on Cloudflare), then serve.
set -eu
node /app/dist/migrate.mjs
exec node /app/dist/entry.node.mjs
