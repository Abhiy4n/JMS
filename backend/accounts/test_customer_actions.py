from django.urls import reverse
from rest_framework.test import APITestCase

from billing.models import Bill
from .models import Customer, User


class CustomerActionsTests(APITestCase):
    def setUp(self):
        user = User.objects.create_user(email="actions@example.com", name="Actions tester", password="test-password-123")
        self.client.force_authenticate(user)
        self.customer = Customer.objects.create(name="Customer", phone="9800000000")
        self.url = reverse("customer-detail", args=[self.customer.id])

    def test_edit_deactivate_and_reactivate_customer(self):
        edited = self.client.patch(self.url, {"name": "Updated customer", "phone": "9811111111"}, format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.data["name"], "Updated customer")
        inactive = self.client.patch(self.url, {"is_active": False}, format="json")
        self.assertFalse(inactive.data["is_active"])
        active = self.client.patch(self.url, {"is_active": True}, format="json")
        self.assertTrue(active.data["is_active"])

    def test_delete_customer_without_financial_history(self):
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        self.assertFalse(Customer.objects.filter(id=self.customer.id).exists())

    def test_delete_with_bills_is_rejected_and_deactivation_preserves_history(self):
        bill = Bill.objects.create(customer=self.customer, bill_number="HISTORY")
        self.assertEqual(self.client.delete(self.url).status_code, 409)
        self.assertTrue(Bill.objects.filter(id=bill.id).exists())
        self.assertEqual(self.client.patch(self.url, {"is_active": False}, format="json").status_code, 200)
        self.assertTrue(Bill.objects.filter(id=bill.id).exists())

    def test_actions_require_authentication(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.patch(self.url, {"is_active": False}, format="json").status_code, 401)
        self.assertEqual(self.client.delete(self.url).status_code, 401)

    def test_edit_keeps_customer_id_count_and_other_customer_data_unchanged(self):
        other = Customer.objects.create(name="Other customer", phone="9822222222", email="other@example.com")
        before = Customer.objects.filter(pk=other.pk).values().get()
        response = self.client.patch(self.url, {"name": "Renamed customer", "email": "updated@example.com"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["id"], self.customer.id)
        self.assertEqual(Customer.objects.count(), 2)
        self.assertEqual(Customer.objects.filter(pk=other.pk).values().get(), before)

    def test_customer_read_and_create_require_authentication(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(reverse("customer-list")).status_code, 401)
        self.assertEqual(self.client.get(self.url).status_code, 401)
        self.assertEqual(self.client.post(reverse("customer-list"), {"name": "Unauthorized"}, format="json").status_code, 401)
        self.assertEqual(Customer.objects.count(), 1)
