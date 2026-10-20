from decimal import Decimal

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers
from rest_framework.validators import UniqueValidator

from .models import BusinessSource, Customer, Role, User


ALLOWED_EMAIL_SUFFIXES = {
    "com",
    "org",
    "net",
    "edu",
    "gov",
    "mil",
    "int",
    "np",
    "co",
    "io",
    "me",
    "info",
}


def validate_customer_phone(value):
    if value and (not value.isascii() or not value.isdigit() or len(value) not in (9, 10)):
        raise serializers.ValidationError("Enter a phone number with 9 or 10 digits.")
    return value


def validate_customer_email(value):
    email = value.strip()
    if not email:
        return email

    try:
        validate_email(email)
    except DjangoValidationError as error:
        raise serializers.ValidationError("Enter a valid email address.") from error

    domain = email.rsplit("@", 1)[-1].lower()
    suffix = domain.rsplit(".", 1)[-1]
    if suffix not in ALLOWED_EMAIL_SUFFIXES:
        raise serializers.ValidationError(
            "Use an email address with a recognized domain such as .com or .np."
        )
    return email


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "name", "email", "profile_picture", "role")
        read_only_fields = fields


class RegisterSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate_email(self, value):
        email = value.lower().strip()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return email

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        return User.objects.create_user(
            email=validated_data["email"],
            name=validated_data["name"].strip(),
            password=validated_data["password"],
            role=Role.ADMIN,
        )


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate(self, attrs):
        email = attrs["email"].lower().strip()
        password = attrs["password"]
        user = authenticate(
            request=self.context.get("request"),
            email=email,
            password=password,
        )
        if user is None:
            raise serializers.ValidationError("Invalid email or password.")
        if not user.is_active:
            raise serializers.ValidationError("This account is inactive.")
        attrs["user"] = user
        return attrs


class NewBusinessSourceCategorySerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    channel_type = serializers.ChoiceField(choices=BusinessSource.ChannelType.choices)
    description = serializers.CharField(required=False, allow_blank=True)
    source_type = serializers.ChoiceField(choices=BusinessSource.Type.choices, required=False)
    market_segment = serializers.CharField(max_length=255)
    phone = serializers.CharField(max_length=10, required=False, allow_blank=True)
    pan_vat_number = serializers.CharField(max_length=32, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    address = serializers.CharField(required=False, allow_blank=True)
    monthly_interest_amount = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)
    interest_credit_basis = serializers.DecimalField(max_digits=14, decimal_places=2, required=False)

    def validate(self, attrs):
        # Legacy inline creation follows exactly the same identity rules.
        source = BusinessSourceSerializer(
            data=attrs,
            context={**self.context, "legacy_customer_source": True},
        )
        source.is_valid(raise_exception=True)
        return source.validated_data


