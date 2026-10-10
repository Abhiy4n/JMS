from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

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


PROFILE_PICTURE_MAX_BYTES = 5 * 1024 * 1024
PROFILE_PICTURE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


class ProfilePictureSerializer(serializers.Serializer):
    profile_picture = serializers.ImageField()

    def validate_profile_picture(self, value):
        if value.size > PROFILE_PICTURE_MAX_BYTES:
            raise serializers.ValidationError("Profile picture must be 5 MB or smaller.")
        # content_type is detected from the decoded image, not the client's filename.
        if getattr(value, "content_type", None) not in PROFILE_PICTURE_EXTENSIONS:
            raise serializers.ValidationError("Use a JPG, PNG, WebP, or GIF image.")
        return value


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


class CustomerSerializer(serializers.ModelSerializer):
    phone = serializers.CharField(
        required=False, allow_blank=True, max_length=10, trim_whitespace=False
    )
    email = serializers.EmailField(required=False, allow_blank=True)
    source_name = serializers.CharField(source="business_source.name", read_only=True)
    business_source = serializers.PrimaryKeyRelatedField(
        queryset=BusinessSource.objects.all(),
        required=False,
    )
    new_business_source = NewBusinessSourceCategorySerializer(write_only=True, required=False)

    class Meta:
        model = Customer
        fields = (
            "id",
            "name",
            "phone",
            "email",
            "business_source",
            "new_business_source",
            "source_name",
            "created_at",
        )
        read_only_fields = ("id", "source_name", "created_at")

    def validate_phone(self, value):
        return validate_customer_phone(value)

    def validate_email(self, value):
        return validate_customer_email(value)

    def validate(self, attrs):
        has_existing_source = "business_source" in attrs
        has_new_source = "new_business_source" in attrs
        if has_existing_source == has_new_source:
            raise serializers.ValidationError(
                "Choose an existing business source or provide a new business source category."
            )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        new_source_data = validated_data.pop("new_business_source", None)
        if new_source_data is not None:
            request = self.context["request"]
            source = BusinessSource.objects.create(
                created_by=request.user,
                **new_source_data,
            )
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
    customer_count = serializers.SerializerMethodField()
    first_customer = InitialCustomerSerializer(write_only=True)

    class Meta:
        model = BusinessSource
        fields = (
            "id",
            "name",
            "channel_type",
            "status",
            "description",
            "customer_count",
            "first_customer",
            "created_at",
        )
        read_only_fields = ("id", "customer_count", "created_at")

    def get_customer_count(self, obj):
        if hasattr(obj, "customer_count"):
            return obj.customer_count
        return obj.customers.count()

    @transaction.atomic
    def create(self, validated_data):
        initial_customer = validated_data.pop("first_customer")
        source = BusinessSource.objects.create(**validated_data)
        # Keep the first customer and its source together if either insert fails.
        Customer.objects.create(business_source=source, **initial_customer)
        return source
