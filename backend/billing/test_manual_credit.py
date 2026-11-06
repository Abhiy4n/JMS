from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.models import BusinessSource, Customer, User
from .models import CustomerCredit, CustomerCreditPayment
from .interest import calculate_customer_credit


class ManualCreditTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="manual-credit@example.com", name="Credit tester", password="test-password-123")
        self.client.force_authenticate(self.user)
        self.customer = Customer.objects.create(name="Credit customer")
        self.start = date(2026, 8, 1)

    def issue(self, amount="100000.00", **overrides):
        payload = {"customer": self.customer.id, "principal_amount": amount, "credit_date": self.start.isoformat(), **overrides}
        response = self.client.post(reverse("credit-list"), payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return CustomerCredit.objects.get(id=response.data["id"])

    def test_individual_period_boundaries_and_amount_scaling(self):
        for amount, charge in (("50000.00", 1000), ("100000.00", 2000), ("200000.00", 4000)):
            credit = self.issue(amount)
            for day, periods in ((1, 1), (30, 1), (31, 2), (60, 2), (61, 3)):
                with self.subTest(amount=amount, day=day):
                    result = calculate_customer_credit(credit, self.start + timedelta(days=day - 1))
                    self.assertEqual(Decimal(result["interest_accrued"]), Decimal(charge * periods))

    def test_company_source_terms_and_fifteen_days(self):
        source = BusinessSource.objects.create(name="Company", source_type="COMPANY", pan_vat_number="123456789", market_segment="Retail")
        self.customer.business_source = source
        self.customer.save()
        credit = self.issue()
        self.assertEqual(credit.credit_customer_type, "COMPANY")
        for day, accrued in ((1, "2000.00"), (15, "2000.00"), (16, "4000.00"), (31, "6000.00")):
            self.assertEqual(calculate_customer_credit(credit, self.start + timedelta(days=day - 1))["interest_accrued"], accrued)

    def test_dynamic_source_terms_are_frozen(self):
        source = BusinessSource.objects.create(name="Dynamic", source_type="DYNAMIC", phone="9800000000", market_segment="Trade", monthly_interest_amount=Decimal("1500"), interest_credit_basis=Decimal("50000"))
        self.customer.business_source = source
        self.customer.save()
        credit = self.issue("75000.00")
        source.monthly_interest_amount = Decimal("2000")
        source.save()
        self.assertEqual(calculate_customer_credit(credit, self.start)["interest_due"], "2250.00")
        self.assertEqual(calculate_customer_credit(credit, self.start + timedelta(days=30))["interest_due"], "4500.00")

    def test_configured_individual_percentage_is_immediate_and_frozen(self):
        source = BusinessSource.objects.create(
            name="Configured individual", source_type="INDIVIDUAL", phone="9800000000",
            interest_type="PERCENTAGE", interest_percentage=Decimal("2.0000"), days=30,
        )
        self.customer.business_source = source
        self.customer.save()
        credit = self.issue("100000.00")
        self.assertEqual(credit.credit_interest_type, "PERCENTAGE")
        self.assertEqual(credit.credit_period_days, 30)
        for day, accrued in ((1, "2000.00"), (30, "2000.00"), (31, "4000.00")):
            self.assertEqual(
                calculate_customer_credit(credit, self.start + timedelta(days=day - 1))["interest_due"],
                accrued,
            )

        source.interest_percentage = Decimal("5.0000")
        source.save(update_fields=("interest_percentage",))
        self.assertEqual(calculate_customer_credit(credit, self.start)["interest_due"], "2000.00")
        newer_credit = self.issue("100000.00")
        self.assertEqual(calculate_customer_credit(newer_credit, self.start)["interest_due"], "5000.00")

    def test_company_percentage_uses_fifteen_day_periods(self):
        source = BusinessSource.objects.create(
            name="Configured company", source_type="COMPANY", pan_vat_number="123456789",
            interest_type="PERCENTAGE", interest_percentage=Decimal("2.0000"), days=15,
        )
        self.customer.business_source = source
        self.customer.save()
        credit = self.issue("10000.00")
        self.assertEqual(credit.credit_interest_type, "PERCENTAGE")
        for day, accrued in ((1, "200.00"), (15, "200.00"), (16, "400.00"), (30, "400.00"), (31, "600.00")):
            self.assertEqual(
                calculate_customer_credit(credit, self.start + timedelta(days=day - 1))["interest_due"],
                accrued,
            )

    def test_dynamic_percentage_and_fixed_custom_periods(self):
        percentage_source = BusinessSource.objects.create(
            name="Dynamic percentage", source_type="DYNAMIC", phone="9800000000",
            interest_type="PERCENTAGE", interest_percentage=Decimal("3.5000"), days=10,
        )
        self.customer.business_source = percentage_source
        self.customer.save()
        percentage_credit = self.issue("50000.00")
        for day, accrued in ((1, "1750.00"), (10, "1750.00"), (11, "3500.00")):
            self.assertEqual(
                calculate_customer_credit(percentage_credit, self.start + timedelta(days=day - 1))["interest_due"],
                accrued,
            )

        fixed_source = BusinessSource.objects.create(
            name="Dynamic fixed", source_type="DYNAMIC", phone="9811111111",
            interest_type="FIXED_AMOUNT", interest_amount=Decimal("500.00"), days=7,
        )
        self.customer.business_source = fixed_source
        self.customer.save()
        fixed_credit = self.issue("12345.00")
        self.assertEqual(calculate_customer_credit(fixed_credit, self.start)["interest_due"], "500.00")
        self.assertEqual(
            calculate_customer_credit(fixed_credit, self.start + timedelta(days=7))["interest_due"],
            "1000.00",
        )

    def test_principal_payment_reduces_future_interest_only(self):
        credit = self.issue()
        CustomerCreditPayment.objects.create(credit=credit, effective_date=self.start + timedelta(days=15), principal_amount=Decimal("50000"))
        result = calculate_customer_credit(credit, self.start + timedelta(days=30))
        self.assertEqual(result["interest_due"], "3000.00")
        self.assertEqual(result["principal_due"], "50000.00")

    def test_full_repayment_on_period_boundary_stops_next_charge(self):
        credit = self.issue()
        CustomerCreditPayment.objects.create(credit=credit, effective_date=self.start + timedelta(days=30), principal_amount=Decimal("100000"))
        result = calculate_customer_credit(credit, self.start + timedelta(days=100))
        self.assertEqual(result["interest_due"], "2000.00")
        self.assertEqual(result["principal_due"], "0.00")
        self.assertIsNone(result["next_charge_date"])

    def test_api_payment_updates_balances_and_rejects_overpayment(self):
        credit = self.issue()
        url = reverse("credit-payment", args=[credit.id])
        with patch("billing.credit_serializers.timezone.localdate", return_value=self.start):
            result = self.client.post(url, {"principal_amount": "50000", "interest_amount": "1000"}, format="json")
            self.assertEqual(result.status_code, 201, result.data)
            self.assertEqual(result.data["calculation"]["principal_due"], "50000.00")
            self.assertEqual(result.data["calculation"]["interest_due"], "1000.00")
            for payload in ({"principal_amount": "50000.01"}, {"interest_amount": "1000.01"}, {"principal_amount": "-1"}, {}):
                self.assertEqual(self.client.post(url, payload, format="json").status_code, 400)

    def test_credit_rejects_inactive_customer_invalid_amount_and_future_date(self):
        for payload in ({"principal_amount": "0"}, {"principal_amount": "-1"}, {"credit_date": "2099-01-01"}):
            response = self.client.post(reverse("credit-list"), {"customer": self.customer.id, "principal_amount": "100", **payload}, format="json")
            self.assertEqual(response.status_code, 400)
        self.customer.is_active = False
        self.customer.save()
        self.assertEqual(self.client.post(reverse("credit-list"), {"customer": self.customer.id, "principal_amount": "100"}, format="json").status_code, 400)

    def test_credit_appears_in_customer_portfolio_and_prevents_customer_deletion(self):
        credit = self.issue()
        with patch("billing.views.timezone.localdate", return_value=self.start):
            summary = self.client.get(reverse("customer-account", args=[self.customer.id])).data["summary"]
        self.assertEqual(summary["credit_principal_due"], "100000.00")
        self.assertEqual(summary["interest_due"], "2000.00")
        self.assertEqual(summary["remaining_balance"], "102000.00")
        self.assertEqual(self.client.delete(reverse("customer-detail", args=[self.customer.id])).status_code, 409)
        self.assertTrue(CustomerCredit.objects.filter(id=credit.id).exists())

    def test_customer_filter_and_authentication(self):
        credit = self.issue()
        other = Customer.objects.create(name="Other")
        self.assertEqual(self.client.get(reverse("credit-list"), {"customer": other.id}).data, [])
        self.assertEqual(self.client.get(reverse("credit-list"), {"customer": "bad"}).status_code, 400)
        self.client.force_authenticate(None)
        for url in (reverse("credit-list"), reverse("credit-detail", args=[credit.id])):
            self.assertEqual(self.client.get(url).status_code, 401)
        self.assertEqual(self.client.post(reverse("credit-payment", args=[credit.id]), {"principal_amount": "1"}).status_code, 401)

    def test_new_bills_do_not_automatically_issue_interest_credit(self):
        response = self.client.post(reverse("bill-list"), {"bill_number": "NEW-SALE", "customer": self.customer.id,
            "interest_enabled": True, "items": [{"item_name": "Jewellery", "material": "OTHER", "rate_unit": "item", "quantity": "1", "rate": "100000"}]}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data["interest_enabled"])
        self.assertEqual(response.data["credit"]["interest_due"], "0.00")
        self.assertEqual(response.data["credit"]["principal_due"], "100000.00")
        self.assertEqual(CustomerCredit.objects.count(), 0)
