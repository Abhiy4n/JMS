from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from accounts.models import Customer
from billing.credit_serializers import CustomerCreditSerializer
from billing.interest import calculate_customer_credit
from billing.models import CustomerCredit

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
        min_value=Decimal("0.01"),
    )
    is_overdue = serializers.BooleanField(read_only=True)
    elapsed_days = serializers.SerializerMethodField()
    credit_id = serializers.IntegerField(source="credit.id", read_only=True, default=None)
    credit_calculation = serializers.SerializerMethodField()
    financial_status = serializers.SerializerMethodField()

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
            "elapsed_days",
            "credit_id",
            "credit_calculation",
            "financial_status",
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
            "elapsed_days",
            "credit_id",
            "credit_calculation",
            "financial_status",
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

        if pledge is not None and hasattr(pledge, "credit"):
            protected_fields = {
                "customer": pledge.customer,
                "amount_received": pledge.amount_received,
            }
            for field, current_value in protected_fields.items():
                if field in attrs and attrs[field] != current_value:
                    raise serializers.ValidationError({
                        field: "Cannot change after this Pledge creates its Credit agreement."
                    })
            if "pledge_date" in attrs and pledge_date != pledge.pledge_date:
                if pledge.credit.payments.exists():
                    raise serializers.ValidationError({
                        "pledge_date": "Cannot change the Pledge date after a payment has been recorded."
                    })
                if pledge_date > nepal_today():
                    raise serializers.ValidationError({
                        "pledge_date": "Pledge date cannot be in the future."
                    })
            if new_status == Pledge.Status.CANCELLED and new_status != pledge.status:
                raise serializers.ValidationError({
                    "status": "Linked Pledges cannot be cancelled because accounting reversal is not available."
                })

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
        if pledge is None:
            credit_serializer = CustomerCreditSerializer(data={
                "customer": attrs["customer"].pk,
                "credit_date": pledge_date.isoformat(),
                "principal_amount": attrs["amount_received"],
                "notes": "Created from Pledge",
            }, context=self.context)
            credit_serializer.is_valid(raise_exception=True)
            self._credit_serializer = credit_serializer
        return attrs

    @staticmethod
    def _credit(obj):
        try:
            return obj.credit
        except CustomerCredit.DoesNotExist:
            return None

    def get_credit_calculation(self, obj):
        credit = self._credit(obj)
        return calculate_customer_credit(credit) if credit else None

    def get_elapsed_days(self, obj):
        return max((nepal_today() - obj.pledge_date).days, 0)

    def get_financial_status(self, obj):
        credit = self._credit(obj)
        if not credit:
            return "NOT_LINKED"
        calculation = calculate_customer_credit(credit)
        if Decimal(calculation["total_due"]) == 0:
            return "PAID"
        return "PARTIALLY_PAID" if credit.payments.exists() else "UNPAID"

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop("items")
        pledge = Pledge.objects.create(**validated_data)
        for item_data in items_data:
            PledgeItem.objects.create(pledge=pledge, **item_data)
        self._credit_serializer.save(
            pledge=pledge,
            notes=f"Pledge {pledge.pledge_number}",
        )
        return pledge

    @transaction.atomic
    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", serializers.empty)
        linked_credit = None
        pledge_date_changed = (
            "pledge_date" in validated_data
            and validated_data["pledge_date"] != instance.pledge_date
        )
        if pledge_date_changed:
            try:
                linked_credit = CustomerCredit.objects.select_for_update().prefetch_related("payments").get(pledge=instance)
            except CustomerCredit.DoesNotExist:
                linked_credit = None
            if linked_credit and linked_credit.payments.exists():
                raise serializers.ValidationError({
                    "pledge_date": "Cannot change the Pledge date after a payment has been recorded."
                })
        if validated_data.get("status") == Pledge.Status.REDEEMED:
            try:
                credit = CustomerCredit.objects.select_for_update().prefetch_related("payments").get(pledge=instance)
            except CustomerCredit.DoesNotExist:
                credit = None
            if credit and Decimal(calculate_customer_credit(credit)["total_due"]) != 0:
                raise serializers.ValidationError({
                    "status": "Settle all principal and accrued interest before redeeming this Pledge."
                })
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if linked_credit:
            linked_credit.credit_date = instance.pledge_date
            linked_credit.save(update_fields=("credit_date",))

        if items_data is not serializers.empty:
            instance.items.all().delete()
            for item_data in items_data:
                PledgeItem.objects.create(pledge=instance, **item_data)
        return instance
