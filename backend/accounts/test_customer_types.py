from django.urls import reverse
from rest_framework.test import APITestCase

from .models import Customer, User


class CustomerTypesTests(APITestCase):
    def setUp(self):
        user = User.objects.create_user(email="types@example.com", name="Type tester", password="test-password-123")
        self.client.force_authenticate(user)

    def test_fixed_types_can_create_customers_without_sources(self):
        for kind in ("INDIVIDUAL", "COMPANY"):
            result = self.client.post(reverse("customer-list"), {"name": kind, "customer_type": kind}, format="json")
            self.assertEqual(result.status_code, 201, result.data)
            self.assertIsNone(Customer.objects.get(id=result.data["id"]).business_source)

    def test_dynamic_terms_are_required_and_validated(self):
        for extra in ({}, {"monthly_interest_amount": "-1", "interest_credit_basis": "100000"},
                      {"monthly_interest_amount": "2000", "interest_credit_basis": "0"},
                      {"monthly_interest_amount": "NaN", "interest_credit_basis": "100000"}):
            result = self.client.post(reverse("customer-list"), {"name": "Dynamic", "customer_type": "DYNAMIC", **extra}, format="json")
            self.assertEqual(result.status_code, 400, result.data)
        valid = self.client.post(reverse("customer-list"), {"name": "Dynamic", "customer_type": "DYNAMIC", "monthly_interest_amount": "1000", "interest_credit_basis": "50000"}, format="json")
        self.assertEqual(valid.status_code, 201, valid.data)

    def test_type_filter_and_counts_come_from_real_records(self):
        Customer.objects.create(name="Individual", customer_type="INDIVIDUAL")
        Customer.objects.create(name="Company", customer_type="COMPANY")
        result = self.client.get(reverse("customer-list"), {"customer_type": "COMPANY"})
        self.assertEqual(len(result.data), 1)
        self.assertEqual(result.data[0]["name"], "Company")
        types = self.client.get(reverse("customer-type-list"))
        self.assertEqual([row["customer_count"] for row in types.data], [1, 1, 0])
        self.assertEqual(self.client.get(reverse("customer-list"), {"customer_type": "UNKNOWN"}).status_code, 400)

    def test_switch_to_dynamic_requires_terms_and_fixed_type_clears_terms(self):
        customer = Customer.objects.create(name="Customer")
        url = reverse("customer-detail", args=[customer.id])
        self.assertEqual(self.client.patch(url, {"customer_type": "DYNAMIC"}, format="json").status_code, 400)
        updated = self.client.patch(url, {"customer_type": "DYNAMIC", "monthly_interest_amount": "0", "interest_credit_basis": "100000"}, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        fixed = self.client.patch(url, {"customer_type": "COMPANY"}, format="json")
        self.assertIsNone(fixed.data["monthly_interest_amount"])
