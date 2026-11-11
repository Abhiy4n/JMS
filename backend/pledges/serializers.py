import json
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from accounts.models import BusinessSource, Customer

from .bs_dates import BSDateField, ad_to_bs
from .interest import calculate_pledge_interest, calculate_pledge_interest_breakdown
from .models import (
    Pledge,
    PledgeEditLog,
    PledgeItem,
    PledgePayment,
    nepal_today,
    record_pledge_changes,
)


class PledgeItemSerializer(serializers.ModelSerializer):
    weight = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0.001"))
    unit = serializers.ChoiceField(choices=PledgeItem.Unit.choices)
    ghat = serializers.CharField(required=False, allow_blank=True)
    jor = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0.001"))

    class Meta:
        model = PledgeItem
        fields = ("id", "sequence", "particulars", "weight", "unit", "ghat", "jor")
        read_only_fields = ("id", "sequence")


class PledgePaymentOutputSerializer(serializers.ModelSerializer):
    payment_date = BSDateField(read_only=True)
    recorded_by = serializers.CharField(source="recorded_by.name", read_only=True)
    due_before = serializers.SerializerMethodField()
    remaining_after = serializers.SerializerMethodField()
    edit_history = serializers.SerializerMethodField()

    class Meta:
        model = PledgePayment
        fields = (
            "id", "payment_date", "type", "amount", "due_before", "remaining_after",
            "recorded_by", "recorded_at", "is_voided", "edit_history",
        )
        read_only_fields = fields

    def get_due_before(self, obj):
        earlier = [
            payment for payment in self.context["payment_history"]
            if _payment_order_key(payment) < _payment_order_key(obj)
        ]
        same_day_principal = [
            payment for payment in self.context["payment_history"]
            if payment.type == PledgePayment.Type.PRINCIPAL
            and payment.payment_date == obj.payment_date
        ]
        return str(payment_due_amount(
            obj.pledge,
            obj.type,
            obj.payment_date,
            earlier,
            list(obj.pledge.edit_logs.all()),
            same_day_principal_payments=same_day_principal,
        ))

    def get_remaining_after(self, obj):
        return str(Decimal(self.get_due_before(obj)) - obj.amount)

    def get_edit_history(self, obj):
        return [
            {
                "id": log.id,
                "edit_id": str(log.edit_id),
                "field": log.field,
                "old_value": log.old_value,
                "new_value": log.new_value,
                "changed_by": log.changed_by.name if log.changed_by else "",
                "changed_at": log.changed_at,
                "reason": log.reason,
            }
            for log in obj.edit_logs.select_related("changed_by").order_by("changed_at", "id")
        ]


class PledgeEditLogSerializer(serializers.ModelSerializer):
    effective_date = BSDateField(read_only=True, allow_null=True)

    class Meta:
        model = PledgeEditLog
        fields = ("id", "edit_id", "field", "old_value", "new_value", "effective_date", "changed_by", "changed_at", "reason")
        read_only_fields = fields


def _payment_order_key(payment):
    return payment.payment_date, payment.recorded_at, payment.id


def _active_payments(payments):
    return sorted(
        (payment for payment in payments if not payment.is_voided),
        key=_payment_order_key,
    )


def interest_payment_rows(payments):
    return [
        {
            "id": payment.id,
            "payment_date": payment.payment_date,
            "interest_amount": payment.amount if payment.type == PledgePayment.Type.INTEREST else Decimal("0.00"),
            "principal_amount": payment.amount if payment.type == PledgePayment.Type.PRINCIPAL else Decimal("0.00"),
            "is_voided": payment.is_voided,
        }
        for payment in payments
    ]


def _money(value):
    return format(Decimal(value).quantize(Decimal("0.01")), ".2f")


