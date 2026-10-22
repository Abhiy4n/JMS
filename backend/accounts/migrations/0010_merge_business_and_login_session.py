from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0004_usersession_loginevent"),
        ("accounts", "0009_backfill_source_entries"),
    ]

    operations = []
