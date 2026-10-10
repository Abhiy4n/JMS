# JMS Bill Module

## Introduction

The Bill Module is JMS's transaction layer. It records a sale for a Customer, stores the purchased Bill Items, calculates saved totals, records the amount paid and remaining due, and exposes Bill history, editing, cancellation, Business Source account reporting, and browser printing.

The module is intentionally limited to billing. It is not a full accounting system and does not implement inventory, stock deduction, stock valuation, expenses, or a general ledger.

## Architecture

```text
Business Source
      |
      +-- Customers
             |
             +-- Bills
                    |
                    +-- Bill Items
                    +-- Summary and payment fields
             |
             +-- Business Source Account / Statement
```

- A `BusinessSource` has many `Customer` records.
- Every Bill belongs to one Customer. The source is obtained through `bill.customer.business_source`; Bill does not duplicate the source foreign key.
- A Bill has zero or more Bill Items. The create form requires at least one item, but the API model permits an empty item set.
- Payment is represented by `Bill.amount_paid` and `Bill.payment_method`. There is no separate Payment model or payment transaction history.
- Business Source account summaries aggregate saved Bills through the Customer relationship.

## Lifecycle

1. From Bills, choose **Create Bill**, or start from a Business Source's **Create Bill** action.
2. Enter the unique Bill Number, date, and Customer. When launched from a source, the Customer list is scoped to that source and auto-selects its only Customer when there is one.
3. Add one or more items. Material, rate unit, applicable purity, weight/quantity, rate, making charge, and discount are entered per item.
4. Review the live item and Bill previews. These are UI feedback; the backend recomputes and persists financial values.
5. Enter Bill-level discount, VAT, amount paid, and payment method, then save.
6. The app opens the saved Bill detail page. From there the user can edit, print, cancel, or follow the Business Source link.
7. Bill edits and cancellations are reflected in Business Source account totals because those totals are recalculated from saved Bills on each request.

## Bill Information

| Field | Purpose and validation | Storage |
| --- | --- | --- |
| `bill_number` | Required, unique identifier, maximum 64 characters. Entered manually; there is no number generator. | `billing.Bill.bill_number` |
| `customer` | Required existing Customer ID. A Customer is protected from deletion while Bills reference it. | Protected foreign key to `accounts.Customer` |
| `bill_date` | Required date; defaults to the current local date at model creation if omitted by a non-UI caller. | `billing.Bill.bill_date` |
| `subtotal` | Server-calculated sum of saved item totals; read-only in the API. | `billing.Bill.subtotal` |
| `discount` | Optional nonnegative overall monetary discount; cannot exceed subtotal. | `billing.Bill.discount` |
| `vat` | Optional nonnegative monetary amount. It is an amount, not a percentage. | `billing.Bill.vat` |
| `grand_total` | Server-calculated and read-only. | `billing.Bill.grand_total` |
| `amount_paid` | Optional nonnegative total payment amount; cannot exceed calculated grand total. | `billing.Bill.amount_paid` |
| `amount_due` | Server-calculated and read-only. | `billing.Bill.amount_due` |
| `payment_method` | Optional free-form text, maximum 40 characters. It does not determine payment status. | `billing.Bill.payment_method` |
| `status` | One of the Bill status choices; derived from totals/payments except DRAFT and CANCELLED overrides. | `billing.Bill.status` |
| `notes` | Optional text. | `billing.Bill.notes` |
| `created_at`, `updated_at` | Server-maintained timestamps. | `billing.Bill` timestamps |

The source and customer names/IDs in Bill responses are read-only relationship data. Business Source is never selected or stored independently on the Bill.

## Bill Items

Each Bill Item stores `item_name`, `material`, `rate_unit`, `quantity`, `gross_weight`, `stone_weight`, calculated `net_weight`, `purity`, `rate`, `making_charge`, `discount`, and calculated `total`.

