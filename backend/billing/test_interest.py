from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.models import Customer, User
from .interest import calculate_credit
from .models import Bill, CreditAdjustment


class CreditInterestTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="credit@example.com", name="Credit tester", password="test-password-123")
        self.client.force_authenticate(self.user)
        self.start = date(2026, 8, 1)

    def issue(self, kind="INDIVIDUAL", amount="100000.00", paid="0.00", **customer_terms):
        customer = Customer.objects.create(name="Credit customer", customer_type=kind, **customer_terms)
        response = self.client.post(reverse("bill-list"), {
            "bill_number": f"CREDIT-{Bill.objects.count() + 1}", "customer": customer.id,
            "bill_date": self.start.isoformat(), "amount_paid": paid,
            "items": [{"item_name": "Jewellery", "material": "OTHER", "rate_unit": "item",
                       "quantity": "1.000", "rate": amount}],
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        bill = Bill.objects.get(pk=response.data["id"])
        # This suite exercises the preserved legacy bill interest agreement.
        bill.interest_enabled = True
        bill.save(update_fields=("interest_enabled",))
        return bill

    def test_individual_boundary_days_and_proportional_credit(self):
        # Day 1 starts the first charge; day 31 starts period two; day 61 period three.
        for principal, one_period in (("50000.00", 1000), ("100000.00", 2000), ("200000.00", 4000)):
            bill = self.issue(amount=principal)
            for day, periods in ((1, 1), (30, 1), (31, 2), (60, 2), (61, 3), (90, 3)):
                with self.subTest(principal=principal, day=day):
                    result = calculate_credit(bill, self.start + timedelta(days=day - 1))
                    self.assertEqual(result["periods"], periods)
                    self.assertEqual(Decimal(result["interest_accrued"]), Decimal(one_period * periods))

    def test_company_uses_exact_fifteen_day_periods(self):
        bill = self.issue(kind="COMPANY")
        for day, interest in ((1, "2000.00"), (15, "2000.00"), (16, "4000.00"), (30, "4000.00"), (31, "6000.00")):
            with self.subTest(day=day):
                self.assertEqual(calculate_credit(bill, self.start + timedelta(days=day - 1))["interest_accrued"], interest)

    def test_dynamic_rate_and_thirty_days_across_year_boundary(self):
        self.start = date(2026, 12, 20)
        bill = self.issue(kind="DYNAMIC", amount="75000.00", monthly_interest_amount=Decimal("1500"), interest_credit_basis=Decimal("50000"))
        self.assertEqual(calculate_credit(bill, date(2027, 1, 18))["interest_accrued"], "2250.00")
        self.assertEqual(calculate_credit(bill, date(2027, 1, 19))["interest_accrued"], "4500.00")

    def test_partial_payment_at_creation_charges_only_borrowed_amount(self):
        bill = self.issue(paid="50000.00")
        result = calculate_credit(bill, self.start)
        self.assertEqual(result["interest_accrued"], "1000.00")
        self.assertEqual(result["total_due"], "51000.00")

    def test_no_interest_before_credit_or_for_paid_draft_cancelled_bills(self):
        bill = self.issue()
        self.assertEqual(calculate_credit(bill, self.start - timedelta(days=1))["total_due"], "0.00")
        for status in (Bill.Status.DRAFT, Bill.Status.CANCELLED):
            bill.status = status
            self.assertEqual(calculate_credit(bill, self.start)["interest_accrued"], "0.00")
        paid = self.issue(paid="100000.00")
        self.assertEqual(calculate_credit(paid, self.start + timedelta(days=100))["interest_accrued"], "0.00")

    def test_later_principal_payment_preserves_earlier_interest(self):
        bill = self.issue()
        payment_date = self.start + timedelta(days=15)
        with patch("billing.serializers.timezone.localdate", return_value=payment_date):
            response = self.client.patch(reverse("bill-detail", args=[bill.id]), {"amount_paid": "50000.00"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        bill.refresh_from_db()
        self.assertEqual(CreditAdjustment.objects.get(bill=bill).effective_date, payment_date)
        self.assertEqual(calculate_credit(bill, self.start + timedelta(days=29))["interest_accrued"], "2000.00")
        result = calculate_credit(bill, self.start + timedelta(days=30))
        self.assertEqual(result["interest_accrued"], "3000.00")
        self.assertEqual(result["total_due"], "53000.00")

    def test_full_payment_on_renewal_day_stops_next_charge(self):
        bill = self.issue(kind="COMPANY")
        with patch("billing.serializers.timezone.localdate", return_value=self.start + timedelta(days=15)):
            response = self.client.patch(reverse("bill-detail", args=[bill.id]), {"amount_paid": "100000.00"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        bill.refresh_from_db()
        result = calculate_credit(bill, self.start + timedelta(days=75))
        self.assertEqual(result["interest_due"], "2000.00")
        self.assertEqual(result["principal_due"], "0.00")
        self.assertIsNone(result["next_charge_date"])

    def test_interest_can_be_paid_separately_and_cannot_be_overpaid(self):
        bill = self.issue()
        with patch("billing.serializers.timezone.localdate", return_value=self.start):
            response = self.client.patch(reverse("bill-detail", args=[bill.id]), {"interest_paid": "1000.00"}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["credit"]["interest_due"], "1000.00")
            invalid = self.client.patch(reverse("bill-detail", args=[bill.id]), {"interest_paid": "2000.01"}, format="json")
            self.assertEqual(invalid.status_code, 400)
            reversed_payment = self.client.patch(reverse("bill-detail", args=[bill.id]), {"interest_paid": "500.00"}, format="json")
            self.assertEqual(reversed_payment.status_code, 400)

    def test_customer_edits_do_not_change_existing_bill_terms(self):
        bill = self.issue()
        bill.customer.customer_type = Customer.Type.COMPANY
        bill.customer.save()
        self.assertEqual(calculate_credit(bill, self.start + timedelta(days=15))["interest_accrued"], "2000.00")
        response = self.client.get(reverse("bill-detail", args=[bill.id]))
        self.assertEqual(response.data["customer_type"], "INDIVIDUAL")

    def test_issued_credit_cannot_be_reset_through_draft_or_cancelled_status(self):
        bill = self.issue()
        url = reverse("bill-detail", args=[bill.id])
        self.assertEqual(self.client.patch(url, {"status": "DRAFT"}, format="json").status_code, 400)
        cancelled = self.client.patch(url, {"status": "CANCELLED"}, format="json")
        self.assertEqual(cancelled.status_code, 200, cancelled.data)
        self.assertEqual(cancelled.data["credit"]["total_due"], "0.00")
        self.assertEqual(self.client.patch(url, {"status": "UNPAID"}, format="json").status_code, 400)

    def test_money_rounds_half_up_without_compounding(self):
        bill = self.issue(amount="1000.25")
        result = calculate_credit(bill, self.start + timedelta(days=30))
        self.assertEqual(result["charges"][0]["interest"], "20.01")
        self.assertEqual(result["interest_accrued"], "40.02")

    def test_customer_account_totals_and_authorization(self):
        bill = self.issue()
        response = self.client.get(reverse("customer-account", args=[bill.customer_id]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["summary"]["principal_due"], "100000.00")
        self.assertGreater(Decimal(response.data["summary"]["interest_due"]), 0)
        self.client.force_authenticate(None)
        for url in (reverse("customer-account", args=[bill.customer_id]), reverse("customer-type-list"), reverse("customer-detail", args=[bill.customer_id])):
            self.assertEqual(self.client.get(url).status_code, 401)

    def test_issued_bill_rejects_changed_date_customer_and_payment_reversal(self):
        bill = self.issue(paid="100.00")
        other = Customer.objects.create(name="Other customer")
        for payload in ({"bill_date": "2026-09-01"}, {"customer": other.id}, {"amount_paid": "0.00"}):
            self.assertEqual(self.client.patch(reverse("bill-detail", args=[bill.id]), payload, format="json").status_code, 400)
