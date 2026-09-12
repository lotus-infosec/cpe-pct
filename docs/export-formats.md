# Export formats

One bundle per certification cycle: `POST /api/exports {cycleId}` → zip containing

| File                                 | Content                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `<body>-<cert>-cycle-<n>.csv`        | One row per credit application, columns in the issuer's entry order (below). UTF-8 with BOM, CRLF, RFC 4180 quoting. |
| `evidence-manifest.csv`              | `activity_date, activity_title, file, sha256, size_bytes, content_type`                                              |
| `evidence/<date>_<title>/<filename>` | The evidence files, byte-identical to what was uploaded (SHA-256 in the manifest).                                   |
| `README.txt`                         | Cycle summary and issuer-specific entry notes.                                                                       |
| `MISSING-EVIDENCE.txt`               | Only present if an evidence object could not be read from storage.                                                   |

CPE PCT never submits anything to an issuer. The bundle is for your records and for entering rows into the portal by hand.

## ISC2 (`isc2`)

| #   | Column              | Source                                                                   |
| --- | ------------------- | ------------------------------------------------------------------------ |
| 1   | `certification`     | held certification abbreviation                                          |
| 2   | `cpe_group`         | `Group A` / `Group B` from the application's category                    |
| 3   | `activity_category` | the issuer's label from the crediting rule (e.g. "Industry conference")  |
| 4   | `activity_title`    | activity title                                                           |
| 5   | `provider`          | activity provider                                                        |
| 6   | `start_date`        | activity date (multi-day activities: enter the real start in the portal) |
| 7   | `completion_date`   | activity date — the portal uses the completion date to pick the cycle    |
| 8   | `cpe_credits`       | credits applied (quarter-hour precision)                                 |
| 9   | `description`       | notes plus duration in hours                                             |
| 10  | `status_in_tracker` | the tracker's own status, not the portal's                               |
| 11  | `issuer_reference`  | what you recorded after submitting                                       |
| 12  | `evidence_files`    | filenames in this bundle                                                 |

Verification status: the CPE portal's exact form layout is behind login and is **not publicly documented**. ISC2's handbook and the "Managing your CPE credits" article confirm that Group A entries require selecting a domain and attaching supporting documentation, and that the completion date decides the cycle; the tracker does not store domains. Treat the column order as a convenience, not a portal contract, until the owner compares it with the portal.

## CompTIA (`comptia`)

| #   | Column              | Source                                                                                                                      |
| --- | ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | `certification`     | held certification abbreviation                                                                                             |
| 2   | `activity_group`    | CE activity group ("Training and higher education", "IT industry participation", "Publishing", "Additional certifications") |
| 3   | `activity`          | the issuer's label from the crediting rule (e.g. "Attend a live webinar")                                                   |
| 4   | `training_provider` | activity provider (the form asks for it on training and webinar activities)                                                 |
| 5   | `activity_title`    | activity title                                                                                                              |
| 6   | `completion_date`   | activity date                                                                                                               |
| 7   | `hours`             | duration in hours                                                                                                           |
| 8   | `ceus`              | CEUs applied                                                                                                                |
| 9   | `description`       | notes                                                                                                                       |
| 10  | `status_in_tracker` | the tracker's own status                                                                                                    |
| 11  | `issuer_reference`  | what you recorded after submitting                                                                                          |
| 12  | `evidence_files`    | filenames in this bundle                                                                                                    |

Verification status: CompTIA's help article "How to Enter Your CEUs" describes the Add CEUs flow as Activity Group → Activity → Training Provider (training and webinars) → CEUs → documentation upload (up to five files, 1 MB total) → documentation language → attestation checkbox → Submit. The article itself sits behind a bot wall; that sequence comes from the search engine's excerpt of it. The `hours` column is the tracker's own; the form asks for CEUs.

## Other bodies

Bodies without a dedicated builder get the generic layout: `certification, activity_type, issuer_label, title, provider, date, hours, credits, category, description, status, issuer_reference, evidence_files`.