def _validate_summary(summary):
    principal = summary["principal"]
    interest = summary["interest"]
    total = summary["total"]
    if total["total"] != principal["total"] + interest["total"]:
        raise AssertionError("Summary total must equal principal plus interest.")
    if total["paid"] != principal["paid"] + interest["paid"]:
        raise AssertionError("Summary paid must equal principal paid plus interest paid.")
    if total["due"] != principal["due"] + interest["due"]:
        raise AssertionError("Summary due must equal principal due plus interest due.")
    if total["due"] != total["total"] - total["paid"]:
        raise AssertionError("Summary due must equal total less paid.")
    for row in (principal, interest, total):
        if row["due"] != row["total"] - row["paid"]:
            raise AssertionError("Each summary due must equal total less paid.")


def pledge_financial_summary(pledge, as_of, *, include_breakdown=True):
    payments = list(pledge.payments.all())
    edit_logs = list(pledge.edit_logs.all())
    calculation = calculate_pledge_interest(
        pledge,
        interest_payment_rows(payments),
        edit_logs,
        as_of,
    )
    principal_total = Decimal(pledge.principal_amount)
    # Principal balance reflects payments on their payment date.
    principal_paid = principal_total - calculation["outstanding_principal"]
    interest_total = calculation["interest_earned"]
    interest_paid = calculation["interest_paid"]
    summary = {
        "principal": {
            "total": principal_total,
            "paid": principal_paid,
            "due": calculation["outstanding_principal"],
        },
        "interest": {
            "total": interest_total,
            "paid": interest_paid,
            "due": calculation["unpaid_interest"],
        },
        "total": {
            "total": principal_total + interest_total,
            "paid": principal_paid + interest_paid,
            "due": calculation["total_outstanding"],
        },
    }
    _validate_summary(summary)
    result = {
        "summary": {
            row_name: {column: _money(value) for column, value in row.items()}
            for row_name, row in summary.items()
        },
    }
    if include_breakdown:
        result["interest_breakdown"] = []
        for row in calculate_pledge_interest_breakdown(
            pledge,
            interest_payment_rows(payments),
            edit_logs,
            as_of,
        ):
            output_row = {
                **row,
                "start_date": ad_to_bs(row["start_date"]),
                "end_date": ad_to_bs(row["end_date"]),
                "principal_used": _money(row["principal_used"]),
                "interest": _money(row["interest"]),
            }
            if "payment_amount" in output_row:
                output_row["payment_amount"] = _money(output_row["payment_amount"])
                output_row["new_principal"] = _money(output_row["new_principal"])
            result["interest_breakdown"].append(output_row)
    return result


def business_source_financial_summary(source_id, as_of):
    pledges = Pledge.objects.filter(business_source_id=source_id).prefetch_related(
        "payments", "edit_logs",
    )
    totals = {
        row_name: {column: Decimal("0.00") for column in ("total", "paid", "due")}
        for row_name in ("principal", "interest", "total")
    }
    for pledge in pledges:
        summary = pledge_financial_summary(pledge, as_of, include_breakdown=False)["summary"]
        for row_name, row in summary.items():
            for column, value in row.items():
                totals[row_name][column] += Decimal(value)
    _validate_summary(totals)
    return {
        "as_of": ad_to_bs(as_of),
        "summary": {
            row_name: {column: _money(value) for column, value in row.items()}
            for row_name, row in totals.items()
        },
    }


def payment_due_amount(
    pledge,
    payment_type,
    payment_date,
    prior_payments,
    edit_logs,
    *,
    same_day_principal_payments=(),
):
    prior_payments = [
        payment for payment in prior_payments
        if not payment.is_voided and payment.payment_date <= payment_date
    ]
    calculation_payments = list(prior_payments)
    if payment_type == PledgePayment.Type.INTEREST:
        known_ids = {payment.pk for payment in calculation_payments}
        calculation_payments.extend(
            payment for payment in same_day_principal_payments
            if payment.payment_date == payment_date and payment.pk not in known_ids
        )
    calculation = calculate_pledge_interest(
        pledge,
        interest_payment_rows(calculation_payments),
        edit_logs,
        payment_date,
    )
    if payment_type == PledgePayment.Type.INTEREST:
        return max(calculation["unpaid_interest"], Decimal("0.00"))

    return max(calculation["outstanding_principal"], Decimal("0.00"))