class CustomerSerializer(serializers.ModelSerializer):
    customer_type = serializers.ChoiceField(choices=Customer.Type.choices, required=False)
    monthly_interest_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0.00"), required=False, allow_null=True,
    )
    interest_credit_basis = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0.01"), required=False, allow_null=True,
    )
    phone = serializers.CharField(
        required=False, allow_blank=True, max_length=10, trim_whitespace=False
    )
    email = serializers.EmailField(required=False, allow_blank=True)
    source_name = serializers.CharField(source="business_source.name", read_only=True)
    business_source = serializers.PrimaryKeyRelatedField(
        queryset=BusinessSource.objects.all(),
        required=False,
        allow_null=True,
    )
    new_business_source = NewBusinessSourceCategorySerializer(write_only=True, required=False)

    class Meta:
        model = Customer
        fields = (
            "id",
            "name",
            "phone",
            "email",
            "customer_type",
            "is_active",
            "monthly_interest_amount",
            "interest_credit_basis",
            "business_source",
            "source_entry",
            "new_business_source",
            "source_name",
            "created_at",
        )
        read_only_fields = ("id", "source_name", "source_entry", "created_at")

    def validate_phone(self, value):
        return validate_customer_phone(value)

    def validate_email(self, value):
        return validate_customer_email(value)

    def validate(self, attrs):
        # A linked source supplies authoritative terms, preventing rate overrides
        # in the customer payload. Existing bill snapshots remain unchanged.
        if self.instance and self.instance.source_entry_id:
            shared = {"name", "phone", "email", "business_source", "new_business_source", "customer_type", "monthly_interest_amount", "interest_credit_basis"}
            if shared.intersection(attrs):
                raise serializers.ValidationError({"detail": "Edit shared customer details through the linked Business Source."})
            # Status remains independent of the source and needs no credit-term validation.
            return attrs
        source = attrs.get("business_source", self.instance.business_source if self.instance else None)
        if source:
            attrs["customer_type"] = source.source_type
            attrs["monthly_interest_amount"], attrs["interest_credit_basis"] = (
                source.credit_terms() if source.source_type == BusinessSource.Type.DYNAMIC else (None, None)
            )
        kind = attrs.get("customer_type", self.instance.customer_type if self.instance else Customer.Type.INDIVIDUAL)
        if kind == Customer.Type.DYNAMIC:
            for field in ("monthly_interest_amount", "interest_credit_basis"):
                value = attrs.get(field, getattr(self.instance, field, None))
                if value is None:
                    raise serializers.ValidationError({field: "Required for a Dynamic Customer."})
        else:
            attrs["monthly_interest_amount"] = None
            attrs["interest_credit_basis"] = None
        has_existing_source = "business_source" in attrs
        has_new_source = "new_business_source" in attrs
        if has_existing_source and has_new_source:
            raise serializers.ValidationError(
                "Provide only one legacy business source."
            )
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["customer_type"] = instance.effective_customer_type
        if instance.business_source_id:
            source = instance.business_source
            data["monthly_interest_amount"] = f"{source.monthly_interest_amount:.2f}" if source.monthly_interest_amount is not None else None
            data["interest_credit_basis"] = f"{source.interest_credit_basis:.2f}" if source.interest_credit_basis is not None else None
        return data

    @transaction.atomic
    def create(self, validated_data):
        new_source_data = validated_data.pop("new_business_source", None)
        if new_source_data is not None:
            request = self.context["request"]
            source = BusinessSource.objects.create(
                created_by=request.user,
                **new_source_data,
            )
            from .source_customers import sync_source_customer
            sync_source_customer(source)
            validated_data["business_source"] = source
        return Customer.objects.create(**validated_data)


class InitialCustomerSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    phone = serializers.CharField(
        max_length=10, required=False, allow_blank=True, trim_whitespace=False
    )
    email = serializers.EmailField(required=False, allow_blank=True)

    def validate_phone(self, value):
        return validate_customer_phone(value)

    def validate_email(self, value):
        return validate_customer_email(value)


