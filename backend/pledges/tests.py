from datetime import date, datetime, timezone as datetime_timezone
from decimal import Decimal
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.models import BusinessSource, Customer, User

from .models import Pledge, PledgeItem, nepal_today


class PledgeApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="pledges@example.com",
            name="Pledge tester",
            password="test-password",
        )
        self.source = BusinessSource.objects.create(
            name="Pledge referral",
            channel_type=BusinessSource.ChannelType.REFERRAL,
        )
        self.customer = Customer.objects.create(
            business_source=self.source,
            name="Asha Rai",
            phone="9800000000",
        )
        self.other_customer = Customer.objects.create(
            business_source=self.source,
            name="Mina Thapa",
            phone="9811111111",
        )
        self.client.force_authenticate(user=self.user)

    def item(self, **overrides):
        return {
            "description": "Gold ring",
            "weight_grams": "5.250",
            "quantity": 1,
            **overrides,
        }

    def create_pledge(self, **overrides):
        payload = {
            "customer": self.customer.id,
            "amount_received": "25000.00",
            "items": [self.item()],
        }
        payload.update(overrides)
        return self.client.post(reverse("pledge-list"), payload, format="json")

    def test_create_pledge_with_customer_source_and_multiple_items(self):
        response = self.create_pledge(
            items=[
                self.item(),
                self.item(description="Silver chain", weight_grams="12.000", quantity=2),
            ]
        )

        self.assertEqual(response.status_code, 201, response.data)
        pledge = Pledge.objects.get(pk=response.data["id"])
        self.assertEqual(pledge.customer, self.customer)
        self.assertEqual(response.data["customer_name"], self.customer.name)
        self.assertEqual(response.data["business_source_id"], self.source.id)
        self.assertEqual(response.data["business_source_name"], self.source.name)
        self.assertRegex(response.data["pledge_number"], r"^PLG-[A-F0-9]{32}$")
        self.assertEqual(response.data["status"], Pledge.Status.ACTIVE)
        self.assertFalse(response.data["is_overdue"])
        self.assertEqual(len(response.data["items"]), 2)
        self.assertEqual(
            [item["sequence"] for item in response.data["items"]],
            [1, 2],
        )
        self.assertEqual(PledgeItem.objects.filter(pledge=pledge).count(), 2)

    def test_create_requires_items_and_customer(self):
        missing_items = self.create_pledge(items=[])
        missing_customer = self.client.post(
            reverse("pledge-list"),
            {"amount_received": "100.00", "items": [self.item()]},
            format="json",
        )

        self.assertEqual(missing_items.status_code, 400, missing_items.data)
        self.assertEqual(missing_customer.status_code, 400, missing_customer.data)

    def test_quantity_one_is_accepted(self):
        response = self.create_pledge(items=[self.item(quantity=1)])

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["items"][0]["quantity"], 1)

    def test_api_pledge_and_lifecycle_dates_use_nepal_local_date(self):
        utc_now = datetime(2025, 12, 31, 18, 30, tzinfo=datetime_timezone.utc)

        with patch("pledges.models.timezone.now", return_value=utc_now):
            redeemed = self.create_pledge()
            redeemed_response = self.client.patch(
                reverse("pledge-detail", args=[redeemed.data["id"]]),
                {"status": Pledge.Status.REDEEMED},
                format="json",
            )
            cancelled = self.create_pledge()
            cancelled_response = self.client.patch(
                reverse("pledge-detail", args=[cancelled.data["id"]]),
                {"status": Pledge.Status.CANCELLED},
                format="json",
            )

        expected_date = "2026-01-01"
        self.assertEqual(redeemed.status_code, 201, redeemed.data)
        self.assertEqual(redeemed.data["pledge_date"], expected_date)
        self.assertEqual(redeemed_response.status_code, 200, redeemed_response.data)
        self.assertEqual(redeemed_response.data["redeemed_date"], expected_date)
        self.assertEqual(cancelled.data["pledge_date"], expected_date)
        self.assertEqual(cancelled_response.status_code, 200, cancelled_response.data)
        self.assertEqual(cancelled_response.data["cancelled_date"], expected_date)

    def test_negative_amount_weight_and_quantity_are_rejected_by_api(self):
        invalid_payloads = (
            {"amount_received": "-1.00"},
            {"items": [self.item(weight_grams="-0.001")]},
            {"items": [self.item(quantity=0)]},
            {"items": [self.item(quantity=-1)]},
        )
        for index, invalid in enumerate(invalid_payloads):
            with self.subTest(invalid=invalid):
                payload = {
                    "customer": self.customer.id,
                    "amount_received": "25000.00",
                    "items": [self.item()],
                }
                payload.update(invalid)
                response = self.client.post(
                    reverse("pledge-list"),
                    payload,
                    format="json",
                )
                self.assertEqual(response.status_code, 400, response.data)
                self.assertEqual(Pledge.objects.count(), 0, f"Invalid case {index} persisted.")

    def test_list_retrieve_search_and_update(self):
        created = self.create_pledge()
        pledge_id = created.data["id"]

        listing = self.client.get(reverse("pledge-list"), {"search": "Asha"})
        detail = self.client.get(reverse("pledge-detail", args=[pledge_id]))
        updated = self.client.patch(
            reverse("pledge-detail", args=[pledge_id]),
            {
                "customer": self.other_customer.id,
                "pledge_date": "2020-01-01",
                "amount_received": "30000.00",
                "due_date": "2020-01-02",
                "items": [self.item(description="Updated ring")],
            },
            format="json",
        )

        self.assertEqual(listing.status_code, 200, listing.data)
        self.assertEqual(len(listing.data), 1)
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data["customer"], self.other_customer.id)
        self.assertEqual(updated.data["pledge_date"], "2020-01-01")
        self.assertEqual(updated.data["amount_received"], "30000.00")
        self.assertEqual(updated.data["due_date"], "2020-01-02")
        self.assertEqual(updated.data["items"][0]["description"], "Updated ring")
        self.assertEqual(updated.data["pledge_number"], created.data["pledge_number"])
        self.assertEqual(PledgeItem.objects.filter(pledge_id=pledge_id).count(), 1)

    def test_invalid_update_and_filters_are_rejected(self):
        created = self.create_pledge()
        detail_url = reverse("pledge-detail", args=[created.data["id"]])

        negative_amount = self.client.patch(
            detail_url,
            {"amount_received": "-1.00"},
            format="json",
        )
        invalid_filter = self.client.get(reverse("pledge-list"), {"status": "OVERDUE"})

        self.assertEqual(negative_amount.status_code, 400, negative_amount.data)
        self.assertEqual(invalid_filter.status_code, 400, invalid_filter.data)

    def test_active_pledge_can_be_redeemed_and_records_date(self):
        created = self.create_pledge()
        response = self.client.patch(
            reverse("pledge-detail", args=[created.data["id"]]),
            {"status": Pledge.Status.REDEEMED},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], Pledge.Status.REDEEMED)
        self.assertEqual(response.data["redeemed_date"], nepal_today().isoformat())
        self.assertIsNone(response.data["cancelled_date"])

    def test_active_pledge_can_be_cancelled_and_terminal_status_cannot_reopen(self):
        created = self.create_pledge()
        detail_url = reverse("pledge-detail", args=[created.data["id"]])
        cancelled = self.client.patch(
            detail_url,
            {"status": Pledge.Status.CANCELLED},
            format="json",
        )
        reopened = self.client.patch(
            detail_url,
            {"status": Pledge.Status.ACTIVE},
            format="json",
        )

        self.assertEqual(cancelled.status_code, 200, cancelled.data)
        self.assertEqual(cancelled.data["status"], Pledge.Status.CANCELLED)
        self.assertEqual(cancelled.data["cancelled_date"], nepal_today().isoformat())
        self.assertEqual(reopened.status_code, 400, reopened.data)

    def test_closed_pledges_reject_all_transaction_updates(self):
        transaction_updates = (
            {"customer": self.other_customer.id},
            {"pledge_date": "2020-01-01"},
            {"amount_received": "30000.00"},
            {"due_date": "2026-12-31"},
            {"items": [self.item(description="Replacement item")]},
            {"status": Pledge.Status.ACTIVE},
        )
        for status in (Pledge.Status.REDEEMED, Pledge.Status.CANCELLED):
            with self.subTest(status=status):
                created = self.create_pledge(
                    pledge_date="2020-01-01",
                    due_date="2020-01-02",
                )
                detail_url = reverse("pledge-detail", args=[created.data["id"]])
                closed = self.client.patch(
                    detail_url,
                    {"status": status},
                    format="json",
                )
                self.assertEqual(closed.status_code, 200, closed.data)
                pledge = Pledge.objects.get(pk=created.data["id"])
                original_items = list(pledge.items.values("description", "quantity"))
                original_values = (
                    pledge.customer_id,
                    pledge.pledge_date,
                    pledge.amount_received,
                    pledge.due_date,
                )

                for update in transaction_updates:
                    with self.subTest(update=update):
                        response = self.client.patch(
                            detail_url,
                            update,
                            format="json",
                        )
                        self.assertEqual(response.status_code, 400, response.data)
                        self.assertIn(
                            "Closed pledges cannot be edited.",
                            str(response.data),
                        )

                pledge.refresh_from_db()
                self.assertEqual(
                    (
                        pledge.customer_id,
                        pledge.pledge_date,
                        pledge.amount_received,
                        pledge.due_date,
                    ),
                    original_values,
                )
                self.assertEqual(
                    list(pledge.items.values("description", "quantity")),
                    original_items,
                )

    def test_redeemed_pledge_cannot_be_cancelled(self):
        created = self.create_pledge()
        detail_url = reverse("pledge-detail", args=[created.data["id"]])
        self.client.patch(
            detail_url,
            {"status": Pledge.Status.REDEEMED},
            format="json",
        )
        response = self.client.patch(
            detail_url,
            {"status": Pledge.Status.CANCELLED},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)

    def test_due_date_before_pledge_date_is_rejected(self):
        response = self.create_pledge(
            pledge_date="2026-10-10",
            due_date="2026-10-09",
        )

        self.assertEqual(response.status_code, 400, response.data)

    def test_due_date_before_default_pledge_date_is_rejected(self):
        response = self.create_pledge(due_date="2020-01-01")

        self.assertEqual(response.status_code, 400, response.data)

    def test_overdue_is_derived_not_a_status(self):
        response = self.create_pledge(
            pledge_date="2020-01-01",
            due_date="2020-01-02",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["is_overdue"])
        self.assertNotIn("OVERDUE", Pledge.Status.values)

    def test_pledge_requires_authentication(self):
        self.client.force_authenticate(user=None)
        response = self.client.get(reverse("pledge-list"))

        self.assertEqual(response.status_code, 401)


