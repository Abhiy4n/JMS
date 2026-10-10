from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models.deletion import ProtectedError
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.models import BusinessSource, Customer, User
from .models import Bill, BillItem


class BillApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="bills@example.com",
            name="Bill tester",
            password="test-password-123",
        )
        self.source = BusinessSource.objects.create(
            name="Bill referral",
            channel_type=BusinessSource.ChannelType.REFERRAL,
        )
        self.customer = Customer.objects.create(
            business_source=self.source,
            name="Asha Rai",
            phone="9800000000",
        )
        self.client.force_authenticate(user=self.user)

    def item(self, item_name="Gold ring", gross_weight="5.000", stone_weight="0.500"):
        return {
            "item_name": item_name,
            "material": BillItem.Material.GOLD,
            "rate_unit": BillItem.RateUnit.GRAM,
            "quantity": "1.000",
            "gross_weight": gross_weight,
            "stone_weight": stone_weight,
            "purity": "22.000",
            "rate": "100.00",
            "making_charge": "50.00",
            "discount": "0.00",
        }

    def create_bill(self, **overrides):
        payload = {
            "bill_number": "BILL-1001",
            "customer": self.customer.id,
            "discount": "0.00",
            "vat": "0.00",
            "amount_paid": "0.00",
            "items": [self.item()],
        }
        payload.update(overrides)
        return self.client.post(reverse("bill-list"), payload, format="json")

    def test_create_bill_with_multiple_items_and_customer_source(self):
        response = self.create_bill(
            items=[self.item(), self.item(item_name="Gold chain", gross_weight="2.000", stone_weight="0.000")]
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["customer_name"], self.customer.name)
        self.assertEqual(response.data["business_source_name"], self.source.name)
        self.assertEqual(response.data["status"], Bill.Status.UNPAID)
        self.assertEqual(len(response.data["items"]), 2)
        self.assertEqual(BillItem.objects.filter(bill_id=response.data["id"]).count(), 2)
        self.assertEqual(response.data["items"][0]["net_weight"], "4.500")
        self.assertEqual(response.data["items"][0]["total"], "500.00")
        self.assertEqual(response.data["subtotal"], "750.00")

    def test_bill_totals_due_and_status_are_calculated(self):
        response = self.create_bill(
            discount="20.00",
            vat="15.00",
            amount_paid="200.00",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["grand_total"], "495.00")
        self.assertEqual(response.data["amount_due"], "295.00")
        self.assertEqual(response.data["status"], Bill.Status.PARTIAL)

    def test_paid_bill_status_and_zero_due(self):
        response = self.create_bill(amount_paid="500.00")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["amount_due"], "0.00")
        self.assertEqual(response.data["status"], Bill.Status.PAID)

    def test_diamond_piece_fully_paid_bill_uses_piece_rate(self):
        item = {
            "item_name": "Diamond ring",
            "material": BillItem.Material.DIAMOND,
            "rate_unit": BillItem.RateUnit.PIECE,
            "quantity": "1.000",
            "rate": "80000.00",
            "making_charge": "2000.00",
            "discount": "1000.00",
        }

        response = self.create_bill(
            bill_number="DIAMOND-81000",
            items=[item],
            amount_paid="81000.00",
            payment_method="CASH",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["items"][0]["material"], BillItem.Material.DIAMOND)
        self.assertEqual(response.data["items"][0]["rate_unit"], BillItem.RateUnit.PIECE)
        self.assertEqual(response.data["items"][0]["rate"], "80000.00")
        self.assertEqual(response.data["items"][0]["total"], "81000.00")
        self.assertEqual(response.data["grand_total"], "81000.00")
        self.assertEqual(response.data["amount_paid"], "81000.00")
        self.assertEqual(response.data["amount_due"], "0.00")
        self.assertEqual(response.data["status"], Bill.Status.PAID)

    def test_rate_unit_calculation_uses_weight_or_quantity_and_line_charges_once(self):
        cases = (
            (
                "SILVER-GRAM",
                {
                    **self.item(item_name="Silver bracelet", gross_weight="10.000", stone_weight="0.000"),
                    "material": BillItem.Material.SILVER,
                    "purity": "925.000",
                    "rate": "250.00",
                    "making_charge": "500.00",
                    "discount": "100.00",
                },
                "2900.00",
            ),
            (
                "GEM-CARAT",
                {
                    "item_name": "Gemstone ring",
                    "material": BillItem.Material.GEMSTONE,
                    "rate_unit": BillItem.RateUnit.CARAT,
                    "quantity": "1.000",
                    "gross_weight": "1.000",
                    "stone_weight": "0.000",
                    "purity": "0.000",
                    "rate": "16000.00",
                    "making_charge": "2000.00",
                    "discount": "1000.00",
                },
                "81000.00",
            ),
            (
                "GOLD-MULTI",
                {
                    **self.item(item_name="Gold ring", gross_weight="1.000", stone_weight="0.000"),
                    "quantity": "2.000",
                    "rate": "100.00",
                    "making_charge": "3000.00",
                    "discount": "500.00",
                },
                "2600.00",
            ),
        )

        for bill_number, item, expected_total in cases:
            with self.subTest(bill_number=bill_number):
                response = self.create_bill(bill_number=bill_number, items=[item])
                self.assertEqual(response.status_code, 201, response.data)
                self.assertEqual(response.data["items"][0]["total"], expected_total)
                self.assertEqual(response.data["grand_total"], expected_total)

    def test_legacy_gold_rate_write_remains_supported(self):
        legacy_item = self.item()
        legacy_item.pop("rate")
        legacy_item["gold_rate"] = "100.00"

        response = self.create_bill(bill_number="LEGACY-RATE", items=[legacy_item])

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["items"][0]["rate"], "100.00")

    def test_negative_values_and_invalid_weights_are_rejected(self):
        invalid_payloads = (
            {"discount": "-1.00"},
            {"amount_paid": "-1.00"},
            {"items": [self.item(gross_weight="-1.000")]},
            {"items": [self.item(gross_weight="1.000", stone_weight="2.000")]},
            {"items": [{**self.item(), "quantity": "0.000"}]},
            {"items": [{**self.item(), "rate": "-1.00"}]},
        )

        for index, invalid in enumerate(invalid_payloads):
            payload = {
                "bill_number": f"INVALID-{index}",
                "customer": self.customer.id,
                "items": [self.item()],
            }
            payload.update(invalid)
            with self.subTest(payload=payload):
                response = self.client.post(reverse("bill-list"), payload, format="json")
                self.assertEqual(response.status_code, 400, response.data)

    def test_bill_discount_and_payment_cannot_exceed_totals(self):
        for index, overrides in enumerate(
            ({"discount": "501.00"}, {"amount_paid": "501.00"})
        ):
            with self.subTest(overrides=overrides):
                response = self.create_bill(bill_number=f"OVER-{index}", **overrides)
                self.assertEqual(response.status_code, 400, response.data)

    def test_draft_and_cancelled_statuses_can_be_explicit(self):
        draft = self.create_bill(status=Bill.Status.DRAFT)
        cancelled = self.create_bill(bill_number="BILL-CANCELLED", status=Bill.Status.CANCELLED)

        self.assertEqual(draft.status_code, 201, draft.data)
        self.assertEqual(draft.data["status"], Bill.Status.DRAFT)
        self.assertEqual(cancelled.status_code, 201, cancelled.data)
        self.assertEqual(cancelled.data["status"], Bill.Status.CANCELLED)

        patch_response = self.client.patch(
            reverse("bill-detail", args=[draft.data["id"]]),
            {"notes": "Keep as draft"},
            format="json",
        )
        self.assertEqual(patch_response.data["status"], Bill.Status.DRAFT)

    def test_zero_total_bill_is_not_marked_paid(self):
        response = self.create_bill(
            items=[],
            bill_number="BILL-ZERO",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["amount_due"], "0.00")
        self.assertEqual(response.data["status"], Bill.Status.UNPAID)

    def test_customer_cannot_be_deleted_while_bills_exist(self):
        response = self.create_bill()
        bill = Bill.objects.get(pk=response.data["id"])

        self.assertEqual(bill.customer, self.customer)
        with self.assertRaises(ProtectedError):
            self.customer.delete()

    def test_bill_detail_patch_and_delete(self):
        create_response = self.create_bill()
        detail_url = reverse("bill-detail", args=[create_response.data["id"]])

        detail_response = self.client.get(detail_url)
        patch_response = self.client.patch(
            detail_url,
            {"notes": "Resized ring", "amount_paid": "100.00"},
            format="json",
        )
        delete_response = self.client.delete(detail_url)

        self.assertEqual(detail_response.status_code, 200)
        self.assertEqual(patch_response.status_code, 200, patch_response.data)
        self.assertEqual(patch_response.data["notes"], "Resized ring")
        self.assertEqual(patch_response.data["amount_due"], "400.00")
        self.assertEqual(patch_response.data["status"], Bill.Status.PARTIAL)
        self.assertEqual(delete_response.status_code, 204)
        self.assertFalse(Bill.objects.filter(pk=create_response.data["id"]).exists())

    def test_edit_rejects_total_below_existing_amount_paid(self):
        create_response = self.create_bill(amount_paid="500.00")
        bill_id = create_response.data["id"]

        response = self.client.patch(
            reverse("bill-detail", args=[bill_id]),
            {"items": [self.item(gross_weight="1.000", stone_weight="0.000")]},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        saved_bill = Bill.objects.get(pk=bill_id)
        self.assertEqual(saved_bill.grand_total, Decimal("500.00"))
        self.assertEqual(saved_bill.amount_paid, Decimal("500.00"))

    def test_bill_list_search_and_filters(self):
        self.create_bill()
        bill = Bill.objects.get(bill_number="BILL-1001")

        by_number = self.client.get(reverse("bill-list"), {"search": "1001"})
        by_customer = self.client.get(reverse("bill-list"), {"customer": self.customer.id})
        by_status = self.client.get(reverse("bill-list"), {"status": Bill.Status.UNPAID})
        by_date = self.client.get(reverse("bill-list"), {"bill_date": bill.bill_date.isoformat()})
        by_range = self.client.get(
            reverse("bill-list"),
            {"date_from": bill.bill_date.isoformat(), "date_to": bill.bill_date.isoformat()},
        )

        self.assertEqual(len(by_number.data), 1)
        self.assertEqual(len(by_customer.data), 1)
        self.assertEqual(len(by_status.data), 1)
        self.assertEqual(len(by_date.data), 1)
        self.assertEqual(len(by_range.data), 1)

    def test_bill_list_rejects_invalid_filters(self):
        invalid_filters = (
            {"customer": "not-an-id"},
            {"customer": "0"},
            {"customer": "999999"},
            {"status": "INVALID"},
            {"bill_date": "2026-13-01"},
            {"date_from": "not-a-date"},
            {"date_to": "2026-02-30"},
            {"date_from": "2026-10-05", "date_to": "2026-10-04"},
        )

        for filters in invalid_filters:
            with self.subTest(filters=filters):
                response = self.client.get(reverse("bill-list"), filters)
                self.assertEqual(response.status_code, 400, response.data)

    def test_business_source_account_updates_with_bill_payments(self):
        bill_specs = (
            ("SOURCE-001", "100000.00", "100000.00"),
            ("SOURCE-002", "200000.00", "150000.00"),
            ("SOURCE-003", "300000.00", "100000.00"),
        )
        created_bills = []
        for bill_number, rate, amount_paid in bill_specs:
            item = {
                "item_name": "Jewelry item",
                "material": BillItem.Material.OTHER,
                "rate_unit": BillItem.RateUnit.ITEM,
                "quantity": "1.000",
                "gross_weight": "0.000",
                "stone_weight": "0.000",
                "purity": "0.000",
                "rate": rate,
                "making_charge": "0.00",
                "discount": "0.00",
            }
            response = self.create_bill(
                bill_number=bill_number,
                items=[item],
                amount_paid=amount_paid,
            )
            self.assertEqual(response.status_code, 201, response.data)
            created_bills.append(response.data["id"])

        account_url = reverse("business-source-account", args=[self.source.id])
        response = self.client.get(account_url)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["summary"]["total_bills"], 3)
        self.assertEqual(response.data["summary"]["total_purchases"], "600000.00")
        self.assertEqual(response.data["summary"]["total_paid"], "350000.00")
        self.assertEqual(response.data["summary"]["total_outstanding"], "250000.00")
        self.assertEqual(response.data["summary"]["credit_status"], "CREDIT")
        self.assertEqual(response.data["statement"][-1]["balance"], "250000.00")

        paged_statement = self.client.get(account_url, {"page": 2, "page_size": 1})
        self.assertEqual(paged_statement.status_code, 200, paged_statement.data)
        self.assertEqual(paged_statement.data["history"]["total_bills"], 3)
        self.assertEqual(paged_statement.data["history"]["page"], 2)
        self.assertEqual(len(paged_statement.data["bills"]), 1)
        self.assertEqual(paged_statement.data["statement_opening_balance"], "0.00")
        self.assertEqual(paged_statement.data["statement"][-1]["balance"], "50000.00")

        self.client.patch(
            reverse("bill-detail", args=[created_bills[1]]),
            {"amount_paid": "200000.00"},
            format="json",
        )
        after_second_payment = self.client.get(account_url).data["summary"]
        self.assertEqual(after_second_payment["total_paid"], "400000.00")
        self.assertEqual(after_second_payment["total_outstanding"], "200000.00")
        self.assertEqual(after_second_payment["credit_status"], "CREDIT")

        self.client.patch(
            reverse("bill-detail", args=[created_bills[2]]),
            {"amount_paid": "300000.00"},
            format="json",
        )
        clear_summary = self.client.get(account_url).data["summary"]
        self.assertEqual(clear_summary["total_purchases"], "600000.00")
        self.assertEqual(clear_summary["total_paid"], "600000.00")
        self.assertEqual(clear_summary["total_outstanding"], "0.00")
        self.assertEqual(clear_summary["credit_status"], "CLEAR")

    def test_business_source_account_filters_and_excludes_cancelled_bills(self):
        cancelled_item = {
            "item_name": "Cancelled item",
            "material": BillItem.Material.DIAMOND,
            "rate_unit": BillItem.RateUnit.PIECE,
            "quantity": "1.000",
            "rate": "90000.00",
            "making_charge": "0.00",
            "discount": "0.00",
        }
        response = self.create_bill(
            bill_number="SOURCE-CANCELLED",
            items=[cancelled_item],
            status=Bill.Status.CANCELLED,
        )
        self.assertEqual(response.status_code, 201, response.data)

        account_url = reverse("business-source-account", args=[self.source.id])
        overall = self.client.get(account_url)
        cancelled = self.client.get(account_url, {"status": "CANCELLED"})
        invalid_range = self.client.get(
            account_url,
            {"date_from": "2026-10-05", "date_to": "2026-10-04"},
        )

        self.assertEqual(overall.data["summary"]["total_purchases"], "0.00")
        self.assertEqual(overall.data["summary"]["credit_status"], "CLEAR")
        self.assertEqual(len(cancelled.data["bills"]), 1)
        self.assertEqual(cancelled.data["filtered_summary"]["total_purchases"], "0.00")
        self.assertEqual(invalid_range.status_code, 400)

    def test_editing_bill_items_updates_business_source_account_totals(self):
        item = {
            "item_name": "Diamond pendant",
            "material": BillItem.Material.DIAMOND,
            "rate_unit": BillItem.RateUnit.PIECE,
            "quantity": "1.000",
            "rate": "100.00",
            "making_charge": "0.00",
            "discount": "0.00",
        }
        create_response = self.create_bill(
            bill_number="SOURCE-EDIT",
            items=[item],
            amount_paid="50.00",
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)

        updated_item = {**item, "rate": "200.00"}
        update_response = self.client.patch(
            reverse("bill-detail", args=[create_response.data["id"]]),
            {"items": [updated_item]},
            format="json",
        )
        self.assertEqual(update_response.status_code, 200, update_response.data)
        self.assertEqual(update_response.data["grand_total"], "200.00")
        self.assertEqual(update_response.data["amount_due"], "150.00")

        account_response = self.client.get(
            reverse("business-source-account", args=[self.source.id])
        )
        self.assertEqual(account_response.data["summary"]["total_purchases"], "200.00")
        self.assertEqual(account_response.data["summary"]["total_paid"], "50.00")
        self.assertEqual(account_response.data["summary"]["total_outstanding"], "150.00")

    def test_patch_with_incomplete_item_returns_validation_error(self):
        create_response = self.create_bill()
        detail_url = reverse("bill-detail", args=[create_response.data["id"]])

        response = self.client.patch(
            detail_url,
            {"items": [{"item_name": "Incomplete ring"}]},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(BillItem.objects.filter(bill_id=create_response.data["id"]).count(), 1)

    def test_unauthorized_requests_are_rejected(self):
        self.client.force_authenticate(user=None)

        list_response = self.client.get(reverse("bill-list"))
        create_response = self.client.post(reverse("bill-list"), {}, format="json")

        self.assertEqual(list_response.status_code, 401)
        self.assertEqual(create_response.status_code, 401)


class BillModelCalculationTests(APITestCase):
    def test_item_model_calculates_net_weight_and_total(self):
        source = BusinessSource.objects.create(
            name="Model source",
            channel_type=BusinessSource.ChannelType.DIRECT,
        )
        customer = Customer.objects.create(business_source=source, name="Model customer")
        bill = Bill.objects.create(bill_number="MODEL-1", customer=customer)
        item = BillItem.objects.create(
            bill=bill,
            item_name="Model ring",
            quantity=Decimal("2.000"),
            gross_weight=Decimal("3.000"),
            stone_weight=Decimal("0.500"),
            rate=Decimal("100.00"),
        )

        self.assertEqual(item.net_weight, Decimal("2.500"))
        self.assertEqual(item.total, Decimal("250.00"))

    def test_item_model_save_rejects_invalid_values(self):
        source = BusinessSource.objects.create(
            name="Validation source",
            channel_type=BusinessSource.ChannelType.DIRECT,
        )
        customer = Customer.objects.create(business_source=source, name="Validation customer")
        bill = Bill.objects.create(bill_number="MODEL-VALIDATION", customer=customer)
        invalid_items = (
            {"stone_weight": Decimal("6.000")},
            {"gross_weight": Decimal("-1.000")},
            {"quantity": Decimal("0.000")},
            {"rate": Decimal("-1.00")},
            {"discount": Decimal("501.00")},
        )

        for index, overrides in enumerate(invalid_items):
            values = {
                "bill": bill,
                "item_name": f"Invalid item {index}",
                "quantity": Decimal("1.000"),
                "gross_weight": Decimal("5.000"),
                "stone_weight": Decimal("0.500"),
                "rate": Decimal("100.00"),
                "making_charge": Decimal("50.00"),
                "discount": Decimal("0.00"),
            }
            values.update(overrides)
            with self.subTest(overrides=overrides):
                with self.assertRaises(DjangoValidationError):
                    BillItem.objects.create(**values)