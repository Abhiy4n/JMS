from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import LoginEvent, User, UserSession


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    ordering = ("email",)
    list_display = ("email", "name", "role", "is_staff", "is_active", "date_joined")
    list_filter = ("role", "is_staff", "is_active", "is_superuser")
    search_fields = ("email", "name")

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profile", {"fields": ("name", "role")}),
        (
            "Permissions",
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )


@admin.register(UserSession)
class UserSessionAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "device_name",
        "ip_address",
        "created_at",
        "last_seen_at",
        "expires_at",
        "revoked_at",
    )
    list_filter = ("device_type", "browser", "operating_system", "revoked_at")
    search_fields = ("user__email", "device_name", "ip_address")
    readonly_fields = ("token_hash", "device_hash", "created_at", "last_seen_at")


@admin.register(LoginEvent)
class LoginEventAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "device_name",
        "ip_address",
        "is_new_device",
        "occurred_at",
    )
    list_filter = ("is_new_device", "device_type", "browser", "operating_system")
    search_fields = ("user__email", "device_name", "ip_address")
    readonly_fields = tuple(field.name for field in LoginEvent._meta.fields)
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "name", "role", "password1", "password2", "is_staff", "is_active"),
            },
        ),
    )
