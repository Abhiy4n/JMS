from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from django.core.exceptions import ValidationError
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.urls import reverse
from django.test import TransactionTestCase
from rest_framework.test import APITestCase

from accounts.models import BusinessSource, Customer, User

from .bs_dates import ad_to_bs, bs_month_calendar, bs_to_ad
from .interest import calculate_pledge_interest
from .models import Pledge, PledgeEditLog, PledgeItem, PledgePayment, nepal_today


class InterestCalculationTests(APITestCase):
    def pledge(self, principal="100000.00", *, source_type="INDIVIDUAL", date_value=date(2026, 1, 1), **terms):
        preset = {
            "INDIVIDUAL": ("2.00", 30, "2.00", 30),
            "COMPANY": ("1.00", 15, "2.00", 30),
        }.get(source_type, ("0", 0, "0", 1))
        defaults = dict(zip(("upfront_percent", "upfront_days", "daily_percent", "daily_divisor"), preset))
        defaults.update(terms)
        return SimpleNamespace(pledge_date=date_value, principal_amount=Decimal(principal), **defaults)

    def calc(self, pledge, as_of, payments=(), logs=()):
        return calculate_pledge_interest(pledge, payments, logs, as_of)

    def test_individual_rounding_and_principal_reduction(self):
        pledge = self.pledge()
        start = pledge.pledge_date
        self.assertEqual(self.calc(pledge, start)["interest_earned"], Decimal("2000.00"))
        self.assertEqual(self.calc(pledge, start + timedelta(days=29))["interest_earned"], Decimal("2000.00"))
        self.assertEqual(self.calc(pledge, start + timedelta(days=30))["interest_earned"], Decimal("2066.67"))
        self.assertEqual(self.calc(pledge, start + timedelta(days=120))["interest_earned"], Decimal("8066.97"))
        payment = {
            "payment_date": start + timedelta(days=120),
            "interest_amount": Decimal("0.00"),
            "principal_amount": Decimal("50000.00"),
            "is_voided": False,
        }
        after = self.calc(pledge, start + timedelta(days=150), [payment])
        self.assertEqual(after["daily_amount"], Decimal("33.33"))
        self.assertEqual(after["unpaid_interest"], Decimal("9066.87"))
        self.assertEqual(after["total_outstanding"], Decimal("59066.87"))

    def test_company_upfront_period(self):
        pledge = self.pledge(source_type="COMPANY")
        start = pledge.pledge_date
        self.assertEqual(self.calc(pledge, start)["interest_earned"], Decimal("1000.00"))
        self.assertEqual(self.calc(pledge, start + timedelta(days=14))["interest_earned"], Decimal("1000.00"))
        self.assertEqual(self.calc(pledge, start + timedelta(days=15))["interest_earned"], Decimal("1066.67"))

    def test_principal_payment_inside_upfront_period_keeps_upfront_fixed(self):
        pledge = self.pledge()
        payment = {
            "payment_date": pledge.pledge_date + timedelta(days=9),
            "interest_amount": Decimal("0.00"),
            "principal_amount": Decimal("50000.00"),
            "is_voided": False,
        }
        result = self.calc(pledge, pledge.pledge_date + timedelta(days=30), [payment])
        self.assertEqual(result["upfront_interest"], Decimal("2000.00"))
        self.assertEqual(result["daily_interest"], Decimal("33.33"))
        self.assertEqual(result["outstanding_principal"], Decimal("50000.00"))
        self.assertEqual(result["interest_earned"], Decimal("2033.33"))

    def test_zero_rate(self):
        pledge = self.pledge(upfront_percent="0.00", daily_percent="0.00")
        result = self.calc(pledge, pledge.pledge_date + timedelta(days=90))
        self.assertEqual(result["interest_earned"], Decimal("0.00"))
        self.assertEqual(result["total_outstanding"], Decimal("100000.00"))

    def test_forfeit_pause_and_reopen_resume_on_reopen_date(self):
        pledge = self.pledge()
        start = pledge.pledge_date
        logs = [
            {"field": "status", "old_value": "ACTIVE", "new_value": "FORFEITED", "effective_date": start + timedelta(days=59), "id": 1},
            {"field": "status", "old_value": "FORFEITED", "new_value": "ACTIVE", "effective_date": start + timedelta(days=99), "id": 2},
        ]
        result = self.calc(pledge, start + timedelta(days=120), logs=logs)
        self.assertEqual(result["interest_earned"], Decimal("5466.84"))

    def test_forfeit_and_reopen_same_day_has_no_pause_days(self):
        pledge = self.pledge()
        day = pledge.pledge_date + timedelta(days=59)
        logs = [
            {"field": "status", "old_value": "ACTIVE", "new_value": "FORFEITED", "effective_date": day, "id": 1},
            {"field": "status", "old_value": "FORFEITED", "new_value": "ACTIVE", "effective_date": day, "id": 2},
        ]
        result = self.calc(pledge, day + timedelta(days=1), logs=logs)
        self.assertEqual(result["interest_earned"], Decimal("4066.77"))


