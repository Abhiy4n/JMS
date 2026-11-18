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

All calculation logic is in `backend/pledges/interest.py`. Stored dates are Gregorian; the shared `bs_elapsed_days` helper in `backend/pledges/bs_dates.py` converts them to BS dates and applies the shop's 30/360 convention:
`d360(date) = 360 * year + 30 * month + min(day, 30)`. The elapsed count is `d360(as_of) - d360(pledge date)`, so the pledge date is day 0. BS days 31 and 32 have the same day number as day 30, and the next month's day 1 is one day later.

- Upfront interest is `round_money(original principal * upfront percent / 100)`. It is charged once when the pledge is created and remains flat while elapsed days `n <= upfront_days`; an early principal payment does not reduce or refund it. The first daily charge is on elapsed day `upfront_days + 1`.
- After the upfront period, each active 30/360 day adds `round_money(outstanding principal * daily percent / 100 / divisor)`. Daily interest is rounded to two decimals using `ROUND_HALF_UP` before multiplication by days.
- A principal payment reduces principal immediately for that date. On a principal-payment day, ordinary daily interest is `daily(balance at start of day) + daily(balance at end of day)`. Previously earned interest is never recalculated, added to principal, or compounded.
- An interest payment dated BS day 31 or 32 charges the largest extra-day count for that BS month (day minus 30); a later payment on day 32 after one on day 31 charges one additional day. Extra days are priced at the rounded daily amount on the payment date's outstanding balance, are not created by principal payments, and are included in accrued interest only once charged. They are never removed by a later payment date. No extra days are charged during the upfront period.
- Forfeiture pauses only the interior 30/360 days between the forfeiture and reopen dates; interest remains active on both event dates. The pause interval is derived from status edit logs; there is no stored pause field.
- Accrued interest is not stored. Summary totals include charged interest only. Interest due for a selected day 31/32 includes any uncharged extra days for that date. `Outstanding = outstanding principal + (interest earned - interest paid)`.

The Individual example with principal 100000 has interest 2000.00 through elapsed day 30, then 2066.67 on day 31. With no payments, interest is 5933.53 on 2083-03-30, 2083-03-31, and 2083-03-32, and 6000.20 on 2083-04-01. On elapsed day 60, a 50000 principal payment produces 4033.43 interest that day under the both-balances rule; interest is 4066.76 on day 61 and 4100.09 on day 62. Company terms remain 1000.00 through elapsed day 15 and 1066.67 on day 16.

## Payments

Each receipt records a date, an interest amount, and a principal amount; either portion may be zero, but not both. The cashier enters the split. Total amount is derived. Payment creation is atomic.

- Interest paid cannot exceed interest due as of that payment date, including uncharged month-end extra days when a payment is dated BS day 31 or 32.
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

API dates are Bikram Sambat (BS) `YYYY-MM-DD`; database date fields contain Gregorian dates. `backend/pledges/bs_dates.py` is the only calendar-conversion and elapsed-day module and uses the pinned `nepali-datetime` dependency, which supports BS years 1975–2100. Invalid or unsupported dates are rejected with a clear validation error. Calendar dates continue to display normally in BS; all interest elapsed-day calculations use the shared 30/360 counter.

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
