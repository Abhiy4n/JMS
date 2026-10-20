from django.db import migrations


def backfill(apps, schema_editor):
    Source = apps.get_model("accounts", "BusinessSource")
    Customer = apps.get_model("accounts", "Customer")
    alias = schema_editor.connection.alias
    for source in Source.objects.using(alias).all().iterator():
        if Customer.objects.using(alias).filter(source_entry_id=source.pk).exists():
            continue
        # Existing linked IDs and their financial records are retained.
        customer = Customer.objects.using(alias).filter(business_source_id=source.pk).order_by("id").first()
        if customer is None:
            customer = Customer.objects.using(alias).create(
                business_source_id=source.pk, name=source.name, phone=source.phone,
                email=source.email, customer_type=source.source_type,
                monthly_interest_amount=source.monthly_interest_amount,
                interest_credit_basis=source.interest_credit_basis,
            )
        customer.source_entry_id = source.pk
        customer.save(using=alias, update_fields=["source_entry"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0008_customer_source_entry_bhakapatra_bhakapatraitem")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
