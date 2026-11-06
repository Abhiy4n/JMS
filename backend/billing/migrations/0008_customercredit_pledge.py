import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("billing", "0007_customer_credit_interest_method_and_period"),
        ("pledges", "0002_alter_pledge_pledge_date_alter_pledgeitem_quantity_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="customercredit",
            name="pledge",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="credit",
                to="pledges.pledge",
            ),
        ),
    ]
