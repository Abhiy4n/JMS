# Customers and Bhaka Patra folio implementation

Implemented October 20, 2026 in the existing `JMS/` working project. The separate older project at the workspace root was not changed.

## Current refinements and maintenance

Business Source names now open their existing details/linked-customers window at 75% desktop size; View is removed from Actions. Business Sources uses the same gold heading colour, font, size and weight as Customers. KPI/small-title accents match across both modules. Customer Folio now includes First created first and Last created first record ordering, without changing its KPI totals.

Important code now has comments explaining stable source ownership, transaction boundaries, non-duplicated totals, exact money arithmetic, unavailable values, request lifetime and nested-dialog keyboard/focus behavior. Current feature guides are [CUSTOMERS.md](CUSTOMERS.md) and [BUSINESS_SOURCES.md](BUSINESS_SOURCES.md); [PROGRESS.md](PROGRESS.md) records completed features, validation and remaining work. Historical implementation findings below describe the inspected starting point.

## Existing implementation inspected

The frontend uses Next.js App Router, React state, the shared JWT API client, shared dialog keyboard handling, and CSS in `app/globals.css`. Credit/Bills supplied the page, table, button, and KPI styling. Django REST Framework and SQLite provide persistence locally; deployed database configuration is unchanged.

Business Sources and Customers were separate entities with an optional many-to-one relationship. Sources could have several contacts. The existing Bhaka Patra component accepted supplied data but had no persistence or retrieval API. Bills and manual credits are distinct transactions and are not converted into Bhaka Patras.

## Behavior and integrity

- Customers has search, customer-type filtering, four ordering choices (oldest/newest first, name A-Z/Z-A), displayed serial numbers, name-cell links, and Edit/Delete actions. Overall Rakha Patra count and recorded amount KPIs are independent of directory filters. Business Source and Status columns are hidden. Customer creation and the Business Source/status filters are removed from this page. Old source/status query parameters do not silently filter its results.
- `/customers?customer=<id>` opens a Customer Folio window at 75% of desktop viewport width and height, with a larger responsive window on mobile. `/customers/[id]` bookmarks redirect to this window. Closing preserves directory search, sorting and customer-type state. Customer details sit between the folio title and its KPIs; Business Source/Status labels, View bills and Activate/Deactivate controls are removed.
- `Customer.source_entry` is a nullable, unique one-to-one link to a Business Source, separate from the existing many-to-one `business_source` contact relationship. The unique constraint prevents multiple representative entries for one source.
- Source API creation (including the legacy inline-source path) and editing synchronize the representative customer in the same transaction. Synchronization locks the source by ID; list requests never create records. Shared identity fields are edited using the existing Business Source form/API. Direct customer API attempts to override those fields on representative entries receive validation errors.
- Existing standalone customers and additional source contacts remain visible and retain their IDs and financial history. Explicit `first_customer` creation still creates its distinct contact alongside the source's representative entry.
- Migration 0009 reuses the earliest existing customer linked by `business_source_id` as a legacy source's representative; it preserves that customer's existing identity fields during migration. If no linked customer exists, it creates the representative from source fields. It never matches names. Re-running the backfill preserves an existing representative.
- Source edits subsequently synchronize the representative's name, phone, email and source terms. Additional linked contacts are independent and are not renamed.
- Delete confirms the exact customer. For a source representative, confirmation explicitly explains deactivation; the source and all history remain. Other customers retain hard deletion where allowed. Bhaka Patra, bill and credit history protect customers from deletion; No separate Activate/Deactivate button is displayed; the confirmed Delete policy still safely deactivates source representatives. Linked sources retain the existing protected deletion policy.

## Bhaka Patra records and preview

Added `BhakaPatra` and `BhakaPatraItem` models under the existing accounts app, with protected customer ownership, an actual unique reference, recorded amounts, optional dates/notes and purchased items. There are no seeded documents or generated production references.

- `GET /api/customers/summary/` returns overall document count and recorded principal amount total.
- `GET/POST /api/customers/<customer_id>/bhaka-patras/`
- `GET/PUT/PATCH /api/customers/<customer_id>/bhaka-patras/<id>/`

Endpoints use the existing authenticated application permissions. Detail requests scope both the customer ID and record ID, preventing a record from being opened or changed under a different customer's folio. Item writes are validated and saved atomically. A generic document deletion endpoint is intentionally unavailable pending document lifecycle rules; financial history is not silently removed. Inactive customers cannot receive new documents.

The folio retrieves actual persisted records and purchased items. Opening a row fetches its detail using both IDs and stores selection in `?patra=<id>`. Enter/Space, focus trapping, Escape, backdrop close and Back to folio are supported. The preview separates reusable document layout from retrieval/dialog behavior. It displays actual customer contacts, source address, recorded purchased items, financial values, notes and dates. Unsupported fields show “Unavailable”; no status, signature, rate or payment confirmation is fabricated. Source addresses are explicitly labeled as source addresses.

The document uses the existing application's business name and neutral print styling. Its surrounding controls use the Credit/Bills theme. Mobile tables scroll inside the preview. Document print visibility is scoped so existing bill printing remains intact.

## KPI definitions