def payment_is_active_on(pledge, payment_date, edit_logs):
    events = []
    for log in edit_logs:
        if log.field != "status":
            continue
        effective = log.effective_date or (log.changed_at.date() if log.changed_at else None)
        if effective is not None:
            events.append((effective, log.changed_at, log.id, log.old_value, log.new_value))
    events.sort(key=lambda event: (event[0], event[1].isoformat() if event[1] else "", event[2]))
    current_status = events[0][3] if events else pledge.status
    for effective, _, _, _, new_status in events:
        if effective > payment_date:
            break
        current_status = new_status
    return current_status == Pledge.Status.ACTIVE


def validate_payment_history(pledge, payments, edit_logs, *, changed_payment_id=None):
    active = _active_payments(payments)
    accepted = []
    today = nepal_today()
    for payment in active:
        payment_date = payment.payment_date
        is_changed = payment.id == changed_payment_id
        field = "payment_date" if is_changed else "detail"
        if payment_date < pledge.pledge_date:
            raise serializers.ValidationError({field: f"Payment #{payment.id} cannot be dated before the pledge date."})
        if payment_date > today:
            raise serializers.ValidationError({field: f"Payment #{payment.id} cannot be dated in the future."})
        if not payment_is_active_on(pledge, payment_date, edit_logs):
            raise serializers.ValidationError({
                field: f"Payment #{payment.id} must fall on a date when the pledge was Active."
            })

        same_day_principal = [
            item for item in active
            if item.type == PledgePayment.Type.PRINCIPAL and item.payment_date == payment_date
        ]
        due = payment_due_amount(
            pledge,
            payment.type,
            payment_date,
            accepted,
            edit_logs,
            same_day_principal_payments=same_day_principal,
        )
        if payment.amount > due:
            field = "amount" if is_changed else "detail"
            raise serializers.ValidationError({
                field: f"Payment #{payment.id} exceeds the {payment.type.lower()} due on {ad_to_bs(payment_date)} ({due:.2f})."
            })
        accepted.append(payment)


def payment_history_representation(pledge):
    payments = list(
        pledge.payments.filter(is_voided=False)
        .select_related("recorded_by", "pledge")
        .prefetch_related("edit_logs__changed_by")
    )
    payments = _active_payments(payments)
    return PledgePaymentOutputSerializer(
        payments,
        many=True,
        context={"payment_history": payments},
    ).data


class PledgeFilterSerializer(serializers.Serializer):
    customer = serializers.IntegerField(required=False, min_value=1)
    business_source = serializers.IntegerField(required=False, min_value=1)
    status = serializers.ChoiceField(choices=Pledge.Status.choices, required=False)
    pledge_date = BSDateField(required=False)
    date_from = BSDateField(required=False)
    date_to = BSDateField(required=False)

    def validate_customer(self, value):
        if not Customer.objects.filter(pk=value).exists():
            raise serializers.ValidationError("Customer does not exist.")
        return value

    def validate_business_source(self, value):
        if not BusinessSource.objects.filter(pk=value).exists():
            raise serializers.ValidationError("Business Source does not exist.")
        return value

    def validate(self, attrs):
        if attrs.get("date_from") and attrs.get("date_to") and attrs["date_from"] > attrs["date_to"]:
            raise serializers.ValidationError({"date_to": "Must be on or after date_from."})
        return attrs


