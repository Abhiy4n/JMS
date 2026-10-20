from decimal import Decimal

from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.models import BusinessSource, Customer, User
from .models import Bill


class CustomerPortfolioTests(APITestCase):
    def setUp(self):
        user = User.objects.create_user(email="portfolio@example.com", name="Portfolio tester", password="test-password-123")
        self.client.force_authenticate(user)
        self.customer = Customer.objects.create(name="Portfolio customer")

    def bill(self, transaction_type="SALE", amount="100000.00", paid="0.00", **overrides):
        payload = {"bill_number": f"PORTFOLIO-{Bill.objects.count() + 1}", "customer": self.customer.id,
                   "transaction_type": transaction_type, "amount_paid": paid,
                   "items": [{"item_name": "Jewellery", "rate_unit": "item", "material": "OTHER", "quantity": "1.000", "rate": amount}]}
        payload.update(overrides)
        response = self.client.post(reverse("bill-list"), payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_portfolio_kpis_use_customer_purchases_and_sales(self):
        self.bill(paid="50000.00")
        purchase = self.bill("PURCHASE", amount="30000.00", paid="10000.00")
        self.assertEqual(purchase["credit"]["interest_due"], "0.00")
        account = self.client.get(reverse("customer-account", args=[self.customer.id])).data
        self.assertEqual(account["summary"]["total_bought"], "100000.00")
        self.assertEqual(account["summary"]["total_sold"], "30000.00")
        self.assertEqual(account["summary"]["principal_due"], "50000.00")
        self.assertEqual(account["summary"]["interest_due"], "0.00")
        self.assertEqual(account["summary"]["payable_due"], "20000.00")
        self.assertEqual(account["summary"]["remaining_balance"], "30000.00")
        self.assertEqual(len(account["bills"]), 2)

    def test_draft_cancelled_bills_remain_in_history_but_not_kpis(self):
        self.bill(status="DRAFT")
        self.bill("PURCHASE", status="CANCELLED")
        account = self.client.get(reverse("customer-account", args=[self.customer.id])).data
        self.assertEqual(account["summary"]["total_bought"], "0.00")
        self.assertEqual(account["summary"]["total_sold"], "0.00")
        self.assertEqual(account["summary"]["remaining_balance"], "0.00")
        self.assertEqual(len(account["bills"]), 2)

    def test_customer_selling_to_shop_has_payable_and_no_interest(self):
        purchase = self.bill("PURCHASE", amount="50000.00")
        self.assertEqual(purchase["credit"]["interest_accrued"], "0.00")
        response = self.client.patch(reverse("bill-detail", args=[purchase["id"]]), {"interest_paid": "1.00"}, format="json")
        self.assertEqual(response.status_code, 400)
        payment = self.client.patch(reverse("bill-detail", args=[purchase["id"]]), {"amount_paid": "20000.00"}, format="json")
        self.assertEqual(payment.status_code, 200, payment.data)
        account = self.client.get(reverse("customer-account", args=[self.customer.id])).data
        self.assertEqual(account["summary"]["remaining_balance"], "-30000.00")

    def test_source_governs_new_interest_and_existing_bill_terms_stay_frozen(self):
        source = BusinessSource.objects.create(name="Company", source_type="COMPANY", market_segment="Wholesale", pan_vat_number="123456789")
        self.customer.business_source = source
        self.customer.save()
        issued = self.bill()
        self.assertEqual(issued["credit"]["period_days"], 15)
        source.source_type = "DYNAMIC"
        source.monthly_interest_amount = Decimal("500")
        source.interest_credit_basis = Decimal("50000")
        source.save()
        previous = self.client.get(reverse("bill-detail", args=[issued["id"]])).data
        self.assertEqual(previous["credit"]["period_days"], 15)
        self.assertEqual(previous["customer_type"], "COMPANY")
        new_bill = self.bill()
        self.assertEqual(new_bill["credit"]["period_days"], 30)
        self.assertEqual(new_bill["credit"]["interest_due"], "0.00")

    def test_portfolios_are_scoped_to_customer(self):
        self.bill()
        other = Customer.objects.create(name="Another customer")
        account = self.client.get(reverse("customer-account", args=[other.id])).data
        self.assertEqual(account["bills"], [])
        self.assertEqual(account["summary"]["total_bought"], "0.00")

    def test_issued_transaction_direction_cannot_be_changed(self):
        issued = self.bill()
        response = self.client.patch(reverse("bill-detail", args=[issued["id"]]), {"transaction_type": "PURCHASE"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_future_dated_bill_does_not_affect_current_portfolio_totals(self):
        self.bill(bill_date="2099-01-01")
        account = self.client.get(reverse("customer-account", args=[self.customer.id])).data
        self.assertEqual(account["summary"]["total_bought"], "0.00")
        self.assertEqual(account["summary"]["principal_due"], "0.00")
