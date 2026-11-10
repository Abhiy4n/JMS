# Pledge Backend Requirements

This document records the current gold-backed loan rules. A customer pledges gold as collateral; the shop lends money and returns the collateral when the loan is repaid. Pledge interest is independent of sales bills and legacy customer-credit calculations.

## Business Source and Pledge

Every Pledge requires a protected Business Source. Individual and Company sources supply fixed code presets; Dynamic sources require all four terms:

| Source type | Upfront percent | Upfront days | Daily percent | Divisor |
|---|---:|---:|---:|---:|
| Individual | 2 | 30 | 2 | 30 |
| Company | 1 | 15 | 2 | 30 |
| Dynamic | configured values | configured values | configured values | configured values |

Percentages are Decimal values from 0 to 100 with at most two decimal places. Upfront days must be an integer >= 0; divisor must be an integer >= 1. Inactive or incomplete sources are not eligible for new pledges.

The pledge copies and freezes the source terms at creation. Its principal, pledge date, source, and four terms can be edited only while it has no payment records, including voided/corrected records. The API and model enforce this rule. Editing or deactivating a source never changes existing pledge snapshots.

Effective Business Source term edits are separately retained in an append-only source term log, with a required reason and shared edit ID.

Stored statuses are Active, Closed, and Forfeited. “Partially Paid” is a display label for an Active pledge with a non-voided principal payment. There is no Overdue status.

## Interest and balances

All calculation logic is in `backend/pledges/interest.py`. The function receives Gregorian dates and payment/status history; it does not query the database or convert calendars.

- Day 1 is the pledge date: `(as_of_date - pledge_date).days + 1`.
- Upfront interest is `round_money(original principal * upfront percent / 100)`. It is charged once on creation and covers days 1 through `upfront_days`; an early principal payment does not reduce or refund it.
- After that period, each active day adds `round_money(outstanding principal * daily percent / 100 / divisor)`. Daily interest is rounded to two decimals using `ROUND_HALF_UP` before multiplication by days.
- A principal payment reduces the principal starting the next day. Earned interest is never recalculated, added to principal, or compounded. Unpaid interest remains outstanding.
- Forfeiture pauses interest after the forfeiture date, inclusive through that date. Reopening resumes on its date. The pause interval is derived from status edit logs; there is no stored pause field. Upfront interest is never charged a second time.
- Accrued interest is not stored. `Outstanding = outstanding principal + (interest earned - interest paid)`.

The implementation tests the Individual example with principal 100000: day 1 and day 30 interest are 2000.00; day 31 is 2066.67; day 121 is 8066.97. A 50000 principal payment on day 121 makes the daily amount 33.33 from day 122; day 151 unpaid interest is 9066.87 and total outstanding is 59066.87. Company tests cover day 1/15 at 1000.00 and day 16 at 1066.67.

## Payments

Each receipt records a date, an interest amount, and a principal amount; either portion may be zero, but not both. The cashier enters the split. Total amount is derived. Payment creation is atomic.

- Interest paid cannot exceed unpaid interest as of that payment date.
- Principal paid cannot exceed principal outstanding on that date.
- The date cannot precede the pledge date, be in the future, or precede the latest existing payment.
- A cap violation rejects the entire receipt.
- Closed and Forfeited pledges accept no payments until reopened.
- Staff corrections/removals require a reason and append edit-log rows. A removal voids the receipt; it does not delete it.

## Status transitions and edit log

All transitions are explicit and logged:

| From | To | Permission | Requirement |
|---|---|---|---|
| Active | Closed | Staff | Principal and unpaid interest are both zero on the closing date; reason optional. |
| Active | Forfeited | Superuser | Manual action; reason required. |
| Closed | Active | Superuser | Reopen; reason required. |
| Forfeited | Active | Superuser | Reopen; reason required. |

All other transitions are rejected. There are no automatic closures or forfeitures.

The append-only edit log records each changed field separately, with a shared edit ID per submission, old/new values, actor, time, and reason. Reasons are trimmed and at least five characters except for a normal paid closure. Logged fields include principal, pledge date, terms, source, status, and payment corrections/removals. The pledge link is protected. System migration entries may have an empty actor and use reason `system migration`.

## Dates

API dates are Bikram Sambat (BS) `YYYY-MM-DD`; database date fields contain Gregorian dates. `backend/pledges/bs_dates.py` is the only calendar-conversion module and uses the pinned `nepali-datetime` dependency, which supports BS years 1975–2100. Invalid or unsupported dates are rejected with a clear validation error. Interest and model logic use Gregorian dates only.

## Permissions

Login is required throughout. Any authenticated user can view pledges, create pledges, and record payments. Staff can edit a pledge before its first payment, close a paid pledge, and correct/remove payments. Only superusers can create/edit/deactivate Business Sources, forfeit pledges, or reopen them. Missing permissions return HTTP 403.

## API routes

- `GET/POST /api/pledges/`: list or create pledges.
- `GET/PATCH/PUT /api/pledges/<id>/`: view; staff edit before first payment.
- `POST /api/pledges/<id>/payments/`: record a receipt.
- `POST /api/pledges/<id>/status/`: close, forfeit, or reopen.
- `POST /api/pledge-payments/<id>/corrections/`: staff-correct a receipt.
- `POST /api/pledge-payments/<id>/removals/`: staff-void a receipt.

All input validation is server-side. The existing router already includes the Pledge URL module.
