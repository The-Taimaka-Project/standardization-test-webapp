# AGENTS.md

A running log for the next person (or agent) who picks up this repo. Layout:
high-level orientation, then a domain section per area with the gotchas and
why-it-is-the-way-it-is notes.

## What this is

A web app that runs the anthropometric standardization test workflow Taimaka
uses to certify field enumerators on MUAC, weight, and height measurements.
It pulls submissions from ODK Central read-only, surfaces missing/duplicate
forms and round-to-round discrepancies, lets the user correct values via
overrides stored in Postgres, runs the SMART/ENA TEM and bias calculations
natively, and shows per-trainee pass/fail.

The user (Justin) is the operator and product owner. He will deploy this on
his own infrastructure behind Apache + certbot.

## Stack

- **Next.js 15 / App Router** with TypeScript and React 19.
- **Tailwind CSS** with hand-rolled chip + panel styles in `app/globals.css`.
  No shadcn/ui dependency was actually pulled — the design system is small
  enough to live in the stylesheet.
- **Postgres 12** (yes, 12) accessed via **Drizzle ORM** + node-postgres.
- **Auth.js v5 (NextAuth beta 25)** with credentials provider and JWT
  sessions. Email handling is done via a direct **Resend** client, not the
  EmailProvider — we send our own verification + reset emails.
- **vitest** for unit and regression tests.

## Repo map

```
app/                        — Next.js App Router pages
  (auth pages)              — login, signup, verify, forgot, reset
  api/auth/[...nextauth]/   — Auth.js handler
  instances/...             — main UI: list, new, setup, view, group toggle
lib/
  auth/                     — Auth.js config + signup/reset server actions + Resend
  db/                       — Drizzle schema + connection
  ena/                      — TEM, bias, classification, runReport (pure)
  odk/                      — Central client, normalizer, AES-GCM crypto
  actions/                  — server actions exposed to the client UI
tests/ena/                  — 13 tests including a row-by-row regression
                              against reference/standardization_test_group3_results.xlsx
drizzle/                    — generated migration SQL
deploy/                     — apache vhost, systemd unit, env.example
scripts/                    — migrate, seed, smoke-tests, dump-reference
reference/                  — original SMART manual PDF, ENA sample, ODK form
```

## Database

Schema lives in `standardization_app` (provisioned externally; the app role
does not have CREATE on the database itself, only on its own schema).

Table list (single migration, `drizzle/0000_*.sql`):

- `users`, `email_verification_tokens`, `password_reset_tokens` — auth.
- `odk_credentials` — per-user ODK Central session token (AES-GCM at rest).
- `test_instances` — one row per "OTP Standardization Test, May 2".
- `test_groups` — one row per group within an instance (groups model
  morning/afternoon cohorts, and same-day retakes).
- `enumerators` — roster per group, includes which measurements each is
  required to do.
- `submission_overrides` — webapp-side corrections to ODK fields, soft-delete
  via `cleared_at`. Field can be any submission key, including `group`.
- `group_completion_marks` — "I'm done entering corrections for this
  enumerator in this group" flag.

### DB gotchas

1. **PG 12, no pgcrypto.** UUIDs are generated app-side via `crypto.randomUUID()`
   in Drizzle `$defaultFn`. Don't try to `gen_random_uuid()` from SQL; it
   doesn't exist on the deployed server, and the role can't `CREATE EXTENSION`.
2. **No drizzle-kit `migrate`.** Drizzle's built-in migrator unconditionally
   `CREATE SCHEMA`s its bookkeeping schema, which fails. We ship our own
   in `scripts/migrate.ts` — it puts the `__drizzle_migrations` table inside
   our owned schema.
3. **`CREATE SCHEMA` line in generated SQL.** drizzle-kit emits one at the
   top of every fresh migration. Strip it by hand after each `db:generate`.
   A comment is left in the file as a marker.
4. **SSL.** `pg_hba.conf` requires SSL for the app role. Both `lib/db/index.ts`
   and `scripts/migrate.ts` use `ssl: { rejectUnauthorized: false }` because
   the cert is self-signed.

## Auth

- **Signup is gated** server-side to addresses ending in `@taimaka.org`
  (configurable via `SIGNUP_ALLOWED_DOMAIN`). The check lives in
  `lib/auth/signup.ts`.
- **Emails are sent from `@taimaka-internal.org`** (configurable via
  `RESEND_FROM`). Verify the domain is set up in Resend before going live.
- **JWT session strategy.** No DB-backed sessions, so the middleware can
  stay on the edge runtime. Auth.js's full `auth()` is used in server
  components and actions.
- **Middleware is dumb.** It only checks for the next-auth session cookie
  and redirects to `/login` if absent. Real auth verification happens in
  each server action / server component via `auth()`. This is necessary
  because the edge runtime can't run pg / dotenv.

## ENA calculations

Implemented in `lib/ena/`. The math is straightforward; the surprising part
is the threshold table.

### TEM threshold gotcha

The SMART Manual 2.0 Figure 5 says MUAC individual TEM cut-points are:
Good < 1.0 mm, Acceptable < 1.3, Poor < 2.1, Reject ≥ 2.1.
**The reference ENA output the user supplied uses entirely different
cut-points** — empirically about 2× the manual's: Good ≤ 2.0, Acceptable
≤ 2.6, Poor ≤ 4.2, Reject > 4.2. The R-value cutoff also differs (Good ≥ 99
across all measurements, not Good > 95 for MUAC as Figure 5 says). Weight
and height TEM, and all bias cut-points, do match the manual.

