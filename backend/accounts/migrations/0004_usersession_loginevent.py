import uuid

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0003_user_profile_picture"),
    ]

    operations = [
        migrations.CreateModel(
            name="UserSession",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("token_hash", models.CharField(editable=False, max_length=64, unique=True)),
                ("device_hash", models.CharField(db_index=True, editable=False, max_length=64)),
                ("device_name", models.CharField(default="Unknown device", max_length=255)),
                ("device_type", models.CharField(default="unknown", max_length=32)),
                ("browser", models.CharField(default="Unknown browser", max_length=100)),
                ("operating_system", models.CharField(default="Unknown OS", max_length=100)),
                ("user_agent", models.CharField(blank=True, max_length=512)),
                ("ip_address", models.GenericIPAddressField(blank=True, null=True)),
                ("location", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("last_seen_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("expires_at", models.DateTimeField(db_index=True)),
                ("revoked_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="auth_sessions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-last_seen_at", "-created_at"]},
        ),
        migrations.CreateModel(
            name="LoginEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("is_new_device", models.BooleanField(default=False)),
                ("device_name", models.CharField(default="Unknown device", max_length=255)),
                ("device_type", models.CharField(default="unknown", max_length=32)),
                ("browser", models.CharField(default="Unknown browser", max_length=100)),
                ("operating_system", models.CharField(default="Unknown OS", max_length=100)),
                ("ip_address", models.GenericIPAddressField(blank=True, null=True)),
                ("location", models.CharField(blank=True, max_length=255)),
                ("occurred_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                (
                    "session",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="login_events",
                        to="accounts.usersession",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="login_events",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-occurred_at", "-id"]},
        ),
        migrations.AddIndex(
            model_name="usersession",
            index=models.Index(fields=["user", "revoked_at", "expires_at"], name="accounts_us_user_id_e2902d_idx"),
        ),
        migrations.AddIndex(
            model_name="loginevent",
            index=models.Index(fields=["user", "-occurred_at"], name="accounts_lo_user_id_b2b169_idx"),
        ),
    ]