1. **Total Bhaka Patra** = number of unique record IDs whose `customer_id` equals the selected customer.
2. **Total Interest Amount** = sum of those records' stored `interest_amount` values, using integer paisa arithmetic. No interest rate is applied. If any relevant interest value is missing/invalid, the aggregate is “Unavailable”, rather than reporting an incomplete total. An empty collection has count 0 and interest Rs. 0.00.

Overall directory KPIs use a database aggregate directly over BhakaPatra: count(id) and sum(principal_amount), without an item join, so multiple purchased items cannot multiply totals. Recorded interest is not added to this amount. These totals include all customers and ignore search/type/sort filters.

The application already formats money as `Rs.` with `en-NP` grouping; the new components follow that convention. Amounts and interest remain separate: no preview total adds interest or charges again. Item amounts are displayed as stored, without introducing a new line-total calculation rule. Directory/folio data refreshes on navigation, after edits and when the window regains focus; closing a preview also refreshes its folio.

## Files modified in this implementation

- `backend/accounts/models.py`, `serializers.py`, `views.py`, `business_urls.py`
- `backend/accounts/tests.py`, `test_business_sources.py`
- `frontend/app/customers/page.tsx`, `frontend/app/customers/[id]/page.tsx`, `frontend/app/globals.css`
- `frontend/components/CustomerActions.tsx`, `CustomerBhakaPatraOverview.tsx`, `CustomerFolio.tsx`, and the shared `frontend/lib/use-dialog.ts` nested-dialog keyboard handling
- `frontend/lib/business-data.ts`, `customer-bhaka-patra.ts`
- `frontend/eslint.config.mjs` (allow CommonJS imports in the existing `.cjs` test scripts)
- `frontend/tests/customer-bhaka-patra.test.cjs`, `customer-source-browser.cjs`

Some of these files already had uncommitted work when this task began. Existing unrelated changes were retained.

## Files added

- `backend/accounts/source_customers.py`, `folio.py`, `test_folio.py`
- `backend/accounts/migrations/0008_customer_source_entry_bhakapatra_bhakapatraitem.py`
- `backend/accounts/migrations/0009_backfill_source_entries.py`
- `frontend/lib/bhaka-patra-api.ts`
- `frontend/components/CustomerEditDialog.tsx`, `CustomerFolio.tsx`, `BhakaPatraDocument.tsx`, `BhakaPatraPreview.tsx`
- This report.

## Executed validation

| Command/check | Actual result |
| --- | --- |
| `python manage.py test --noinput` | 95 tests passed, including nine folio integration tests covering overall totals and ordering. |
| `python manage.py test accounts.test_folio --noinput` | Nine tests passed for the current folio and directory behavior. |
| `python manage.py check` | No issues. |
| `python manage.py makemigrations --check --dry-run` | No changes detected. |
| `python manage.py migrate` and `python manage.py migrate --check` | Migrations 0008 and 0009 applied; no pending migrations. |
| `node --test tests/customer-bhaka-patra.test.cjs` | Seven tests passed: exact arithmetic, duplicate IDs, customer isolation, unavailable values, table interaction, and actual preview data. |
| `npx tsc --noEmit` | Passed. |
| `npm run lint` | Passed. |
| `$env:JMS_TEST_URL='http://localhost:3000'; node tests/customer-source-browser.cjs` | Passed in real headless Chromium with mocked APIs. Covers creation-to-directory flow, source editing, confirmation/deactivation, routing, keyboard preview, focus/Escape, mobile sizing, updated KPIs, failure/retry, customer isolation, and no browser exceptions. |
| Live authenticated HTTP checks | Health, Customers, Business Sources, Bills, Credit and the customer's Bhaka Patra list returned 200. |
| `npm run build` | Failed fetching the existing Inter and Geist Mono Google Fonts from `fonts.googleapis.com`. A separate connection check also failed. This pre-existing network dependency remains; the build did not pass. |

The 75% folio window, top details ordering, nested preview Escape handling, overall KPIs, sorting and removed controls also passed browser checks. The folio screenshot is `.runtime/customer-folio-window.png`. Desktop/mobile document screenshots were captured and visually reviewed in `.runtime/folio-preview-desktop.png` and `.runtime/folio-preview-mobile.png`.

## Local database and remaining decisions

Before migration, SQLite was backed up to `backend/.backups/before-customer-folio-20261020-112826.sqlite3`. Verification confirmed every pre-existing customer, source, bill and manual-credit ID remained present. No example documents were saved. The current database has zero Bhaka Patras, so the real folio correctly shows an empty document table and zero KPIs.

The initial document layout and recorded-value storage are implemented. A document-entry UI, interest accrual rules, settlement workflow, document statuses, and document deletion/voiding policies are outside this initial preview implementation and still need business requirements. Documents can already be persisted using the authenticated API. Neither Bills nor Credit is treated as a substitute document dataset.

For the next phase, confirm the exact Bhaka Patra fields/layout and lifecycle, whether missing recorded interest means unknown or explicitly zero, and whether the earliest linked customer is the preferred representative for legacy sources with several contacts. The current backfill preserves all legacy contacts and financial IDs, but future source edits update the chosen representative's shared identity fields. Production builds also require Google Fonts access or separately authorized local hosting of the same font assets.