Initial material choices are `GOLD`, `SILVER`, `PLATINUM`, `DIAMOND`, `GEMSTONE`, and `OTHER`. Rate units are `g`, `piece`, `carat`, and `item`.

Purity is stored as a nonnegative decimal. The frontend asks for purity for Gold, Silver, and Platinum and displays “Not applicable” for Diamond, Gemstone, and Other, sending `0.000` for those materials. Purity does not affect the current pricing calculation.

Quantity must be at least `0.001`. Weight, rate, making charge, and discount values cannot be negative. Gross weight must be positive for gram- and carat-priced items; piece- and item-priced items can use zero weight. Stone weight cannot exceed gross weight. Model `save()` recalculates net weight and total and runs `full_clean()` before writing.

## Pricing Rules

The backend is authoritative. Money is rounded to two decimal places using `ROUND_HALF_UP`; weights are stored to three decimal places.

```text
net_weight = gross_weight - stone_weight
```

Rate value depends on the selected rate unit:

```text
g:      rate_value = net_weight × rate
carat:  rate_value = (net_weight × 5) × rate
piece:  rate_value = quantity × rate
item:   rate_value = quantity × rate
```

The current carat conversion is **5 carats per gram**. Making charge and item discount are each manual line amounts applied once:

```text
item_total = rate_value + making_charge - discount
```

The item discount cannot exceed rate value plus making charge. This does not apply purity conversions, wastage, market rates, separate stone pricing, or other unconfirmed jewelry rules.

### Examples

**Diamond, per piece**

```text
Quantity:       1
Rate:           Rs. 80,000 / piece
Rate Value:     1 × 80,000 = Rs. 80,000
Making Charge:  Rs. 2,000
Discount:       Rs. 1,000
Item Total:     80,000 + 2,000 - 1,000 = Rs. 81,000
```

**Gold, per gram**

```text
Gross Weight:   6.500 g
Stone Weight:   0.500 g
Net Weight:     6.000 g
Rate:           Rs. 15,000 / g
Rate Value:     6.000 × 15,000 = Rs. 90,000
Making Charge:  Rs. 3,000
Discount:       Rs. 500
Item Total:     90,000 + 3,000 - 500 = Rs. 92,500
```

**Multiple items**

The Bill subtotal is the sum of each saved Bill Item total. For example, item totals of Rs. 92,500 and Rs. 81,000 produce a subtotal of Rs. 173,500 before Bill-level discount and VAT.

## Bill Summary and Payment

The backend calculates:

```text
subtotal = sum(item.total)
grand_total = subtotal - bill.discount + bill.vat
amount_due = grand_total - amount_paid
```

Item discounts are already included in each item total and are not deducted again in the Bill summary. Overall Bill discount is a separate field.

Payment Method is the method label (for example, Cash). Payment Status is derived separately:

| Condition | Backend status | Bills UI label |
| --- | --- | --- |
| Explicit draft override | `DRAFT` | Draft |
| Explicit cancellation | `CANCELLED` | Cancelled |
| Grand total is positive and amount due is zero | `PAID` | Paid |
| Amount paid is positive and amount due remains | `PARTIAL` | Partial |
| No payment is recorded | `UNPAID` | Due |

The API rejects negative payment and payment above the recalculated grand total. A Bill edit that lowers the total below the existing amount paid is rejected; overpayment is not supported.

## Bills List

The `/bills` page shows Bill Number, Customer, Business Source, Bill Date, Grand Total, Amount Paid, Amount Due, Status, and actions. It supports server-side search, status, and date-range filters and provides loading, empty, and error states.

Available row actions are View, Edit, and Cancel. Cancelled Bills remain visible with `CANCELLED` status and show no active outstanding amount. Print is available from Bill Detail.

## Bill Detail, Edit, and Cancellation

`/bills/<id>` loads a read-only Bill response from the backend. It displays saved items, source/customer, summary, payment method, paid amount, due amount, and status. The Business Source name links to its account page.

