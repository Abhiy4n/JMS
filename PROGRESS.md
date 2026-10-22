# JMS progress and features

Last updated: October 20, 2026 (Nepal time). Current behavior is described below; earlier timeline milestones remain historical.

## Progress from day 1

The early timeline below comes from the repository's commit history. October 18/20 entries record local implementation work from this session, not additional commits. Dates without a recorded change are not reconstructed or guessed.

| Date | Progress |
| --- | --- |
| September 15, 2026 — day 1 | Initial Next.js application created. |
| September 21, 2026 | First recorded merge. |
| September 22, 2026 | Setup guide and dependencies added. |
| September 23, 2026 | Django backend and basic authentication added. Password reset was left unimplemented. |
| October 2, 2026 | Linked business source/customer management and an API fix committed. |
| October 3, 2026 | Business module branch changes merged. |
| October 4, 2026 | Profile dropdown and appearance placeholders added; bill module implemented. |
| October 9, 2026 | Local API repaired by applying missing profile/billing migrations. Frontend/API services started. Missing `lucide-react` installed and malformed generated Next.js types regenerated. |
| October 10, 2026 | Business Sources replaced in the UI by Customer Types. Customers, Customer Types and Billing separated in navigation. Confirmed test records removed after a database backup. Individual, Company and Dynamic Customer credit rules implemented, along with account totals, charge breakdowns and separate principal/interest receipts. Later the same day, Business Source records, source-governed interest, customer popups, Accounts ? Invoices portfolios and purchase bills were added. |
| October 18, 2026 | Reproduced a Business Source API failure caused by missing migration 0007. Backed up SQLite, applied the migration, and verified API/CORS operation. |
| October 20, 2026 | Integrated persisted Bhaka Patras and preview, automatic source representative customers, overall/customer KPIs, ordering, protected actions and 75% folio/source windows. Matched gold heading typography. Added maintenance comments and refreshed feature documentation. |

## Latest October 20 refinements

- Customers has no creation button or Business Source/Status columns and filters. Source creation automatically provides a representative customer; existing contacts/history remain intact.
- Overall Customers KPIs show Total Rakha Patra and Total Amount across all persisted documents, independently of list filters. The directory supports oldest/newest first and alphabetical ordering.
- Customer names open a 75% desktop Customer Folio window. Customer details are above its document count/recorded-interest KPIs and Bhaka Patra table. Folio documents can be ordered First created first or Last created first.
- Bhaka Patras are persisted in the accounts app with purchased items, actual references and recorded financial values. Clicking a row opens a customer-scoped formal preview. Bills/manual credits are separate and never substitute for documents.
- Edit/Delete remain in customer Actions; Activate/Deactivate and View bills controls are removed. Confirmed deletion of source representatives deactivates them, preserving the source/history.
- Business Source names open a 75% details window. Its Actions has Edit/Delete, with View removed. Existing source linking and creation workflows remain.
- Business Sources and Customers share matching gold heading typography and restrained KPI/small-title accents. Mobile windows adapt to the viewport; nested Escape handling and focus restoration are supported.
- Important source synchronization, aggregation, sorting, money, dialog and ownership lines have maintenance comments. Detailed current guides: [CUSTOMERS.md](CUSTOMERS.md), [BUSINESS_SOURCES.md](BUSINESS_SOURCES.md), and [CUSTOMER_FOLIO_IMPLEMENTATION.md](CUSTOMER_FOLIO_IMPLEMENTATION.md).

## Historical October 10 refinements

- Sidebar modules use their normal style and turn yellow only on hover, including Bills and Reports.
- Removed the Invoices module. Bills remains the transaction list with its existing headings, buttons, filters and controls. Old invoice URLs redirect to Bills, optionally filtered by customer.
- Customer names open a popup occupying 75% of the desktop viewport. The popup contains customer details, all bills and the five portfolio KPIs.
- Added rightmost **Actions** to customer records: edit, delete, activate/deactivate. Customers with bill or credit history cannot be deleted; deactivation preserves that history.
- Added **Accounts ? Credit** for manually recording customer credit amounts and calculating/collecting interest.
- As explicitly confirmed, new bills do not generate interest. Interest is charged only on manually entered credit; existing bill interest agreements are retained.

## Current modules and features

### Authentication and account menu

- Signup, email/password login, current-user API and JWT refresh.
- Automatic access-token renewal and logout on session expiry.
- Protected frontend routes and authenticated API endpoints.
- Account menu with name, email and optional profile picture; sign out.
- Appearance controls are placeholders, not a working theme switcher.
- Password reset is not implemented.

### Business Source

Route: `/business-sources`. `/dashboard` and `/customer-types` redirect here.

