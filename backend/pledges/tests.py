from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
import uuid

from django.core.exceptions import ValidationError
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.urls import reverse
from django.test import TransactionTestCase
from rest_framework.test import APITestCase

from accounts.models import BusinessSource, Customer, User

from .bs_dates import ad_to_bs, bs_month_calendar, bs_to_ad
from .interest import calculate_pledge_interest, calculate_pledge_interest_breakdown
from .models import Pledge, PledgeEditLog, PledgeItem, PledgePayment, nepal_today
from .serializers import pledge_financial_summary


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

    def test_individual_same_day_principal_payment_charges_start_and_end_balances(self):
        pledge = self.pledge()
        start = pledge.pledge_date
        self.assertEqual(self.calc(pledge, start)["interest_earned"], Decimal("2000.00"))
        self.assertEqual(self.calc(pledge, start + timedelta(days=29))["interest_earned"], Decimal("2000.00"))
        self.assertEqual(self.calc(pledge, start + timedelta(days=30))["interest_earned"], Decimal("2066.67"))
        payment_date = start + timedelta(days=59)
        self.assertEqual(self.calc(pledge, payment_date)["interest_earned"], Decimal("4000.10"))
        payment = {
            "payment_date": payment_date,
            "interest_amount": Decimal("0.00"),
            "principal_amount": Decimal("50000.00"),
            "is_voided": False,
        }
        on_payment_day = self.calc(pledge, payment_date, [payment])
        self.assertEqual(on_payment_day["interest_earned"], Decimal("4033.43"))
        self.assertEqual(on_payment_day["outstanding_principal"], Decimal("50000.00"))
        self.assertEqual(self.calc(pledge, payment_date + timedelta(days=1), [payment])["interest_earned"], Decimal("4066.76"))
        self.assertEqual(self.calc(pledge, payment_date + timedelta(days=2), [payment])["interest_earned"], Decimal("4100.09"))

    def test_company_same_day_principal_payment_charges_both_balances(self):
        pledge = self.pledge(source_type="COMPANY")
        start = pledge.pledge_date
        payment_date = start + timedelta(days=59)
        payment = {
            "payment_date": payment_date,
            "interest_amount": Decimal("0.00"),
            "principal_amount": Decimal("50000.00"),
            "is_voided": False,
        }
        before = self.calc(pledge, payment_date)["interest_earned"]
        after = self.calc(pledge, payment_date, [payment])
        self.assertEqual(before, Decimal("4000.15"))
        self.assertEqual(after["interest_earned"], Decimal("4033.48"))
        self.assertEqual(self.calc(pledge, payment_date + timedelta(days=1), [payment])["interest_earned"], Decimal("4066.81"))
        self.assertEqual(self.calc(pledge, payment_date + timedelta(days=2), [payment])["interest_earned"], Decimal("4100.14"))
        self.assertEqual(after["outstanding_principal"], Decimal("50000.00"))

    def test_dynamic_same_day_principal_payment_uses_copied_dynamic_terms(self):
        pledge = self.pledge(
            source_type="DYNAMIC",
            upfront_percent="2.00",
            upfront_days=30,
            daily_percent="2.00",
            daily_divisor=30,
        )
        start = pledge.pledge_date
        payment_date = start + timedelta(days=59)
        payment = {
            "payment_date": payment_date,
            "interest_amount": Decimal("0.00"),
            "principal_amount": Decimal("50000.00"),
            "is_voided": False,
        }
        before = self.calc(pledge, payment_date)["interest_earned"]
        after = self.calc(pledge, payment_date, [payment])
        self.assertEqual(before, Decimal("4000.10"))
        self.assertEqual(after["interest_earned"], Decimal("4033.43"))
        self.assertEqual(self.calc(pledge, payment_date + timedelta(days=1), [payment])["interest_earned"], Decimal("4066.76"))
        self.assertEqual(self.calc(pledge, payment_date + timedelta(days=2), [payment])["interest_earned"], Decimal("4100.09"))
        self.assertEqual(after["outstanding_principal"], Decimal("50000.00"))

    def test_breakdown_overlaps_payment_day_and_marks_new_balance(self):
        pledge = self.pledge()
        start = pledge.pledge_date
        payment = {
            "payment_date": start + timedelta(days=59),
            "interest_amount": Decimal("0.00"),
            "principal_amount": Decimal("50000.00"),
            "is_voided": False,
        }
        rows = calculate_pledge_interest_breakdown(
            pledge, [payment], [], start + timedelta(days=61),
        )
        self.assertEqual(
            [(row["kind"], row["start_date"], row["end_date"], row["days"], row["principal_used"], row["interest"]) for row in rows],
            [
                ("UPFRONT", start, start + timedelta(days=29), 30, Decimal("100000.00"), Decimal("2000.00")),
                ("DAILY", start + timedelta(days=30), start + timedelta(days=59), 30, Decimal("100000.00"), Decimal("2000.10")),
                ("PRINCIPAL_PAYMENT", start + timedelta(days=59), start + timedelta(days=59), 0, Decimal("50000.00"), Decimal("0.00")),
                ("DAILY", start + timedelta(days=59), start + timedelta(days=61), 3, Decimal("50000.00"), Decimal("99.99")),
            ],
        )
        marker = rows[2]
        self.assertEqual(marker["payment_amount"], Decimal("50000.00"))
        self.assertEqual(marker["new_principal"], Decimal("50000.00"))
        self.assertEqual(rows[0]["interest"] + rows[1]["interest"], Decimal("4000.10"))
        self.assertEqual(sum(row["interest"] for row in rows), Decimal("4100.09"))

    def test_multiple_different_day_principal_payments_overlap_each_payment_date(self):
        pledge = self.pledge()
        start = pledge.pledge_date
        payments = [
            {
                "payment_date": start + timedelta(days=59),
                "interest_amount": Decimal("0.00"),
                "principal_amount": Decimal("50000.00"),
                "is_voided": False,
            },
            {
                "payment_date": start + timedelta(days=69),
                "interest_amount": Decimal("0.00"),
                "principal_amount": Decimal("10000.00"),
                "is_voided": False,
            },
        ]
        rows = calculate_pledge_interest_breakdown(
            pledge, payments, [], start + timedelta(days=70),
        )
        daily = [row for row in rows if row["kind"] == "DAILY"]
        self.assertEqual([(row["start_date"], row["end_date"], row["principal_used"]) for row in daily], [
            (start + timedelta(days=30), start + timedelta(days=59), Decimal("100000.00")),
            (start + timedelta(days=59), start + timedelta(days=69), Decimal("50000.00")),
            (start + timedelta(days=69), start + timedelta(days=70), Decimal("40000.00")),
        ])

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

    def test_same_day_principal_payments_charge_opening_and_final_balance_once(self):
        pledge = self.pledge()
        start = pledge.pledge_date
        payment_date = start + timedelta(days=59)
        payments = [
            {"payment_date": payment_date, "interest_amount": Decimal("0.00"), "principal_amount": Decimal("20000.00"), "is_voided": False},
            {"payment_date": payment_date, "interest_amount": Decimal("0.00"), "principal_amount": Decimal("30000.00"), "is_voided": False},
        ]
        result = self.calc(pledge, payment_date, payments)
        self.assertEqual(result["interest_earned"], Decimal("4033.43"))
        self.assertEqual(result["outstanding_principal"], Decimal("50000.00"))
        markers = [
            row for row in calculate_pledge_interest_breakdown(pledge, payments, [], payment_date)
            if row["kind"] == "PRINCIPAL_PAYMENT"
        ]
        self.assertEqual(len(markers), 1)
        self.assertEqual(markers[0]["payment_amount"], Decimal("50000.00"))
        self.assertEqual(markers[0]["new_principal"], Decimal("50000.00"))

    def test_payment_that_clears_principal_charges_only_start_balance_today(self):
        pledge = self.pledge()
        payment_date = pledge.pledge_date + timedelta(days=59)
        payment = {
            "payment_date": payment_date,
            "interest_amount": Decimal("0.00"),
            "principal_amount": Decimal("100000.00"),
            "is_voided": False,
        }
        on_payment_day = self.calc(pledge, payment_date, [payment])
        next_day = self.calc(pledge, payment_date + timedelta(days=1), [payment])
        self.assertEqual(on_payment_day["interest_earned"], Decimal("4000.10"))
        self.assertEqual(on_payment_day["outstanding_principal"], Decimal("0.00"))
        self.assertEqual(next_day["interest_earned"], Decimal("4000.10"))

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

    def test_breakdown_shows_paused_period_when_forfeited_and_reopened(self):
        pledge = self.pledge()
        start = pledge.pledge_date
        logs = [
            {"field": "status", "old_value": "ACTIVE", "new_value": "FORFEITED", "effective_date": start + timedelta(days=59), "id": 1},
            {"field": "status", "old_value": "FORFEITED", "new_value": "ACTIVE", "effective_date": start + timedelta(days=99), "id": 2},
        ]
        rows = calculate_pledge_interest_breakdown(
            pledge, [], logs, start + timedelta(days=120),
        )
        self.assertEqual(
            [(row["kind"], row["days"], row["interest"]) for row in rows[1:]],
            [
                ("DAILY", 30, Decimal("2000.10")),
                ("PAUSED", 39, Decimal("0.00")),
                ("DAILY", 22, Decimal("1466.74")),
            ],
        )

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
            type=PledgePayment.Type.PRINCIPAL,
            amount="100.00",
            recorded_by=self.cashier,
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
            type=PledgePayment.Type.PRINCIPAL,
            amount="100.00",
            recorded_by=self.cashier,
        )
        self.assertEqual(self.client.get(detail).data["status_label"], "Partially Paid")
        self.client.force_authenticate(self.staff)
        locked = self.client.patch(detail, {"principal_amount": "80000.00", "reason": "Another change"}, format="json")
        self.assertEqual(locked.status_code, 400, locked.data)
        pledge.refresh_from_db()
        self.assertEqual(pledge.principal_amount, Decimal("90000.00"))

    def test_individual_due_amounts_and_interest_payment_match_day_121_and_151(self):
        start = nepal_today() - timedelta(days=150)
        created = self.create_pledge(pledge_date=ad_to_bs(start))
        self.assertEqual(created.status_code, 201, created.data)
        pledge_id = created.data["id"]
        payment_url = reverse("pledge-payment-list", args=[pledge_id])
        due_url = reverse("pledge-payment-due", args=[pledge_id])
        day_121 = start + timedelta(days=120)
        day_151 = start + timedelta(days=150)

        due_on_day_121 = self.client.get(due_url, {"as_of": ad_to_bs(day_121)})
        self.assertEqual(due_on_day_121.status_code, 200, due_on_day_121.data)
        self.assertEqual(due_on_day_121.data["principal_due"], "100000.00")
        self.assertEqual(due_on_day_121.data["interest_due"], "8066.97")

        principal_payment = self.client.post(payment_url, {
            "payment_date": ad_to_bs(day_121),
            "type": PledgePayment.Type.PRINCIPAL,
            "amount": "50000.00",
        }, format="json")
        self.assertEqual(principal_payment.status_code, 201, principal_payment.data)
        self.assertEqual(principal_payment.data["payment_date"], ad_to_bs(day_121))
        self.assertEqual(principal_payment.data["due_before"], "100000.00")
        self.assertEqual(principal_payment.data["remaining_after"], "50000.00")

        due_on_day_151 = self.client.get(due_url, {"as_of": ad_to_bs(day_151)})
        self.assertEqual(due_on_day_151.status_code, 200, due_on_day_151.data)
        self.assertEqual(due_on_day_151.data["interest_due"], "9100.20")

        interest_payment = self.client.post(payment_url, {
            "payment_date": ad_to_bs(day_151),
            "type": PledgePayment.Type.INTEREST,
            "amount": "8066.97",
        }, format="json")
        self.assertEqual(interest_payment.status_code, 201, interest_payment.data)
        self.assertEqual(interest_payment.data["due_before"], "9100.20")
        self.assertEqual(interest_payment.data["remaining_after"], "1033.23")
        self.assertEqual(interest_payment.data["recorded_by"], self.cashier.name)

        pledge = self.client.get(reverse("pledge-detail", args=[pledge_id]))
        self.assertEqual(pledge.status_code, 200, pledge.data)
        self.assertEqual(pledge.data["calculation"]["outstanding_principal"], "50000.00")
        self.assertEqual(pledge.data["calculation"]["unpaid_interest"], "1033.23")
        self.assertEqual(pledge.data["calculation"]["total_outstanding"], "51033.23")

    def test_pledge_summary_endpoint_returns_day_151_example_and_breakdown(self):
        start = nepal_today() - timedelta(days=150)
        created = self.create_pledge(pledge_date=ad_to_bs(start))
        pledge = Pledge.objects.get(pk=created.data["id"])
        PledgePayment.objects.create(
            pledge=pledge,
            payment_date=start + timedelta(days=120),
            type=PledgePayment.Type.PRINCIPAL,
            amount="50000.00",
            recorded_by=self.cashier,
        )

        response = self.client.get(reverse("pledge-financial-summary", args=[pledge.pk]))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["as_of"], ad_to_bs(nepal_today()))
        self.assertEqual(response.data["summary"]["principal"], {
            "total": "100000.00", "paid": "50000.00", "due": "50000.00",
        })
        self.assertEqual(response.data["summary"]["interest"], {
            "total": "9100.20", "paid": "0.00", "due": "9100.20",
        })
        self.assertEqual(response.data["summary"]["total"], {
            "total": "109100.20", "paid": "50000.00", "due": "59100.20",
        })
        self.assertEqual(
            [(row["kind"], row["days"], row["interest"]) for row in response.data["interest_breakdown"]],
            [
                ("UPFRONT", 30, "2000.00"),
                ("DAILY", 91, "6066.97"),
                ("PRINCIPAL_PAYMENT", 0, "0.00"),
                ("DAILY", 31, "1033.23"),
            ],
        )
        self.assertEqual(response.data["interest_breakdown"][2]["payment_amount"], "50000.00")
        self.assertEqual(response.data["interest_breakdown"][2]["new_principal"], "50000.00")

    def test_summary_applies_principal_payment_immediately_on_payment_date(self):
        created = self.create_pledge(pledge_date=ad_to_bs(nepal_today() - timedelta(days=2)))
        self.assertEqual(created.status_code, 201, created.data)
        pledge = Pledge.objects.get(pk=created.data["id"])
        PledgePayment.objects.create(
            pledge=pledge,
            payment_date=nepal_today(),
            type=PledgePayment.Type.PRINCIPAL,
            amount="50000.00",
            recorded_by=self.cashier,
        )

        same_day_summary = pledge_financial_summary(pledge, nepal_today(), include_breakdown=False)["summary"]
        self.assertEqual(same_day_summary["principal"], {
            "total": "100000.00", "paid": "50000.00", "due": "50000.00",
        })

    def test_same_day_principal_and_interest_payment_match_requested_summary(self):
        start = nepal_today() - timedelta(days=117)
        created = self.create_pledge(pledge_date=ad_to_bs(start))
        self.assertEqual(created.status_code, 201, created.data)
        payment_url = reverse("pledge-payment-list", args=[created.data["id"]])
        principal_payment = self.client.post(payment_url, {
            "payment_date": ad_to_bs(nepal_today()),
            "type": PledgePayment.Type.PRINCIPAL,
            "amount": "50000.00",
        }, format="json")
        self.assertEqual(principal_payment.status_code, 201, principal_payment.data)
        interest_payment = self.client.post(payment_url, {
            "payment_date": ad_to_bs(nepal_today()),
            "type": PledgePayment.Type.INTEREST,
            "amount": "5000.00",
        }, format="json")
        self.assertEqual(interest_payment.status_code, 201, interest_payment.data)

        pledge = Pledge.objects.get(pk=created.data["id"])
        summary = pledge_financial_summary(pledge, nepal_today(), include_breakdown=False)["summary"]
        self.assertEqual(summary["principal"], {
            "total": "100000.00", "paid": "50000.00", "due": "50000.00",
        })
        self.assertEqual(summary["interest"], {
            "total": "7900.29", "paid": "5000.00", "due": "2900.29",
        })
        self.assertEqual(summary["total"], {
            "total": "107900.29", "paid": "55000.00", "due": "52900.29",
        })

    def test_business_source_summary_aggregates_multiple_pledges(self):
        start = nepal_today() - timedelta(days=150)
        first = self.create_pledge(pledge_date=ad_to_bs(start))
        second = self.create_pledge()
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)
        pledge = Pledge.objects.get(pk=first.data["id"])
        PledgePayment.objects.create(
            pledge=pledge,
            payment_date=start + timedelta(days=120),
            type=PledgePayment.Type.PRINCIPAL,
            amount="50000.00",
            recorded_by=self.cashier,
        )

        response = self.client.get(reverse("business-source-pledge-summary", args=[self.source.pk]))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["summary"]["principal"], {
            "total": "200000.00", "paid": "50000.00", "due": "150000.00",
        })
        self.assertEqual(response.data["summary"]["interest"], {
            "total": "11100.20", "paid": "0.00", "due": "11100.20",
        })
        self.assertEqual(response.data["summary"]["total"], {
            "total": "211100.20", "paid": "50000.00", "due": "161100.20",
        })

    def test_payment_above_due_and_future_date_are_rejected(self):
        start = nepal_today() - timedelta(days=2)
        created = self.create_pledge(pledge_date=ad_to_bs(start))
        payment_url = reverse("pledge-payment-list", args=[created.data["id"]])
        too_much = self.client.post(payment_url, {
            "payment_date": ad_to_bs(nepal_today()),
            "type": PledgePayment.Type.INTEREST,
            "amount": "2000.01",
        }, format="json")
        self.assertEqual(too_much.status_code, 400, too_much.data)
        self.assertEqual(PledgePayment.objects.filter(pledge_id=created.data["id"]).count(), 0)

        future = nepal_today() + timedelta(days=1)
        future_payment = self.client.post(payment_url, {
            "payment_date": ad_to_bs(future),
            "type": PledgePayment.Type.INTEREST,
            "amount": "1.00",
        }, format="json")
        self.assertEqual(future_payment.status_code, 400, future_payment.data)
        self.assertIn("payment_date", future_payment.data)

        before_pledge = self.client.post(payment_url, {
            "payment_date": ad_to_bs(start - timedelta(days=1)),
            "type": PledgePayment.Type.PRINCIPAL,
            "amount": "1.00",
        }, format="json")
        self.assertEqual(before_pledge.status_code, 400, before_pledge.data)

    def test_new_payment_cannot_precede_latest_and_same_day_payments_are_ordered(self):
        start = nepal_today() - timedelta(days=5)
        created = self.create_pledge(pledge_date=ad_to_bs(start))
        pledge_id = created.data["id"]
        payment_url = reverse("pledge-payment-list", args=[pledge_id])
        today_bs = ad_to_bs(nepal_today())

        first = self.client.post(payment_url, {
            "payment_date": today_bs,
            "type": PledgePayment.Type.PRINCIPAL,
            "amount": "50000.00",
        }, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        second = self.client.post(payment_url, {
            "payment_date": today_bs,
            "type": PledgePayment.Type.PRINCIPAL,
            "amount": "50000.00",
        }, format="json")
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(second.data["due_before"], "50000.00")
        self.assertEqual(second.data["remaining_after"], "0.00")

        due_url = reverse("pledge-payment-due", args=[pledge_id])
        due_before_first = self.client.get(due_url, {
            "as_of": today_bs,
            "payment_id": first.data["id"],
        })
        self.assertEqual(due_before_first.status_code, 200, due_before_first.data)
        self.assertEqual(due_before_first.data["principal_due"], "100000.00")
        due_before_second = self.client.get(due_url, {
            "as_of": today_bs,
            "payment_id": second.data["id"],
        })
        self.assertEqual(due_before_second.status_code, 200, due_before_second.data)
        self.assertEqual(due_before_second.data["principal_due"], "50000.00")

        history = self.client.get(payment_url)
        self.assertEqual(history.status_code, 200, history.data)
        self.assertEqual([row["id"] for row in history.data], [first.data["id"], second.data["id"]])
        self.assertLessEqual(first.data["recorded_at"], second.data["recorded_at"])

        earlier = self.client.post(payment_url, {
            "payment_date": ad_to_bs(nepal_today() - timedelta(days=1)),
            "type": PledgePayment.Type.INTEREST,
            "amount": "1.00",
        }, format="json")
        self.assertEqual(earlier.status_code, 400, earlier.data)
        self.assertIn("latest existing payment", str(earlier.data))

    def test_staff_edits_are_logged_and_non_staff_edits_are_rejected(self):
        start = nepal_today() - timedelta(days=10)
        created = self.create_pledge(pledge_date=ad_to_bs(start))
        payment = self.client.post(reverse("pledge-payment-list", args=[created.data["id"]]), {
            "payment_date": ad_to_bs(start + timedelta(days=1)),
            "type": PledgePayment.Type.INTEREST,
            "amount": "100.00",
        }, format="json")
        self.assertEqual(payment.status_code, 201, payment.data)
        edit_url = reverse("pledge-payment-detail", args=[payment.data["id"]])
        values = {
            "payment_date": ad_to_bs(start + timedelta(days=2)),
            "amount": "150.00",
            "reason": "Correct amount and date",
        }
        self.assertEqual(self.client.patch(edit_url, values, format="json").status_code, 403)

        self.client.force_authenticate(self.staff)
        edited = self.client.patch(edit_url, values, format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.data["payment_date"], ad_to_bs(start + timedelta(days=2)))
        self.assertEqual(edited.data["amount"], "150.00")
        logs = list(PledgeEditLog.objects.filter(payment_id=payment.data["id"]).order_by("field"))
        self.assertEqual({log.field for log in logs}, {"amount", "payment_date"})
        self.assertEqual({log.reason for log in logs}, {"Correct amount and date"})
        self.assertEqual({log.changed_by for log in logs}, {self.staff})
        self.assertEqual(len({log.edit_id for log in logs}), 1)

    def test_edit_date_is_bounded_by_neighboring_payment_dates(self):
        start = nepal_today() - timedelta(days=10)
        created = self.create_pledge(pledge_date=ad_to_bs(start))
        payment_url = reverse("pledge-payment-list", args=[created.data["id"]])
        first = self.client.post(payment_url, {
            "payment_date": ad_to_bs(start + timedelta(days=1)),
            "type": PledgePayment.Type.INTEREST,
            "amount": "100.00",
        }, format="json")
        second = self.client.post(payment_url, {
            "payment_date": ad_to_bs(start + timedelta(days=3)),
            "type": PledgePayment.Type.INTEREST,
            "amount": "100.00",
        }, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)

        self.client.force_authenticate(self.staff)
        edit_first = reverse("pledge-payment-detail", args=[first.data["id"]])
        within_bounds = self.client.patch(edit_first, {
            "payment_date": ad_to_bs(start + timedelta(days=2)),
            "reason": "Move within order",
        }, format="json")
        self.assertEqual(within_bounds.status_code, 200, within_bounds.data)

        edit_second = reverse("pledge-payment-detail", args=[second.data["id"]])
        before_previous = self.client.patch(edit_second, {
            "payment_date": ad_to_bs(start + timedelta(days=1)),
            "reason": "Move before prior",
        }, format="json")
        self.assertEqual(before_previous.status_code, 400, before_previous.data)

    def test_edit_amount_that_invalidates_later_payment_is_rejected(self):
        start = nepal_today() - timedelta(days=10)
        created = self.create_pledge(pledge_date=ad_to_bs(start))
        payment_url = reverse("pledge-payment-list", args=[created.data["id"]])
        first = self.client.post(payment_url, {
            "payment_date": ad_to_bs(start + timedelta(days=1)),
            "type": PledgePayment.Type.INTEREST,
            "amount": "1500.00",
        }, format="json")
        later = self.client.post(payment_url, {
            "payment_date": ad_to_bs(start + timedelta(days=3)),
            "type": PledgePayment.Type.INTEREST,
            "amount": "400.00",
        }, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(later.status_code, 201, later.data)

        self.client.force_authenticate(self.staff)
        edit_url = reverse("pledge-payment-detail", args=[first.data["id"]])
        response = self.client.patch(edit_url, {
            "amount": "1800.00",
            "reason": "Increase first payment",
        }, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn(f"Payment #{later.data['id']}", str(response.data))
        self.assertEqual(PledgePayment.objects.get(pk=first.data["id"]).amount, Decimal("1500.00"))

    def test_payment_due_endpoint_reports_zero_after_full_payment(self):
        created = self.create_pledge(pledge_date=ad_to_bs(nepal_today() - timedelta(days=2)))
        pledge_id = created.data["id"]
        payment_url = reverse("pledge-payment-list", args=[pledge_id])
        day = nepal_today()
        for payment_type, amount in (
            (PledgePayment.Type.PRINCIPAL, "100000.00"),
            (PledgePayment.Type.INTEREST, "2000.00"),
        ):
            response = self.client.post(payment_url, {
                "payment_date": ad_to_bs(day),
                "type": payment_type,
                "amount": amount,
            }, format="json")
            self.assertEqual(response.status_code, 201, response.data)
        due = self.client.get(reverse("pledge-payment-due", args=[pledge_id]), {"as_of": ad_to_bs(day)})
        self.assertEqual(due.status_code, 200, due.data)
        self.assertEqual(due.data["principal_due"], "0.00")
        self.assertEqual(due.data["interest_due"], "0.00")

    def test_voided_legacy_payments_remain_hidden_but_keep_pledge_edit_locked(self):
        created = self.create_pledge(pledge_date=ad_to_bs(nepal_today() - timedelta(days=2)))
        pledge = Pledge.objects.get(pk=created.data["id"])
        PledgePayment.objects.create(
            pledge=pledge,
            payment_date=nepal_today(),
            type=PledgePayment.Type.PRINCIPAL,
            amount="100.00",
            recorded_by=self.cashier,
            is_voided=True,
        )

        detail_url = reverse("pledge-detail", args=[pledge.pk])
        detail = self.client.get(detail_url)
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertTrue(detail.data["has_payments"])
        self.assertEqual(detail.data["payments"], [])

        self.client.force_authenticate(self.staff)
        edited = self.client.patch(detail_url, {
            "principal_amount": "90000.00",
            "reason": "Legacy payment lock",
        }, format="json")
        self.assertEqual(edited.status_code, 400, edited.data)

    def test_payment_on_forfeited_or_closed_date_is_rejected(self):
        start = nepal_today() - timedelta(days=10)
        created = self.create_pledge(pledge_date=ad_to_bs(start))
        pledge = Pledge.objects.get(pk=created.data["id"])
        inactive_start = start + timedelta(days=3)
        reopen_date = start + timedelta(days=6)
        PledgeEditLog.objects.create(
            pledge=pledge,
            edit_id=uuid.uuid4(),
            field="status",
            old_value=Pledge.Status.ACTIVE,
            new_value=Pledge.Status.FORFEITED,
            effective_date=inactive_start,
            changed_by=self.staff,
            reason="Forfeit for test",
        )
        PledgeEditLog.objects.create(
            pledge=pledge,
            edit_id=uuid.uuid4(),
            field="status",
            old_value=Pledge.Status.FORFEITED,
            new_value=Pledge.Status.ACTIVE,
            effective_date=reopen_date,
            changed_by=self.admin,
            reason="Reopen for test",
        )
        response = self.client.post(reverse("pledge-payment-list", args=[pledge.pk]), {
            "payment_date": ad_to_bs(inactive_start + timedelta(days=1)),
            "type": PledgePayment.Type.INTEREST,
            "amount": "1.00",
        }, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("Active", str(response.data))


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
            type=PledgePayment.Type.PRINCIPAL,
            amount="100000.00",
            recorded_by=self.cashier,
        )
        PledgePayment.objects.create(
            pledge=pledge,
            payment_date=nepal_today() - timedelta(days=1),
            type=PledgePayment.Type.INTEREST,
            amount="2000.00",
            recorded_by=self.cashier,
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
            "payment_date": ad_to_bs(nepal_today()),
            "type": PledgePayment.Type.PRINCIPAL,
            "amount": "1.00",
        }, format="json")
        self.assertEqual(blocked.status_code, 400)

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


class PledgePaymentMigrationTests(TransactionTestCase):
    migrate_from = ("pledges", "0005_pledge_paper_form_fields")
    migrate_to = ("pledges", "0006_pledge_payment_single_amount")

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        executor.migrate([self.migrate_from])
        old_apps = executor.loader.project_state([self.migrate_from]).apps
        BusinessSource = old_apps.get_model("accounts", "BusinessSource")
        Customer = old_apps.get_model("accounts", "Customer")
        Pledge = old_apps.get_model("pledges", "Pledge")
        PledgePayment = old_apps.get_model("pledges", "PledgePayment")
        PledgeEditLog = old_apps.get_model("pledges", "PledgeEditLog")

        user = User.objects.create_user(
            email="migration@example.com",
            name="Migration User",
            password="migration-test-password",
        )
        source = BusinessSource.objects.create(
            name="Migration payment source",
            source_type="INDIVIDUAL",
            phone="9812345678",
            address="Old Road",
        )
        customer = Customer.objects.create(name="Migration payment customer", business_source=source)
        pledge = Pledge.objects.create(
            customer=customer,
            business_source=source,
            pledge_date=date(2026, 1, 1),
            principal_amount=Decimal("1000.00"),
            upfront_percent=Decimal("2.00"),
            upfront_days=30,
            daily_percent=Decimal("2.00"),
            daily_divisor=30,
            customer_name=customer.name,
            address=source.address,
            phone=source.phone,
        )
        payment = PledgePayment.objects.create(
            pledge=pledge,
            payment_date=date(2026, 1, 2),
            interest_amount=Decimal("100.00"),
            principal_amount=Decimal("500.00"),
            is_voided=True,
            created_by_id=user.pk,
        )
        self.payment_id = payment.pk
        self.created_at = payment.created_at
        self.user_id = user.pk
        self.pledge_id = pledge.pk
        edit_id = uuid.uuid4()
        for field, old_value, new_value in (
            ("principal_amount", "400.00", "500.00"),
            ("interest_amount", "50.00", "100.00"),
            ("payment_date", "2026-01-01", "2026-01-02"),
        ):
            PledgeEditLog.objects.create(
                pledge=pledge,
                payment=payment,
                edit_id=edit_id,
                field=field,
                old_value=old_value,
                new_value=new_value,
                effective_date=date(2026, 1, 2),
                changed_by_id=user.pk,
                reason="Legacy payment correction",
            )

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()

    def test_mixed_legacy_payment_is_split_without_losing_history(self):
        MigrationExecutor(connection).migrate([self.migrate_to])
        new_apps = MigrationExecutor(connection).loader.project_state([self.migrate_to]).apps
        PledgePayment = new_apps.get_model("pledges", "PledgePayment")
        PledgeEditLog = new_apps.get_model("pledges", "PledgeEditLog")
        payments = list(PledgePayment.objects.filter(pledge_id=self.pledge_id).order_by("id"))

        self.assertEqual(len(payments), 2)
        by_type = {payment.type: payment for payment in payments}
        self.assertEqual(by_type["PRINCIPAL"].id, self.payment_id)
        self.assertEqual(by_type["PRINCIPAL"].amount, Decimal("500.00"))
        self.assertEqual(by_type["INTEREST"].amount, Decimal("100.00"))
        for payment in payments:
            self.assertTrue(payment.is_voided)
            self.assertEqual(payment.recorded_by_id, self.user_id)
            self.assertEqual(payment.recorded_at, self.created_at)

        logs = list(PledgeEditLog.objects.filter(pledge_id=self.pledge_id))
        self.assertEqual(len(logs), 4)
        principal_logs = [log for log in logs if log.payment_id == by_type["PRINCIPAL"].id]
        interest_logs = [log for log in logs if log.payment_id == by_type["INTEREST"].id]
        self.assertEqual({log.field for log in principal_logs}, {"amount", "payment_date"})
        self.assertEqual({log.field for log in interest_logs}, {"amount", "payment_date"})

        executor = MigrationExecutor(connection)
        executor.migrate([self.migrate_from])
        old_apps = executor.loader.project_state([self.migrate_from]).apps
        OldPayment = old_apps.get_model("pledges", "PledgePayment")
        restored = list(OldPayment.objects.filter(pledge_id=self.pledge_id))
        self.assertEqual(len(restored), 2)
        self.assertEqual(
            sum((item.principal_amount + item.interest_amount for item in restored), Decimal("0.00")),
            Decimal("600.00"),
        )
