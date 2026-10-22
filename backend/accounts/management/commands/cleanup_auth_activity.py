from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from accounts.models import LoginEvent, UserSession


class Command(BaseCommand):
    help = "Delete expired/revoked auth sessions and old login activity."

    def handle(self, *args, **options):
        now = timezone.now()
        session_cutoff = now - timedelta(days=settings.AUTH_SESSION_RETENTION_DAYS)
        event_cutoff = now - timedelta(days=settings.AUTH_LOGIN_EVENT_RETENTION_DAYS)

        sessions, _ = UserSession.objects.filter(
            Q(expires_at__lt=session_cutoff)
            | Q(revoked_at__isnull=False, revoked_at__lt=session_cutoff)
        ).delete()
        events, _ = LoginEvent.objects.filter(occurred_at__lt=event_cutoff).delete()
        self.stdout.write(
            self.style.SUCCESS(
                f"Deleted {sessions} old session records and {events} old login events."
            )
        )