Create Source and Edit share the existing form. Required common fields are name/type/address. Individual requires phone, Company requires PAN/VAT, and Dynamic requires phone plus percentage/fixed-amount configuration and a positive day count. Market segment is optional legacy data. Existing credit snapshots are not rewritten by these configuration fields.

The register shows SN, name, type, phone, address, created date and Edit/Delete. Search/type filtering and first-added/recent/name ordering use the API. KPI totals count sources and all linked customers independently of filters. Click or keyboard-activate a source name to inspect its details and linked contacts in a 75% window. See [BUSINESS_SOURCES.md](BUSINESS_SOURCES.md).

### Customers and Customer Folio

Route: `/customers`; `?customer=<id>` selects the folio window. `/customers/<id>` redirects to it.

New sources create one unique representative customer atomically through `Customer.source_entry`. The existing many-to-one `business_source` relationship still supports additional contacts. Backfill preserves existing IDs/history and uses source IDs, never name matching. Shared representative fields are edited through the source form; independent contacts keep their customer form.

The directory has search, customer-type filtering and four sort choices. Overall Total Rakha Patra/Total Amount use document count and recorded principal sums across all customers. Customer-name cells open the 75% folio; closing keeps directory filters/order. Business Source/Status columns and filters are hidden.

The folio contains customer information first, followed by Total Bhaka Patra/Total Interest Amount, then the document table. Its creation-order selector supports both directions with sequential SN. Interest is summed from stored values using exact paisa arithmetic; unknown interest is unavailable rather than an invented zero. View credit remains; View bills and separate activation controls are removed.

Edit/Delete reuse existing validation and persistence. Confirmed Delete deactivates source representatives; customer financial/document history protects other records from hard deletion. See [CUSTOMERS.md](CUSTOMERS.md).

### Bhaka Patra documents

The accounts app now persists documents and purchased items. Each document has a protected customer foreign key and an actual unique reference. Authenticated list/create and customer-scoped detail/update APIs power the folio and spacious visual preview. Optional dates, items, financial fields and notes render safely; no example records or arbitrary interest calculations are added.

Preview selection uses `?customer=<id>&patra=<record_id>`. Only the top window handles Escape/Tab, and closing the preview leaves its folio open. The reusable document layout has neutral print styling; surrounding controls use the application theme. Document-entry UI, accrual, settlement, status and voiding rules remain future work. Generic document deletion is unavailable to protect history.

Bills and manual credits retain their own APIs, balances and calculation rules. `/bills?customer=<id>` filters the existing Bills register. Old Accounts/Invoices URLs continue to redirect to Bills; the customer folio no longer embeds a Bills table or the five account-portfolio KPIs.

### Accounts ? Credit

Route: `/accounts/credit`. Use **Add credit** to select an active customer, enter the amount given and its date, and optionally add notes. The amount must be positive and the credit date cannot be in the future.

New credit inherits its linked source's terms, or the standalone customer's terms, and freezes those terms when entered. Individual and Dynamic periods are 30 days; Company periods are 15 days. Interest is simple and charged at the start of each started period.

Credit records show amount given, principal due, interest due and total due. Open a record to see its period charge breakdown and record separate principal/interest payments. Principal payments reduce future charges, earned interest stays payable, and overpayments are rejected.

Manual credit is an independent transaction, not automatically created from a bill. New bills track sale/payment balances without interest. Existing bill agreements are retained for history.

### Bills and jewellery items

- Bill creation, list/search, status/date filters, detail, editing, cancellation and browser printing. Each bill selects customer buys from shop (SALE) or customer sells to shop (PURCHASE). Existing bills migrate as SALE.
- Materials: Gold, Silver, Platinum, Diamond, Gemstone and Other.
- Pricing by gram, piece, carat or item; optional purity, weights, making charge and line discount.
- Net weight = gross weight − stone weight; carat pricing uses 5 carats per gram.
- Server-calculated item totals, subtotal, overall discount, VAT amount, grand total, principal paid and principal due.
- Principal sale status: Draft, Unpaid, Partial, Paid or Cancelled. A Paid sale can still have outstanding interest; interest is displayed separately.
- Invalid negative values, excess discounts, invalid weights and principal overpayments are rejected.
- Issued customer/date fields cannot be changed, and cumulative principal/interest payments cannot be reduced.
- Cancellation retains the bill but excludes its principal and interest from the active account.

## Credit calculation rules

The October 10 clarification explicitly removed Nepali calendar calculations from **all** customer types. One monthly period now means exactly **30 elapsed days**, anchored to the bill's credit start date, rather than a Gregorian or Bikram Sambat calendar month. Company periods are exactly **15 elapsed days**. Backend local dates use `Asia/Kathmandu`.