class BikramSambatDateTests(APITestCase):
    def test_bs_ad_round_trip_and_calendar_boundaries(self):
        for value in ("2083-01-30", "2083-02-01", "2083-12-30", "2084-01-01"):
            self.assertEqual(ad_to_bs(bs_to_ad(value)), value)
        self.assertEqual((bs_to_ad("2083-02-01") - bs_to_ad("2083-01-30")).days, 2)
        self.assertEqual((bs_to_ad("2084-01-01") - bs_to_ad("2083-12-30")).days, 1)

    def test_invalid_and_out_of_range_dates_are_rejected(self):
        for value in ("2083-13-01", "2083-02-32", "1974-12-31", "2101-01-01"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                bs_to_ad(value)

    def test_calendar_month_has_bikram_sambat_days_and_weekday_offset(self):
        calendar = bs_month_calendar(2083, 7)
        first_ad = bs_to_ad("2083-07-01")
        self.assertEqual(calendar["days"], list(range(1, len(calendar["days"]) + 1)))
        self.assertEqual(calendar["first_weekday"], (first_ad.weekday() + 1) % 7)
        self.assertEqual(calendar["year"], 2083)
        self.assertEqual(calendar["month"], 7)

    def test_calendar_rejects_invalid_and_out_of_range_months(self):
        for year, month in ((2083, 0), (2083, 13), (1974, 12), (2101, 1)):
            with self.subTest(year=year, month=month), self.assertRaises(ValueError):
                bs_month_calendar(year, month)


class PledgeApiTests(APITestCase):
    def setUp(self):
        self.cashier = User.objects.create_user(email="cashier@example.com", name="Cashier", password="test-pass")
        self.staff = User.objects.create_user(email="staff@example.com", name="Staff", password="test-pass", is_staff=True)
        self.admin = User.objects.create_superuser(email="admin@example.com", name="Admin", password="test-pass")
        self.source = BusinessSource.objects.create(
            name="Individual source",
            source_type=BusinessSource.Type.INDIVIDUAL,
            phone="9812345678",
            address="Kathmandu",
        )
        self.customer = Customer.objects.create(name="Asha Rai", phone="9800000000", business_source=self.source)
        self.client.force_authenticate(self.cashier)

    def pledge_data(self, **overrides):
        return {
            "customer": self.customer.pk,
            "business_source_id": self.source.pk,
            "pledge_date": ad_to_bs(nepal_today()),
            "principal_amount": "100000.00",
            "items": [{
                "particulars": "Gold ring",
                "weight": "5.250",
                "unit": "GRAM",
                "ghat": "",
                "jor": "1",
            }],
            **overrides,
        }

    def create_pledge(self, **overrides):
        return self.client.post(reverse("pledge-list"), self.pledge_data(**overrides), format="json")

    def test_form_defaults_return_today_in_bikram_sambat(self):
        response = self.client.get(reverse("pledge-form-defaults"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"today_bs": ad_to_bs(nepal_today())})

        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(reverse("pledge-form-defaults")).status_code, 401)

    def test_calendar_endpoint_returns_month_and_requires_authentication(self):
        response = self.client.get(reverse("pledge-calendar"), {"year": 2083, "month": 7})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["year"], 2083)
        self.assertEqual(response.data["month"], 7)
        self.assertEqual(response.data["first_weekday"], (bs_to_ad("2083-07-01").weekday() + 1) % 7)
        self.assertEqual(response.data["days"], list(range(1, len(response.data["days"]) + 1)))

        invalid = self.client.get(reverse("pledge-calendar"), {"year": 2083, "month": 13})
        self.assertEqual(invalid.status_code, 400)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(reverse("pledge-calendar"), {"year": 2083, "month": 7}).status_code, 401)

    def test_authenticated_cashier_creates_pledge_and_freezes_source_terms(self):
        response = self.create_pledge()
        self.assertEqual(response.status_code, 201, response.data)
        pledge = Pledge.objects.get(pk=response.data["id"])
        self.assertEqual(response.data["pledge_date"], ad_to_bs(pledge.pledge_date))
        self.assertEqual(pledge.upfront_percent, Decimal("2.00"))
        self.assertEqual(pledge.upfront_days, 30)
        self.assertEqual(pledge.daily_percent, Decimal("2.00"))
        self.assertEqual(pledge.daily_divisor, 30)
        self.assertEqual(pledge.customer_name, self.customer.name)
        self.assertEqual(pledge.address, self.source.address)
        self.assertEqual(pledge.phone, self.source.phone)
        self.assertIsNone(pledge.due_date)
        self.assertEqual(response.data["items"][0]["unit"], "GRAM")
        self.source.source_type = BusinessSource.Type.COMPANY
        self.source.save()
        pledge.refresh_from_db()
        self.assertEqual(pledge.upfront_percent, Decimal("2.00"))
        self.assertEqual(pledge.upfront_days, 30)

    def test_paper_fields_due_date_and_item_values_validate(self):
        pledge_date = nepal_today() - timedelta(days=2)
        due_date = pledge_date + timedelta(days=10)
        created = self.create_pledge(
            pledge_date=ad_to_bs(pledge_date),
            due_date=ad_to_bs(due_date),
            written_text="लिखितम् विवरण",
            customer_name="Printed customer name",
            address="Edited address",
            phone="9800000000",
            items=[{
                "particulars": "Gold necklace",
                "weight": "2.125",
                "unit": "TOLA",
                "ghat": "दुई टुक्रा",
                "jor": "1.250",
            }],
        )
        self.assertEqual(created.status_code, 201, created.data)
        pledge = Pledge.objects.get(pk=created.data["id"])
        item = pledge.items.get()
        self.assertEqual(pledge.due_date, due_date)
        self.assertEqual(pledge.written_text, "लिखितम् विवरण")
        self.assertEqual(pledge.customer_name, "Printed customer name")
        self.assertEqual(pledge.address, "Edited address")
        self.assertEqual(pledge.phone, "9800000000")
        self.assertEqual(item.weight, Decimal("2.125"))
        self.assertEqual(item.unit, PledgeItem.Unit.TOLA)
        self.assertEqual(item.ghat, "दुई टुक्रा")
        self.assertEqual(item.jor, Decimal("1.250"))

        same_day_due_date = self.create_pledge(
            pledge_date=ad_to_bs(pledge_date),
            due_date=ad_to_bs(pledge_date),
        )
        self.assertEqual(same_day_due_date.status_code, 201, same_day_due_date.data)
        self.assertEqual(same_day_due_date.data["due_date"], ad_to_bs(pledge_date))

        past_due_date = self.create_pledge(
            pledge_date=ad_to_bs(pledge_date),
            due_date=ad_to_bs(pledge_date - timedelta(days=1)),
        )
        self.assertEqual(past_due_date.status_code, 201, past_due_date.data)

        for item in (
            {"particulars": "Gold ring", "weight": "0", "unit": "GRAM", "jor": "1"},
            {"particulars": "Gold ring", "weight": "1", "unit": "GRAM", "jor": "0"},
            {"particulars": "Gold ring", "weight": "1", "unit": "ANAA", "jor": "1"},
            {"particulars": "Gold ring", "weight": "1.0001", "unit": "GRAM", "jor": "1"},
            {"particulars": "Gold ring", "weight": "1", "unit": "GRAM", "jor": "1.0001"},
        ):
            with self.subTest(item=item):
                invalid_item = self.create_pledge(items=[item])
                self.assertEqual(invalid_item.status_code, 400, invalid_item.data)

    def test_only_customers_linked_to_the_selected_source_can_have_pledges(self):
        unlinked = Customer.objects.create(name="Unlinked customer")
        response = self.create_pledge(customer=unlinked.pk)
        self.assertEqual(response.status_code, 400, response.data)

    def test_paper_field_and_item_edits_are_logged_and_locked_after_payment(self):
        created = self.create_pledge()
        detail = reverse("pledge-detail", args=[created.data["id"]])
        self.client.force_authenticate(self.staff)
        no_reason = self.client.patch(detail, {
            "items": [{
                "particulars": "Missing reason",
                "weight": "5.250",
                "unit": "GRAM",
                "ghat": "",
                "jor": "1",
            }],
        }, format="json")
        self.assertEqual(no_reason.status_code, 400, no_reason.data)
        updated = self.client.patch(detail, {
            "customer_name": "Asha Rai updated",
            "address": "Patan",
            "phone": "9800000001",
            "written_text": "Updated लिखितम्",
            "items": [{
                "particulars": "Gold ring, revised",
                "weight": "5.250",
                "unit": "GRAM",
                "ghat": "One stone",
                "jor": "1.500",
            }],
            "reason": "Correct printed details",
        }, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        logs = list(PledgeEditLog.objects.filter(pledge_id=created.data["id"]))
        self.assertEqual(len(logs), 5)
        self.assertEqual({log.field for log in logs}, {"customer_name", "address", "phone", "written_text", "items"})
        self.assertEqual(len({log.edit_id for log in logs}), 1)

        pledge = Pledge.objects.get(pk=created.data["id"])
        PledgePayment.objects.create(
            pledge=pledge,
            payment_date=nepal_today(),
            principal_amount="100.00",
            created_by=self.cashier,
        )
        locked = self.client.patch(detail, {
            "items": [{
                "particulars": "Changed after payment",
                "weight": "5.250",
                "unit": "GRAM",
                "ghat": "",
                "jor": "1",
            }],
            "reason": "Attempt item edit",
        }, format="json")
        self.assertEqual(locked.status_code, 400, locked.data)
        self.assertEqual(pledge.items.get().particulars, "Gold ring, revised")

    def test_inactive_or_incomplete_sources_cannot_be_used(self):
        self.source.status = BusinessSource.Status.INACTIVE
        self.source.save()
        self.assertEqual(self.create_pledge().status_code, 400)
        self.source.status = BusinessSource.Status.ACTIVE
        self.source.source_type = BusinessSource.Type.DYNAMIC
        self.source.save()
        response = self.create_pledge()
        self.assertEqual(response.status_code, 400, response.data)

    def test_edit_before_first_payment_and_lock_after_any_payment(self):
        created = self.create_pledge()
        self.assertEqual(created.status_code, 201, created.data)
        detail = reverse("pledge-detail", args=[created.data["id"]])
        blocked = self.client.patch(detail, {
            "principal_amount": "90000.00",
            "reason": "Correction before payment",
        }, format="json")
        self.assertEqual(blocked.status_code, 403)
        self.client.force_authenticate(self.staff)
        edited = self.client.patch(detail, {
            "principal_amount": "90000.00",
            "upfront_days": 29,
            "reason": "Correction before payment",
        }, format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        logs = PledgeEditLog.objects.filter(pledge_id=created.data["id"])
        self.assertEqual(logs.count(), 2)
        self.assertEqual(logs.values_list("edit_id", flat=True).distinct().count(), 1)

        pledge = Pledge.objects.get(pk=created.data["id"])
        PledgePayment.objects.create(
            pledge=pledge,
            payment_date=nepal_today(),
            principal_amount="100.00",
            created_by=self.cashier,
        )
        self.assertEqual(self.client.get(detail).data["status_label"], "Partially Paid")
        self.client.force_authenticate(self.staff)
        locked = self.client.patch(detail, {"principal_amount": "80000.00", "reason": "Another change"}, format="json")
        self.assertEqual(locked.status_code, 400, locked.data)
        pledge.refresh_from_db()
        self.assertEqual(pledge.principal_amount, Decimal("90000.00"))

    def test_create_payment_caps_amount_and_returns_bs_date(self):
        created = self.create_pledge(pledge_date=ad_to_bs(nepal_today() - timedelta(days=31)))
        self.assertEqual(created.status_code, 201, created.data)
        url = reverse("pledge-payment-list", args=[created.data["id"]])
        too_much_interest = self.client.post(url, {
            "payment_date": ad_to_bs(nepal_today()), "interest_amount": "3000.00", "principal_amount": "0.00",
        }, format="json")
        self.assertEqual(too_much_interest.status_code, 400, too_much_interest.data)
        self.assertEqual(PledgePayment.objects.filter(pledge_id=created.data["id"]).count(), 0)
        valid = self.client.post(url, {
            "payment_date": ad_to_bs(nepal_today()), "interest_amount": "2066.67", "principal_amount": "500.00",
        }, format="json")
        self.assertEqual(valid.status_code, 201, valid.data)
        self.assertEqual(valid.data["payment_date"], ad_to_bs(nepal_today()))

    def test_payment_date_cannot_be_backdated_before_latest_payment(self):
        created = self.create_pledge(pledge_date=ad_to_bs(nepal_today() - timedelta(days=31)))
        url = reverse("pledge-payment-list", args=[created.data["id"]])
        self.assertEqual(self.client.post(url, {
            "payment_date": ad_to_bs(nepal_today()), "interest_amount": "100.00",
        }, format="json").status_code, 201)
        earlier = self.client.post(url, {
            "payment_date": ad_to_bs(nepal_today() - timedelta(days=1)), "interest_amount": "100.00",
        }, format="json")
        self.assertEqual(earlier.status_code, 400)

    def test_status_permissions_and_transition_reasons(self):
        created = self.create_pledge()
        status_url = reverse("pledge-status", args=[created.data["id"]])
        self.assertEqual(self.client.post(status_url, {"status": "FORFEITED"}, format="json").status_code, 403)
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.post(status_url, {"status": "FORFEITED", "reason": "reason"}, format="json").status_code, 403)
        self.assertEqual(self.client.post(status_url, {"status": "CLOSED"}, format="json").status_code, 400)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(status_url, {"status": "FORFEITED"}, format="json").status_code, 400)
        forfeited = self.client.post(status_url, {"status": "FORFEITED", "reason": "Customer absent"}, format="json")
        self.assertEqual(forfeited.status_code, 200, forfeited.data)
        self.assertEqual(self.client.post(status_url, {"status": "ACTIVE"}, format="json").status_code, 400)
        reopened = self.client.post(status_url, {"status": "ACTIVE", "reason": "Owner approved"}, format="json")
        self.assertEqual(reopened.status_code, 200, reopened.data)
        self.assertEqual(PledgeEditLog.objects.filter(pledge_id=created.data["id"], field="status").count(), 2)

    def test_business_source_cannot_be_deleted_while_pledges_exist(self):
        created = self.create_pledge()
        self.client.force_authenticate(self.admin)
        response = self.client.delete(reverse("business-source-detail", args=[self.source.pk]))
        self.assertEqual(response.status_code, 409, response.data)
        self.assertIn("pledges", response.data["detail"])
        self.assertTrue(BusinessSource.objects.filter(pk=self.source.pk).exists())

    def test_paid_closure_allows_no_reason_and_logs_the_transition(self):
        created = self.create_pledge(pledge_date=ad_to_bs(nepal_today() - timedelta(days=2)))
        pledge = Pledge.objects.get(pk=created.data["id"])
        PledgePayment.objects.create(
            pledge=pledge,
            payment_date=nepal_today() - timedelta(days=1),
            interest_amount="2000.00",
            principal_amount="100000.00",
            created_by=self.cashier,
        )
        self.client.force_authenticate(self.staff)
        closed = self.client.post(
            reverse("pledge-status", args=[pledge.pk]),
            {"status": "CLOSED"},
            format="json",
        )
        self.assertEqual(closed.status_code, 200, closed.data)
        log = PledgeEditLog.objects.get(pledge=pledge, field="status")
        self.assertEqual(log.reason, "")
        self.assertEqual(log.changed_by, self.staff)
        blocked = self.client.post(reverse("pledge-payment-list", args=[pledge.pk]), {
            "payment_date": ad_to_bs(nepal_today()), "principal_amount": "1.00",
        }, format="json")
        self.assertEqual(blocked.status_code, 400)

    def test_payment_correction_and_removal_are_staff_only_and_logged(self):
        created = self.create_pledge(pledge_date=ad_to_bs(nepal_today() - timedelta(days=31)))
        payment = self.client.post(reverse("pledge-payment-list", args=[created.data["id"]]), {
            "payment_date": ad_to_bs(nepal_today()), "interest_amount": "100.00",
        }, format="json")
        self.assertEqual(payment.status_code, 201, payment.data)
        correction_url = reverse("pledge-payment-correction", args=[payment.data["id"]])
        self.assertEqual(self.client.post(correction_url, {"interest_amount": "150.00", "reason": "Fix amount"}, format="json").status_code, 403)
        self.client.force_authenticate(self.staff)
        corrected = self.client.post(correction_url, {"interest_amount": "150.00", "reason": "Fix amount"}, format="json")
        self.assertEqual(corrected.status_code, 200, corrected.data)
        removed = self.client.post(reverse("pledge-payment-removal", args=[payment.data["id"]]), {"reason": "Duplicate receipt"}, format="json")
        self.assertEqual(removed.status_code, 200, removed.data)
        self.assertTrue(PledgePayment.objects.get(pk=payment.data["id"]).is_voided)
        logs = PledgeEditLog.objects.filter(payment_id=payment.data["id"])
        self.assertEqual(logs.count(), 2)

    def test_anonymous_pledge_api_is_blocked(self):
        self.client.force_authenticate(None)
        response = self.client.get(reverse("pledge-list"))
        self.assertEqual(response.status_code, 401)


