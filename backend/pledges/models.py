from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models, transaction
from django.db.models import Q
from django.db.models import Max
from django.utils import timezone

from accounts.models import Customer


NEPAL_TIME_ZONE = ZoneInfo("Asia/Kathmandu")


def nepal_today():
    return timezone.now().astimezone(NEPAL_TIME_ZONE).date()


def generate_pledge_number():
    return f"PLG-{uuid4().hex.upper()}"


class Pledge(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        REDEEMED = "REDEEMED", "Redeemed"
        CANCELLED = "CANCELLED", "Cancelled"

    pledge_number = models.CharField(
        max_length=36,
        unique=True,
        default=generate_pledge_number,
        editable=False,
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="pledges",
    )
    pledge_date = models.DateField(default=nepal_today)
    amount_received = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    redeemed_date = models.DateField(null=True, blank=True, editable=False)
    cancelled_date = models.DateField(null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-pledge_date", "-id"]
        indexes = [
            models.Index(fields=["customer", "pledge_date"]),
            models.Index(fields=["status", "due_date"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(amount_received__gte=0),
                name="pledge_amount_received_nonnegative",
            ),
        ]

    def __str__(self):
        return self.pledge_number

    def clean(self):
        super().clean()
        errors = {}

        if self.due_date and self.pledge_date and self.due_date < self.pledge_date:
            errors["due_date"] = "Due date cannot be before the pledge date."
        if (
            self.redeemed_date
            and self.pledge_date
            and self.redeemed_date < self.pledge_date
        ):
            errors["redeemed_date"] = "Redemption date cannot be before the pledge date."
        if (
            self.cancelled_date
            and self.pledge_date
            and self.cancelled_date < self.pledge_date
        ):
            errors["cancelled_date"] = "Cancellation date cannot be before the pledge date."

        previous_status = None
        if self.pk:
            previous_status = (
                type(self).objects.filter(pk=self.pk)
                .values_list("status", flat=True)
                .first()
            )

        if previous_status is None:
            if self.status != self.Status.ACTIVE:
                errors["status"] = "A pledge must be created as active."
        elif previous_status != self.status:
            if previous_status != self.Status.ACTIVE or self.status not in (
                self.Status.REDEEMED,
                self.Status.CANCELLED,
            ):
                errors["status"] = "Only active pledges can be redeemed or cancelled."

        if self.status == self.Status.ACTIVE:
            if self.redeemed_date or self.cancelled_date:
                errors["status"] = "Active pledges cannot have a redemption or cancellation date."
        elif self.status == self.Status.REDEEMED:
            if not self.redeemed_date:
                errors["redeemed_date"] = "Redeemed pledges require a redemption date."
            if self.cancelled_date:
                errors["cancelled_date"] = "Redeemed pledges cannot have a cancellation date."
        elif self.status == self.Status.CANCELLED:
            if not self.cancelled_date:
                errors["cancelled_date"] = "Cancelled pledges require a cancellation date."
            if self.redeemed_date:
                errors["redeemed_date"] = "Cancelled pledges cannot have a redemption date."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        previous_status = None
        if self.pk:
            previous_status = (
                type(self).objects.filter(pk=self.pk)
                .values_list("status", flat=True)
                .first()
            )
        if previous_status == self.Status.ACTIVE and self.status == self.Status.REDEEMED:
            self.redeemed_date = self.redeemed_date or nepal_today()
        elif previous_status == self.Status.ACTIVE and self.status == self.Status.CANCELLED:
            self.cancelled_date = self.cancelled_date or nepal_today()

        if kwargs.get("update_fields") is not None and previous_status != self.status:
            update_fields = set(kwargs["update_fields"])
            update_fields.add("updated_at")
            if self.status == self.Status.REDEEMED:
                update_fields.add("redeemed_date")
            elif self.status == self.Status.CANCELLED:
                update_fields.add("cancelled_date")
            kwargs["update_fields"] = update_fields

        self.full_clean()
        super().save(*args, **kwargs)

    @property
    def is_overdue(self):
        return (
            self.status == self.Status.ACTIVE
            and self.due_date is not None
            and self.due_date < nepal_today()
        )


class PledgeItem(models.Model):
    pledge = models.ForeignKey(
        Pledge,
        on_delete=models.CASCADE,
        related_name="items",
    )
    sequence = models.PositiveIntegerField(default=0)
    description = models.CharField(max_length=500)
    weight_grams = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        validators=[MinValueValidator(Decimal("0.000"))],
    )
    quantity = models.PositiveIntegerField(validators=[MinValueValidator(1)])

    class Meta:
        ordering = ["sequence", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["pledge", "sequence"],
                name="unique_pledge_item_sequence",
            ),
            models.CheckConstraint(
                condition=Q(weight_grams__gte=0),
                name="pledge_item_weight_nonnegative",
            ),
            models.CheckConstraint(
                condition=Q(quantity__gte=1),
                name="pledge_item_quantity_positive",
            ),
        ]

    def __str__(self):
        return self.description

    def save(self, *args, **kwargs):
        if not self.sequence:
            with transaction.atomic():
                Pledge.objects.select_for_update().get(pk=self.pledge_id)
                current_max = (
                    type(self).objects.filter(pledge_id=self.pledge_id)
                    .aggregate(sequence=Max("sequence"))["sequence"]
                    or 0
                )
                self.sequence = current_max + 1
                self.full_clean()
                super().save(*args, **kwargs)
            return

        self.full_clean()
        super().save(*args, **kwargs)