class PledgeSerializer(serializers.ModelSerializer):
    customer = serializers.PrimaryKeyRelatedField(queryset=Customer.objects.all())
    business_source_id = serializers.PrimaryKeyRelatedField(
        source="business_source",
        queryset=BusinessSource.objects.all(),
        required=False,
    )
    business_source_name = serializers.CharField(source="business_source.name", read_only=True)
    pledge_date = BSDateField(required=False)
    due_date = BSDateField(required=False, allow_null=True)
    written_text = serializers.CharField(required=False, allow_blank=True)
    customer_name = serializers.CharField(max_length=255, required=False)
    address = serializers.CharField(required=False, allow_blank=True)
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True)
    principal_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    upfront_percent = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=Decimal("0.00"),
        max_value=Decimal("100.00"), required=False,
    )
    upfront_days = serializers.IntegerField(min_value=0, required=False)
    daily_percent = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=Decimal("0.00"),
        max_value=Decimal("100.00"), required=False,
    )
    daily_divisor = serializers.IntegerField(min_value=1, required=False)
    items = PledgeItemSerializer(many=True, required=False, allow_empty=False)
    status_label = serializers.SerializerMethodField()
    calculation = serializers.SerializerMethodField()
    payments = serializers.SerializerMethodField()
    has_payments = serializers.SerializerMethodField()
    edit_log = PledgeEditLogSerializer(source="edit_logs", many=True, read_only=True)
    reason = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=500)

    class Meta:
        model = Pledge
        fields = (
            "id", "pledge_number", "customer", "customer_name", "business_source_id",
            "business_source_name", "pledge_date", "due_date", "written_text", "address",
            "phone", "principal_amount", "upfront_percent",
            "upfront_days", "daily_percent", "daily_divisor", "status", "status_label",
            "calculation", "payments", "has_payments", "edit_log", "items", "reason", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "pledge_number", "business_source_name", "status",
            "status_label", "calculation", "payments", "has_payments", "edit_log", "created_at", "updated_at",
        )

    def get_status_label(self, obj):
        if obj.status == Pledge.Status.ACTIVE and obj.is_partially_paid:
            return "Partially Paid"
        return obj.get_status_display()

    def get_calculation(self, obj):
        result = calculate_pledge_interest(
            obj,
            interest_payment_rows(list(obj.payments.all())),
            list(obj.edit_logs.all()),
            nepal_today(),
        )
        return {key: str(value) for key, value in result.items()}

    def get_payments(self, obj):
        payments = list(
            obj.payments.filter(is_voided=False)
            .select_related("recorded_by", "pledge")
            .prefetch_related("edit_logs__changed_by")
        )
        payments = _active_payments(payments)
        return PledgePaymentOutputSerializer(
            payments,
            many=True,
            context={**self.context, "payment_history": payments},
        ).data

    def get_has_payments(self, obj):
        return obj.payments.exists()

    def validate(self, attrs):
        if "status" in self.initial_data:
            raise serializers.ValidationError({"status": "Use the pledge status action to change status."})
        pledge = self.instance
        customer = attrs.get("customer", pledge.customer if pledge else None)
        source = attrs.get("business_source", pledge.business_source if pledge else None)
        customer_changed = pledge is None or customer != pledge.customer
        if customer_changed:
            if customer is None or customer.business_source_id is None:
                raise serializers.ValidationError({"customer": "Choose a customer linked to a Business Source."})
            linked_source = customer.business_source
            if "business_source" not in attrs:
                attrs["business_source"] = linked_source
                source = linked_source
        if customer is not None and source is not None and customer.business_source_id != source.pk:
            raise serializers.ValidationError({"business_source_id": "The selected customer must be linked to this Business Source."})
        if source is not None and (pledge is None or source != pledge.business_source):
            if source.status != BusinessSource.Status.ACTIVE:
                raise serializers.ValidationError({"business_source_id": "Inactive Business Sources cannot be used for new pledges."})
            terms = source.pledge_terms()
            if terms is None:
                raise serializers.ValidationError({"business_source_id": "Business Source has incomplete pledge interest terms."})
            term_names = ("upfront_percent", "upfront_days", "daily_percent", "daily_divisor")
            for name, value in zip(term_names, terms):
                attrs.setdefault(name, value)
        elif pledge is None:
            raise serializers.ValidationError({"business_source_id": "A Business Source is required."})
        if pledge is None:
            if "items" not in attrs:
                raise serializers.ValidationError({"items": "At least one pledged item is required."})
            terms = source.pledge_terms()
            for name, value in zip(("upfront_percent", "upfront_days", "daily_percent", "daily_divisor"), terms):
                if name in attrs and attrs[name] != value:
                    raise serializers.ValidationError({name: "Pledge terms must be copied from its Business Source."})
                attrs[name] = value
            attrs.setdefault("customer_name", customer.name)
            attrs.setdefault("address", source.address)
            attrs.setdefault("phone", source.phone)
        else:
            locked_fields = (
                "customer", "business_source", "pledge_date", "due_date", "written_text",
                "customer_name", "address", "phone", "principal_amount",
                "upfront_percent", "upfront_days", "daily_percent", "daily_divisor",
            )
            changes = [
                name for name in locked_fields
                if name in attrs and attrs[name] != getattr(pledge, name)
            ]
            items_changed = (
                "items" in attrs
                and self._item_values(pledge.items.all()) != self._item_values(attrs["items"])
            )
            if customer_changed and "customer_name" not in attrs:
                attrs["customer_name"] = customer.name
                if "customer_name" not in changes:
                    changes.append("customer_name")
            source_changed = source != pledge.business_source
            if source_changed:
                if "address" not in attrs:
                    attrs["address"] = source.address
                    changes.append("address")
                if "phone" not in attrs:
                    attrs["phone"] = source.phone
                    changes.append("phone")
            if changes and pledge.payments.exists():
                raise serializers.ValidationError({"detail": "Pledge details are locked after the first payment."})
            if items_changed and pledge.payments.exists():
                raise serializers.ValidationError({"items": "Pledge items are locked after the first payment."})
            if "pledge_date" in attrs and attrs["pledge_date"] > nepal_today():
                raise serializers.ValidationError({"pledge_date": "Pledge date cannot be in the future."})
            if changes or items_changed:
                reason = attrs.get("reason", "").strip()
                if len(reason) < 5:
                    raise serializers.ValidationError({"reason": "A reason of at least 5 characters is required."})
        pledge_date = attrs.get("pledge_date", pledge.pledge_date if pledge else nepal_today())
        if pledge_date > nepal_today():
            raise serializers.ValidationError({"pledge_date": "Pledge date cannot be in the future."})
        attrs["reason"] = attrs.get("reason", "").strip()
        return attrs

    @staticmethod
    def _item_values(items):
        return [
            {
                "particulars": item["particulars"] if isinstance(item, dict) else item.particulars,
                "weight": str(item["weight"] if isinstance(item, dict) else item.weight),
                "unit": item["unit"] if isinstance(item, dict) else item.unit,
                "ghat": item.get("ghat", "") if isinstance(item, dict) else item.ghat,
                "jor": str(item["jor"] if isinstance(item, dict) else item.jor),
            }
            for item in items
        ]

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("items")
        validated_data.pop("reason", None)
        pledge = Pledge.objects.create(**validated_data)
        for item in items:
            PledgeItem.objects.create(pledge=pledge, **item)
        return pledge

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("items", serializers.empty)
        reason = validated_data.pop("reason", "")
        log_fields = (
            "customer", "business_source", "pledge_date", "due_date", "written_text",
            "customer_name", "address", "phone", "principal_amount",
            "upfront_percent", "upfront_days", "daily_percent", "daily_divisor",
        )
        changes = []
        for field in log_fields:
            if field in validated_data:
                old = getattr(instance, field)
                new = validated_data[field]
                if old != new:
                    if field in ("business_source", "customer"):
                        old, new = old.pk, new.pk
                    if field in ("pledge_date", "due_date"):
                        old = ad_to_bs(old) if old else None
                        new = ad_to_bs(new) if new else None
                    changes.append((field, old, new))
        items_changed = (
            items is not serializers.empty
            and self._item_values(instance.items.all()) != self._item_values(items)
        )
        if items_changed:
            old_items = json.dumps(self._item_values(instance.items.all()), ensure_ascii=False, sort_keys=True)
            new_items = json.dumps(self._item_values(items), ensure_ascii=False, sort_keys=True)
            changes.append(("items", old_items, new_items))
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if items_changed:
            instance.items.all().delete()
            for item in items:
                PledgeItem.objects.create(pledge=instance, **item)
        record_pledge_changes(instance, changes, self.context["request"].user, reason)
        return instance


