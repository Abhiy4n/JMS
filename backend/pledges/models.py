import uuid
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models, transaction
from django.db.models import Max, Q
from django.utils import timezone

from accounts.models import BusinessSource, Customer


NEPAL_TIME_ZONE = ZoneInfo("Asia/Kathmandu")


def nepal_today():
    return timezone.now().astimezone(NEPAL_TIME_ZONE).date()


def generate_pledge_number():
    return f"PLG-{uuid.uuid4().hex.upper()}"


class Pledge(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        CLOSED = "CLOSED", "Closed"
        FORFEITED = "FORFEITED", "Forfeited"

    pledge_number = models.CharField(max_length=36, unique=True, default=generate_pledge_number, editable=False)
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="pledges")
    business_source = models.ForeignKey(BusinessSource, on_delete=models.PROTECT, related_name="pledges")
    pledge_date = models.DateField(default=nepal_today)
    due_date = models.DateField(null=True, blank=True)
    written_text = models.TextField(blank=True)
    customer_name = models.CharField(max_length=255)
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=32, blank=True)
    principal_amount = models.DecimalField(max_digits=14, decimal_places=2, validators=[MinValueValidator(Decimal("0.01"))])
    upfront_percent = models.DecimalField(
        max_digits=5, decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00")), MaxValueValidator(Decimal("100.00"))],
    )
    upfront_days = models.PositiveIntegerField(validators=[MinValueValidator(0)])
    daily_percent = models.DecimalField(
        max_digits=5, decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00")), MaxValueValidator(Decimal("100.00"))],
    )
    daily_divisor = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-pledge_date", "-id"]
        indexes = [
            models.Index(fields=["customer", "pledge_date"]),
            models.Index(fields=["business_source", "pledge_date"], name="pledge_source_date_idx"),
            models.Index(fields=["status", "pledge_date"], name="pledge_status_date_idx"),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(principal_amount__gt=0), name="pledge_principal_amount_positive"),
        ]

    def __str__(self):
        return self.pledge_number

    def clean(self):
        super().clean()
        errors = {}
        source = self.business_source if self.business_source_id else None
        terms = source.pledge_terms() if source else None
        if source and not terms:
            errors["business_source"] = "Business Source has incomplete pledge interest terms."
        if not self.pk:
            if source and source.status != BusinessSource.Status.ACTIVE:
                errors["business_source"] = "Inactive Business Sources cannot be used for new pledges."
            if source and self.customer_id and self.customer.business_source_id != self.business_source_id:
                errors["business_source"] = "The selected customer must be linked to this Business Source."
            if terms and tuple(terms) != (
                self.upfront_percent, self.upfront_days, self.daily_percent, self.daily_divisor,
            ):
                errors["business_source"] = "Pledge interest terms must be copied from its Business Source."
            if self.status != self.Status.ACTIVE:
                errors["status"] = "A pledge must be created as active."
        else:
            previous = type(self).objects.filter(pk=self.pk).values(
                "status", "customer_id", "business_source_id", "pledge_date", "due_date",
                "written_text", "customer_name", "address", "phone", "principal_amount",
                "upfront_percent", "upfront_days", "daily_percent", "daily_divisor",
            ).first()
            if previous:
                changed = (
                    previous["customer_id"] != self.customer_id
                    or previous["business_source_id"] != self.business_source_id
                    or previous["pledge_date"] != self.pledge_date
                    or previous["due_date"] != self.due_date
                    or previous["written_text"] != self.written_text
                    or previous["customer_name"] != self.customer_name
                    or previous["address"] != self.address
                    or previous["phone"] != self.phone
                    or previous["principal_amount"] != self.principal_amount
                    or previous["upfront_percent"] != self.upfront_percent
                    or previous["upfront_days"] != self.upfront_days
                    or previous["daily_percent"] != self.daily_percent
                    or previous["daily_divisor"] != self.daily_divisor
                )
                if changed and self.payments.exists():
                    errors["pledge"] = "Pledge terms are locked after the first payment."
                if (
                    (previous["customer_id"] != self.customer_id
                     or previous["business_source_id"] != self.business_source_id)
                    and self.customer_id
                    and source
                    and self.customer.business_source_id != self.business_source_id
                ):
                    errors["business_source"] = "The selected customer must be linked to this Business Source."
                if previous["business_source_id"] != self.business_source_id and source:
                    if source.status != BusinessSource.Status.ACTIVE:
                        errors["business_source"] = "Inactive Business Sources cannot be selected."
                allowed = {
                    self.Status.ACTIVE: (self.Status.CLOSED, self.Status.FORFEITED),
                    self.Status.CLOSED: (self.Status.ACTIVE,),
                    self.Status.FORFEITED: (self.Status.ACTIVE,),
                }
                if previous["status"] != self.status and self.status not in allowed.get(previous["status"], ()):
                    errors["status"] = "This pledge status transition is not allowed."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    @property
    def is_partially_paid(self):
        return self.payments.filter(is_voided=False, principal_amount__gt=0).exists()


