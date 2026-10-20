# Business Sources and Customer Linking

Last updated: October 20, 2026 (Nepal time).

## Current workflow and appearance

Route: `/business-sources`. `/dashboard` and `/customer-types` redirect here.

The register uses the existing Credit/Bills components and colours. Its BUSINESS SOURCES eyebrow and gold Business Sources title match the Customers heading's font, size, weight and colour. KPI borders/values, counts, dialog headings and small labels have restrained gold accents.

- Create Source and Edit reuse `BusinessSourceDialog`.
- Table columns: SN, Source Name, Source Type, Contact / Phone, Address, Created Date, Actions.
- Actions contains Edit and Delete. View is removed.
- The whole source-name area is a native button supporting click and keyboard activation. It opens source details and linked customers in `SourceCustomersDialog`, at 75% of desktop viewport width/height; mobile uses 95vw and 88vh.
- The details window shows identity/contact/address, creation date, PAN/VAT, email and applicable Dynamic interest configuration. Existing customer linking and Add customer remain available. Linked customer names open their Customer Folio.
- Escape, Close and backdrop dismissal follow existing dialog conventions; focus returns to the source name.

## Validation and source configuration

Every current form requires source type, name and address. The API defaults to Individual for compatible legacy callers that omit `source_type`.

| Type | Required identity/configuration |
| --- | --- |
| Individual | Phone with 9 or 10 digits. PAN/VAT is not used. |
| Company | PAN/VAT. Phone is not used. |
| Dynamic | Phone; Percentage or Fixed Amount; the corresponding non-negative percentage/amount; positive whole-number Days. PAN/VAT is optional. |

Email is optional and validated when supplied. Source names are trimmed and checked for case-insensitive uniqueness across types. Market segment remains an optional legacy field. Switching source types clears incompatible fields. Older channel, status, description and credit-term fields remain for compatibility.

Dynamic `interest_type`, `interest_percentage`, `interest_amount` and `days` are configuration fields. They do not calculate Bhaka Patra interest or replace existing frozen credit agreements. The separate Credit module retains its existing legacy rate/basis calculation rules.

## Customer relationship and synchronization

`Customer.business_source` is the existing optional, protected many-to-one relationship. A source can still have several independent contacts. `Customer.source_entry` adds a unique representative entry without replacing that relationship.

Creating a source automatically creates its representative customer in the same transaction. Repeated list requests and page navigation never create records. Source editing synchronizes representative identity/terms using IDs, preserving its ID and active state. Additional contacts remain independent. Shared representative fields are edited through the source form/service; customer API overrides are rejected.

For legacy data, migration 0009 reuses the earliest existing customer linked to a source ID, preserving its details during migration. It creates an entry only when no linked customer exists. It never matches customer names. Optional `first_customer` and legacy inline-source requests still preserve explicitly supplied independent contacts alongside the representative.

The Customers directory has no separate creation button; source representatives appear automatically. No default sources, customers or example documents are seeded.

## KPIs, search and ordering

`GET /api/business-sources/summary/` returns:

- `total_sources`: actual Business Source count.
- `total_linked_customers`: actual customers with a source, including representatives and inactive contacts.

Totals are independent of directory search/type/order. Loading/errors and retries are explicit.

The list API accepts `search`, `source_type` and `ordering`. Search trims whitespace and matches source names case-insensitively. Ordering supports `first_added` (default), `recently_added`, `name_asc` and `name_desc`, with ID tie-breaks. Filtering/ordering run in the API; SN follows the displayed order. There is no pagination in the current register.

## Deletion and API

Delete asks for confirmation and respects the existing protected relationships. Any customer reference, including a representative or inactive contact, blocks source deletion with HTTP 409. Source representatives are not silently detached, and financial history is not cascaded. A genuinely unassigned legacy source can be deleted with HTTP 204.

All endpoints require JWT authentication:

| Methods | Endpoint | Purpose |
| --- | --- | --- |
| GET/POST | `/api/business-sources/` | List/create sources and synchronize representative entries. |
| GET | `/api/business-sources/summary/` | Unfiltered source and linked-customer totals. |
| GET/PUT/PATCH/DELETE | `/api/business-sources/<id>/` | Detail, validated edits and protected deletion. |
| GET/POST | `/api/customers/` | Search/filter/order customers or create an explicit contact. |
| GET/PUT/PATCH/DELETE | `/api/customers/<id>/` | Customer detail, validation and history protection. |

Example valid Individual source payload:

```json
{
  "name": "Referral Register",
  "source_type": "INDIVIDUAL",
  "phone": "9800000000",
  "address": "Kathmandu",
  "email": ""
}
```

This creates one representative entry. To link an independent existing contact, PATCH its `business_source` with the source ID. A representative cannot be reassigned through the customer API.

## Maintenance and checks

- `frontend/app/business-sources/page.tsx`: list, search, sorting, summary and actions.
- `frontend/components/BusinessSourceDialog.tsx`: shared create/edit form.
- `frontend/components/SourceCustomersDialog.tsx`: source details, linked contacts and linking actions.
- `frontend/lib/business-data.ts`: shared source/customer API clients.
- `backend/accounts/serializers.py`: identity/configuration validation and atomic writes.
- `backend/accounts/source_customers.py`: unique source representative synchronization.
- `backend/accounts/views.py`: listing, summaries and protected deletion.
- `backend/accounts/migrations/0008_*` / `0009_*`: representative relationship, documents and legacy backfill.

Apply migrations with `python manage.py migrate`. Regression coverage lives in `backend/accounts/test_business_sources.py` and `test_folio.py`. Browser checks cover source-name click/keyboard opening, 75% sizing, mobile fit, close/focus restoration, shared heading typography and Edit/Delete-only actions.

See [CUSTOMERS.md](CUSTOMERS.md) for Customer Folio and Bhaka Patra behavior and [PROGRESS.md](PROGRESS.md) for validation history.
