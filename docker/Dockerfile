# syntax=docker/dockerfile:1
# Multi-stage. Runtime image carries only the bundled server, the built SPA, the migrations
# folder, and production node_modules (native libSQL binding). Runs as the non-root `node` user.
# node:22-alpine, manifest-list digest recorded 2026-09-11 (Dependabot bumps it).
FROM node:26-alpine@sha256:2c45bdcbf63561a54da9549612084b43ca309854a4110c87857d609ddeb61c9e AS build
WORKDIR /app
COPY package.json package-lock.json ./
# `prepare` runs during npm ci and lives in a file, so it has to be present before the install.
COPY scripts/prepare.mjs ./scripts/prepare.mjs
RUN npm ci
COPY . .
RUN npm run build && rm -rf node_modules && npm ci --omit=dev

FROM node:26-alpine@sha256:2c45bdcbf63561a54da9549612084b43ca309854a4110c87857d609ddeb61c9e AS runtime
ENV NODE_ENV=production DATA_DIR=/data PORT=8787 WEB_DIST=/app/web/dist MIGRATIONS_DIR=/app/src/db/migrations
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/web/dist ./web/dist
COPY --from=build --chown=node:node /app/src/db/migrations ./src/db/migrations
COPY --chown=node:node docker/entrypoint.sh /app/entrypoint.sh
RUN mkdir -p /data && chown node:node /data && chmod +x /app/entrypoint.sh
USER node
VOLUME ["/data"]
EXPOSE 8787
ENTRYPOINT ["/app/entrypoint.sh"]