Edit reuses the Bill form at `/bills/new?edit=<id>`. The form loads saved Bill data and sends a `PATCH` to the existing detail endpoint. If `items` is included, the serializer replaces the nested item set transactionally; if omitted, items remain unchanged. The backend recalculates totals and validates the existing/new amount paid against the recalculated total.

Cancel requires browser confirmation and sends `PATCH` with `status: CANCELLED`. It does not delete the Bill. Cancelled Bills remain available in history but are excluded from active Business Source purchase, paid, and outstanding totals.

## Print / Invoice

The Bill Detail **Print** action invokes the browser print dialog. Print CSS targets A4 paper and prints saved Bill values: company heading, Bill number/date, Business Source, Customer, saved Bill Items, summary, and payment information. The print view does not run a separate pricing calculation. PDF generation and configurable company address/contact details are not implemented.

## Business Source Account and Statement

The account view is on `/business-sources/<id>`. It answers what the source purchased, paid, and currently owes. Aggregates are computed in the database from Bills reached through `Bill.customer.business_source`:

```text
Total Purchases = sum(valid Bill grand_total)
Total Paid = sum(valid Bill amount_paid)
Outstanding = max(Total Purchases - Total Paid, 0)
```

“Valid” account Bills exclude `DRAFT` and `CANCELLED`. `CLEAR` means outstanding is zero; `CREDIT` means outstanding is greater than zero. Paid, partial, and due Bill counts are also returned.

History can be searched by Bill number or Customer, filtered by status and `bill_date` range, and paginated server-side (25 per page by default, maximum 100). The overall summary stays unchanged by history filters; filtered-period totals are separately labeled.

The Statement tab derives debit rows from Bill grand totals and credit rows from each Bill's `amount_paid`, in Bill-date order. Individual payment dates are not stored, so payment rows use the associated Bill date. Statement rows are derived from Bills; there is no separate manual ledger.

## Backend Architecture

| File | Responsibility |
| --- | --- |
| `backend/billing/models.py` | Bill and BillItem fields, status/material/rate-unit choices, calculations, model validation. |
| `backend/billing/serializers.py` | Nested item/Bill API fields, validation, create/update transactions, payment validation. |
| `backend/billing/views.py` | Authenticated Bill CRUD and database-aggregated Business Source account endpoint. |
| `backend/billing/urls.py` | Bill and account endpoint routes. |
| `backend/billing/tests.py` | API, calculation, validation, account, and lifecycle regressions. |
| `backend/config/settings.py` | Registers the `billing` Django app. |
| `backend/api/urls.py` | Includes `billing.urls` under `/api/`. |
| `backend/accounts/models.py` | Existing BusinessSource/Customer records; Bill uses the Customer relationship. |

All Bill endpoints require the existing JWT authentication. Bill detail uses Django REST Framework's retrieve/update/destroy view, so GET, PUT, PATCH, and DELETE are available. The UI uses PATCH for editing and cancellation; it does not expose permanent deletion.

## API Reference

