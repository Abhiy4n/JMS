from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

from accounts.models import Customer


MONEY_PLACES = Decimal("0.01")
WEIGHT_PLACES = Decimal("0.001")


def quantize_money(value):
    return value.quantize(MONEY_PLACES, rounding=ROUND_HALF_UP)


class Bill(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        UNPAID = "UNPAID", "Unpaid"
        PARTIAL = "PARTIAL", "Partial"
        PAID = "PAID", "Paid"
        CANCELLED = "CANCELLED", "Cancelled"

    bill_number = models.CharField(max_length=64, unique=True)
    customer = models.ForeignKey(
        Customer,
        on_delete=models.PROTECT,
        related_name="bills",
    )
    bill_date = models.DateField(default=timezone.localdate)
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    discount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    vat = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    grand_total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    amount_due = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    payment_method = models.CharField(max_length=40, blank=True)
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-bill_date", "-id"]

    def __str__(self):
        return self.bill_number

    def recalculate_totals(self, status_override=None):
        item_total = sum((item.total for item in self.items.all()), Decimal("0.00"))
        self.subtotal = quantize_money(item_total)
        self.grand_total = quantize_money(self.subtotal - self.discount + self.vat)
        self.amount_due = quantize_money(self.grand_total - self.amount_paid)

        if status_override in (self.Status.DRAFT, self.Status.CANCELLED):
            self.status = status_override
        elif self.grand_total > 0 and self.amount_due == 0:
            self.status = self.Status.PAID
        elif self.amount_paid > 0:
            self.status = self.Status.PARTIAL
        else:
            self.status = self.Status.UNPAID

        self.save(
            update_fields=(
                "subtotal",
                "grand_total",
                "amount_due",
                "status",
                "updated_at",
            )
        )


class BillItem(models.Model):
    class Material(models.TextChoices):
        GOLD = "GOLD", "Gold"
        SILVER = "SILVER", "Silver"
        PLATINUM = "PLATINUM", "Platinum"
        DIAMOND = "DIAMOND", "Diamond"
        GEMSTONE = "GEMSTONE", "Gemstone"
        OTHER = "OTHER", "Other"

    class RateUnit(models.TextChoices):
        GRAM = "g", "Rs./g"
        PIECE = "piece", "Rs./piece"
        CARAT = "carat", "Rs./carat"
        ITEM = "item", "Rs./item"

    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name="items")
    item_name = models.CharField(max_length=255)
    material = models.CharField(
        max_length=10,
        choices=Material.choices,
        default=Material.GOLD,
    )
    rate_unit = models.CharField(
        max_length=10,
        choices=RateUnit.choices,
        default=RateUnit.GRAM,
    )
    quantity = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        validators=[MinValueValidator(Decimal("0.001"))],
    )
    gross_weight = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    stone_weight = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        default=Decimal("0.000"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    net_weight = models.DecimalField(max_digits=10, decimal_places=3, default=Decimal("0.000"))
    purity = models.DecimalField(
        max_digits=6,
        decimal_places=3,
        default=Decimal("0.000"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    rate = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    making_charge = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    discount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return self.item_name

    @staticmethod
    def calculate_rate_value_for(rate, rate_unit, quantity, net_weight):
        if rate_unit == BillItem.RateUnit.GRAM:
            rate_quantity = net_weight
        elif rate_unit == BillItem.RateUnit.CARAT:
            rate_quantity = net_weight * Decimal("5")
        else:
            rate_quantity = quantity
        return quantize_money(rate_quantity * rate)

    def calculate_rate_value(self):
        return self.calculate_rate_value_for(
            self.rate,
            self.rate_unit,
            self.quantity,
            self.net_weight,
        )

    def calculate_total(self):
        return quantize_money(
            self.calculate_rate_value() + self.making_charge - self.discount
        )

    def clean(self):
        errors = {}
        if (
            self.gross_weight is not None
            and self.stone_weight is not None
            and self.stone_weight > self.gross_weight
        ):
            errors["stone_weight"] = "Stone weight cannot exceed gross weight."

        if (
            self.rate_unit in (self.RateUnit.GRAM, self.RateUnit.CARAT)
            and self.gross_weight is not None
            and self.gross_weight <= 0
        ):
            errors["gross_weight"] = "Gross weight is required for weight-based pricing."

        if all(
            value is not None
            for value in (
                self.gross_weight,
                self.stone_weight,
                self.quantity,
                self.rate,
                self.making_charge,
                self.discount,
            )
        ):
            net_weight = self.gross_weight - self.stone_weight
            rate_value = self.calculate_rate_value_for(
                self.rate,
                self.rate_unit,
                self.quantity,
                net_weight,
            )
            if self.discount > rate_value + self.making_charge:
                errors["discount"] = "Item discount cannot exceed the item value."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.net_weight = (self.gross_weight - self.stone_weight).quantize(WEIGHT_PLACES)
        self.total = self.calculate_total()
        self.full_clean()
        super().save(*args, **kwargs)