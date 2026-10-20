from django.db import migrations


def initialize_existing_credit(apps, schema_editor):
    # Historical bills have no dated payment history. Preserve their current
    # outstanding principal when adopting the new credit ledger.
    Bill = apps.get_model("billing", "Bill")
    for bill in Bill.objects.select_related("customer").all():
        customer = bill.customer
        bill.initial_credit = bill.amount_due
        bill.credit_customer_type = customer.customer_type
        if customer.customer_type == "DYNAMIC":
            bill.credit_interest_amount = customer.monthly_interest_amount
            bill.credit_basis = customer.interest_credit_basis
        bill.save(update_fields=("initial_credit", "credit_customer_type", "credit_interest_amount", "credit_basis"))


class Migration(migrations.Migration):
    dependencies = [("billing", "0003_bill_credit_basis_bill_credit_customer_type_and_more")]
    operations = [migrations.RunPython(initialize_existing_credit, migrations.RunPython.noop)]
