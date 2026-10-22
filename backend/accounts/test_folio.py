from decimal import Decimal
from importlib import import_module
from types import SimpleNamespace

from django.apps import apps
from django.db import connection, IntegrityError, transaction
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import BhakaPatra, BusinessSource, Customer, User


class CustomerFolioTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="folio@example.com", name="Folio", password="test-password-123")
        self.client.force_authenticate(self.user)

    def source(self, **overrides):
        data = dict(name="Source entry", source_type="INDIVIDUAL", phone="9800000000", address="Kathmandu")
        data.update(overrides)
        response = self.client.post(reverse("business-source-list"), data, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return BusinessSource.objects.get(pk=response.data["id"])

    def test_overall_totals_include_all_customers_once_and_ignore_directory_filters(self):
        url = reverse("customer-bhaka-patra-summary")
        self.assertEqual(self.client.get(url).data, {"total_rakha_patra": 0, "total_amount": "0.00"})
        first = Customer.objects.create(name="First")
        second = Customer.objects.create(name="Second", is_active=False)
        record = BhakaPatra.objects.create(customer=first, reference="TOTAL-1", principal_amount="0.10", interest_amount="99.00")
        record.items.create(name="Ring", amount="0.05")
        record.items.create(name="Chain", amount="0.05")
        BhakaPatra.objects.create(customer=second, reference="TOTAL-2", principal_amount="0.20")
        self.assertEqual(self.client.get(url, {"search": "absent", "ordering": "name_desc"}).data,
                         {"total_rakha_patra": 2, "total_amount": "0.30"})
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(url).status_code, 401)

    def test_customer_sorting_combines_search_and_stable_tie_breaks(self):
        from django.utils import timezone
        from datetime import timedelta
        first = Customer.objects.create(name="beta")
        second = Customer.objects.create(name="Alpha")
        third = Customer.objects.create(name="alphabet")
        now = timezone.now()
        Customer.objects.filter(pk__in=[first.pk, second.pk]).update(created_at=now)
        Customer.objects.filter(pk=third.pk).update(created_at=now + timedelta(seconds=1))
        def ids(**query):
            return [item["id"] for item in self.client.get(reverse("customer-list"), query).data]
        self.assertEqual(ids(ordering="first_added"), [first.pk, second.pk, third.pk])
        self.assertEqual(ids(ordering="recently_added"), [third.pk, second.pk, first.pk])
        self.assertEqual(ids(ordering="name_asc"), [second.pk, third.pk, first.pk])
        self.assertEqual(ids(ordering="name_desc"), [first.pk, third.pk, second.pk])
        self.assertEqual(ids(ordering="name_desc", search="ALP"), [third.pk, second.pk])
        self.assertEqual(self.client.get(reverse("customer-list"), {"ordering": "invalid"}).status_code, 400)

    def test_source_create_edit_and_repeated_reads_keep_one_stable_customer(self):
        source = self.source()
        customer = source.customer_entry
        self.assertEqual(customer.name, source.name)
        self.assertEqual(customer.business_source_id, source.pk)
        for _ in range(3):
            self.assertEqual(self.client.get(reverse("customer-list")).status_code, 200)
        response = self.client.patch(reverse("business-source-detail", args=[source.pk]),
                                     {"name": "Updated source", "phone": "9811111111"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        customer.refresh_from_db()
        self.assertEqual(customer.name, "Updated source")
        self.assertEqual(customer.phone, "9811111111")
        self.assertEqual(Customer.objects.count(), 1)
        self.assertEqual(source.customer_entry.pk, customer.pk)
        independent_edit = self.client.patch(reverse("customer-detail", args=[customer.pk]), {"name": "Inconsistent"}, format="json")
        self.assertEqual(independent_edit.status_code, 400)

    def test_dynamic_source_customer_can_be_deactivated_without_legacy_credit_terms(self):
        source = self.source(source_type="DYNAMIC", interest_type="PERCENTAGE", interest_percentage="2.5", days=30)
        customer = source.customer_entry
        response = self.client.patch(reverse("customer-detail", args=[customer.pk]), {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["is_active"])
        self.assertEqual(self.client.delete(reverse("customer-detail", args=[customer.pk])).status_code, 409)
        self.assertEqual(self.client.delete(reverse("business-source-detail", args=[source.pk])).status_code, 409)

    def test_backfill_reuses_linked_ids_preserves_contacts_and_is_idempotent(self):
        source = BusinessSource.objects.create(name="Legacy source")
        first = Customer.objects.create(name="Original contact", business_source=source)
        second = Customer.objects.create(name="Another contact", business_source=source)
        standalone = Customer.objects.create(name="Legacy source")
        migration = import_module("accounts.migrations.0009_backfill_source_entries")
        editor = SimpleNamespace(connection=connection)
        migration.backfill(apps, editor)
        migration.backfill(apps, editor)
        first.refresh_from_db(); second.refresh_from_db(); standalone.refresh_from_db()
        self.assertEqual(first.source_entry_id, source.pk)
        self.assertEqual(first.name, "Original contact")
        self.assertIsNone(second.source_entry_id)
        self.assertIsNone(standalone.source_entry_id)
        self.assertEqual(Customer.objects.count(), 3)

    def test_source_entry_unique_constraint(self):
        source = self.source()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Customer.objects.create(name="Duplicate", business_source=source, source_entry=source)

    def test_legacy_inline_source_creation_preserves_the_explicit_contact(self):
        response = self.client.post(reverse("customer-list"), {
            "name": "Separate contact",
            "new_business_source": {
                "name": "Inline source", "source_type": "INDIVIDUAL", "channel_type": "DIRECT",
                "market_segment": "Retail", "phone": "9800000000",
            },
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        source = BusinessSource.objects.get(name="Inline source")
        self.assertEqual(source.customer_entry.name, "Inline source")
        self.assertNotEqual(source.customer_entry.pk, response.data["id"])
        self.assertEqual(Customer.objects.get(pk=response.data["id"]).name, "Separate contact")

    def test_documents_persist_items_and_cannot_cross_customer_boundaries(self):
        customer = self.source().customer_entry
        other = Customer.objects.create(name="Other")
        url = reverse("customer-bhaka-patra-list", args=[customer.pk])
        payload = dict(reference="BP-actual-1", principal_amount="100.30", interest_amount="0.20",
                       items=[dict(name="Ring", quantity="1.000", rate="100.30", amount="100.30")])
        created = self.client.post(url, payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        record = BhakaPatra.objects.get(pk=created.data["id"])
        self.assertEqual(record.principal_amount, Decimal("100.30"))
        self.assertEqual(record.items.get().name, "Ring")
        detail = reverse("customer-bhaka-patra-detail", args=[customer.pk, record.pk])
        self.assertEqual(self.client.get(detail).data["customer_id"], customer.pk)
        self.assertEqual(self.client.get(reverse("customer-bhaka-patra-list", args=[other.pk])).data, [])
        wrong_detail = reverse("customer-bhaka-patra-detail", args=[other.pk, record.pk])
        self.assertEqual(self.client.get(wrong_detail).status_code, 404)
        self.assertEqual(self.client.patch(wrong_detail, {"interest_amount": "99"}).status_code, 404)
        self.assertEqual(self.client.patch(detail, {"interest_amount": "0.35"}).status_code, 200)
        self.assertEqual(self.client.get(url).data[0]["interest_amount"], "0.35")
        self.assertEqual(self.client.delete(detail).status_code, 405)
        self.assertEqual(self.client.delete(reverse("customer-detail", args=[customer.pk])).status_code, 409)
        self.assertTrue(record.items.exists())
        self.assertEqual(self.client.post(url, payload, format="json").status_code, 400)
        self.assertEqual(BhakaPatra.objects.count(), 1)

    def test_missing_interest_stays_unknown_and_invalid_values_roll_back(self):
        customer = Customer.objects.create(name="Independent")
        url = reverse("customer-bhaka-patra-list", args=[customer.pk])
        created = self.client.post(url, {"reference": "BP-unknown", "principal_amount": "0.10"}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertIsNone(created.data["interest_amount"])
        invalid = self.client.post(url, {"reference": "BP-invalid", "principal_amount": "1", "items": [{"name": "Item", "amount": "-1"}]}, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(BhakaPatra.objects.count(), 1)
        self.assertEqual(self.client.delete(reverse("customer-detail", args=[customer.pk])).status_code, 409)
        self.assertEqual(self.client.get(reverse("customer-bhaka-patra-list", args=[99999])).status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(url).status_code, 401)
