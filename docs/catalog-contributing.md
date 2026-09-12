# Contributing a catalog body

Rules are data with provenance. A body file is accepted when every number in it can be traced to a primary
document, and a released version is never edited.

## Rules of the road

| Rule                                                                                                                                                                             | Why                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Primary sources only: the issuer's policy PDF, handbook, or official program page. Blog posts and training vendors may help you find the primary document; they are never cited. | Wrong numbers in a rules engine are worse than missing ones. |
| Every version has at least one `sources[]` entry with `url`, `title`, `retrieved_on`; PDFs also carry `sha256` of the retrieved file. The schema enforces the first three.       | Anyone can re-verify.                                        |
| Parameters only. No handbook prose. `body_label` is the issuer's short name for an activity.                                                                                     | Copyright and trademark hygiene (see `NOTICE.md`).           |
| If a figure cannot be cited, leave it out. A body with requirements but no crediting rules is fine (GIAC, Cisco): users apply credits by override.                               | Honesty over completeness.                                   |
| Released versions are immutable. Fixing a released number means a new `version` block with `effective_from` and a `notes` line saying what changed.                              | Open cycles pin a version; history never rewrites itself.    |
| Use the canonical activity types in `src/core/domain/activity-types.ts`. If a body has an activity that maps onto none of them, open an issue before inventing a key.            | Fan-out depends on one shared taxonomy.                      |

## Steps

1. Copy `catalog/TEMPLATE.yaml` to `catalog/bodies/<body>.yaml`. `body.id` must equal the filename.
2. Fill `certifications`, then one `versions` block. Encode:
   - `requirements`: cycle length, total, annual minimum with `hard`/`soft` (say which the document says), fee with period and scope.
   - `crediting`: one rule per canonical activity type the body recognises, with basis, rate, rounding, category, caps, and `applies_to` when the cap differs per certification.
   - `constraints`: at minimum `cycle_total`; add `annual_min`, `category_min/max`, `fee_paid`, `prerequisite_current`, `recert_exam`, `any_of` as the policy requires.
   - `relations`: `earning_renews`, `credits_flow_down`, `requires_current`, `earning_credits`. `from` may be another body's certification id.
3. `npm run catalog:check` — validation and lock check.
4. `npm run catalog:compile` — emits `src/db/migrations/NNNN_seed_<body>_v<n>.sql` and updates `catalog/lock.json`. Commit both with the YAML.
5. `npm run db:check` and `npm test`. Add a test in `test/node/catalog-bodies.test.ts` that reproduces one worked example from the issuer's own document if it has one.
6. Open a PR: one body per PR, with the sources listed in the description.

## What reviewers check

- Each number against the cited page or PDF section (`pointer`).
- Rounding direction and the unit definition (50 vs 60 minutes; quarter-hour vs whole).
- Whether the annual figure is a requirement or a suggestion.
- Fee scope: per certification or per membership.
- That nothing in `notes` or `body_label` quotes the handbook.
