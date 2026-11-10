import json
from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from accounts.models import BusinessSource, Customer

from .bs_dates import BSDateField, ad_to_bs
from .interest import calculate_pledge_interest
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
    total_amount = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = PledgePayment
        fields = ("id", "payment_date", "interest_amount", "principal_amount", "total_amount", "is_voided", "created_by", "created_at")
        read_only_fields = fields


class PledgeEditLogSerializer(serializers.ModelSerializer):
    effective_date = BSDateField(read_only=True, allow_null=True)

    class Meta:
        model = PledgeEditLog
        fields = ("id", "edit_id", "field", "old_value", "new_value", "effective_date", "changed_by", "changed_at", "reason")
        read_only_fields = fields


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
    payments = PledgePaymentOutputSerializer(many=True, read_only=True)
    edit_log = PledgeEditLogSerializer(source="edit_logs", many=True, read_only=True)
    reason = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=500)

    class Meta:
        model = Pledge
        fields = (
            "id", "pledge_number", "customer", "customer_name", "business_source_id",
            "business_source_name", "pledge_date", "due_date", "written_text", "address",
            "phone", "principal_amount", "upfront_percent",
            "upfront_days", "daily_percent", "daily_divisor", "status", "status_label",
            "calculation", "payments", "edit_log", "items", "reason", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "pledge_number", "business_source_name", "status",
            "status_label", "calculation", "payments", "edit_log", "created_at", "updated_at",
        )

    def get_status_label(self, obj):
        if obj.status == Pledge.Status.ACTIVE and obj.is_partially_paid:
            return "Partially Paid"
        return obj.get_status_display()

    def get_calculation(self, obj):
        result = calculate_pledge_interest(
            obj,
            list(obj.payments.all()),
            list(obj.edit_logs.all()),
            nepal_today(),
        )
        return {key: str(value) for key, value in result.items()}

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


def validate_payment_sequence(pledge, payments, edit_logs):
    ordered = sorted(
        (payment for payment in payments if not payment.get("is_voided", False)),
        key=lambda payment: (payment["payment_date"], payment.get("id", 0)),
    )
    accepted = []
    for payment in ordered:
        when = payment["payment_date"]
        if when < pledge.pledge_date:
            raise serializers.ValidationError({"payment_date": "Payment date cannot be before the pledge date."})
        if when > nepal_today():
            raise serializers.ValidationError({"payment_date": "Payment date cannot be in the future."})
        result = calculate_pledge_interest(pledge, accepted, edit_logs, when)
        same_day_principal = sum(
            (item["principal_amount"] for item in accepted if item["payment_date"] == when),
            Decimal("0.00"),
        )
        if payment["interest_amount"] > result["unpaid_interest"]:
            raise serializers.ValidationError({"interest_amount": "Interest payment exceeds unpaid interest on this date."})
        if payment["principal_amount"] > result["outstanding_principal"] - same_day_principal:
            raise serializers.ValidationError({"principal_amount": "Principal payment exceeds outstanding principal on this date."})
        accepted.append(payment)


class PledgePaymentSerializer(serializers.ModelSerializer):
    payment_date = BSDateField(required=False)
    interest_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0.00"), required=False,
        default=Decimal("0.00"),
    )
    principal_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0.00"), required=False,
        default=Decimal("0.00"),
    )

    class Meta:
        model = PledgePayment
        fields = ("id", "payment_date", "interest_amount", "principal_amount", "total_amount", "created_by", "created_at")
        read_only_fields = ("id", "total_amount", "created_by", "created_at")

    def validate(self, attrs):
        pledge = self.context["pledge"]
        if pledge.status != Pledge.Status.ACTIVE:
            raise serializers.ValidationError({"detail": "Closed or forfeited pledges must be reopened before accepting payments."})
        when = attrs.get("payment_date", nepal_today())
        existing = list(pledge.payments.all())
        if existing and when < max(payment.payment_date for payment in existing):
            raise serializers.ValidationError({"payment_date": "Payment date cannot be before the latest existing payment."})
        candidate = {
            "payment_date": when,
            "interest_amount": attrs.get("interest_amount", Decimal("0.00")),
            "principal_amount": attrs.get("principal_amount", Decimal("0.00")),
            "id": max((payment.id for payment in existing), default=0) + 1,
        }
        history = [
            {
                "payment_date": payment.payment_date,
                "interest_amount": payment.interest_amount,
                "principal_amount": payment.principal_amount,
                "is_voided": payment.is_voided,
                "id": payment.id,
            }
            for payment in existing
        ]
        if not candidate["interest_amount"] and not candidate["principal_amount"]:
            raise serializers.ValidationError("A payment must include interest, principal, or both.")
        validate_payment_sequence(pledge, history + [candidate], list(pledge.edit_logs.all()))
        return attrs

    def create(self, validated_data):
        return PledgePayment.objects.create(
            pledge=self.context["pledge"],
            created_by=self.context["request"].user,
            **validated_data,
        )


class PledgePaymentCorrectionSerializer(serializers.Serializer):
    payment_date = BSDateField(required=False)
    interest_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.00"), required=False)
    principal_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.00"), required=False)
    reason = serializers.CharField(max_length=500)

    def validate(self, attrs):
        reason = attrs["reason"].strip()
        if len(reason) < 5:
            raise serializers.ValidationError({"reason": "Reason must contain at least 5 characters."})
        attrs["reason"] = reason
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
                pledge, list(pledge.payments.all()), list(pledge.edit_logs.all()), nepal_today(),
            )
            if result["outstanding_principal"] != 0 or result["unpaid_interest"] != 0:
                raise serializers.ValidationError({"status": "A pledge can be closed only when principal and unpaid interest are both zero."})
        attrs["reason"] = reason
        return attrs
