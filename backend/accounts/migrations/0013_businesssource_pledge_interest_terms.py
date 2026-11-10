import django.core.validators
from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0012_backfill_business_source_interest_terms"),
    ]

    operations = [
        migrations.AddField(
            model_name="businesssource",
            name="upfront_percent",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=5,
                null=True,
                validators=[
                    django.core.validators.MinValueValidator(Decimal("0.00")),
                    django.core.validators.MaxValueValidator(Decimal("100.00")),
                ],
            ),
        ),
        migrations.AddField(
            model_name="businesssource",
            name="upfront_days",
            field=models.PositiveIntegerField(
                blank=True,
                null=True,
                validators=[django.core.validators.MinValueValidator(0)],
            ),
        ),
        migrations.AddField(
            model_name="businesssource",
            name="daily_percent",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=5,
                null=True,
                validators=[
                    django.core.validators.MinValueValidator(Decimal("0.00")),
                    django.core.validators.MaxValueValidator(Decimal("100.00")),
                ],
            ),
        ),
        migrations.AddField(
            model_name="businesssource",
            name="daily_divisor",
            field=models.PositiveIntegerField(
                blank=True,
                null=True,
                validators=[django.core.validators.MinValueValidator(1)],
            ),
        ),
    ]