We implement what ENA does, not what the manual says. The justification:
the user's existing workflow runs ENA, and the webapp must produce the
same pass/fail decisions. The deviation is documented in `lib/ena/thresholds.ts`
and pinned by `tests/ena/regression-group3.test.ts` (every per-person row
in the reference spreadsheet round-trips through our classifier and matches
its Status text).

### Inclusive boundaries

ENA uses ≤ for upper bounds, not <. The supervisor row in the reference
has `bias_from_median = 1` classified `Bias good`, which only fits if
good = ≤ 1.0. All thresholds in `thresholds.ts` are exclusive on the high
side (use `value <= tier.good` etc.).

### Bias decision rule

Per SMART Manual page 22 (and visible in the reference file): if the
supervisor's intra-observer TEM for that measurement is Good or Acceptable,
use bias-vs-supervisor. Otherwise use bias-vs-median. This is decided
per-measurement, not globally per enumerator.

## ODK integration

`lib/odk/client.ts` wraps `/v1/sessions` (token exchange) and the OData
`Submissions` feed. Tokens are encrypted at rest via AES-256-GCM using
`TOKEN_ENCRYPTION_KEY`. Passwords are never stored.

### MUAC unit conversion

ODK captures MUAC in **cm** (form constraint: 0..30). The ENA library
takes MUAC in **mm**. `lib/odk/normalize.ts` multiplies by 10 on the way
in. Don't double-convert.

### Edit links

`editLink()` builds the ODK Central web UI URL for a submission:
`{base}/#/projects/{p}/forms/{f}/submissions/{instanceId}`. The base URL is
the per-user ODK base URL (saved with their credentials), not the form's
upstream URL.

### Dev creds file

`dev_odk.creds` is a local-only file (gitignored) that primes the
development ODK token without re-prompting on every restart. The
`scripts/smoke-odk.ts` script reads it directly. Production never touches
this file.

### Known blocker — ODK project access

The `get_data@taimaka.org` ODK account currently only has access to project 4
("2021 PHL Study"), not project 9 (where `standardization_test_otp` lives).
**The user needs to grant this account read access (Project Viewer or
Data Collector role) on project 9 before the webapp can pull live data.**
The smoke script `scripts/smoke-odk.ts` will pass token exchange but 403 on
the submissions list until that's fixed.

## Workflow & UI

`app/instances/[id]/client.tsx` is the main workspace. Top-level actions:

- Tabs across the top toggle between groups in the instance.
- Per-enumerator row shows R1/R2 completeness, duplicates, and discrepancies.
- Expand the row to see each submission with edit-on-ODK links, copy-uuid,
  and inline override editors. Override-bearing fields render with an amber
  border; an `×` button clears the override.
- "Mark corrections done" per enumerator writes to
  `group_completion_marks`.
- "Run tests" pulls fresh ODK data, applies overrides, runs the ENA report
  for the active group, and shows pass/fail.
- Results card has two follow-up actions:
  - **+ New group with failed** — appends a new `test_groups` row to the
    *same* instance, pre-loaded with failing enumerators and only the
    measurements they failed.
  - **+ New test with failed** — creates a fresh `test_instances` row.

### Discrepancy thresholds

Hard-coded in `lib/odk/normalize.ts` callers:

- MUAC > 3 mm
- Weight > 0.2 kg
- Height > 1 cm

These are the user's practical cutoffs from the existing manual workflow,
not from the SMART manual. Surface them as warnings only — the user decides
whether to enter a correction.

## Local development

```bash
npm install
# (.env and dev_odk.creds already exist with real values; do not commit them)
npm run db:generate    # if you change lib/db/schema.ts
# strip the CREATE SCHEMA line from the new drizzle/<num>_*.sql before:
npm run db:migrate
npm test               # runs the full vitest suite incl. ENA regression
npm run dev            # localhost:3000
```

For ODK live testing:

```bash
npx tsx scripts/smoke-odk.ts        # uses dev_odk.creds
npx tsx scripts/dump-reference.ts   # prints the first 40 rows of the ENA xlsx
```

## Deployment

- `npm run build` produces a standalone server in `.next/standalone/server.js`.
- `deploy/standardization-webapp.service` is a systemd unit template; copy
  it to `/etc/systemd/system/`, edit `User=` and `WorkingDirectory=`, then
  `systemctl daemon-reload && systemctl enable --now standardization-webapp`.
- `deploy/apache-vhost.conf` is the Apache reverse-proxy config for
  `standardization.taimaka-internal.org`. SSL is handled externally by
  certbot.
- `deploy/env.example` documents every environment variable the app expects.

## Things still pending or worth knowing

1. **ODK access grant**: see "Known blocker" above.
2. **Resend domain verification**: sender is `noreply@taimaka-internal.org`.
   Verify the domain in Resend (DKIM/SPF DNS records) before any real signup.
3. **Height fixture**: the regression test only covers MUAC and weight rows
   — the user's reference file doesn't have height. Height calcs are
   covered by synthetic tests but not regression-tested against ENA. If
   you ever get a real ENA file with height, drop it under `reference/`
   and extend `tests/ena/regression-group3.test.ts`.
4. **Group reassignment**: handled as an override on the synthetic `group`
   field in `submission_overrides`. The normalizer applies the override
   and the submission is then bucketed under the corrected group number.
5. **No background jobs**. Refresh is user-initiated.
