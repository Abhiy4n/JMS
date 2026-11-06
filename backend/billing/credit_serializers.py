from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from accounts.models import Customer
from .models import CustomerCredit, CustomerCreditPayment
from .interest import calculate_customer_credit


class CustomerCreditSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    pledge_number = serializers.CharField(source="pledge.pledge_number", read_only=True, default=None)
    calculation = serializers.SerializerMethodField()
    financial_status = serializers.SerializerMethodField()
    principal_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))

    class Meta:
        model = CustomerCredit
        fields = ("id", "customer", "customer_name", "pledge", "pledge_number", "credit_date", "principal_amount", "notes",
                  "credit_customer_type", "calculation", "financial_status", "created_at")
        read_only_fields = ("id", "customer_name", "pledge", "pledge_number", "credit_customer_type", "calculation", "financial_status", "created_at")

    def validate_customer(self, value):
        if not value.is_active:
            raise serializers.ValidationError("Activate this customer before issuing new credit.")
        interest_type, rate, basis, period_days = value.credit_terms()
        if (interest_type not in ("PERCENTAGE", "FIXED_AMOUNT") or rate is None or basis is None
                or period_days is None or rate <= 0 or basis <= 0 or period_days <= 0):
            raise serializers.ValidationError("Configure valid interest terms for this customer or its business source first.")
        return value

    def validate_credit_date(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError("Credit date cannot be in the future.")
        return value

    def create(self, validated_data):
        customer = validated_data["customer"]
        interest_type, rate, basis, period_days = customer.credit_terms()
        return CustomerCredit.objects.create(
            **validated_data, credit_customer_type=customer.effective_customer_type,
            credit_interest_type=interest_type, credit_interest_amount=rate,
            credit_basis=basis, credit_period_days=period_days,
        )

    def get_calculation(self, obj):
        return calculate_customer_credit(obj)

    def get_financial_status(self, obj):
        calculation = calculate_customer_credit(obj)
        if Decimal(calculation["total_due"]) == 0:
            return "PAID"
        return "PARTIALLY_PAID" if obj.payments.exists() else "UNPAID"


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
