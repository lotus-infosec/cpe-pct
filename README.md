# CPE PCT — CPE Personal Certification Tracker

A single-owner web app that tracks continuing-education credits and maintenance fees across every professional certification you hold. Log an activity once; it fans out to every certification it can credit, at each issuing body's own conversion rate, category rules, and caps. One codebase deploys to Cloudflare Workers or to your own hardware with Docker Compose. Same code, no forked business logic.

This is a personal project, entirely vibecoded with Claude. It exists because the author holds certifications from several bodies and got tired of spreadsheets. It is not a product, has no roadmap beyond the author's needs, and makes no promises about the accuracy of any rule figure. Read `NOTICE.md`.

> Status: usable for the author's own tracking. Built, deployed and validated on Workers Paid and on Docker.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/lotus-infosec/cpe-pct)

The button needs a **Workers Paid** plan. The committed `limits.cpu_ms` is rejected on Free accounts, so a Free deploy fails at the last step. If you do not want to pay Cloudflare, the Docker path below costs nothing and runs the same code.

## Why the activity-centric model matters

Every tracker in this space models a per-certification counter with a progress bar. That is the wrong model for anyone holding more than two certifications, because the pain is not logging; it is fan-out.

One real-world activity (a conference session, a book, a mentoring hour) credits several certifications across several bodies at different values under different rules:

| Concern                         | Example                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Unit conversion differs by body | Some bodies credit per 50 minutes, some per 60; some accept quarter-hours, some whole hours only |
| Category caps                   | A body may cap how much of a cycle's total can come from a secondary category                    |
| Annual floors                   | Several bodies enforce a per-year minimum inside a multi-year cycle                              |
| Bodies disagree on what counts  | Earning a new certification credits at some bodies and not others                                |
| Stacking                        | A higher certification may renew a lower one, with credits flowing down                          |
| Fees                            | A lapsed maintenance fee invalidates the certification regardless of credits                     |
| Renewal by exam                 | Some bodies accept a recertification exam instead of credits                                     |

CPE PCT therefore models:

- The **activity** as the unit of work: something that happened once, with a duration in minutes.
- **Credit** as a many-to-many join between an activity and a held certification, carrying the per-body rule outputs and an explanation of how they were computed.
- **Rules** as versioned, cited data evaluated by pure functions. Every number in the catalog carries a source URL and a retrieval date. Open cycles pin a rule version; newer versions never silently change history.
- **Standing** (are you compliant right now, and why not) as something derived on read, never stored.

Nothing is applied silently. The app suggests; you confirm or override.

## What it does

- Catalog of certifying bodies and their rules as versioned, cited data. Adding a credential is a selection, not data entry.
- Activity logging in minutes, with suggested credit fan-out across all held certifications.
- Per-cycle standing that names exactly which constraint fails: cycle total, annual floor, category cap, unpaid fee, prerequisite, or missing attestation.
- Evidence upload with content hashing and PDF text extraction into draft activities.
- Maintenance fee and membership tracking, renewal rollover, scheduled warnings via webhook or Discord.
- Body-aware audit exports in the shape each body's worksheet expects. You submit; the tool never touches an issuer portal.
- Portable backup and verified restore between the two deploy targets.
- Backfill of already-submitted credits by CSV import.

## Quickstart

### Self-hosted (Docker Compose)

```
git clone https://github.com/lotus-infosec/cpe-pct
cd cpe-pct
docker compose -f docker/compose.yml up -d
```

Open `http://localhost:8787`. The first visit asks for an owner password. Data (SQLite file and evidence) lives on the `data` volume mounted at `/data`. No external services, no outbound calls except the webhooks you configure and the update check you press.

Fast development loop: `npm install`, then `npm run dev:node` and `npm run dev:web` (port 5173, API proxied).

### Cloudflare Workers (Workers Paid)

Requires a Workers Paid plan: the committed `limits.cpu_ms` is rejected on Free, and PDF extraction and password hashing need the headroom. D1 and R2 stay within their free allowances for a single user (D1 free: 5 GB, 100k writes/day; R2 free: 10 GB, egress free).

Press the button at the top of this page, or deploy from your own machine:

```
npm install
npx wrangler login
npm run deploy             # build web assets, apply migrations to remote D1, deploy
```

