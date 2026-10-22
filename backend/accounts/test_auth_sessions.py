from datetime import timedelta

from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from .models import LoginEvent, User, UserSession


class AuthSessionTests(APITestCase):
    password = "test-password-123"
    desktop_agent = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36"
    )

    def setUp(self):
        self.user = User.objects.create_user(
            email="auth@example.com", name="Auth user", password=self.password
        )

    def login(self, *, agent=None, address="203.0.113.10", **headers):
        return self.client.post(
            reverse("auth-login"),
            {"email": self.user.email, "password": self.password},
            format="json",
            HTTP_USER_AGENT=agent or self.desktop_agent,
            REMOTE_ADDR=address,
            **headers,
        )

    def authorize(self, access):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

    def test_login_creates_session_and_login_event_with_metadata(self):
        response = self.login()
        self.assertEqual(response.status_code, 200, response.data)
        session = UserSession.objects.get(user=self.user)
        event = LoginEvent.objects.get(user=self.user)
        self.assertEqual((session.browser, session.operating_system), ("Chrome", "Windows"))
        self.assertEqual(session.device_type, "desktop")
        self.assertEqual(str(session.ip_address), "203.0.113.10")
        self.assertTrue(event.is_new_device)
        self.assertEqual(event.session, session)

        self.assertEqual(self.login().status_code, 200)
        self.assertFalse(LoginEvent.objects.first().is_new_device)

    def test_registration_is_tracked_and_access_token_works(self):
        response = self.client.post(
            reverse("auth-register"),
            {"email": "new@example.com", "name": "New user", "password": self.password},
            format="json",
            HTTP_USER_AGENT="Mozilla/5.0 (iPhone) Safari/604.1",
            REMOTE_ADDR="198.51.100.4",
        )
        self.assertEqual(response.status_code, 201, response.data)
        new_user = User.objects.get(email="new@example.com")
        self.assertEqual(new_user.auth_sessions.count(), 1)
        self.assertEqual(new_user.login_events.count(), 1)
        self.authorize(response.data["access"])
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 200)

    def test_activity_marks_current_session_and_keeps_history(self):
        first = self.login()
        self.login(agent="Mozilla/5.0 (Linux; Android 14; Mobile) Chrome/130.0")
        self.authorize(first.data["access"])
        response = self.client.get(reverse("auth-session-list"))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["sessions"]), 2)
        self.assertEqual(len(response.data["login_events"]), 2)
        current = [item for item in response.data["sessions"] if item["current"]]
        self.assertEqual(len(current), 1)
        self.assertEqual(current[0]["device_type"], "desktop")

    def test_revocation_immediately_rejects_access_and_refresh_tokens(self):
        first = self.login()
        second = self.login(agent="Mozilla/5.0 (iPhone) Safari/604.1")
        second_session = UserSession.objects.order_by("-created_at").first()
        self.authorize(first.data["access"])
        response = self.client.post(reverse("auth-session-revoke", args=[second_session.pk]))
        self.assertEqual(response.status_code, 204, response.data)

        self.authorize(second.data["access"])
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 401)
        self.client.credentials()
        refresh = self.client.post(
            reverse("auth-token-refresh"), {"refresh": second.data["refresh"]}, format="json"
        )
        self.assertEqual(refresh.status_code, 401, refresh.data)

    def test_refresh_preserves_the_session_and_issues_a_working_access_token(self):
        login = self.login()
        response = self.client.post(
            reverse("auth-token-refresh"), {"refresh": login.data["refresh"]}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.authorize(response.data["access"])
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 200)
        self.assertEqual(UserSession.objects.count(), 1)

    def test_revoke_others_preserves_current_session(self):
        current = self.login()
        other = self.login(agent="Mozilla/5.0 (iPhone) Safari/604.1")
        self.authorize(current.data["access"])
        response = self.client.post(reverse("auth-session-revoke-others"))
        self.assertEqual(response.data["revoked"], 1)
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 200)
        self.authorize(other.data["access"])
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 401)

    def test_logout_revokes_current_session(self):
        login = self.login()
        self.authorize(login.data["access"])
        self.assertEqual(self.client.post(reverse("auth-logout")).status_code, 204)
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 401)

    def test_cannot_revoke_another_users_session(self):
        own = self.login()
        other_user = User.objects.create_user(
            email="other@example.com", name="Other", password=self.password
        )
        self.client.credentials()
        other_login = self.client.post(
            reverse("auth-login"),
            {"email": other_user.email, "password": self.password},
            format="json",
        )
        self.authorize(own.data["access"])
        response = self.client.post(
            reverse("auth-session-revoke", args=[other_user.auth_sessions.get().pk])
        )
        self.assertEqual(response.status_code, 404)
        self.authorize(other_login.data["access"])
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 200)

    def test_legacy_token_and_expired_server_session_are_rejected(self):
        legacy = RefreshToken.for_user(self.user)
        self.authorize(str(legacy.access_token))
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 401)
        self.client.credentials()
        login = self.login()
        UserSession.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.authorize(login.data["access"])
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 401)

    @override_settings(AUTH_SESSION_ACTIVITY_THROTTLE=timedelta(minutes=5))
    def test_last_activity_is_throttled(self):
        login = self.login()
        session = UserSession.objects.get()
        recent = timezone.now() - timedelta(minutes=1)
        UserSession.objects.filter(pk=session.pk).update(last_seen_at=recent)
        self.authorize(login.data["access"])
        self.client.get(reverse("auth-me"))
        session.refresh_from_db()
        self.assertEqual(session.last_seen_at, recent)

        old = timezone.now() - timedelta(minutes=10)
        UserSession.objects.filter(pk=session.pk).update(last_seen_at=old)
        self.client.get(reverse("auth-me"))
        session.refresh_from_db()
        self.assertGreater(session.last_seen_at, old)

    @override_settings(AUTH_TRUSTED_PROXY_IPS=["10.0.0.0/8"])
    def test_forwarded_ip_is_used_only_for_a_trusted_proxy(self):
        trusted = self.login(
            address="10.0.0.5", HTTP_X_FORWARDED_FOR="198.51.100.8, 10.0.0.4"
        )
        self.assertEqual(trusted.status_code, 200)
        self.assertEqual(str(UserSession.objects.first().ip_address), "198.51.100.8")
        self.login(address="192.0.2.20", HTTP_X_FORWARDED_FOR="198.51.100.9")
        newest = UserSession.objects.order_by("-created_at").first()
        self.assertEqual(str(newest.ip_address), "192.0.2.20")

    @override_settings(AUTH_SESSION_RETENTION_DAYS=30, AUTH_LOGIN_EVENT_RETENTION_DAYS=60)
    def test_cleanup_removes_old_inactive_records_and_events(self):
        self.login()
        session = UserSession.objects.get()
        old = timezone.now() - timedelta(days=100)
        UserSession.objects.filter(pk=session.pk).update(revoked_at=old)
        LoginEvent.objects.filter(session=session).update(occurred_at=old)
        call_command("cleanup_auth_activity", verbosity=0)
        self.assertFalse(UserSession.objects.filter(pk=session.pk).exists())
        self.assertFalse(LoginEvent.objects.filter(user=self.user).exists())
