from decimal import Decimal
from datetime import timedelta

from django.utils import timezone
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import BusinessSource, Customer, User


class BusinessSourceIdentityTests(APITestCase):
    def setUp(self):
        user = User.objects.create_user(email="source-tests@example.com", name="Source tester", password="test-password-123")
        self.client.force_authenticate(user)

    def create_source(self, **overrides):
        payload = {
            "name": "Source",
            "source_type": "INDIVIDUAL",
            "market_segment": "Retail",
            "phone": "9800000000",
            "address": "Kathmandu",
        }
        payload.update(overrides)
        return self.client.post(reverse("business-source-list"), payload, format="json")

    def test_individual_requires_name_phone_and_address(self):
        for field in ("name", "phone", "address"):
            with self.subTest(field=field):
                response = self.create_source(**{field: ""})
                self.assertEqual(response.status_code, 400, response.data)
        response = self.create_source()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["customer_count"], 1)
        self.assertEqual(Customer.objects.count(), 1)

    def test_company_requires_pan_not_phone(self):
        invalid = self.create_source(source_type="COMPANY", phone="")
        self.assertEqual(invalid.status_code, 400)
        phone_is_irrelevant = self.create_source(
            name="Company with phone",
            source_type="COMPANY",
            phone="9800000000",
            pan_vat_number="123456789",
        )
        self.assertEqual(phone_is_irrelevant.status_code, 400)
        valid = self.create_source(source_type="COMPANY", phone="", pan_vat_number="123456789")
        self.assertEqual(valid.status_code, 201, valid.data)
        self.assertEqual(valid.data["pan_vat_number"], "123456789")
        self.assertEqual(valid.data["phone"], "")
        individual_with_pan = self.create_source(name="Individual with PAN", pan_vat_number="0012345")
        self.assertEqual(individual_with_pan.status_code, 400)

    def test_dynamic_requires_phone_interest_choice_and_positive_days(self):
        missing_phone = self.create_source(
            source_type="DYNAMIC",
            phone="",
            pan_vat_number="DYN-123",
            interest_type="PERCENTAGE",
            interest_percentage="5.25",
            days=15,
        )
        self.assertEqual(missing_phone.status_code, 400)
        missing_configuration = self.create_source(source_type="DYNAMIC")
        self.assertEqual(missing_configuration.status_code, 400)

        percentage = self.create_source(
            name="Percentage dynamic",
            source_type="DYNAMIC",
            interest_type="PERCENTAGE",
            interest_percentage="5.2500",
            days=15,
        )
        self.assertEqual(percentage.status_code, 201, percentage.data)
        self.assertEqual(percentage.data["interest_percentage"], "5.2500")
        self.assertIsNone(percentage.data["interest_amount"])

        fixed = self.create_source(
            name="Fixed dynamic",
            source_type="DYNAMIC",
            pan_vat_number="DYN-123",
            interest_type="FIXED_AMOUNT",
            interest_amount="125.50",
            days=7,
        )
        self.assertEqual(fixed.status_code, 201, fixed.data)
        self.assertEqual(fixed.data["interest_amount"], "125.50")
        self.assertIsNone(fixed.data["interest_percentage"])

        invalid_configurations = (
            {"interest_percentage": "-1"},
            {"interest_amount": "-1", "interest_type": "FIXED_AMOUNT"},
            {"interest_type": "FIXED_AMOUNT", "interest_amount": "0", "interest_percentage": "5"},
            {"interest_type": "PERCENTAGE", "interest_percentage": "5", "interest_amount": "1"},
            {"days": 0},
            {"days": 1.5},
        )
        for index, override in enumerate(invalid_configurations):
            with self.subTest(override=override):
                data = {
                    "source_type": "DYNAMIC",
                    "interest_type": "PERCENTAGE",
                    "interest_percentage": "5",
                    "days": 7,
                }
                data.update(override)
                response = self.create_source(name=f"Invalid dynamic {index}", **data)
                self.assertEqual(response.status_code, 400, response.data)

    def test_optional_email_and_required_address_are_validated(self):
        result = self.create_source(email="source@example.com", address="New Road, Kathmandu")
        self.assertEqual(result.status_code, 201, result.data)
        self.assertEqual(result.data["address"], "New Road, Kathmandu")
        invalid = self.create_source(name="Invalid contact", phone="abc1234567")
        self.assertEqual(invalid.status_code, 400)
        invalid_email = self.create_source(name="Invalid email", email="not-an-email")
        self.assertEqual(invalid_email.status_code, 400)
        missing_address = self.create_source(name="Missing address", address=" ")
        self.assertEqual(missing_address.status_code, 400)

    def test_multiple_customers_link_to_source_and_inherit_its_terms(self):
        source_response = self.create_source(source_type="COMPANY", phone="", pan_vat_number="123456789")
        source_id = source_response.data["id"]
        for name in ("First customer", "Second customer"):
            created = self.client.post(reverse("customer-list"), {"name": name, "customer_type": "INDIVIDUAL", "business_source": source_id}, format="json")
            self.assertEqual(created.status_code, 201, created.data)
            self.assertEqual(created.data["customer_type"], "COMPANY")
        linked = self.client.get(reverse("customer-list"), {"business_source": source_id})
        self.assertEqual(len(linked.data), 3)  # Source entry plus two distinct contacts.
        details = self.client.get(reverse("business-source-detail", args=[source_id]))
        self.assertEqual(details.data["customer_count"], 3)

    def test_linking_existing_customer_overrides_customer_dynamic_terms(self):
        source = BusinessSource.objects.create(name="Dynamic", source_type="DYNAMIC", market_segment="Trade", phone="9800000000", monthly_interest_amount=Decimal("1500"), interest_credit_basis=Decimal("50000"))
        customer = Customer.objects.create(name="Existing")
        response = self.client.patch(reverse("customer-detail", args=[customer.id]), {"business_source": source.id}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["customer_type"], "DYNAMIC")
        self.assertEqual(response.data["monthly_interest_amount"], "1500.00")

    def test_type_filter_tracks_source_type_changes(self):
        source = BusinessSource.objects.create(name="Linked source", source_type="INDIVIDUAL", market_segment="Retail", phone="9800000000")
        Customer.objects.create(name="Linked", business_source=source, customer_type="INDIVIDUAL")
        response = self.client.patch(reverse("business-source-detail", args=[source.id]), {"source_type": "COMPANY", "pan_vat_number": "123456789", "address": "Kathmandu"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        filtered = self.client.get(reverse("customer-list"), {"customer_type": "COMPANY"})
        self.assertEqual(len(filtered.data), 1)
        self.assertEqual(filtered.data[0]["customer_type"], "COMPANY")

    def test_source_endpoints_require_authentication(self):
        source = BusinessSource.objects.create(name="Private source")
        self.client.force_authenticate(None)
        for url in (reverse("business-source-list"), reverse("business-source-detail", args=[source.id])):
            self.assertEqual(self.client.get(url).status_code, 401)

    def test_edit_source_preserves_identity_customer_links_and_legacy_fields(self):
        created = self.create_source(channel_type="REFERRAL", description="Existing referral", status="INACTIVE")
        source_id = created.data["id"]
        customer = Customer.objects.create(name="Linked customer", business_source_id=source_id)
        response = self.client.patch(reverse("business-source-detail", args=[source_id]), {
            "name": "Renamed source", "phone": "9811111111", "address": "Kathmandu",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["id"], source_id)
        self.assertEqual(response.data["customer_count"], 2)
        self.assertEqual(response.data["channel_type"], "REFERRAL")
        self.assertEqual(response.data["description"], "Existing referral")
        self.assertEqual(response.data["status"], "INACTIVE")
        customer.refresh_from_db()
        self.assertEqual(customer.business_source_id, source_id)
        self.assertEqual(self.client.get(reverse("customer-detail", args=[customer.id])).data["source_name"], "Renamed source")

    def test_duplicate_names_are_trimmed_and_case_insensitive_on_create_and_edit(self):
        created = self.create_source(name="Referral")
        self.assertEqual(created.status_code, 201)
        for name in ("Referral", "referral", "  REFERRAL  "):
            response = self.create_source(name=name)
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn("name", response.data)
        second = self.create_source(name="Independent")
        detail = reverse("business-source-detail", args=[second.data["id"]])
        response = self.client.patch(detail, {"name": " referral "}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(BusinessSource.objects.get(pk=second.data["id"]).name, "Independent")
        own_detail = reverse("business-source-detail", args=[created.data["id"]])
        self.assertEqual(self.client.patch(own_detail, {"name": " Referral "}, format="json").status_code, 200)
        self.assertEqual(BusinessSource.objects.count(), 2)

    def test_blank_and_invalid_updates_do_not_change_saved_source(self):
        created = self.create_source()
        detail = reverse("business-source-detail", args=[created.data["id"]])
        for payload in ({"name": "   "}, {"name": "x" * 256}, {"phone": "invalid"},
                        {"email": "invalid-email"}, {"address": " "}, {"source_type": "UNKNOWN"}):
            with self.subTest(payload=payload):
                self.assertEqual(self.client.patch(detail, payload, format="json").status_code, 400)
        self.assertEqual(BusinessSource.objects.get(pk=created.data["id"]).name, "Source")

    def test_changing_source_type_clears_fields_that_no_longer_apply(self):
        created = self.create_source(
            source_type="DYNAMIC",
            interest_type="FIXED_AMOUNT",
            interest_amount="125.50",
            days=14,
        )
        detail = reverse("business-source-detail", args=[created.data["id"]])
        changed = self.client.patch(
            detail,
            {"source_type": "COMPANY", "pan_vat_number": "0012345", "address": "Kathmandu"},
            format="json",
        )
        self.assertEqual(changed.status_code, 200, changed.data)
        self.assertEqual(changed.data["phone"], "")
        self.assertIsNone(changed.data["interest_type"])
        self.assertIsNone(changed.data["interest_amount"])
        self.assertIsNone(changed.data["days"])

    def test_delete_unassigned_source_never_deletes_unrelated_customers(self):
        # Legacy unassigned sources retain the existing deletion policy.
        source = BusinessSource.objects.create(name="Legacy unassigned")
        customer = Customer.objects.create(name="Unlinked customer")
        detail = reverse("business-source-detail", args=[source.pk])
        self.assertEqual(self.client.delete(detail).status_code, 204)
        self.assertFalse(BusinessSource.objects.filter(pk=source.pk).exists())
        self.assertTrue(Customer.objects.filter(pk=customer.id).exists())
        self.assertEqual(self.client.get(detail).status_code, 404)

    def test_assigned_source_is_protected_until_customers_are_explicitly_reassigned(self):
        original = self.create_source().data["id"]
        destination = self.create_source(name="Destination").data["id"]
        customer = Customer.objects.create(name="Existing customer", business_source_id=original, is_active=False)
        detail = reverse("business-source-detail", args=[original])
        blocked = self.client.delete(detail)
        self.assertEqual(blocked.status_code, 409, blocked.data)
        self.assertIn("assigned to customers", blocked.data["detail"])
        customer.refresh_from_db()
        self.assertEqual(customer.business_source_id, original)
        self.assertTrue(BusinessSource.objects.filter(pk=original).exists())
        reassigned = self.client.patch(reverse("customer-detail", args=[customer.id]), {"business_source": destination}, format="json")
        self.assertEqual(reassigned.status_code, 200, reassigned.data)
        # The source's automatic directory entry still protects the source.
        self.assertEqual(self.client.delete(detail).status_code, 409)
        customer.refresh_from_db()
        self.assertEqual(customer.business_source_id, destination)
        self.assertFalse(customer.is_active)

    def test_summary_counts_real_sources_and_customers_independent_of_search(self):
        summary_url = reverse("business-source-summary")
        self.assertEqual(self.client.get(summary_url).data, {"total_sources": 0, "total_linked_customers": 0})
        original = self.create_source(
            name="Referral register",
            source_type="COMPANY",
            phone="",
            pan_vat_number="PAN-123",
        ).data["id"]
        other = self.create_source(name="Other register").data["id"]
        Customer.objects.create(name="First", business_source_id=original)
        Customer.objects.create(name="Second", business_source_id=original, is_active=False)
        Customer.objects.create(name="Unlinked")
        response = self.client.get(reverse("business-source-list"), {"search": "  REFERR  "})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([source["id"] for source in response.data], [original])
        self.assertEqual(self.client.get(reverse("business-source-list"), {"search": "PAN-123"}).data, [])
        self.assertEqual(self.client.get(reverse("business-source-list"), {"search": "9800000000"}).data, [])
        self.assertEqual(self.client.get(reverse("business-source-list"), {"search": "absent"}).data, [])
        self.assertEqual(self.client.get(summary_url).data, {"total_sources": 2, "total_linked_customers": 4})

    def test_source_list_search_type_filter_and_sorting_are_combined_deterministically(self):
        names = (
            ("Ram Stores", BusinessSource.Type.INDIVIDUAL),
            ("ram Traders", BusinessSource.Type.COMPANY),
            ("Rama Supplies", BusinessSource.Type.INDIVIDUAL),
        )
        created = [
            self.create_source(
                name=name,
                source_type=source_type,
                phone="" if source_type == BusinessSource.Type.COMPANY else "9800000000",
                pan_vat_number="0012345" if source_type == BusinessSource.Type.COMPANY else "",
            ).data
            for name, source_type in names
        ]
        timestamp = timezone.now()
        BusinessSource.objects.filter(pk=created[0]["id"]).update(created_at=timestamp)
        BusinessSource.objects.filter(pk=created[1]["id"]).update(created_at=timestamp)
        BusinessSource.objects.filter(pk=created[2]["id"]).update(created_at=timestamp + timedelta(seconds=1))
        url = reverse("business-source-list")

        def ids(**params):
            response = self.client.get(url, params)
            self.assertEqual(response.status_code, 200, response.data)
            return [item["id"] for item in response.data]

        self.assertEqual(ids(), [created[0]["id"], created[1]["id"], created[2]["id"]])
        self.assertEqual(ids(ordering="recently_added"), [created[2]["id"], created[1]["id"], created[0]["id"]])
        self.assertEqual(ids(ordering="name_asc"), [created[0]["id"], created[1]["id"], created[2]["id"]])
        self.assertEqual(ids(ordering="name_desc"), [created[2]["id"], created[1]["id"], created[0]["id"]])
        self.assertEqual(
            ids(search=" ram ", source_type=BusinessSource.Type.INDIVIDUAL, ordering="name_asc"),
            [created[0]["id"], created[2]["id"]],
        )
        self.assertEqual(
            ids(source_type=BusinessSource.Type.COMPANY),
            [created[1]["id"]],
        )
        self.assertEqual(self.client.get(url, {"source_type": "INVALID"}).status_code, 400)
        self.assertEqual(self.client.get(url, {"ordering": "invalid"}).status_code, 400)
        self.assertEqual(self.client.get(reverse("business-source-summary")).data["total_sources"], 3)

    def test_mutation_and_summary_endpoints_require_authentication(self):
        created = self.create_source()
        detail = reverse("business-source-detail", args=[created.data["id"]])
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(reverse("business-source-list"), {"name": "Unauthorized"}).status_code, 401)
        self.assertEqual(self.client.patch(detail, {"name": "Unauthorized"}).status_code, 401)
        self.assertEqual(self.client.delete(detail).status_code, 401)
        self.assertEqual(self.client.get(reverse("business-source-summary")).status_code, 401)
        self.assertTrue(BusinessSource.objects.filter(pk=created.data["id"]).exists())