All paths below are under `/api` and require the existing JWT bearer token, except where noted.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/bills/` | List Bills. Supports `search`, `customer`, `status`, `bill_date`, `date_from`, and `date_to`. Search matches Bill number, Customer, or Business Source. |
| POST | `/api/bills/` | Create a Bill with nested items. Important fields: `bill_number`, `customer`, `bill_date`, `items`, Bill `discount`, `vat`, `amount_paid`, `payment_method`. Returns the saved Bill with server totals and relationship names/IDs. |
| GET | `/api/bills/<id>/` | Read a saved Bill and its items. |
| PUT / PATCH | `/api/bills/<id>/` | Update a Bill. PATCH with `items` replaces the full item list; omit `items` to keep it unchanged. Totals are recalculated and payment is revalidated. |
| DELETE | `/api/bills/<id>/` | Permanently deletes through the generic API. The frontend does not use this for cancellation. Prefer the CANCELLED status for financial history. |
| GET | `/api/business-sources/<id>/account/` | Return source summary, filtered/paginated Bill history, and derived statement. Filters: `search`, `status` (`ALL`, `PAID`, `PARTIAL`, `DUE`, `CANCELLED`), `date_from`, `date_to`, `page`, and `page_size`. |

Current item request fields are `item_name`, `material`, `rate_unit`, `quantity`, `gross_weight`, `stone_weight`, `purity`, `rate`, `making_charge`, and `discount`. `net_weight` and `total` are read-only response values. For older clients, the item serializer accepts write-only `gold_rate` as an alias for `rate`; clients should use `rate` going forward.

Common validation errors include duplicate/missing Bill number, missing/invalid Customer, negative monetary or weight values, nonpositive quantity, stone weight greater than gross weight, missing gross weight for `g`/`carat`, excessive item/Bill discounts, and payment above the calculated grand total. Invalid list/account filters return HTTP 400.

The existing Business Source and Customer endpoints remain under `/api/business-sources/`, `/api/business-sources/<id>/`, and `/api/customers/`.

## Frontend Architecture

| File | Responsibility |
| --- | --- |
| `frontend/app/bills/page.tsx` | Bills list, filters, and View/Edit/Cancel links/actions. |
| `frontend/app/bills/new/page.tsx` | Shared create/edit form; edit mode uses the `edit` query parameter. |
| `frontend/app/bills/[id]/page.tsx` | Saved Bill detail, cancellation, Business Source link, and browser print action. |
| `frontend/app/business-sources/[id]/page.tsx` | Business Source account overview, filtered history, statement, Customer list, and Create Bill entry point. |
| `frontend/lib/bill-data.ts` | Bill/item TypeScript types and authenticated fetch/create/update/cancel helpers. |
| `frontend/lib/business-source-account.ts` | Typed Business Source account response and authenticated query helper. |
| `frontend/lib/business-data.ts` | Existing Business Source/Customer types and Customer/source API helpers. |
| `frontend/lib/user-facing-error.ts` | Replaces Django HTML/debug error pages with safe user-facing fallback messages. |
| `frontend/components/BusinessAppShell.tsx` | Shared navigation, including Bills. |
| `frontend/app/globals.css` | Existing JMS design tokens plus account, Bill detail, responsive, and print styling. |

API helpers reuse `apiRequest` and the existing JWT token storage. No second authentication mechanism is used.

## Database and Migrations

The Django app is `billing`.

- `backend/billing/migrations/0001_initial.py` created Bill and BillItem with the initial `gold_rate` field.
- `backend/billing/migrations/0002_rename_gold_rate_billitem_rate_billitem_material_and_more.py` renames `gold_rate` to `rate` without discarding values and adds `material` and `rate_unit`.

Both billing migrations are applied in the verified local database. The completed lifecycle/documentation work introduced no additional model changes or pending migrations. Database configuration uses SQLite when `DATABASE_URL` is absent and the configured database (for example PostgreSQL) when it is supplied.

## Validation and Error Handling

DRF decimal fields validate API input; `BillItem.save()` recalculates `net_weight` and `total`, calls `full_clean()`, and saves only after model and cross-field validation. Nested Bill writes are transactional. Bill-level payment validation uses calculated item totals, Bill discount, and VAT before accepting the request; saved totals/status are recalculated by the model.

Frontend fields show local validation errors and prevent invalid submissions, but their calculations are previews only. API failures are displayed through safe error messages; Django HTML debug pages are not exposed verbatim. Load, save, update, and cancellation paths display loading or error state.

## Testing and Verification

Verified in the current implementation:

- `python manage.py check`: passed.
- Full `python manage.py test`: **29 tests passed**.
- Frontend ESLint: passed.
- `npx tsc --noEmit`: passed.
- Frontend production build: passed.
- `git diff --check`: passed.
- `makemigrations --check --dry-run`: no changes detected; billing migrations applied.
- Business Source account tests cover three Bills totaling Rs. 600,000, Rs. 350,000 paid, Rs. 250,000 outstanding; paying more Bills updates totals to CLEAR.
- Bill tests cover fully paid Diamond piece pricing, partial/due behavior, item editing, payment validation, cancellation exclusion, and account statement values.

The production build reports the existing Next.js middleware-to-proxy deprecation warning. Manual inspection of the authenticated Business Source page/print dialog was not completed in the shared browser because its authentication session had expired.

## Known Limitations

- Payments are stored as one `amount_paid` total and one `payment_method` string on Bill. There are no separate payment records or payment dates.
- Consequently, statement credits use the associated Bill date; the system cannot show the actual date of each payment.
- Payment method is free text. Property Setup payment-method configuration is not implemented.
- Printing uses the browser print dialog and CSS; it does not generate a PDF. The invoice header currently uses the configured frontend brand text; editable address/contact settings are not present.
- Material/rate-unit fields are supported by the current Bill API, but inventory, stock deduction, and valuation are not.
- The account statement is a derived Bill/payment view, not double-entry accounting or a general ledger.
- Frontend calculations can differ by rounding/display while typing; persisted response values from the backend are authoritative.

## Future Improvements

The following are not implemented and require separate requirements/design:

- Configurable payment methods through Property Setup.
- Payment records with payment date/time and receipts.
- Inventory/stock integration and valuation.
- General accounting or ledger integration.
- Configurable tax/VAT rules.
- Configurable invoice address/contact details and invoice numbering.
- PDF generation if browser printing is insufficient.
- Additional material/rate units or jewelry pricing rules beyond the current choices.

## Important Rules When Modifying the Bill Module

1. Backend-saved item and Bill totals are the financial source of truth; frontend figures are previews.
2. Item discounts are included in each item total. Do not deduct them again in the Bill summary.
3. Keep `amount_paid <= grand_total`; do not weaken server validation when editing totals.
4. Making charge and item discount are manual line amounts applied once, not multiplied by quantity.
5. Preserve the current rate-unit rules: `g` uses net weight, `carat` uses net weight × 5, and `piece`/`item` use quantity.
6. Do not change the 5-carat-per-gram conversion without confirming the business requirement.
7. Keep generic `rate` terminology. `gold_rate` exists only as a write-only compatibility alias.
8. Keep Payment Method separate from the Bill status.
9. Use `CANCELLED` rather than deleting a financial record when cancellation is intended; cancelled Bills remain in history and are excluded from active account totals.
10. Do not add a duplicate Business Source foreign key to Bill. Follow `Bill.customer.business_source`.
11. Keep account summaries aggregated from saved non-DRAFT/non-CANCELLED Bills in the database.
12. Do not present filtered-period totals as overall account balances.
13. Do not invent payment dates; only the Bill date is available for derived statement entries.
14. Avoid displaying raw Django HTML/debug responses in the frontend.
15. Keep inventory, accounting, payment gateways, and automated market rates out of this module until separately specified.

## Developer Quick Start

Start with these files, in order:

1. `backend/billing/models.py` — fields, status, and financial calculations.
2. `backend/billing/serializers.py` — API contract and validation.
3. `backend/billing/views.py` and `backend/billing/urls.py` — CRUD and Business Source account API.
4. `frontend/app/bills/new/page.tsx` — shared Bill create/edit form.
5. `frontend/app/bills/page.tsx` and `frontend/app/bills/[id]/page.tsx` — list, detail, cancel, and print.
6. `frontend/app/business-sources/[id]/page.tsx` — Business Source account and purchase history.
7. `backend/billing/tests.py` — calculations, API validation, lifecycle, and account tests.