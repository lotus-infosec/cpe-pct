# CPE PCT — CPE Personal Certification Tracker

A single-owner web app that tracks continuing-education credits and maintenance fees across every professional certification you hold. Log an activity once; it fans out to every certification it can credit, at each issuing body's own conversion rate, category rules, and caps. One codebase deploys to Cloudflare Workers or to your own hardware with Docker Compose. Same code, no forked business logic.

This is a personal project, entirely vibecoded with Claude. It exists because the author holds certifications from several bodies and got tired of spreadsheets. It is not a product, has no roadmap beyond the author's needs, and makes no promises about the accuracy of any rule figure. Read `NOTICE.md`.

> Status: design complete, implementation in progress. Not yet usable.

## Why the activity-centric model matters

Every tracker in this space models a per-certification counter with a progress bar. That is the wrong model for anyone holding more than two certifications, because the pain is not logging; it is fan-out.

One real-world activity (a conference session, a book, a mentoring hour) credits several certifications across several bodies at different values under different rules:

| Concern | Example |
|---|---|
| Unit conversion differs by body | Some bodies credit per 50 minutes, some per 60; some accept quarter-hours, some whole hours only |
| Category caps | A body may cap how much of a cycle's total can come from a secondary category |
| Annual floors | Several bodies enforce a per-year minimum inside a multi-year cycle |
| Bodies disagree on what counts | Earning a new certification credits at some bodies and not others |
| Stacking | A higher certification may renew a lower one, with credits flowing down |
| Fees | A lapsed maintenance fee invalidates the certification regardless of credits |
| Renewal by exam | Some bodies accept a recertification exam instead of credits |

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

## Deploy

One codebase, two targets. Business logic is pure and runtime-agnostic; each target supplies adapters for storage, scheduling, and auth. Anything that has no honest equivalent on one target is documented as degraded, never faked.

### Cloudflare Workers (Workers Paid)

Requires a Workers Paid plan. Free-plan CPU limits are too low for PDF extraction and password hashing; if you want the free option, use Docker. Deployment uses D1 for the database, R2 for evidence, Static Assets for the SPA, and one Cron Trigger for scheduled work. A "Deploy to Cloudflare" button is planned for the final stage. Until then:

```
npm run deploy
```

Deploys run from your own machine via `wrangler login`. No Cloudflare API token is ever stored in GitHub.

### Self-hosted (Docker Compose)

```
docker compose -f docker/compose.yml up -d
```

Runs Node 22 with a libSQL database file and evidence on a named volume mounted at `/data`. No external services, no outbound calls except the webhooks you configure.

### First run

Both targets start with zero secrets. The first visit redirects to `/setup`, which creates the single owner account and generates the session signing key into the database.

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
- `docs/`: degradation list, export formats, and catalog contribution guide (added in the final stage)

## Disclaimer

Certification names are trademarks of their respective owners. This project is not affiliated with, endorsed by, or verified by any certifying body. Rule data is a best-effort transcription of public policy documents and may be wrong or out of date. The issuer's current policy always governs. Verify with the issuer before relying on any figure here for a renewal decision.

## License

Code: MIT. Catalog data: CC-BY-4.0. See `NOTICE.md`.
