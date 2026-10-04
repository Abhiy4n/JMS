from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from accounts.models import Customer
from .models import Bill, BillItem, quantize_money


class BillItemSerializer(serializers.ModelSerializer):
    material = serializers.ChoiceField(
        choices=BillItem.Material.choices,
        required=False,
        default=BillItem.Material.GOLD,
    )
    rate_unit = serializers.ChoiceField(
        choices=BillItem.RateUnit.choices,
        required=False,
        default=BillItem.RateUnit.GRAM,
    )
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=Decimal("0.001"))
    gross_weight = serializers.DecimalField(
        max_digits=10,
        decimal_places=3,
        min_value=Decimal("0.00"),
        required=False,
        default=Decimal("0.000"),
    )
    stone_weight = serializers.DecimalField(
        max_digits=10,
        decimal_places=3,
        min_value=Decimal("0.00"),
        required=False,
        default=Decimal("0.000"),
    )
    purity = serializers.DecimalField(
        max_digits=6,
        decimal_places=3,
        min_value=Decimal("0.00"),
        required=False,
        default=Decimal("0.000"),
    )
    rate = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0.00"),
        required=False,
    )
    gold_rate = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0.00"),
        required=False,
        write_only=True,
    )
    making_charge = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0.00"),
        required=False,
        default=Decimal("0.00"),
    )
    discount = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0.00"),
        required=False,
        default=Decimal("0.00"),
    )

    class Meta:
        model = BillItem
        fields = (
            "id",
            "item_name",
            "material",
            "rate_unit",
            "quantity",
            "gross_weight",
            "stone_weight",
            "net_weight",
            "purity",
            "rate",
            "gold_rate",
            "making_charge",
            "discount",
            "total",
        )
        read_only_fields = ("id", "net_weight", "total")

    def validate(self, attrs):
        legacy_rate = attrs.pop("gold_rate", None)
        if legacy_rate is not None:
            if "rate" in attrs:
                raise serializers.ValidationError({"rate": "Provide rate, not both rate and gold_rate."})
            attrs["rate"] = legacy_rate

        required_fields = ("item_name", "quantity", "rate")
        missing_fields = {
            field: ["This field is required."]
            for field in required_fields
            if field not in attrs
        }
        if missing_fields:
            raise serializers.ValidationError(missing_fields)

        rate_unit = attrs.get(
            "rate_unit",
            self.instance.rate_unit if self.instance else BillItem.RateUnit.GRAM,
        )
        attrs.setdefault(
            "gross_weight",
            self.instance.gross_weight if self.instance else Decimal("0.000"),
        )
        attrs.setdefault(
            "stone_weight",
            self.instance.stone_weight if self.instance else Decimal("0.000"),
        )
        gross_weight = attrs["gross_weight"]
        stone_weight = attrs["stone_weight"]
        if stone_weight > gross_weight:
            raise serializers.ValidationError({"stone_weight": "Stone weight cannot exceed gross weight."})
        if rate_unit in (BillItem.RateUnit.GRAM, BillItem.RateUnit.CARAT) and gross_weight <= 0:
            raise serializers.ValidationError({"gross_weight": "Gross weight is required for weight-based pricing."})

        net_weight = gross_weight - stone_weight
        rate_value = BillItem.calculate_rate_value_for(
            attrs["rate"],
            rate_unit,
            attrs.get("quantity", self.instance.quantity if self.instance else Decimal("0.000")),
            net_weight,
        )
        line_before_discount = rate_value + attrs.get(
            "making_charge",
            self.instance.making_charge if self.instance else Decimal("0.00"),
        )
        if attrs.get("discount", Decimal("0.00")) > line_before_discount:
            raise serializers.ValidationError({"discount": "Item discount cannot exceed the item value."})
        return attrs


class BillListFilterSerializer(serializers.Serializer):
    customer = serializers.IntegerField(required=False, min_value=1)
    status = serializers.ChoiceField(choices=Bill.Status.choices, required=False)
    bill_date = serializers.DateField(required=False)
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


class BillSerializer(serializers.ModelSerializer):
    customer = serializers.PrimaryKeyRelatedField(queryset=Customer.objects.all())
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    business_source_id = serializers.IntegerField(source="customer.business_source_id", read_only=True)
    business_source_name = serializers.CharField(
        source="customer.business_source.name",
        read_only=True,
    )
    items = BillItemSerializer(many=True, required=False)
    discount = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0.00"),
        required=False,
        default=Decimal("0.00"),
    )
    vat = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0.00"),
        required=False,
        default=Decimal("0.00"),
    )
    amount_paid = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        min_value=Decimal("0.00"),
        required=False,
        default=Decimal("0.00"),
    )
    status = serializers.ChoiceField(choices=Bill.Status.choices, required=False)

    class Meta:
        model = Bill
        fields = (
            "id",
            "bill_number",
            "customer",
            "customer_name",
            "business_source_id",
            "business_source_name",
            "bill_date",
            "items",
            "subtotal",
            "discount",
            "vat",
            "grand_total",
            "amount_paid",
            "amount_due",
            "payment_method",
            "status",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "customer_name",
            "business_source_name",
            "subtotal",
            "grand_total",
            "amount_due",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs):
        bill = self.instance
        current_discount = bill.discount if bill else Decimal("0.00")
        current_vat = bill.vat if bill else Decimal("0.00")
        current_paid = bill.amount_paid if bill else Decimal("0.00")
        discount = attrs.get("discount", current_discount)
        vat = attrs.get("vat", current_vat)
        amount_paid = attrs.get("amount_paid", current_paid)

        if "items" in attrs:
            items = attrs["items"]
            subtotal = sum((self._item_total(item) for item in items), Decimal("0.00"))
        elif bill:
            subtotal = bill.subtotal
        else:
            subtotal = Decimal("0.00")

        if discount > subtotal:
            raise serializers.ValidationError({"discount": "Bill discount cannot exceed the subtotal."})
        grand_total = quantize_money(subtotal - discount + vat)
        if amount_paid > grand_total:
            raise serializers.ValidationError({"amount_paid": "Amount paid cannot exceed the grand total."})
        return attrs

    @staticmethod
    def _item_total(item):
        gross_weight = item.get("gross_weight", Decimal("0.000"))
        stone_weight = item.get("stone_weight", Decimal("0.000"))
        quantity = item["quantity"]
        rate = item["rate"]
        rate_unit = item.get("rate_unit", BillItem.RateUnit.GRAM)
        making_charge = item.get("making_charge", Decimal("0.00"))
        discount = item.get("discount", Decimal("0.00"))
        rate_value = BillItem.calculate_rate_value_for(
            rate,
            rate_unit,
            quantity,
            gross_weight - stone_weight,
        )
        return quantize_money(rate_value + making_charge - discount)

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        status_override = validated_data.pop("status", None)
        bill = Bill.objects.create(**validated_data)
        for item_data in items_data:
            BillItem.objects.create(bill=bill, **item_data)
        bill.recalculate_totals(status_override=status_override)
        return bill

    @transaction.atomic
    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", serializers.empty)
        status_override = validated_data.pop("status", None)
        if status_override is None and instance.status in (Bill.Status.DRAFT, Bill.Status.CANCELLED):
            status_override = instance.status
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()

        if items_data is not serializers.empty:
            instance.items.all().delete()
            for item_data in items_data:
                BillItem.objects.create(bill=instance, **item_data)

        instance.recalculate_totals(status_override=status_override)
        return instance