class PledgePaymentSerializer(serializers.ModelSerializer):
    payment_date = BSDateField()
    type = serializers.ChoiceField(choices=PledgePayment.Type.choices)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))

    class Meta:
        model = PledgePayment
        fields = ("id", "payment_date", "type", "amount", "recorded_by", "recorded_at")
        read_only_fields = ("id", "recorded_by", "recorded_at")

    def validate(self, attrs):
        pledge = self.context["pledge"]
        if pledge.status != Pledge.Status.ACTIVE:
            raise serializers.ValidationError({"detail": "Closed or forfeited pledges must be reopened before accepting payments."})
        when = attrs["payment_date"]
        existing = list(pledge.payments.all())
        active_existing = _active_payments(existing)
        if active_existing and when < active_existing[-1].payment_date:
            raise serializers.ValidationError({"payment_date": "Payment date cannot be before the latest existing payment."})
        candidate = PledgePayment(
            id=max((payment.id for payment in existing), default=0) + 1,
            pledge=pledge,
            payment_date=when,
            type=attrs["type"],
            amount=attrs["amount"],
            is_voided=False,
            recorded_by=self.context["request"].user,
            recorded_at=timezone.now(),
        )
        validate_payment_history(pledge, existing + [candidate], list(pledge.edit_logs.all()), changed_payment_id=candidate.id)
        return attrs

    def create(self, validated_data):
        return PledgePayment.objects.create(
            pledge=self.context["pledge"],
            recorded_by=self.context["request"].user,
            **validated_data,
        )


