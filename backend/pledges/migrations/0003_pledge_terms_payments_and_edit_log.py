import django.core.validators
import django.db.models.deletion
import django.utils.timezone
import pledges.models
import uuid
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models


PRESETS = {
    "INDIVIDUAL": (Decimal("2.00"), 30, Decimal("2.00"), 30),
    "COMPANY": (Decimal("1.00"), 15, Decimal("2.00"), 30),
}
DYNAMIC_DEFAULT = (Decimal("0.00"), 0, Decimal("0.00"), 1)


def backfill_pledge_terms(apps, schema_editor):
    Pledge = apps.get_model("pledges", "Pledge")
    Customer = apps.get_model("accounts", "Customer")
    BusinessSource = apps.get_model("accounts", "BusinessSource")

    customers = {c.id: c for c in Customer.objects.all()}
    sources = {s.id: s for s in BusinessSource.objects.all()}

    for pledge in Pledge.objects.all():
        customer = customers.get(pledge.customer_id)
        source = sources.get(customer.business_source_id) if customer and customer.business_source_id else None
        if source is None:
            raise RuntimeError(
                f"Pledge {pledge.id} customer {pledge.customer_id} has no Business Source; cannot migrate."
            )

        terms = (
            source.upfront_percent,
            source.upfront_days,
            source.daily_percent,
            source.daily_divisor,
        )
        if any(value is None for value in terms):
            terms = PRESETS.get(source.source_type, DYNAMIC_DEFAULT)

        pledge.principal_amount = pledge.amount_received
        pledge.business_source_id = source.id
        pledge.upfront_percent, pledge.upfront_days, pledge.daily_percent, pledge.daily_divisor = terms
        pledge.save(
            update_fields=[
                "principal_amount",
                "business_source_id",
                "upfront_percent",
                "upfront_days",
                "daily_percent",
                "daily_divisor",
            ]
        )


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0013_businesssource_pledge_interest_terms"),
        ("pledges", "0002_alter_pledge_pledge_date_alter_pledgeitem_quantity_and_more"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="pledge",
            name="pledge_amount_received_nonnegative",
        ),
        migrations.RemoveIndex(
            model_name="pledge",
            name="pledges_ple_status_867b39_idx",
        ),
        migrations.RemoveField(
            model_name="pledge",
            name="redeemed_date",
        ),
        migrations.RemoveField(
            model_name="pledge",
            name="cancelled_date",
        ),
        migrations.AlterField(
            model_name="pledge",
            name="status",
            field=models.CharField(
                choices=[
                    ("ACTIVE", "Active"),
                    ("CLOSED", "Closed"),
                    ("FORFEITED", "Forfeited"),
                ],
                default="ACTIVE",
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="pledge",
            name="principal_amount",
            field=models.DecimalField(
                decimal_places=2,
                max_digits=14,
                null=True,
                validators=[django.core.validators.MinValueValidator(Decimal("0.01"))],
            ),
        ),
        migrations.AddField(
            model_name="pledge",
            name="upfront_percent",
            field=models.DecimalField(
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
            model_name="pledge",
            name="upfront_days",
            field=models.PositiveIntegerField(
                null=True,
                validators=[django.core.validators.MinValueValidator(0)],
            ),
        ),
        migrations.AddField(
            model_name="pledge",
            name="daily_percent",
            field=models.DecimalField(
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
            model_name="pledge",
            name="daily_divisor",
            field=models.PositiveIntegerField(
                null=True,
                validators=[django.core.validators.MinValueValidator(1)],
            ),
        ),
        migrations.AddField(
            model_name="pledge",
            name="business_source",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="pledges",
                to="accounts.businesssource",
            ),
        ),
        migrations.RunPython(backfill_pledge_terms, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="pledge",
            name="amount_received",
        ),
        migrations.AlterField(
            model_name="pledge",
            name="principal_amount",
            field=models.DecimalField(
                decimal_places=2,
                max_digits=14,
                validators=[django.core.validators.MinValueValidator(Decimal("0.01"))],
            ),
        ),
        migrations.AlterField(
            model_name="pledge",
            name="upfront_percent",
            field=models.DecimalField(
                decimal_places=2,
                max_digits=5,
                validators=[
                    django.core.validators.MinValueValidator(Decimal("0.00")),
                    django.core.validators.MaxValueValidator(Decimal("100.00")),
                ],
            ),
        ),
        migrations.AlterField(
            model_name="pledge",
            name="upfront_days",
            field=models.PositiveIntegerField(
                validators=[django.core.validators.MinValueValidator(0)],
            ),
        ),
        migrations.AlterField(
            model_name="pledge",
            name="daily_percent",
            field=models.DecimalField(
                decimal_places=2,
                max_digits=5,
                validators=[
                    django.core.validators.MinValueValidator(Decimal("0.00")),
                    django.core.validators.MaxValueValidator(Decimal("100.00")),
                ],
            ),
        ),
        migrations.AlterField(
            model_name="pledge",
            name="daily_divisor",
            field=models.PositiveIntegerField(
                validators=[django.core.validators.MinValueValidator(1)],
            ),
        ),
        migrations.AlterField(
            model_name="pledge",
            name="business_source",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="pledges",
                to="accounts.businesssource",
            ),
        ),
        migrations.AddIndex(
            model_name="pledge",
            index=models.Index(
                fields=["business_source", "pledge_date"],
                name="pledge_source_date_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="pledge",
            index=models.Index(
                fields=["status", "pledge_date"],
                name="pledge_status_date_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="pledge",
            constraint=models.CheckConstraint(
                condition=models.Q(("principal_amount__gt", 0)),
                name="pledge_principal_amount_positive",
            ),
        ),
        migrations.CreateModel(
            name="PledgePayment",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "payment_date",
                    models.DateField(default=pledges.models.nepal_today),
                ),
                (
                    "interest_amount",
                    models.DecimalField(
                        decimal_places=2,
                        default=Decimal("0.00"),
                        max_digits=14,
                        validators=[django.core.validators.MinValueValidator(Decimal("0.00"))],
                    ),
                ),
                (
                    "principal_amount",
                    models.DecimalField(
                        decimal_places=2,
                        default=Decimal("0.00"),
                        max_digits=14,
                        validators=[django.core.validators.MinValueValidator(Decimal("0.00"))],
                    ),
                ),
                ("is_voided", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "created_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="pledge_payments",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "pledge",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="payments",
                        to="pledges.pledge",
                    ),
                ),
            ],
            options={"ordering": ["payment_date", "id"]},
        ),
        migrations.AddConstraint(
            model_name="pledgepayment",
            constraint=models.CheckConstraint(
                condition=models.Q(("interest_amount__gte", 0), ("principal_amount__gte", 0)),
                name="pledge_payment_amounts_nonnegative",
            ),
        ),
        migrations.AddConstraint(
            model_name="pledgepayment",
            constraint=models.CheckConstraint(
                condition=models.Q(("interest_amount__gt", 0), ("principal_amount__gt", 0), _connector="OR"),
                name="pledge_payment_not_empty",
            ),
        ),
        migrations.CreateModel(
            name="PledgeEditLog",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("edit_id", models.UUIDField(db_index=True, default=uuid.uuid4)),
                ("field", models.CharField(max_length=64)),
                ("old_value", models.TextField()),
                ("new_value", models.TextField()),
                ("changed_at", models.DateTimeField(auto_now_add=True)),
                (
                    "reason",
                    models.CharField(
                        max_length=500,
                        validators=[django.core.validators.MinLengthValidator(5)],
                    ),
                ),
                (
                    "changed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="pledge_edit_logs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "payment",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="edit_logs",
                        to="pledges.pledgepayment",
                    ),
                ),
                (
                    "pledge",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="edit_logs",
                        to="pledges.pledge",
                    ),
                ),
            ],
            options={"ordering": ["-changed_at", "-id"]},
        ),
    ]
