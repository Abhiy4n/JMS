from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0010_merge_business_and_login_session"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="company_name",
            field=models.CharField(default="Admin", max_length=255),
        ),
    ]
