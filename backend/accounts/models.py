import uuid
from decimal import Decimal

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    ADMIN = "Admin", "Admin"
    # Add Member, Editor later — CharField needs no schema change for new values.


BUSINESS_SOURCE_TERM_PRESETS = {
    "INDIVIDUAL": (Decimal("2.00"), 30, Decimal("2.00"), 30),
    "COMPANY": (Decimal("1.00"), 15, Decimal("2.00"), 30),
}


class UserManager(BaseUserManager):
    def create_user(self, email, name, password=None, **extra_fields):
        if not email:
            raise ValueError("Users must have an email address")
        if not name:
            raise ValueError("Users must have a name")

        email = self.normalize_email(email).lower()
        user = self.model(email=email, name=name, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, name, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        extra_fields.setdefault("role", Role.ADMIN)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")

        return self.create_user(email, name, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=255)
    company_name = models.CharField(max_length=255, default="Admin")
    profile_picture = models.URLField(blank=True)
    role = models.CharField(
        max_length=32,
        choices=Role.choices,
        default=Role.ADMIN,
    )
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    class Meta:
        ordering = ["email"]

    def __str__(self):
        return self.email


class UserSession(models.Model):
    """A server-side record that makes an issued JWT session revocable."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="auth_sessions")
    token_hash = models.CharField(max_length=64, unique=True, editable=False)
    device_hash = models.CharField(max_length=64, db_index=True, editable=False)
    device_name = models.CharField(max_length=255, default="Unknown device")
    device_type = models.CharField(max_length=32, default="unknown")
    browser = models.CharField(max_length=100, default="Unknown browser")
    operating_system = models.CharField(max_length=100, default="Unknown OS")
    user_agent = models.CharField(max_length=512, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    location = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    last_seen_at = models.DateTimeField(default=timezone.now, db_index=True)
    expires_at = models.DateTimeField(db_index=True)
    revoked_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-last_seen_at", "-created_at"]
        indexes = [
            models.Index(fields=["user", "revoked_at", "expires_at"]),
        ]

    @property
    def is_active(self):
        return self.revoked_at is None and self.expires_at > timezone.now()

    def __str__(self):
        return f"{self.user.email} on {self.device_name}"


class LoginEvent(models.Model):
    """An immutable successful-login event retained independently of a session."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="login_events")
    session = models.ForeignKey(
        UserSession,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="login_events",
    )
    is_new_device = models.BooleanField(default=False)
    device_name = models.CharField(max_length=255, default="Unknown device")
    device_type = models.CharField(max_length=32, default="unknown")
    browser = models.CharField(max_length=100, default="Unknown browser")
    operating_system = models.CharField(max_length=100, default="Unknown OS")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    location = models.CharField(max_length=255, blank=True)
    occurred_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-occurred_at", "-id"]
        indexes = [models.Index(fields=["user", "-occurred_at"])]

    def __str__(self):
        return f"Login by {self.user.email} at {self.occurred_at}"


class BusinessSource(models.Model):
    class Type(models.TextChoices):
        INDIVIDUAL = "INDIVIDUAL", "Individual"
        COMPANY = "COMPANY", "Company"
        DYNAMIC = "DYNAMIC", "Dynamic"

    class InterestType(models.TextChoices):
        PERCENTAGE = "PERCENTAGE", "Percentage"
        FIXED_AMOUNT = "FIXED_AMOUNT", "Fixed Amount"

    class ChannelType(models.TextChoices):
        DIRECT = "DIRECT", "Direct"
        MARKETING = "MARKETING", "Marketing"
        REFERRAL = "REFERRAL", "Referral"
        DEALER = "DEALER", "Dealer"
        CORPORATE = "CORPORATE", "Corporate"
        BRANCH = "BRANCH", "Branch"
        OTHER = "OTHER", "Other"

    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"

    name = models.CharField(max_length=255, unique=True)
    # Source identity and market segment are independent of customer contacts.
    source_type = models.CharField(max_length=16, choices=Type.choices, default=Type.INDIVIDUAL)
    phone = models.CharField(max_length=10, blank=True)
    pan_vat_number = models.CharField(max_length=32, blank=True)
    market_segment = models.CharField(max_length=255, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    interest_type = models.CharField(max_length=16, choices=InterestType.choices, null=True, blank=True)
    interest_percentage = models.DecimalField(max_digits=9, decimal_places=4, null=True, blank=True)
    interest_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    days = models.PositiveIntegerField(null=True, blank=True)
    monthly_interest_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    interest_credit_basis = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    upfront_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.00")), MaxValueValidator(Decimal("100.00"))],
    )
    upfront_days = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
    )
    daily_percent = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.00")), MaxValueValidator(Decimal("100.00"))],
    )
    daily_divisor = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1)],
    )
    channel_type = models.CharField(
        max_length=20,
        choices=ChannelType.choices,
        default=ChannelType.OTHER,
    )
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="business_sources_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def credit_terms(self):
        if self.interest_type == self.InterestType.PERCENTAGE:
            return self.interest_type, self.interest_percentage, Decimal("100.00"), self.days
        if self.interest_type == self.InterestType.FIXED_AMOUNT:
            return self.interest_type, self.interest_amount, Decimal("1.00"), self.days
        # Compatibility for sources created before configurable terms existed.
        if self.source_type == self.Type.DYNAMIC:
            return self.InterestType.PERCENTAGE, self.monthly_interest_amount, self.interest_credit_basis, 30
        period_days = 15 if self.source_type == self.Type.COMPANY else 30
        return self.InterestType.PERCENTAGE, Decimal("2000.00"), Decimal("100000.00"), period_days

    def pledge_terms(self):
        preset = BUSINESS_SOURCE_TERM_PRESETS.get(self.source_type)
        if preset is not None:
            return preset
        terms = (
            self.upfront_percent,
            self.upfront_days,
            self.daily_percent,
            self.daily_divisor,
        )
        return terms if all(value is not None for value in terms) else None


class BusinessSourceTermEditLogQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ValidationError("Business Source edit logs are append-only.")

    def delete(self):
        raise ValidationError("Business Source edit logs are append-only.")


class BusinessSourceTermEditLog(models.Model):
    source = models.ForeignKey(BusinessSource, on_delete=models.PROTECT, related_name="term_edit_logs")
    edit_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    field = models.CharField(max_length=64)
    old_value = models.TextField()
    new_value = models.TextField()
    changed_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name="business_source_term_edits")
    changed_at = models.DateTimeField(auto_now_add=True)
    reason = models.CharField(max_length=500)
    objects = BusinessSourceTermEditLogQuerySet.as_manager()

    class Meta:
        ordering = ["-changed_at", "-id"]

    def clean(self):
        super().clean()
        self.reason = self.reason.strip()
        if len(self.reason) < 5:
            raise ValidationError({"reason": "Reason must contain at least 5 non-space characters."})

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Business Source edit logs are append-only.")
        self.full_clean()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Business Source edit logs are append-only.")


class Customer(models.Model):
    class Type(models.TextChoices):
        INDIVIDUAL = "INDIVIDUAL", "Individual"
        COMPANY = "COMPANY", "Company"
        DYNAMIC = "DYNAMIC", "Dynamic Customer"

    # One directory entry represents the source; other linked contacts stay distinct.
    source_entry = models.OneToOneField(
        BusinessSource, on_delete=models.PROTECT, related_name="customer_entry",
        null=True, blank=True,
    )
    # A linked source governs new credit terms; unlinked customers retain theirs.
    business_source = models.ForeignKey(
        BusinessSource,
        on_delete=models.PROTECT,
        related_name="customers",
        null=True,
        blank=True,
    )
    customer_type = models.CharField(max_length=16, choices=Type.choices, default=Type.INDIVIDUAL)
    # Dynamic terms mean rupees of interest per this credit basis per 30 days.
    monthly_interest_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    interest_credit_basis = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self):
        return self.name

    def credit_terms(self):
        if self.business_source_id:
            return self.business_source.credit_terms()
        if self.customer_type == self.Type.DYNAMIC:
            return BusinessSource.InterestType.PERCENTAGE, self.monthly_interest_amount, self.interest_credit_basis, 30
        period_days = 15 if self.customer_type == self.Type.COMPANY else 30
        return BusinessSource.InterestType.PERCENTAGE, Decimal("2000.00"), Decimal("100000.00"), period_days

    @property
    def effective_customer_type(self):
        return self.business_source.source_type if self.business_source_id else self.customer_type


class BhakaPatra(models.Model):
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="bhaka_patras")
    reference = models.CharField(max_length=100, unique=True)
    transaction_date = models.DateField(null=True, blank=True)
    principal_amount = models.DecimalField(max_digits=14, decimal_places=2)
    # Recorded interest only. No rate or accrual rule is implied by this document.
    interest_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    additional_charges = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    discount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    outstanding_balance = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True)
    settlement_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class BhakaPatraItem(models.Model):
    bhaka_patra = models.ForeignKey(BhakaPatra, on_delete=models.CASCADE, related_name="items")
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    quantity = models.DecimalField(max_digits=14, decimal_places=3, null=True, blank=True)
    rate = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ["id"]
