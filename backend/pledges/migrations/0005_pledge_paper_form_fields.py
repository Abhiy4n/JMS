import decimal
import django.core.validators
from django.db import migrations, models
from django.db.models import Q


def backfill_pledge_snapshots(apps, schema_editor):
    Pledge = apps.get_model("pledges", "Pledge")
    for pledge in Pledge.objects.select_related("customer", "business_source").iterator():
        pledge.customer_name = pledge.customer.name
        pledge.address = pledge.business_source.address
        pledge.phone = pledge.business_source.phone
        pledge.save(update_fields=("customer_name", "address", "phone"))


class Migration(migrations.Migration):

    dependencies = [
        ("pledges", "0004_remove_pledge_due_date_pledgeeditlog_effective_date_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="pledge",
            name="due_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="pledge",
            name="written_text",
            field=models.TextField(blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="pledge",
            name="customer_name",
            field=models.CharField(blank=True, default="", max_length=255),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="pledge",
            name="address",
            field=models.TextField(blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="pledge",
            name="phone",
            field=models.CharField(blank=True, default="", max_length=32),
            preserve_default=False,
        ),
        migrations.AlterField(
            model_name="pledgeeditlog",
            name="old_value",
            field=models.TextField(blank=True),
        ),
        migrations.AlterField(
            model_name="pledgeeditlog",
            name="new_value",
            field=models.TextField(blank=True),
        ),
        migrations.RemoveConstraint(
            model_name="pledgeitem",
            name="pledge_item_weight_nonnegative",
        ),
        migrations.RemoveConstraint(
            model_name="pledgeitem",
            name="pledge_item_quantity_positive",
        ),
        migrations.RenameField(
            model_name="pledgeitem",
            old_name="description",
            new_name="particulars",
        ),
        migrations.RenameField(
            model_name="pledgeitem",
            old_name="weight_grams",
            new_name="weight",
        ),
        migrations.RenameField(
            model_name="pledgeitem",
            old_name="quantity",
            new_name="jor",
        ),
        migrations.AddField(
            model_name="pledgeitem",
            name="unit",
            field=models.CharField(
                choices=[("TOLA", "तोला"), ("LAAL", "लाल"), ("GRAM", "ग्राम")],
                default="GRAM",
                max_length=8,
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="pledgeitem",
            name="ghat",
            field=models.TextField(blank=True, default=""),
            preserve_default=False,
        ),
        migrations.AlterField(
            model_name="pledgeitem",
            name="weight",
            field=models.DecimalField(
                decimal_places=3,
                max_digits=12,
                validators=[django.core.validators.MinValueValidator(decimal.Decimal("0.001"))],
            ),
        ),
        migrations.AlterField(
            model_name="pledgeitem",
            name="jor",
            field=models.DecimalField(
                decimal_places=3,
                max_digits=12,
                validators=[django.core.validators.MinValueValidator(decimal.Decimal("0.001"))],
            ),
        ),
        migrations.AddConstraint(
            model_name="pledgeitem",
            constraint=models.CheckConstraint(condition=Q(weight__gte=0), name="pledge_item_weight_nonnegative"),
        ),
        migrations.AddConstraint(
            model_name="pledgeitem",
            constraint=models.CheckConstraint(condition=Q(jor__gt=0), name="pledge_item_quantity_positive"),
        ),
        migrations.RunPython(backfill_pledge_snapshots, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="pledge",
            name="customer_name",
            field=models.CharField(max_length=255),
        ),
    ]
