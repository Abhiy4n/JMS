from datetime import date, datetime, timedelta, timezone as datetime_timezone
from decimal import Decimal
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import serializers

from accounts.models import BusinessSource, Customer, User
from billing.models import CustomerCredit, CustomerCreditPayment
from billing.interest import calculate_customer_credit

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
        credit = CustomerCredit.objects.get(pledge=pledge)
        self.assertEqual(credit.customer, self.customer)
        self.assertEqual(credit.principal_amount, Decimal("25000.00"))
        self.assertEqual(credit.credit_date, pledge.pledge_date)
        self.assertEqual(response.data["credit_id"], credit.id)
        self.assertEqual(response.data["financial_status"], "UNPAID")

    def test_pledge_credit_creation_is_atomic_and_duplicate_safe(self):
        with patch(
            "pledges.serializers.CustomerCreditSerializer.create",
            side_effect=serializers.ValidationError({"credit": "Forced failure."}),
        ):
            failed = self.create_pledge()
        self.assertEqual(failed.status_code, 400, failed.data)
        self.assertEqual(Pledge.objects.count(), 0)
        self.assertEqual(PledgeItem.objects.count(), 0)
        self.assertEqual(CustomerCredit.objects.count(), 0)

        created = self.create_pledge()
        pledge = Pledge.objects.get(pk=created.data["id"])
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                CustomerCredit.objects.create(
                    pledge=pledge, customer=self.customer, credit_date=pledge.pledge_date,
                    principal_amount=pledge.amount_received, credit_customer_type="INDIVIDUAL",
                    credit_interest_type="PERCENTAGE", credit_interest_amount="2.0000",
                    credit_basis="100.00", credit_period_days=30,
                )

    def test_pledge_snapshots_configured_terms_and_source_edits_do_not_rewrite_them(self):
        self.source.interest_type = BusinessSource.InterestType.PERCENTAGE
        self.source.interest_percentage = Decimal("3.5000")
        self.source.days = 10
        self.source.save(update_fields=("interest_type", "interest_percentage", "days"))
        created = self.create_pledge(amount_received="3000.00")
        credit = CustomerCredit.objects.get(pledge_id=created.data["id"])
        self.assertEqual(credit.credit_interest_type, "PERCENTAGE")
        self.assertEqual(credit.credit_interest_amount, Decimal("3.5000"))
        self.assertEqual(credit.credit_period_days, 10)
        self.assertEqual(created.data["credit_calculation"]["interest_due"], "105.00")

        self.source.interest_percentage = Decimal("8.0000")
        self.source.days = 5
        self.source.save(update_fields=("interest_percentage", "days"))
        credit.refresh_from_db()
        self.assertEqual(credit.credit_interest_amount, Decimal("3.5000"))
        self.assertEqual(credit.credit_period_days, 10)

    def test_company_and_dynamic_pledges_use_their_configured_methods(self):
        self.source.source_type = BusinessSource.Type.COMPANY
        self.source.interest_type = BusinessSource.InterestType.PERCENTAGE
        self.source.interest_percentage = Decimal("2.0000")
        self.source.interest_amount = None
        self.source.days = 15
        self.source.save(update_fields=(
            "source_type", "interest_type", "interest_percentage", "interest_amount", "days",
        ))
        company = self.create_pledge(amount_received="3000.00")
        company_credit = CustomerCredit.objects.get(pledge_id=company.data["id"])
        self.assertEqual(calculate_customer_credit(company_credit, company_credit.credit_date)["interest_due"], "60.00")
        self.assertEqual(
            calculate_customer_credit(company_credit, company_credit.credit_date + timedelta(days=15))["interest_due"],
            "120.00",
        )

        dynamic_source = BusinessSource.objects.create(
            name="Pledge dynamic", source_type=BusinessSource.Type.DYNAMIC,
            interest_type=BusinessSource.InterestType.FIXED_AMOUNT,
            interest_amount=Decimal("125.00"), days=7,
        )
        self.other_customer.business_source = dynamic_source
        self.other_customer.save(update_fields=("business_source",))
        dynamic = self.create_pledge(customer=self.other_customer.id, amount_received="3000.00")
        dynamic_credit = CustomerCredit.objects.get(pledge_id=dynamic.data["id"])
        self.assertEqual(dynamic_credit.credit_interest_type, "FIXED_AMOUNT")
        self.assertEqual(calculate_customer_credit(dynamic_credit, dynamic_credit.credit_date)["interest_due"], "125.00")
        self.assertEqual(
            calculate_customer_credit(dynamic_credit, dynamic_credit.credit_date + timedelta(days=7))["interest_due"],
            "250.00",
        )
    def test_partial_and_full_payment_do_not_automatically_redeem(self):
        created = self.create_pledge(amount_received="3000.00")
        credit_id = created.data["credit_id"]
        partial = self.client.post(reverse("credit-payment", args=[credit_id]), {
            "principal_amount": "1000.00",
        }, format="json")
        self.assertEqual(partial.status_code, 201, partial.data)
        detail = self.client.get(reverse("pledge-detail", args=[created.data["id"]]))
        self.assertEqual(detail.data["financial_status"], "PARTIALLY_PAID")
        refused = self.client.patch(reverse("pledge-detail", args=[created.data["id"]]), {
            "status": Pledge.Status.REDEEMED,
        }, format="json")
        self.assertEqual(refused.status_code, 400, refused.data)
        cancelled = self.client.patch(reverse("pledge-detail", args=[created.data["id"]]), {
            "status": Pledge.Status.CANCELLED,
        }, format="json")
        self.assertEqual(cancelled.status_code, 400, cancelled.data)

        calculation = partial.data["calculation"]
        settled = self.client.post(reverse("credit-payment", args=[credit_id]), {
            "principal_amount": calculation["principal_due"],
            "interest_amount": calculation["interest_due"],
        }, format="json")
        self.assertEqual(settled.status_code, 201, settled.data)
        detail = self.client.get(reverse("pledge-detail", args=[created.data["id"]]))
        self.assertEqual(detail.data["financial_status"], "PAID")
        self.assertEqual(detail.data["status"], Pledge.Status.ACTIVE)

    def test_linked_credit_makes_financial_identity_immutable(self):
        created = self.create_pledge()
        url = reverse("pledge-detail", args=[created.data["id"]])
        for payload in (
            {"customer": self.other_customer.id},
            {"amount_received": "30000.00"},
        ):
            with self.subTest(payload=payload):
                response = self.client.patch(url, payload, format="json")
                self.assertEqual(response.status_code, 400, response.data)
        credit = CustomerCredit.objects.get(pledge_id=created.data["id"])
        self.assertEqual(credit.customer, self.customer)
        self.assertEqual(credit.principal_amount, Decimal("25000.00"))

    def test_pledge_date_can_change_before_payment_and_updates_credit_start_date(self):
        created = self.create_pledge()
        changed_date = (nepal_today() - timedelta(days=10)).isoformat()
        response = self.client.patch(
            reverse("pledge-detail", args=[created.data["id"]]),
            {"pledge_date": changed_date},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        credit = CustomerCredit.objects.get(pledge_id=created.data["id"])
        self.assertEqual(response.data["pledge_date"], changed_date)
        self.assertEqual(credit.credit_date.isoformat(), changed_date)

    def test_pledge_date_cannot_change_after_payment(self):
        created = self.create_pledge()
        payment = self.client.post(reverse("credit-payment", args=[created.data["credit_id"]]), {
            "principal_amount": "1.00",
        }, format="json")
        self.assertEqual(payment.status_code, 201, payment.data)
        original_date = created.data["pledge_date"]
        response = self.client.patch(
            reverse("pledge-detail", args=[created.data["id"]]),
            {"pledge_date": (nepal_today() - timedelta(days=10)).isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        credit = CustomerCredit.objects.get(pk=created.data["credit_id"])
        self.assertEqual(credit.credit_date.isoformat(), original_date)

    def test_pledge_credit_is_in_customer_and_source_accounts_without_bill(self):
        created = self.create_pledge(amount_received="3000.00")
        self.assertEqual(self.client.get(reverse("bill-list")).data, [])
        customer_summary = self.client.get(
            reverse("customer-account", args=[self.customer.id])
        ).data["summary"]
        self.assertEqual(customer_summary["credit_principal_due"], "3000.00")
        self.assertEqual(customer_summary["interest_due"], "60.00")
        source_account = self.client.get(
            reverse("business-source-account", args=[self.source.id])
        ).data
        self.assertEqual(source_account["pledge_credit_summary"]["principal_due"], "3000.00")
        self.assertEqual(source_account["pledge_credit_summary"]["interest_due"], "60.00")
        self.assertEqual(source_account["pledge_credits"][0]["pledge_number"], created.data["pledge_number"])
        self.assertTrue(source_account["pledge_credit_statement"])

    def test_historical_pledge_remains_unlinked(self):
        pledge = Pledge.objects.create(customer=self.customer, amount_received="100.00")
        PledgeItem.objects.create(
            pledge=pledge, description="Historical item", weight_grams="1.000", quantity=1,
        )
        response = self.client.get(reverse("pledge-detail", args=[pledge.id]))
        self.assertEqual(response.data["financial_status"], "NOT_LINKED")
        self.assertIsNone(response.data["credit_id"])
        self.assertFalse(CustomerCredit.objects.filter(pledge=pledge).exists())

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

        expected_date = "2026-01-01"
        self.assertEqual(redeemed.status_code, 201, redeemed.data)
        self.assertEqual(redeemed.data["pledge_date"], expected_date)
        self.assertEqual(CustomerCredit.objects.get(pledge_id=redeemed.data["id"]).credit_date.isoformat(), expected_date)

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
                "due_date": "2099-01-02",
                "items": [self.item(description="Updated ring")],
            },
            format="json",
        )

        self.assertEqual(listing.status_code, 200, listing.data)
        self.assertEqual(len(listing.data), 1)
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data["customer"], self.customer.id)
        self.assertEqual(updated.data["amount_received"], "25000.00")
        self.assertEqual(updated.data["due_date"], "2099-01-02")
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
        calculation = created.data["credit_calculation"]
        payment = self.client.post(reverse("credit-payment", args=[created.data["credit_id"]]), {
            "principal_amount": calculation["principal_due"],
            "interest_amount": calculation["interest_due"],
        }, format="json")
        self.assertEqual(payment.status_code, 201, payment.data)
        response = self.client.patch(
            reverse("pledge-detail", args=[created.data["id"]]),
            {"status": Pledge.Status.REDEEMED},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], Pledge.Status.REDEEMED)
        self.assertEqual(response.data["redeemed_date"], nepal_today().isoformat())
        self.assertIsNone(response.data["cancelled_date"])
        duplicate = self.client.patch(
            reverse("pledge-detail", args=[created.data["id"]]),
            {"status": Pledge.Status.REDEEMED}, format="json",
        )
        self.assertEqual(duplicate.status_code, 400, duplicate.data)

    def test_active_pledge_can_be_cancelled_and_terminal_status_cannot_reopen(self):
        created = self.create_pledge()
        detail_url = reverse("pledge-detail", args=[created.data["id"]])
        cancelled = self.client.patch(
            detail_url,
            {"status": Pledge.Status.CANCELLED},
            format="json",
        )
        self.assertEqual(cancelled.status_code, 400, cancelled.data)
        self.assertIn("reversal is not available", str(cancelled.data))

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
                pledge = Pledge.objects.create(
                    customer=self.customer, amount_received="25000.00",
                    pledge_date="2020-01-01", due_date="2020-01-02",
                )
                PledgeItem.objects.create(pledge=pledge, description="Gold ring", weight_grams="5.250", quantity=1)
                detail_url = reverse("pledge-detail", args=[pledge.id])
                closed = self.client.patch(
                    detail_url,
                    {"status": status},
                    format="json",
                )
                self.assertEqual(closed.status_code, 200, closed.data)
                pledge.refresh_from_db()
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
        calculation = created.data["credit_calculation"]
        self.client.post(reverse("credit-payment", args=[created.data["credit_id"]]), {
            "principal_amount": calculation["principal_due"],
            "interest_amount": calculation["interest_due"],
        }, format="json")
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

    def test_elapsed_days_uses_nepal_date_and_never_goes_negative(self):
        pledge = Pledge.objects.create(
            customer=self.customer, amount_received="100.00", pledge_date="2026-10-01",
        )
        PledgeItem.objects.create(
            pledge=pledge, description="Elapsed item", weight_grams="1.000", quantity=1,
        )
        with patch("pledges.serializers.nepal_today", return_value=date(2026, 11, 6)):
            response = self.client.get(reverse("pledge-detail", args=[pledge.id]))
        self.assertEqual(response.data["elapsed_days"], 36)

        pledge.pledge_date = date(2026, 12, 1)
        pledge.save(update_fields=("pledge_date",))
        with patch("pledges.serializers.nepal_today", return_value=date(2026, 11, 6)):
            response = self.client.get(reverse("pledge-detail", args=[pledge.id]))
        self.assertEqual(response.data["elapsed_days"], 0)

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