class PledgePayment(models.Model):
    pledge = models.ForeignKey(Pledge, on_delete=models.PROTECT, related_name="payments")
    payment_date = models.DateField(default=nepal_today)
    interest_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    principal_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    is_voided = models.BooleanField(default=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="pledge_payments")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["payment_date", "id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(interest_amount__gte=0) & Q(principal_amount__gte=0),
                name="pledge_payment_amounts_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(interest_amount__gt=0) | Q(principal_amount__gt=0),
                name="pledge_payment_not_empty",
            ),
        ]

    def clean(self):
        super().clean()
        if self.interest_amount == 0 and self.principal_amount == 0:
            raise ValidationError("A payment must include interest, principal, or both.")

    def delete(self, *args, **kwargs):
        raise ValidationError("Payments cannot be deleted; use the logged removal action.")

    @property
    def total_amount(self):
        return self.interest_amount + self.principal_amount


class AppendOnlyQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ValidationError("Edit logs are append-only.")

    def delete(self):
        raise ValidationError("Edit logs are append-only.")


class PledgeEditLog(models.Model):
    pledge = models.ForeignKey(Pledge, on_delete=models.PROTECT, related_name="edit_logs")
    payment = models.ForeignKey(
        PledgePayment, on_delete=models.PROTECT, related_name="edit_logs", null=True, blank=True,
    )
    edit_id = models.UUIDField(default=uuid.uuid4, db_index=True)
    field = models.CharField(max_length=64)
    old_value = models.TextField(blank=True)
    new_value = models.TextField(blank=True)
    effective_date = models.DateField(null=True, blank=True)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name="pledge_edit_logs",
    )
    changed_at = models.DateTimeField(auto_now_add=True)
    reason = models.CharField(max_length=500, blank=True)
    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        ordering = ["-changed_at", "-id"]

    def clean(self):
        super().clean()
        self.reason = self.reason.strip()
        optional_close = self.field == "status" and self.old_value == "ACTIVE" and self.new_value == "CLOSED"
        if len(self.reason) < 5 and not optional_close:
            raise ValidationError({"reason": "Reason must contain at least 5 non-space characters."})

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Edit logs are append-only.")
        self.full_clean()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Edit logs are append-only.")

    def __str__(self):
        return f"{self.pledge.pledge_number}: {self.field}"


def record_pledge_changes(pledge, changes, changed_by, reason, *, effective_date=None, payment=None):
    edit_id = uuid.uuid4()
    logs = []
    for field, old_value, new_value in changes:
        if old_value == new_value:
            continue
        log = PledgeEditLog(
            pledge=pledge,
            payment=payment,
            edit_id=edit_id,
            field=field,
            old_value=str(old_value),
            new_value=str(new_value),
            effective_date=effective_date,
            changed_by=changed_by,
            reason=reason,
        )
        log.save()
        logs.append(log)
    return logs


class PledgeItem(models.Model):
    class Unit(models.TextChoices):
        TOLA = "TOLA", "तोला"
        LAAL = "LAAL", "लाल"
        GRAM = "GRAM", "ग्राम"

    pledge = models.ForeignKey(Pledge, on_delete=models.CASCADE, related_name="items")
    sequence = models.PositiveIntegerField(default=0)
    particulars = models.CharField(max_length=500)
    weight = models.DecimalField(
        max_digits=12, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))],
    )
    unit = models.CharField(max_length=8, choices=Unit.choices)
    ghat = models.TextField(blank=True)
    jor = models.DecimalField(
        max_digits=12, decimal_places=3, validators=[MinValueValidator(Decimal("0.001"))],
    )

    class Meta:
        ordering = ["sequence", "id"]
        constraints = [
            models.UniqueConstraint(fields=["pledge", "sequence"], name="unique_pledge_item_sequence"),
            models.CheckConstraint(condition=Q(weight__gte=0), name="pledge_item_weight_nonnegative"),
            models.CheckConstraint(condition=Q(jor__gt=0), name="pledge_item_quantity_positive"),
        ]

    def __str__(self):
        return self.particulars

    def clean(self):
        super().clean()
        if self.pledge_id and PledgePayment.objects.filter(pledge_id=self.pledge_id).exists():
            raise ValidationError("Pledge items are locked after the first payment.")

    def save(self, *args, **kwargs):
        if not self.sequence:
            with transaction.atomic():
                Pledge.objects.select_for_update().get(pk=self.pledge_id)
                self.sequence = (type(self).objects.filter(pledge_id=self.pledge_id).aggregate(
                    sequence=Max("sequence"),
                )["sequence"] or 0) + 1
                self.full_clean()
                super().save(*args, **kwargs)
            return
        self.full_clean()
        super().save(*args, **kwargs)