Interest is simple, charged at the start of every started period, and rounded to two decimal places using decimal arithmetic with half-up rounding:

```text
period charge = outstanding principal at period start × interest amount ÷ credit basis
total to collect = current principal due + accrued interest − interest paid
```

For unchanged Individual credit:

| Credit | Days 1–30 | Days 31–60 | Days 61–90 |
| --- | --- | --- | --- |
| Rs. 50,000 | Rs. 1,000 total interest | Rs. 2,000 | Rs. 3,000 |
| Rs. 1,00,000 | Rs. 2,000 | Rs. 4,000 | Rs. 6,000 |
| Rs. 2,00,000 | Rs. 4,000 | Rs. 8,000 | Rs. 12,000 |

For Company credit of Rs. 1,00,000, total interest is Rs. 2,000 on days 1–15, Rs. 4,000 on days 16–30, and Rs. 6,000 on days 31–45.

A Dynamic Customer configured for Rs. 1,500 per Rs. 50,000, borrowing Rs. 75,000, is charged Rs. 2,250 for each 30-day period.

### Payments and history

- Creation-time payment is deducted before determining borrowed principal. A fully paid sale creates no credit interest.
- Each manual credit freezes its effective interest type/rate/basis from the source or standalone customer. Existing bill interest snapshots remain unchanged; new bills do not charge interest.
- Principal changes after issue create dated `CreditAdjustment` records. Later payments reduce future period charges without retroactively reducing earlier interest.
- Principal payments made on a renewal date apply before that renewal's charge. The first period remains charged if initially borrowed principal is repaid later on day 1.
- Earned interest remains payable after principal is repaid. It never becomes interest-bearing principal.
- Bill detail provides separate principal and interest payment inputs and a charge table with charge date, period end, principal and interest.
- Interest cannot be paid above the accrued amount; future dates, draft and cancelled bills have no active charges before issue.
- Interest totals are calculated when the API is requested; no scheduled job is needed. Refresh the screen to get a later day's totals.

## Data cleanup and compatibility

On October 10, the user confirmed removal of five local test customers (Ramesh, hari, Thuldai, Abhiyanlee and Testing) and three old business sources. There were no local bills. Login accounts were preserved.

The original SQLite database was backed up to `backend/.backups/before-customer-types-2026-10-10.sqlite3`. This directory is ignored by Git. Cleanup was scoped to the inspected records and refused to proceed if records changed or bills appeared. No automatic deletion migration or startup seeding was added.

The existing `BusinessSource` model and nullable customer relation are now used by the new source register. Older channel/status fields and source account API remain for compatibility, while the current UI uses the typed source register and customer popup. Existing customers default to Individual during migration. Existing bills adopt their current outstanding balance as opening credit, because historic dated payments were not previously stored; the local database had no bills requiring this approximation.

## Main code locations

| Code | Responsibility |
| --- | --- |
| `backend/accounts/models.py`, `serializers.py`, `views.py` | Customer types, dynamic terms, validation, filters and type counts |
| `backend/billing/interest.py` | Period boundaries, proportional simple interest and payment-aware charges |
| `backend/billing/models.py`, `serializers.py` | Frozen bill terms, dated principal adjustments, payment validation |
| `backend/billing/views.py` | Bill APIs and customer account totals |
| `frontend/components/CustomerDialog.tsx` | Source-free customer form and dynamic settings |
| `frontend/components/BillCreditPanel.tsx` | Interest breakdown and payment collection |
| `frontend/app/business-sources/page.tsx` and source dialogs | Business Source register, creation and linked-customer popup |
| `frontend/app/accounts/credit/` and credit dialogs | Manual credit entry, charges and repayments |
| `frontend/components/CustomerFolioDialog.tsx`, `CustomerFolio.tsx` | 75% customer window, details, document loading and ordering |
| `frontend/components/CustomerBhakaPatraOverview.tsx` | Customer document KPIs, sort selector and rows |
| `frontend/components/BhakaPatraPreview.tsx`, `BhakaPatraDocument.tsx` | Customer-scoped record loading and document layout |
| `backend/accounts/source_customers.py`, `folio.py` | Representative synchronization, document APIs and overall summary |
| `frontend/lib/customer-bhaka-patra.ts`, `use-dialog.ts` | Exact totals, deduplication, sorting and nested-window accessibility |
| `frontend/components/CustomerActions.tsx` | Edit/Delete with confirmed, history-preserving behavior |
| `frontend/app/customers/` | Customer directory and links to customer popups |
| `frontend/app/bills/` | Bill creation, list and detail |

