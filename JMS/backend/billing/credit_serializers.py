from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from accounts.models import Customer
from .models import CustomerCredit, CustomerCreditPayment
from .interest import calculate_customer_credit


class CustomerCreditSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    calculation = serializers.SerializerMethodField()
    principal_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))

    class Meta:
        model = CustomerCredit
        fields = ("id", "customer", "customer_name", "credit_date", "principal_amount", "notes",
                  "credit_customer_type", "calculation", "created_at")
        read_only_fields = ("id", "customer_name", "credit_customer_type", "calculation", "created_at")

    def validate_customer(self, value):
        if not value.is_active:
            raise serializers.ValidationError("Activate this customer before issuing new credit.")
        rate, basis = value.credit_terms()
        if rate is None or basis is None or rate < 0 or basis <= 0:
            raise serializers.ValidationError("Configure valid interest terms for this customer or its business source first.")
        return value

    def validate_credit_date(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError("Credit date cannot be in the future.")
        return value

    def create(self, validated_data):
        customer = validated_data["customer"]
        rate, basis = customer.credit_terms()
        return CustomerCredit.objects.create(
            **validated_data, credit_customer_type=customer.effective_customer_type,
            credit_interest_amount=rate, credit_basis=basis,
        )

    def get_calculation(self, obj):
        return calculate_customer_credit(obj)


class CustomerCreditPaymentSerializer(serializers.ModelSerializer):
    principal_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.00"), required=False, default=Decimal("0.00"))
    interest_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.00"), required=False, default=Decimal("0.00"))

    class Meta:
        model = CustomerCreditPayment
        fields = ("id", "principal_amount", "interest_amount", "effective_date")
        read_only_fields = ("id", "effective_date")

    def validate(self, attrs):
        calculation = calculate_customer_credit(self.context["credit"])
        principal = attrs.get("principal_amount", Decimal("0.00"))
        interest = attrs.get("interest_amount", Decimal("0.00"))
        if principal + interest <= 0:
            raise serializers.ValidationError("Enter a principal or interest payment greater than zero.")
        if principal > Decimal(calculation["principal_due"]):
            raise serializers.ValidationError({"principal_amount": "Cannot exceed outstanding principal."})
        if interest > Decimal(calculation["interest_due"]):
            raise serializers.ValidationError({"interest_amount": "Cannot exceed accrued unpaid interest."})
        return attrs
