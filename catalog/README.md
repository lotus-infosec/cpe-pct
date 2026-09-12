# Catalog

One YAML file per certifying body under `bodies/`. Rules are **data**: every number carries a source URL and
a retrieval date, and released versions are immutable. The format is documented in `TEMPLATE.yaml`; the
validator is `schema.ts`; `lock.json` holds a content hash per released `body@version` and CI fails if a
released version changes.

The catalog data (the YAML files and the seed migrations generated from them) is licensed under
[CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/). The code is MIT (see `/LICENSE`).

Trademark notice: see `/NOTICE.md`. Rule parameters are a best-effort transcription of public policy
documents; the issuer's current policy governs.

How to add or update a body: `docs/catalog-contributing.md`.
