import secrets
import string

from django.db import migrations, models

import pledges.models


ALPHABET = string.ascii_uppercase + string.digits


def shorten_existing_pledge_numbers(apps, schema_editor):
    Pledge = apps.get_model("pledges", "Pledge")
    used = set(Pledge.objects.values_list("pledge_number", flat=True))
    for pledge in Pledge.objects.order_by("id"):
        current = (pledge.pledge_number or "").strip().upper()
        if len(current) == 5 and all(ch in ALPHABET for ch in current):
            used.add(current)
            if pledge.pledge_number != current:
                pledge.pledge_number = current
                pledge.save(update_fields=["pledge_number"])
            continue
        for _ in range(64):
            code = "".join(secrets.choice(ALPHABET) for _ in range(5))
            if code in used:
                continue
            used.add(code)
            pledge.pledge_number = code
            pledge.save(update_fields=["pledge_number"])
            break
        else:
            raise RuntimeError(f"Could not allocate a unique pledge number for pledge {pledge.pk}.")


class Migration(migrations.Migration):

    dependencies = [
        ("pledges", "0006_pledge_payment_single_amount"),
    ]

    operations = [
        migrations.RunPython(shorten_existing_pledge_numbers, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="pledge",
            name="pledge_number",
            field=models.CharField(
                default=pledges.models.generate_pledge_number,
                editable=False,
                max_length=5,
                unique=True,
            ),
        ),
    ]
