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


def _daily_interest_schedule(pledge, payments, edit_logs, as_of_date):
    pledge_date = _get(pledge, "pledge_date")
    principal = Decimal(_get(pledge, "principal_amount"))
    upfront_days = int(_get(pledge, "upfront_days"))
    daily_percent = Decimal(_get(pledge, "daily_percent"))
    divisor = int(_get(pledge, "daily_divisor"))
    payments = [payment for payment in payments if not _get(payment, "is_voided", False)]
    first_daily_date = pledge_date + timedelta(days=upfront_days)
    principal_events = {}
    interest_paid_by_date = Decimal("0.00")
    for payment in payments:
        payment_date = _get(payment, "payment_date")
        if payment_date > as_of_date:
            continue
        principal_amount = Decimal(_get(payment, "principal_amount"))
        if principal_amount > 0:
            principal_events[payment_date] = principal_events.get(payment_date, Decimal("0.00")) + principal_amount
        interest_paid_by_date += Decimal(_get(payment, "interest_amount"))

    principal_before_daily = sum(
        (amount for payment_date, amount in principal_events.items() if payment_date < first_daily_date),
        Decimal("0.00"),
    )
    balance = principal - principal_before_daily
    pause_ranges = _paused_ranges(edit_logs, as_of_date)
    daily_rows = []
    current_date = first_daily_date
    while current_date <= as_of_date:
        start_balance = balance
        principal_paid = principal_events.get(current_date, Decimal("0.00"))
        end_balance = start_balance - principal_paid
        paused = any(start <= current_date <= end for start, end in pause_ranges)
        if paused:
            start_interest = Decimal("0.00")
            end_interest = Decimal("0.00")
        else:
            start_interest = daily_interest_amount(start_balance, daily_percent, divisor)
            end_interest = (
                daily_interest_amount(end_balance, daily_percent, divisor)
                if principal_paid > 0 and end_balance > 0
                else Decimal("0.00")
            )
        daily_rows.append({
            "date": current_date,
            "start_balance": start_balance,
            "end_balance": end_balance,
            "principal_paid": principal_paid,
            "paused": paused,
            "start_interest": start_interest,
            "end_interest": end_interest,
        })
        balance = end_balance
        current_date += timedelta(days=1)

    outstanding_principal = principal - sum(principal_events.values(), Decimal("0.00"))
    return daily_rows, principal_events, outstanding_principal, interest_paid_by_date


def calculate_pledge_interest(pledge, payments, edit_logs, as_of_date):
    pledge_date = _get(pledge, "pledge_date")
    principal = Decimal(_get(pledge, "principal_amount"))
    upfront_percent = Decimal(_get(pledge, "upfront_percent"))
    daily_percent = Decimal(_get(pledge, "daily_percent"))
    divisor = int(_get(pledge, "daily_divisor"))
    first_daily_date = pledge_date + timedelta(days=int(_get(pledge, "upfront_days")))
    daily_rows, _, outstanding_principal, interest_paid = _daily_interest_schedule(
        pledge, payments, edit_logs, as_of_date,
    )
    upfront = round_money(principal * upfront_percent / HUNDRED) if as_of_date >= pledge_date else Decimal("0.00")
    daily_interest = sum(
        (row["start_interest"] + row["end_interest"] for row in daily_rows),
        Decimal("0.00"),
    )
    daily_active = (
        as_of_date >= first_daily_date
        and not any(start <= as_of_date <= end for start, end in _paused_ranges(edit_logs, as_of_date))
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


def calculate_pledge_interest_breakdown(pledge, payments, edit_logs, as_of_date):
    pledge_date = _get(pledge, "pledge_date")
    principal = Decimal(_get(pledge, "principal_amount"))
    upfront_percent = Decimal(_get(pledge, "upfront_percent"))
    daily_percent = Decimal(_get(pledge, "daily_percent"))
    divisor = int(_get(pledge, "daily_divisor"))
    first_daily_date = pledge_date + timedelta(days=int(_get(pledge, "upfront_days")))
    daily_rows, principal_events, _, _ = _daily_interest_schedule(
        pledge, payments, edit_logs, as_of_date,
    )
    rows = []

    if as_of_date >= pledge_date:
        rows.append({
            "kind": "UPFRONT",
            "start_date": pledge_date,
            "end_date": pledge_date + timedelta(days=max(int(_get(pledge, "upfront_days")) - 1, 0)),
            "days": int(_get(pledge, "upfront_days")),
            "principal_used": principal,
            "rate": f"{upfront_percent:.2f}% once",
            "interest": round_money(principal * upfront_percent / HUNDRED),
        })

    def append_period(period):
        if period["days"] == 0:
            return
        rows.append({
            "kind": "PAUSED" if period["paused"] else "DAILY",
            "start_date": period["start_date"],
            "end_date": period["end_date"],
            "days": period["days"],
            "principal_used": period["principal_used"],
            "rate": "Paused" if period["paused"] else f"{daily_percent:.2f}% / {divisor} days",
            "interest": period["interest"],
        })

    current_period = None
    for day in daily_rows:
        payment_today = day["principal_paid"] > 0
        if current_period is None:
            current_period = {
                "start_date": day["date"],
                "end_date": day["date"],
                "principal_used": day["start_balance"],
                "paused": day["paused"],
                "days": 0,
                "interest": Decimal("0.00"),
            }
        elif current_period["paused"] != day["paused"]:
            append_period(current_period)
            current_period = {
                "start_date": day["date"],
                "end_date": day["date"],
                "principal_used": day["start_balance"],
                "paused": day["paused"],
                "days": 0,
                "interest": Decimal("0.00"),
            }

        current_period["end_date"] = day["date"]
        current_period["days"] += 1
        current_period["interest"] += day["start_interest"]

        if payment_today:
            append_period(current_period)
            rows.append({
                "kind": "PRINCIPAL_PAYMENT",
                "start_date": day["date"],
                "end_date": day["date"],
                "days": 0,
                "principal_used": day["end_balance"],
                "payment_amount": day["principal_paid"],
                "new_principal": day["end_balance"],
                "rate": "",
                "interest": Decimal("0.00"),
            })
            current_period = {
                "start_date": day["date"],
                "end_date": day["date"],
                "principal_used": day["end_balance"],
                "paused": day["paused"],
                "days": 1,
                "interest": day["end_interest"],
            }
        elif current_period is not None:
            current_period["principal_used"] = day["start_balance"]

    if current_period is not None:
        append_period(current_period)

    for payment_date, amount in principal_events.items():
        if payment_date < first_daily_date:
            new_principal = principal - sum(
                (event_amount for event_day, event_amount in principal_events.items() if event_day <= payment_date),
                Decimal("0.00"),
            )
            rows.append({
                "kind": "PRINCIPAL_PAYMENT",
                "start_date": payment_date,
                "end_date": payment_date,
                "days": 0,
                "principal_used": new_principal,
                "payment_amount": amount,
                "new_principal": new_principal,
                "rate": "",
                "interest": Decimal("0.00"),
            })

    if rows:
        upfront_rows = [row for row in rows if row["kind"] == "UPFRONT"]
        other_rows = [row for row in rows if row["kind"] != "UPFRONT"]
        other_rows.sort(key=lambda row: row["start_date"])
        rows = upfront_rows + other_rows

    breakdown_total = sum(
        (row["interest"] for row in rows),
        Decimal("0.00"),
    )
    totals = calculate_pledge_interest(pledge, payments, edit_logs, as_of_date)
    if breakdown_total != totals["interest_earned"]:
        raise AssertionError("Interest breakdown does not match calculated interest.")
    return rows
