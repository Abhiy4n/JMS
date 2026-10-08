from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from accounts.models import Customer

from .models import Pledge, PledgeItem, nepal_today


class PledgeItemSerializer(serializers.ModelSerializer):
    weight_grams = serializers.DecimalField(
        max_digits=12,
        decimal_places=3,
        min_value=Decimal("0.000"),
    )
    quantity = serializers.IntegerField(min_value=1)

    class Meta:
        model = PledgeItem
        fields = ("id", "sequence", "description", "weight_grams", "quantity")
        read_only_fields = ("id", "sequence")


class PledgeFilterSerializer(serializers.Serializer):
    customer = serializers.IntegerField(required=False, min_value=1)
    status = serializers.ChoiceField(choices=Pledge.Status.choices, required=False)
    pledge_date = serializers.DateField(required=False)
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)

    def validate_customer(self, value):
        if not Customer.objects.filter(pk=value).exists():
            raise serializers.ValidationError("Customer does not exist.")
        return value

    def validate(self, attrs):
        date_from = attrs.get("date_from")
        date_to = attrs.get("date_to")
        if date_from and date_to and date_from > date_to:
            raise serializers.ValidationError({"date_to": "Must be on or after date_from."})
        return attrs


class PledgeSerializer(serializers.ModelSerializer):
    customer = serializers.PrimaryKeyRelatedField(queryset=Customer.objects.all())
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    business_source_id = serializers.IntegerField(
        source="customer.business_source_id",
        read_only=True,
    )
    business_source_name = serializers.CharField(
        source="customer.business_source.name",
        read_only=True,
    )
    items = PledgeItemSerializer(many=True, required=True, allow_empty=False)
    amount_received = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0.00"),
    )
    is_overdue = serializers.BooleanField(read_only=True)

    class Meta:
        model = Pledge
        fields = (
            "id",
            "pledge_number",
            "customer",
            "customer_name",
            "business_source_id",
            "business_source_name",
            "pledge_date",
            "amount_received",
            "due_date",
            "status",
            "is_overdue",
            "redeemed_date",
            "cancelled_date",
            "items",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "pledge_number",
            "customer_name",
            "business_source_id",
            "business_source_name",
            "is_overdue",
            "redeemed_date",
            "cancelled_date",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs):
        pledge = self.instance
        if pledge is not None and pledge.status in (
            Pledge.Status.REDEEMED,
            Pledge.Status.CANCELLED,
        ):
            raise serializers.ValidationError("Closed pledges cannot be edited.")

        new_status = attrs.get("status", Pledge.Status.ACTIVE if pledge is None else pledge.status)
        pledge_date = attrs.get(
            "pledge_date",
            pledge.pledge_date if pledge is not None else nepal_today(),
        )
        due_date = attrs.get(
            "due_date",
            pledge.due_date if pledge is not None else None,
        )

        if due_date and pledge_date and due_date < pledge_date:
            raise serializers.ValidationError(
                {"due_date": "Due date cannot be before the pledge date."}
            )
        if pledge is None and new_status != Pledge.Status.ACTIVE:
            raise serializers.ValidationError({"status": "Pledges must be created as active."})
        if pledge is not None and new_status != pledge.status:
            if pledge.status != Pledge.Status.ACTIVE or new_status not in (
                Pledge.Status.REDEEMED,
                Pledge.Status.CANCELLED,
            ):
                raise serializers.ValidationError(
                    {"status": "Only active pledges can be redeemed or cancelled."}
                )
            if pledge_date and pledge_date > nepal_today():
                raise serializers.ValidationError(
                    {"status": "A pledge cannot be closed before its pledge date."}
                )
        if pledge is not None and new_status == Pledge.Status.REDEEMED:
            redeemed_date = pledge.redeemed_date or nepal_today()
            if pledge_date and redeemed_date < pledge_date:
                raise serializers.ValidationError(
                    {"pledge_date": "Pledge date cannot be after the redemption date."}
                )
        if pledge is not None and new_status == Pledge.Status.CANCELLED:
            cancelled_date = pledge.cancelled_date or nepal_today()
            if pledge_date and cancelled_date < pledge_date:
                raise serializers.ValidationError(
                    {"pledge_date": "Pledge date cannot be after the cancellation date."}
                )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop("items")
        pledge = Pledge.objects.create(**validated_data)
        for item_data in items_data:
            PledgeItem.objects.create(pledge=pledge, **item_data)
        return pledge

    @transaction.atomic
    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", serializers.empty)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if items_data is not serializers.empty:
            instance.items.all().delete()
            for item_data in items_data:
                PledgeItem.objects.create(pledge=instance, **item_data)
        return instance
