# Customers and Customer Folio

Last updated: October 20, 2026 (Nepal time).

## Customers directory

Route: `/customers`.

- New Business Sources automatically produce a representative customer entry. There is no Add/New Customer button on this page. Existing standalone customers and additional source contacts remain available.
- Columns: SN, Customer Name, Phone, Email, Customer type, Added, Actions. Business Source and Status columns and their filters are hidden.
- Search matches name, phone, email or linked source. Customer-type filtering remains available.
- Ordering: First created first, Last created first, Name A-Z, Name Z-A. The API sorts by creation time or case-insensitive name, using ID to break ties. SN follows the displayed result, starting at 1.
- Search, type and ordering use URL parameters `q`, `type` and `ordering`. The current list has no pagination.
- Gold headings, KPI borders and small titles follow the existing Credit/Bills typography and application colours.

## Overall KPIs

`GET /api/customers/summary/` supplies both directory KPIs independently of search, filters and ordering:

| Label | Calculation |
| --- | --- |
| Total Rakha Patra | Count all persisted `BhakaPatra.id` records across customers. |
| Total Amount | Sum their stored `principal_amount`; exclude interest and avoid joining purchased items. |

An empty collection returns 0 and Rs. 0.00. Loading and failed requests have explicit states and a retry action. Bills and manual credits are separate records and never substitute for Bhaka Patras.

## Customer Folio window

The full customer-name cell is a keyboard-accessible link to `/customers?customer=<id>`. This opens a window over the directory at 75% of desktop viewport width and height. On smaller screens it uses 95vw and 88vh. `/customers/<id>` bookmarks redirect to this window.

Content order:

1. Customer Folio title and Close control.
2. Customer details: name/ID, phone, email, type, and available source-owned address for representative entries. Business Source/Status labels are hidden.
3. Edit/Delete actions and View credit. View bills and Activate/Deactivate buttons are removed.
4. Total Bhaka Patra and Total Interest Amount KPIs.
5. Bhaka Patras table: SN, Rakha Patra Number, Rakha Patra Amount, Purchased Items.

The folio table supports First created first and Last created first. This orders the selected customer's records by `created_at`; equal timestamps retain the supplied order. Sorting does not change KPI totals. Repeated representations of the same document ID count once. Monetary totals use integer paisa arithmetic. Missing/invalid interest makes Total Interest Amount unavailable; an empty collection has zero totals.

Closing the folio preserves directory search/type/order. Focus returns to the opener. Window focus, edits and preview closure refresh the relevant data. Escape closes only the top window, so closing a document preview leaves its folio open.

## Data ownership, editing and deletion

`Customer.business_source` remains an optional many-to-one relationship for source contacts. The additional unique `Customer.source_entry` identifies one representative entry per source. Source creation/editing synchronizes its representative transactionally, using stable IDs and never matching names.

Source-backed Edit opens the existing Business Source form; the API rejects independent customer overrides of its shared identity/term fields. Other contacts use `CustomerDialog`. Source edits preserve a representative's deactivated state and leave other contacts and existing financial snapshots intact.

Delete asks for confirmation. A source representative is deactivated rather than removing its source or history. Other customers may be deleted only when unreferenced. Bhaka Patras, bills and credit history protect customers from hard deletion. There is no separate Activate/Deactivate action in the current UI.

Migration 0009 reuses the earliest existing customer linked by source ID as its legacy representative, preserving its identity fields during backfill. Sources with no linked customer get a representative. Additional contacts and financial IDs remain intact. Future source edits synchronize the chosen representative's shared fields; see the implementation report for this legacy mapping decision.

## Persisted Bhaka Patras and document preview

The accounts app owns `BhakaPatra` and `BhakaPatraItem`. Each document belongs to a protected Customer foreign key and stores its actual unique reference, principal, optional recorded interest, dates, financial summary fields, notes and purchased items.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/customers/summary/` | Overall document count and amount. |
| GET/POST | `/api/customers/<id>/bhaka-patras/` | List/create a customer's documents. |
| GET/PUT/PATCH | `/api/customers/<id>/bhaka-patras/<record_id>/` | Read/update the matching customer's document. |

All routes use JWT authentication. Detail reads/writes check both IDs. Item writes are atomic: omitting `items` preserves the collection; sending `[]` clears it. Negative amounts are rejected. Inactive customers cannot receive new documents. A generic document DELETE endpoint is not provided.

Clicking a record row, or pressing Enter/Space on it, opens the spacious document preview at `?customer=<id>&patra=<record_id>`. The reusable layout includes the existing business name, reference/date, actual customer contacts, purchased items, recorded totals, notes, settlement information and an unsigned signature area. Unknown values are marked unavailable. It does not invent line totals, interest, payment confirmations or document statuses.

The initial preview is implemented. Document-entry UI, interest accrual, settlement/status and voiding rules require a later business definition. Records can be persisted through the API now. No sample documents are seeded into the live database.

## Code guide and verification

- `frontend/app/customers/page.tsx`: directory filters, overall KPIs and selected window.
- `frontend/components/CustomerFolioDialog.tsx` / `CustomerFolio.tsx`: window and folio data flow.
- `CustomerBhakaPatraOverview.tsx`: records, ordering control and folio KPIs.
- `BhakaPatraPreview.tsx` / `BhakaPatraDocument.tsx`: detail retrieval and reusable document layout.
- `frontend/lib/customer-bhaka-patra.ts`: customer isolation, deduplication, ordering and exact money formatting.
- `frontend/lib/use-dialog.ts`: keyboard handling, focus trap and nested-window restoration.
- `backend/accounts/source_customers.py`: source representative synchronization.
- `backend/accounts/folio.py`: summary, validation and customer-scoped document endpoints.

From `backend`: `python manage.py test --noinput`.

From `frontend`: `npm run lint`, `npx tsc --noEmit`, `node --test tests/customer-bhaka-patra.test.cjs`.

Browser coverage: set `JMS_TEST_URL` to the running frontend URL and run `node tests/customer-source-browser.cjs`. Its mocked fixtures do not write to the live database.

See [PROGRESS.md](PROGRESS.md) for recorded results and [CUSTOMER_FOLIO_IMPLEMENTATION.md](CUSTOMER_FOLIO_IMPLEMENTATION.md) for migration and initial implementation details.