The first deploy provisions the D1 database and the R2 bucket by name; `wrangler.jsonc` carries no resource IDs, so nothing in this repository points at anyone's account.

Deploys run from your own machine and no Cloudflare token is stored anywhere. `npm run release` is the same command behind a `gitleaks detect` sweep of the working tree, and it is how this repository is released; the gate sits outside `npm run deploy` because the button hands that script to Cloudflare's builder, which has no gitleaks binary.

## Parity

| Capability          | Self-hosted                                   | Cloudflare                                      |
| ------------------- | --------------------------------------------- | ----------------------------------------------- |
| Database            | libSQL file (Drizzle)                         | D1 (Drizzle), same migrations folder            |
| Evidence            | filesystem volume                             | R2                                              |
| PDF text extraction | unpdf, inline with job fallback               | same                                            |
| Background jobs     | jobs table + 15 s interval                    | jobs table + Cron Trigger                       |
| Auth                | local password; optional trusted proxy header | local password; optional Cloudflare Access gate |
| Notifications       | webhook, Discord, in-app                      | same                                            |
| Backup / restore    | zip via API or `npm run backup`               | same, portable in both directions               |
| Image OCR           | none                                          | none                                            |

The full list of differences is in `docs/degradation.md`.

## Backup and restore

`GET /api/backup` returns one zip: a SQL dump of every table, a manifest with per-table checksums and every evidence hash, and the evidence files. Restore it into a fresh instance before setup, or into a running one with the wipe option; the restore verifies itself. From a terminal:

```
CPE_URL=http://localhost:8787 CPE_PASSWORD=... npm run backup -- today.zip
CPE_URL=https://<worker>.workers.dev CPE_PASSWORD=... npm run restore -- today.zip
npm run verify-restore -- today.zip
```

Backups are portable between the two targets in both directions.

## Catalog

Rules live in `catalog/bodies/*.yaml` as versioned, cited data (CC-BY-4.0). Twelve bodies are seeded: ISC2, CompTIA, ISACA, GIAC, EC-Council, IAPP, PMI, Cisco, AWS, Microsoft, TestOut, and IMI. Every number has a source URL and retrieval date; PDFs are hashed. Adding a body: `docs/catalog-contributing.md`.

The only outbound call the app makes on its own is the **Check for catalog updates** button on the Certifications page, and only when you press it. It fetches exactly one file, `catalog/lock.json` from this repository's `main` branch, and compares version numbers. Nothing is sent. Updates arrive by redeploying or pulling a new image.

## Non-goals

These are out of scope and will be declined as contributions:

- Multi-user, multi-tenant, or billing of any kind
- Native mobile apps (the SPA is responsive)
- Automated submission to issuer portals. Ever. Exports only; a human submits.
- Telemetry, analytics, or any phone-home. The one exception is a user-initiated "check for catalog updates" button that fetches a single JSON file from this repository.
- Study material, exam prep, or salary data
- Monetization

## Security notes

- Zero secrets at deploy time on either target.
- Single owner. Local password auth with PBKDF2 via WebCrypto and HttpOnly, SameSite cookies. Cloudflare Access or a trusted-header reverse proxy can be layered in front as an optional extra.
- Evidence and rule data stay on infrastructure you control: your Cloudflare account or your disk.
- Repository hygiene (secret scanning, pinned actions, branch protection, noreply commit identity) is described in `SECURITY.md`. Vulnerability reports go through GitHub private advisories, not public issues.
- Tests and fixtures use synthetic certification and member numbers only.

## Documents

- `SECURITY.md`: repository hygiene and vulnerability reporting
- `NOTICE.md`: trademark disclaimer and licensing
- `catalog/TEMPLATE.yaml`: the body rule file format
- `docs/degradation.md`, `docs/export-formats.md`, `docs/catalog-contributing.md`
- `LICENSE` (MIT) and `catalog/README.md` (CC-BY-4.0 for the rule data)

## Disclaimer

Certification names are trademarks of their respective owners. This project is not affiliated with, endorsed by, or verified by any certifying body. Rule data is a best-effort transcription of public policy documents and may be wrong or out of date. The issuer's current policy always governs. Verify with the issuer before relying on any figure here for a renewal decision.

## License

Code: MIT. Catalog data: CC-BY-4.0. See `NOTICE.md`.
