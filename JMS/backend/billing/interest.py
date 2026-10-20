"""Simple interest charged in advance, in fixed elapsed-day periods."""

from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from accounts.models import Customer
from .models import Bill, quantize_money


def calculate_interest(start_date, initial_credit, interest_paid, customer_type,
                       interest_amount, credit_basis, changes, as_of=None, enabled=True):
    """One schedule shared by legacy bill credit and the manual Credit module."""
    as_of = as_of or timezone.localdate()
    period_days = 15 if customer_type == Customer.Type.COMPANY else 30
    result = {
        "as_of": as_of.isoformat(), "period_days": period_days,
        "interest_per_basis": f"{interest_amount:.2f}",
        "credit_basis": f"{credit_basis:.2f}",
        "periods": 0, "interest_accrued": "0.00", "interest_paid": f"{interest_paid:.2f}",
        "interest_due": "0.00", "principal_due": "0.00", "total_due": "0.00",
        "next_charge_date": None, "charges": [],
    }
    if not enabled or as_of < start_date:
        return result

    changes = sorted(changes, key=lambda change: change[0])
    balance = initial_credit
    change_index = 0
    interest = Decimal("0.00")
    period_count = (as_of - start_date).days // period_days + 1
    for index in range(period_count):
        charge_date = start_date + timedelta(days=index * period_days)
        # Apply payments on a renewal date before charging the next period.
        # Period one is charged on the initial credit, even if paid later that day.
        if index > 0:
            while change_index < len(changes) and changes[change_index][0] <= charge_date:
                balance += changes[change_index][1]
                change_index += 1
        principal = max(balance, Decimal("0.00"))
        if principal > 0:
            charge = quantize_money(principal * interest_amount / credit_basis)
            interest += charge
            result["periods"] += 1
            result["charges"].append({
                "period": index + 1, "date": charge_date.isoformat(),
                "through_date": (charge_date + timedelta(days=period_days - 1)).isoformat(),
                "principal": f"{principal:.2f}", "interest": f"{charge:.2f}",
            })

    # Principal payments stop future charges; earned interest never compounds.
    current_principal = max(initial_credit + sum(
        (amount for date, amount in changes if date <= as_of), Decimal("0.00")
    ), Decimal("0.00"))
    due = max(interest - interest_paid, Decimal("0.00"))
    result.update({
        "interest_accrued": f"{interest:.2f}", "interest_due": f"{due:.2f}",
        "principal_due": f"{current_principal:.2f}",
        "total_due": f"{current_principal + due:.2f}",
        "next_charge_date": (start_date + timedelta(days=period_count * period_days)).isoformat()
        if current_principal > 0 else None,
    })
    return result


def calculate_credit(bill, as_of=None):
    enabled = bill.transaction_type == Bill.TransactionType.SALE and bill.status not in (Bill.Status.DRAFT, Bill.Status.CANCELLED)
    if not bill.interest_enabled:
        # Bills retain sale/payment balances but no longer create interest loans.
        result = calculate_interest(bill.bill_date, bill.initial_credit, Decimal("0.00"),
                                    bill.credit_customer_type, Decimal("0.00"), bill.credit_basis,
                                    [], as_of=as_of, enabled=False)
        principal = bill.amount_due if enabled and bill.bill_date <= (as_of or timezone.localdate()) else Decimal("0.00")
        result.update(principal_due=f"{principal:.2f}", total_due=f"{principal:.2f}")
        return result
    return calculate_interest(
        bill.bill_date, bill.initial_credit, bill.interest_paid, bill.credit_customer_type,
        bill.credit_interest_amount, bill.credit_basis,
        [(event.effective_date, event.amount) for event in bill.credit_adjustments.all()],
        as_of=as_of, enabled=enabled,
    )


def calculate_customer_credit(credit, as_of=None):
    payments = list(credit.payments.all())
    interest_paid = sum((payment.interest_amount for payment in payments
                         if payment.effective_date <= (as_of or timezone.localdate())), Decimal("0.00"))
    return calculate_interest(
        credit.credit_date, credit.principal_amount, interest_paid, credit.credit_customer_type,
        credit.credit_interest_amount, credit.credit_basis,
        [(payment.effective_date, -payment.principal_amount) for payment in payments],
        as_of=as_of,
    )
