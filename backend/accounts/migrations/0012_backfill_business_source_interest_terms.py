from decimal import Decimal, ROUND_HALF_UP

from django.db import migrations


def backfill_interest_terms(apps, schema_editor):
    BusinessSource = apps.get_model("accounts", "BusinessSource")
    for source in BusinessSource.objects.all().iterator():
        if source.interest_type:
            continue
        if source.source_type == "INDIVIDUAL":
            source.interest_type = "PERCENTAGE"
            source.interest_percentage = Decimal("2.0000")
            source.days = 30
        elif source.source_type == "COMPANY":
            source.interest_type = "PERCENTAGE"
            source.interest_percentage = Decimal("2.0000")
            source.days = 15
        elif source.monthly_interest_amount is not None and source.interest_credit_basis:
            source.interest_type = "PERCENTAGE"
            source.interest_percentage = (
                source.monthly_interest_amount * Decimal("100") / source.interest_credit_basis
            ).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            source.days = 30
        source.save(update_fields=(
            "interest_type", "interest_percentage", "interest_amount", "days",
        ))


class Migration(migrations.Migration):
    dependencies = [("accounts", "0011_user_company_name")]

    operations = [migrations.RunPython(backfill_interest_terms, migrations.RunPython.noop)]
