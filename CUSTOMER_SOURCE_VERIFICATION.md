# Customers and Business Sources verification

## Changes in this completion pass

- Added Principal Amount and Interest Amount columns to the existing Bhaka
  Patra overview. Rows use the same exact integer-paisa formatting as its KPIs.
- Made the selected customer's name visible directly below Customer's Folio.
- Reused the folio's keyboard/scroll behavior through a shared dialog hook for
  the folio, CustomerDialog, BusinessSourceDialog, and SourceCustomersDialog.
  Escape closes idle dialogs, focus stays inside, body scrolling is locked,
  and focus/scroll state is restored on closing. Saves keep Escape disabled.
- Capped the existing 75vw folio at its available container width on mobile.
- Added success notices for customer/source saves, deletion, status changes,
  and linking, using the existing notice styles.
- Corrected source-customer loading, error, and retry behavior. Failed reads
  no longer display a misleading empty customer list or a stale link selector.
- Added retry and a preserved source label to CustomerDialog when source
  loading fails, and rejected whitespace-only customer names before submit.

Existing source CRUD, source counts, customer links, protected deletion,
authentication, credit rules, and navigation are reused. No production backend
logic was changed in this pass.

## Files changed in this pass

- `frontend/app/customers/page.tsx`
- `frontend/app/business-sources/page.tsx`
- `frontend/app/globals.css`
- `frontend/components/CustomerDetailsDialog.tsx`
- `frontend/components/CustomerBhakaPatraOverview.tsx`
- `frontend/components/CustomerDialog.tsx`
- `frontend/components/BusinessSourceDialog.tsx`
- `frontend/components/SourceCustomersDialog.tsx`
- `frontend/lib/customer-bhaka-patra.ts`
- `frontend/lib/use-dialog.ts` (new shared behavior)
- `frontend/tests/customer-bhaka-patra.test.cjs`
- `frontend/tests/customer-source-browser.cjs` (new browser smoke test)
- `backend/accounts/test_customer_actions.py`
- `CUSTOMERS.md`
- `CUSTOMER_SOURCE_VERIFICATION.md`

## Checks and their scope

Final results: 84 backend tests passed, seven frontend tests passed, the Chromium
smoke test passed, TypeScript passed, targeted ESLint passed, and the migration
check reported no changes. `git diff --check` found no whitespace errors.

The backend suite runs against Django's isolated test database. It exercises
customer/source CRUD, contact/type/term validation, duplicate source names,
customer association/reassignment, source counts, authorization, protected
deletion, portfolio isolation, and existing billing/interest regression tests.
Two additional checks verify that customer edits preserve IDs and counts and
leave another customer's complete database row unchanged, and that customer
read/create endpoints reject unauthenticated requests.

The seven frontend overview tests verify zero/empty behavior, ascending creation
order and tie ordering, sequential SN, customer isolation, exact decimal totals
and row values, action gating, and the original-record View callback. Their
fixtures exist only in memory; no Bhaka Patras are persisted.

The Chromium smoke test uses the actual Next frontend and mocked business API
responses. It verifies:

- Customer Folio opening, 75% desktop width at 1440x900, containment at 390x844,
  mobile KPI stacking, vertical scrolling, focus trapping, Escape, close button,
  backdrop closing, and restoration of body scrolling.
- CustomerDialog closing and customer create/edit/delete through the existing
  form, exactly one creation request, stable record count after editing, and
  deletion cancellation and confirmation.
- Business Source listing, KPI values from API responses, linked-customer
  isolation and linking without customer duplication, source create/edit/delete,
  duplicate-error display, protected-deletion messages, search and empty states,
  mobile dialog fit, and load failure/retry behavior.
- No Bhaka Patra requests and no uncaught browser exceptions during the run.

This is not a live API end-to-end mutation test: browser fixtures are isolated
from the actual database. API correctness is checked separately by Django tests.
The dev server used fallback fonts because Google Fonts was unreachable; layout
checks passed with those fallback fonts. A production build was not run.

Run from `frontend`:

```powershell
node --test tests/customer-bhaka-patra.test.cjs
npx tsc --noEmit
npx eslint app/customers/page.tsx app/business-sources/page.tsx components/CustomerDetailsDialog.tsx components/CustomerBhakaPatraOverview.tsx components/CustomerDialog.tsx components/BusinessSourceDialog.tsx components/SourceCustomersDialog.tsx lib/use-dialog.ts lib/customer-bhaka-patra.ts
```

For browser checks, start `npm run dev -- --port 3100`, then run
`node tests/customer-source-browser.cjs` in another terminal. It uses an isolated
temporary Chrome profile and Next's installed WebSocket client. Set `CHROME_PATH`
to another Chromium executable or `JMS_TEST_URL` to another local test server if
needed. Its sandbox flags apply only to the isolated headless browser process.

Run from `backend`:

```powershell
python manage.py test accounts billing --noinput
python manage.py makemigrations --check --dry-run
```

## Database integrity and future integration

No database schema, migrations, or production records were changed. Read-only
fingerprints of all customer and source rows matched before and after these
checks. The existing local database had one customer, zero sources, and zero
exact duplicate customer groups by name/phone/email. This audit does not impose
a new uniqueness rule on customer names or merge existing records.

The dedicated Bhaka Patra module is still absent. No forms, models, endpoints,
sample documents, automatic reads, or document mutations were added. Its real
record IDs, numbers, customer references, decimal principal/interest values,
and creation timestamps must later populate the existing display contract.
View/Edit/Delete remain unavailable without real handlers. Future work is
documented in [CUSTOMERS.md](CUSTOMERS.md): map authoritative data, preserve
complete/global KPI scope, delegate original-record navigation and mutations,
handle permissions/loading/errors, and refresh both views after successful
changes. The overview does not calculate interest.