Main calculation, validation, migration and form sections include comments explaining their purpose.

## API additions

All endpoints below require a JWT bearer token.

| Method | Path | Purpose |
| --- | --- | --- |
| GET/POST | `/api/business-sources/` | List/create typed sources and synchronize their representative customers |
| GET/PATCH | `/api/business-sources/<id>/` | Read/update source identity and interest terms |
| GET | `/api/customers/summary/` | Overall Bhaka Patra count and principal total |
| GET/POST | `/api/customers/<id>/bhaka-patras/` | Customer-scoped document list and creation |
| GET/PUT/PATCH | `/api/customers/<id>/bhaka-patras/<record_id>/` | Matching customer/document detail and update |
| GET/POST | `/api/customers/` | List/search/filter or create customers using `customer_type` |
| GET/PATCH/DELETE | `/api/customers/<id>/` | Customer detail, update/status and history-protected deletion |
| GET/POST | `/api/credits/` | List/create manually issued customer credit |
| GET | `/api/credits/<id>/` | Credit terms and calculated charges |
| POST | `/api/credits/<id>/payments/` | Record principal/interest repayments |
| GET | `/api/customers/<id>/account/` | Account totals and bill/interest history |
| GET/POST | `/api/bills/` | Bill list/create with server-calculated item and payment totals |
| GET/PATCH/DELETE | `/api/bills/<id>/` | Bill detail/update/delete; PATCH cumulative `amount_paid` and/or `interest_paid` |

## Running locally on Windows

After installing backend/frontend dependencies, run migrations and keep both services running:

```powershell
# Terminal 1, from JMS/backend
python manage.py migrate
python manage.py runserver 8000

# Terminal 2, from JMS/frontend
npm.cmd install
npm.cmd run dev -- --port 3000
```

Frontend: `http://localhost:3000/business-sources`. API health: `http://localhost:8000/api/health/`.

## Verification

The comments/documentation maintenance pass changed no application behavior: Python ASTs matched before/after for the three edited backend files, and emitted JavaScript matched for all eight commented frontend files. Lint, TypeScript, relative Markdown links and whitespace checks passed. Functional suites were not rerun for this comments-only pass; their most recent results are recorded below.

Latest functional verification on October 20: **95 backend tests passed**, including nine folio/integration tests; **seven frontend tests passed**. Lint and TypeScript passed. Real Chromium checks (mocked business APIs) verified overall KPIs, directory and folio ordering, matching heading typography, source-name click/keyboard, 75% desktop windows, mobile fit, nested Escape, focus restoration, source editing, protected actions and error/retry. No test documents were added to the live database.

Live authenticated requests verified the summary and each customer ordering endpoint returned HTTP 200. Migrations 0008/0009 were applied after a SQLite backup; all pre-existing customer/source/bill/credit IDs were preserved.

Production build attempt: blocked by the existing Inter/Geist Mono downloads from Google Fonts; the build did not pass. Document entry UI and financial lifecycle rules remain unresolved, not hidden behind sample data.

The results below are historical milestones, not the latest test totals.


Earlier customer-popup/manual-credit refinement: **75 backend tests passed**. TypeScript, ESLint and migration checks passed. Live checks verified Customers, Bills and Credit APIs, preserved existing bill interest agreements, and compiled the customer popup route, Bills and Accounts/Credit pages. No test records were added to the live database.

Earlier source/portfolio result: **61 backend tests passed**. Source identity requirements, multiple customer links, source-inherited/frozen credit terms, purchase payables and portfolio KPIs are covered. TypeScript, ESLint and migration drift checks passed. Business Sources, Customers, Accounts/Invoices, invoice portfolio and bill routes compiled and returned HTTP 200; API health returned OK.

October 10 result: **46 backend tests passed**, migration drift check passed, TypeScript and ESLint passed. The six customer/bill page routes compiled and returned HTTP 200. Authenticated live checks verified Customer Types, Customers and Bills endpoints and confirmed empty customer/bill records after cleanup.

The October 10 backend suite includes original billing/legacy compatibility tests and new tests for all interest period boundaries, proportional amounts, custom terms, year transitions, rounding, initial/later payments, full principal settlement, separate interest receipts, frozen terms, authorization and account totals.

```powershell
# Backend
python manage.py test
python manage.py makemigrations --check --dry-run

# Frontend
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
npm.cmd run lint
node --test tests/customer-bhaka-patra.test.cjs
# With the frontend running:
$env:JMS_TEST_URL = "http://localhost:3000"
node tests/customer-source-browser.cjs
```

Reports, inventory, full accounting, stock management, password reset and theme switching remain future work.
