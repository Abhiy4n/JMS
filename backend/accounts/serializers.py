from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers

from .models import BusinessSource, Customer, Role, User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "name", "email", "role")
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


class CustomerSerializer(serializers.ModelSerializer):
    source_name = serializers.CharField(source="business_source.name", read_only=True)

    class Meta:
        model = Customer
        fields = (
            "id",
            "name",
            "phone",
            "email",
            "business_source",
            "source_name",
            "created_at",
        )
        read_only_fields = ("id", "source_name", "created_at")


class InitialCustomerSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True)
    email = serializers.EmailField(required=False, allow_blank=True)


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
