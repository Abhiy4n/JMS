from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP


CENT = Decimal("0.01")
HUNDRED = Decimal("100")


def round_money(value):
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def daily_interest_amount(principal, daily_percent, divisor):
    return round_money(Decimal(principal) * Decimal(daily_percent) / HUNDRED / Decimal(divisor))


def _get(item, key, default=None):
    return item.get(key, default) if isinstance(item, dict) else getattr(item, key, default)


def _status_events(edit_logs):
    events = []
    for log in edit_logs:
        if _get(log, "field") != "status":
            continue
        effective = _get(log, "effective_date")
        if effective is None:
            changed_at = _get(log, "changed_at")
            if changed_at is None:
                continue
            effective = changed_at.date()
        events.append((effective, _get(log, "changed_at"), _get(log, "id", 0), _get(log, "new_value")))
    return sorted(
        events,
        key=lambda event: (event[0], event[1].isoformat() if event[1] else "", event[2]),
    )


def _paused_ranges(edit_logs, end_date):
    ranges = []
    pause_start = None
    for event_date, _, _, new_status in _status_events(edit_logs):
        if event_date > end_date:
            continue
        if new_status in ("FORFEITED", "CLOSED"):
            if pause_start is None:
                pause_start = event_date + timedelta(days=1)
        elif new_status == "ACTIVE" and pause_start is not None:
            ranges.append((pause_start, event_date - timedelta(days=1)))
            pause_start = None
    if pause_start is not None:
        ranges.append((pause_start, end_date))
    return ranges


def calculate_pledge_interest(pledge, payments, edit_logs, as_of_date):
    pledge_date = _get(pledge, "pledge_date")
    principal = Decimal(_get(pledge, "principal_amount"))
    upfront_percent = Decimal(_get(pledge, "upfront_percent"))
    upfront_days = int(_get(pledge, "upfront_days"))
    daily_percent = Decimal(_get(pledge, "daily_percent"))
    divisor = int(_get(pledge, "daily_divisor"))
    payments = [payment for payment in payments if not _get(payment, "is_voided", False)]
    pause_ranges = _paused_ranges(edit_logs, as_of_date)
    accrual_end = as_of_date

    upfront = round_money(principal * upfront_percent / HUNDRED) if as_of_date >= pledge_date else Decimal("0.00")
    principal_events = sorted(
        (
            (_get(payment, "payment_date") + timedelta(days=1), Decimal(_get(payment, "principal_amount")))
            for payment in payments
            if Decimal(_get(payment, "principal_amount")) > 0
        ),
        key=lambda event: event[0],
    )
    daily_principal = principal
    daily_interest = Decimal("0.00")
    first_daily_date = pledge_date + timedelta(days=upfront_days)
    current_date = first_daily_date
    event_index = 0
    while current_date <= accrual_end:
        while event_index < len(principal_events) and principal_events[event_index][0] <= current_date:
            daily_principal -= principal_events[event_index][1]
            event_index += 1
        paused = any(start <= current_date <= end for start, end in pause_ranges)
        if not paused:
            daily_interest += daily_interest_amount(daily_principal, daily_percent, divisor)
        current_date += timedelta(days=1)

    outstanding_principal = principal - sum(
        (amount for effective_date, amount in principal_events if effective_date <= as_of_date),
        Decimal("0.00"),
    )
    daily_active = (
        as_of_date >= first_daily_date
        and not any(start <= as_of_date <= end for start, end in pause_ranges)
    )
    interest_paid = sum(
        (
            Decimal(_get(payment, "interest_amount"))
            for payment in payments
            if _get(payment, "payment_date") <= as_of_date
        ),
        Decimal("0.00"),
    )
    interest_earned = upfront + daily_interest
    unpaid_interest = interest_earned - interest_paid
    return {
        "day_number": max((as_of_date - pledge_date).days + 1, 0),
        "upfront_interest": upfront,
        "daily_interest": daily_interest,
        "daily_amount": daily_interest_amount(outstanding_principal, daily_percent, divisor) if daily_active else Decimal("0.00"),
        "interest_earned": interest_earned,
        "interest_paid": interest_paid,
        "unpaid_interest": unpaid_interest,
        "outstanding_principal": outstanding_principal,
        "total_outstanding": outstanding_principal + unpaid_interest,
    }