class PledgeModelTests(APITestCase):
    def setUp(self):
        source = BusinessSource.objects.create(
            name="Model test source",
            channel_type=BusinessSource.ChannelType.DIRECT,
        )
        self.customer = Customer.objects.create(
            business_source=source,
            name="Model test customer",
        )

    def create_pledge(self, **overrides):
        fields = {
            "customer": self.customer,
            "amount_received": Decimal("100.00"),
        }
        fields.update(overrides)
        return Pledge.objects.create(**fields)

    def test_pledge_number_is_unique_and_stable(self):
        pledge = self.create_pledge()
        pledge_number = pledge.pledge_number
        pledge.amount_received = Decimal("200.00")
        pledge.save()
        self.assertEqual(pledge.pledge_number, pledge_number)

        with self.assertRaises(ValidationError):
            self.create_pledge(pledge_number=pledge_number)

    def test_customer_deletion_is_protected(self):
        self.create_pledge()
        with self.assertRaises(ProtectedError):
            self.customer.delete()

    def test_negative_values_fail_model_validation(self):
        with self.assertRaises(ValidationError):
            self.create_pledge(amount_received=Decimal("-1.00"))

        pledge = self.create_pledge()
        with self.assertRaises(ValidationError):
            PledgeItem.objects.create(
                pledge=pledge,
                description="Invalid weight",
                weight_grams=Decimal("-0.001"),
                quantity=1,
            )
        with self.assertRaises(ValidationError):
            PledgeItem.objects.create(
                pledge=pledge,
                description="Invalid quantity",
                weight_grams=Decimal("1.000"),
                quantity=-1,
            )
        with self.assertRaises(ValidationError):
            PledgeItem.objects.create(
                pledge=pledge,
                description="Zero quantity",
                weight_grams=Decimal("1.000"),
                quantity=0,
            )

    def test_quantity_database_constraint_rejects_zero(self):
        pledge = self.create_pledge()
        item = PledgeItem.objects.create(
            pledge=pledge,
            description="Valid quantity",
            weight_grams=Decimal("1.000"),
            quantity=1,
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                PledgeItem.objects.filter(pk=item.pk).update(quantity=0)

    def test_nepal_local_default_and_lifecycle_dates(self):
        utc_now = datetime(2025, 12, 31, 18, 30, tzinfo=datetime_timezone.utc)

        with patch("pledges.models.timezone.now", return_value=utc_now):
            pledge = self.create_pledge()

        self.assertEqual(pledge.pledge_date, date(2026, 1, 1))

        pledge.status = Pledge.Status.REDEEMED
        with patch("pledges.models.timezone.now", return_value=utc_now):
            pledge.save()
        self.assertEqual(pledge.redeemed_date, date(2026, 1, 1))

        cancelled = self.create_pledge(pledge_date=date(2025, 12, 31))
        cancelled.status = Pledge.Status.CANCELLED
        with patch("pledges.models.timezone.now", return_value=utc_now):
            cancelled.save()
        self.assertEqual(cancelled.cancelled_date, date(2026, 1, 1))

    def test_overdue_uses_controlled_nepal_local_date(self):
        pledge = self.create_pledge(
            pledge_date=date(2025, 12, 31),
            due_date=date(2026, 1, 1),
        )

        before_nepal_due_date = datetime(2025, 12, 31, 18, 30, tzinfo=datetime_timezone.utc)
        after_nepal_due_date = datetime(2026, 1, 1, 18, 30, tzinfo=datetime_timezone.utc)
        with patch("pledges.models.timezone.now", return_value=before_nepal_due_date):
            self.assertFalse(pledge.is_overdue)
        with patch("pledges.models.timezone.now", return_value=after_nepal_due_date):
            self.assertTrue(pledge.is_overdue)

    def test_lifecycle_dates_are_set_and_invalid_transitions_fail(self):
        pledge = self.create_pledge()
        pledge.status = Pledge.Status.REDEEMED
        pledge.save()
        self.assertEqual(pledge.redeemed_date, nepal_today())

        pledge.status = Pledge.Status.ACTIVE
        with self.assertRaises(ValidationError):
            pledge.save()

    def test_cancelled_pledge_records_date(self):
        pledge = self.create_pledge()
        pledge.status = Pledge.Status.CANCELLED
        pledge.save()
        self.assertEqual(pledge.cancelled_date, nepal_today())

    def test_lifecycle_date_is_saved_with_limited_update_fields(self):
        pledge = self.create_pledge()
        pledge.status = Pledge.Status.REDEEMED
        pledge.save(update_fields={"status"})
        pledge.refresh_from_db()

        self.assertEqual(pledge.status, Pledge.Status.REDEEMED)
        self.assertEqual(pledge.redeemed_date, nepal_today())
