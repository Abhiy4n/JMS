from django.db import migrations, models


def preserve_existing_credit_terms(apps, schema_editor):
    CustomerCredit = apps.get_model("billing", "CustomerCredit")
    CustomerCredit.objects.filter(credit_customer_type="COMPANY").update(
        credit_interest_type="PERCENTAGE", credit_period_days=15,
    )
    CustomerCredit.objects.exclude(credit_customer_type="COMPANY").update(
        credit_interest_type="PERCENTAGE", credit_period_days=30,
    )


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0012_backfill_business_source_interest_terms"),
        ("billing", "0006_bill_interest_enabled_customercredit_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="customercredit",
            name="credit_interest_amount",
            field=models.DecimalField(decimal_places=4, max_digits=16),
        ),
        migrations.AddField(
            model_name="customercredit",
            name="credit_interest_type",
            field=models.CharField(
                choices=[("PERCENTAGE", "Percentage"), ("FIXED_AMOUNT", "Fixed Amount")],
                default="PERCENTAGE",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="customercredit",
            name="credit_period_days",
            field=models.PositiveIntegerField(default=30),
        ),
        migrations.RunPython(preserve_existing_credit_terms, migrations.RunPython.noop),
    ]