class BusinessSourceSerializer(serializers.ModelSerializer):
    name = serializers.CharField(max_length=255, validators=[UniqueValidator(
        queryset=BusinessSource.objects.all(), lookup="iexact",
        message="A business source with this name already exists.",
    )])
    customer_count = serializers.SerializerMethodField()
    first_customer = InitialCustomerSerializer(write_only=True, required=False)
    monthly_interest_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.00"), required=False, allow_null=True)
    interest_credit_basis = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"), required=False, allow_null=True)
    interest_type = serializers.ChoiceField(choices=BusinessSource.InterestType.choices, required=False, allow_null=True)
    interest_percentage = serializers.DecimalField(max_digits=9, decimal_places=4, min_value=Decimal("0.00"), required=False, allow_null=True)
    interest_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.00"), required=False, allow_null=True)
    days = serializers.IntegerField(min_value=1, required=False, allow_null=True)

    class Meta:
        model = BusinessSource
        fields = (
            "id",
            "name",
            "source_type",
            "phone",
            "pan_vat_number",
            "market_segment",
            "email",
            "address",
            "interest_type",
            "interest_percentage",
            "interest_amount",
            "days",
            "monthly_interest_amount",
            "interest_credit_basis",
            "channel_type",
            "status",
            "description",
            "customer_count",
            "first_customer",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "customer_count", "created_at", "updated_at")

    def get_customer_count(self, obj):
        if hasattr(obj, "customer_count"):
            return obj.customer_count
        return obj.customers.count()

    def validate_phone(self, value):
        return validate_customer_phone(value)

    def validate_email(self, value):
        return validate_customer_email(value)

    def validate(self, attrs):
        def current(field, default=""):
            return attrs.get(field, getattr(self.instance, field, default))

        kind = current("source_type", BusinessSource.Type.INDIVIDUAL)
        errors = {}
        source_type_changed = self.instance is not None and kind != self.instance.source_type

        address_is_missing = not current("address").strip()
        if address_is_missing and not self.context.get("legacy_customer_source") and (
            self.instance is None or source_type_changed or "address" in attrs
        ):
            errors["address"] = "Address is required."

        if kind == BusinessSource.Type.INDIVIDUAL and not current("phone"):
            errors["phone"] = "Phone is required for an Individual source."
        if kind == BusinessSource.Type.DYNAMIC and not current("phone"):
            errors["phone"] = "Phone is required for a Dynamic source."
        if kind == BusinessSource.Type.COMPANY and not current("pan_vat_number").strip():
            errors["pan_vat_number"] = "PAN/VAT number is required for a Company source."

        if kind == BusinessSource.Type.COMPANY:
            if "phone" in attrs and attrs["phone"]:
                errors["phone"] = "Phone is not used for a Company source."
            elif source_type_changed:
                attrs["phone"] = ""
        elif kind == BusinessSource.Type.INDIVIDUAL:
            if "pan_vat_number" in attrs and attrs["pan_vat_number"].strip():
                errors["pan_vat_number"] = "PAN/VAT number is not used for an Individual source."
            elif source_type_changed:
                attrs["pan_vat_number"] = ""

        config_fields = ("interest_type", "interest_percentage", "interest_amount", "days")
        config_was_submitted = any(field in attrs for field in config_fields)
        if kind == BusinessSource.Type.DYNAMIC and self.context.get("legacy_customer_source"):
            for field in ("monthly_interest_amount", "interest_credit_basis"):
                if current(field, None) is None:
                    errors[field] = "Required for Dynamic credit terms."
        elif kind == BusinessSource.Type.DYNAMIC and (
            self.instance is None or source_type_changed or config_was_submitted
        ):
            interest_type = current("interest_type", None)
            percentage = current("interest_percentage", None)
            amount = current("interest_amount", None)
            days = current("days", None)
            if interest_type is None:
                errors["interest_type"] = "Choose Percentage or Fixed Amount."
            elif interest_type == BusinessSource.InterestType.PERCENTAGE:
                if percentage is None:
                    errors["interest_percentage"] = "Interest % is required for Percentage."
                if amount is not None:
                    errors["interest_amount"] = "Interest Amount is not used for Percentage."
            elif interest_type == BusinessSource.InterestType.FIXED_AMOUNT:
                if amount is None:
                    errors["interest_amount"] = "Interest Amount is required for Fixed Amount."
                if percentage is not None:
                    errors["interest_percentage"] = "Interest % is not used for Fixed Amount."
            if days is None:
                errors["days"] = "Days must be a positive whole number."
        elif kind != BusinessSource.Type.DYNAMIC:
            for field in config_fields:
                if field in attrs and attrs[field] is not None:
                    errors[field] = "Interest configuration is only used for a Dynamic source."

        if kind != BusinessSource.Type.DYNAMIC and (source_type_changed or config_was_submitted):
            attrs.update({field: None for field in config_fields})
            attrs["monthly_interest_amount"] = None
            attrs["interest_credit_basis"] = None
        if source_type_changed and kind == BusinessSource.Type.DYNAMIC:
            attrs["monthly_interest_amount"] = None
            attrs["interest_credit_basis"] = None

        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        initial_customer = validated_data.pop("first_customer", None)
        source = BusinessSource.objects.create(**validated_data)
        from .source_customers import sync_source_customer
        sync_source_customer(source)
        # Keep the first customer and its source together if either insert fails.
        if initial_customer is not None:
            Customer.objects.create(business_source=source, customer_type=source.source_type, **initial_customer)
        return source

    @transaction.atomic
    def update(self, instance, validated_data):
        validated_data.pop("first_customer", None)
        source = super().update(instance, validated_data)
        from .source_customers import sync_source_customer
        sync_source_customer(source)
        # Annotated counts may predate creation of the directory entry.
        if hasattr(source, "customer_count"):
            source.customer_count = source.customers.count()
        return source