class PledgePaperMigrationTests(TransactionTestCase):
    migrate_from = ("pledges", "0004_remove_pledge_due_date_pledgeeditlog_effective_date_and_more")
    migrate_to = ("pledges", "0005_pledge_paper_form_fields")

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        executor.migrate([self.migrate_from])
        old_apps = executor.loader.project_state([self.migrate_from]).apps
        BusinessSource = old_apps.get_model("accounts", "BusinessSource")
        Customer = old_apps.get_model("accounts", "Customer")
        Pledge = old_apps.get_model("pledges", "Pledge")
        PledgeItem = old_apps.get_model("pledges", "PledgeItem")

        source = BusinessSource.objects.create(
            name="Migration source",
            source_type="INDIVIDUAL",
            phone="9812345678",
            address="Old Road",
        )
        customer = Customer.objects.create(name="Migration customer", business_source=source)
        pledge = Pledge.objects.create(
            customer=customer,
            business_source=source,
            pledge_date=date(2026, 1, 1),
            principal_amount=Decimal("1000.00"),
            upfront_percent=Decimal("2.00"),
            upfront_days=30,
            daily_percent=Decimal("2.00"),
            daily_divisor=30,
        )
        self.pledge_id = pledge.pk
        self.item_id = PledgeItem.objects.create(
            pledge=pledge,
            sequence=1,
            description="Old gold item",
            weight_grams=Decimal("3.125"),
            quantity=1,
        ).pk

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()

    def test_existing_pledge_and_gram_weight_are_preserved(self):
        MigrationExecutor(connection).migrate([self.migrate_to])
        new_apps = MigrationExecutor(connection).loader.project_state([self.migrate_to]).apps
        Pledge = new_apps.get_model("pledges", "Pledge")
        PledgeItem = new_apps.get_model("pledges", "PledgeItem")
        pledge = Pledge.objects.get(pk=self.pledge_id)
        item = PledgeItem.objects.get(pk=self.item_id)

        self.assertEqual(pledge.customer_name, "Migration customer")
        self.assertEqual(pledge.address, "Old Road")
        self.assertEqual(pledge.phone, "9812345678")
        self.assertEqual(item.particulars, "Old gold item")
        self.assertEqual(item.weight, Decimal("3.125"))
        self.assertEqual(item.unit, "GRAM")
        self.assertEqual(item.jor, Decimal("1.000"))