class PledgePaymentCorrectionSerializer(serializers.Serializer):
    payment_date = BSDateField(required=False)
    amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0.01"), required=False,
    )
    reason = serializers.CharField(max_length=500)

    def validate(self, attrs):
        reason = attrs["reason"].strip()
        if len(reason) < 5:
            raise serializers.ValidationError({"reason": "Reason must contain at least 5 characters."})
        attrs["reason"] = reason
        return attrs


class PledgePaymentDueSerializer(serializers.Serializer):
    as_of = BSDateField()
    payment_id = serializers.IntegerField(required=False, min_value=1)

    def validate_as_of(self, value):
        pledge = self.context["pledge"]
        if value < pledge.pledge_date:
            raise serializers.ValidationError("Date cannot be before the pledge date.")
        if value > nepal_today():
            raise serializers.ValidationError("Date cannot be in the future.")
        return value

    def validate(self, attrs):
        payment_id = attrs.get("payment_id")
        if payment_id is not None:
            payment = PledgePayment.objects.filter(
                pk=payment_id,
                pledge=self.context["pledge"],
                is_voided=False,
            ).first()
            if payment is None:
                raise serializers.ValidationError({
                    "payment_id": "Payment does not exist on this pledge or is no longer active."
                })
            attrs["payment"] = payment
        return attrs


class PledgeStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Pledge.Status.choices)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=500)

    def validate(self, attrs):
        reason = attrs.get("reason", "").strip()
        pledge = self.context["pledge"]
        new_status = attrs["status"]
        allowed = {
            Pledge.Status.ACTIVE: (Pledge.Status.CLOSED, Pledge.Status.FORFEITED),
            Pledge.Status.CLOSED: (Pledge.Status.ACTIVE,),
            Pledge.Status.FORFEITED: (Pledge.Status.ACTIVE,),
        }
        if new_status not in allowed[pledge.status]:
            raise serializers.ValidationError({"status": "This pledge status transition is not allowed."})
        if new_status != Pledge.Status.CLOSED and len(reason) < 5:
            raise serializers.ValidationError({"reason": "A reason of at least 5 characters is required."})
        if new_status == Pledge.Status.CLOSED:
            result = calculate_pledge_interest(
                pledge,
                interest_payment_rows(list(pledge.payments.all())),
                list(pledge.edit_logs.all()),
                nepal_today(),
            )
            if result["outstanding_principal"] != 0 or result["unpaid_interest"] != 0:
                raise serializers.ValidationError({"status": "A pledge can be closed only when principal and unpaid interest are both zero."})
        attrs["reason"] = reason
        return attrs
