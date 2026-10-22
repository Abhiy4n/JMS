import secrets
from datetime import datetime, timezone as datetime_timezone

from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .models import LoginEvent, UserSession
from .request_metadata import get_request_metadata


SESSION_CLAIM = "sid"


def hash_session_reference(reference):
    return salted_hmac(
        "accounts.auth_session",
        reference,
        secret=settings.AUTH_SESSION_HASH_KEY,
        algorithm="sha256",
    ).hexdigest()


def get_active_session(token, user):
    reference = token.get(SESSION_CLAIM)
    if not reference or not isinstance(reference, str):
        raise AuthenticationFailed("This session is no longer valid.", code="session_invalid")
    try:
        session = UserSession.objects.get(
            token_hash=hash_session_reference(reference),
            user=user,
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        )
    except UserSession.DoesNotExist as error:
        raise AuthenticationFailed(
            "This session has expired or was signed out.", code="session_inactive"
        ) from error
    return session


def touch_session(session):
    now = timezone.now()
    cutoff = now - settings.AUTH_SESSION_ACTIVITY_THROTTLE
    if session.last_seen_at <= cutoff:
        UserSession.objects.filter(pk=session.pk, last_seen_at__lte=cutoff).update(
            last_seen_at=now
        )
        session.last_seen_at = now


class SessionJWTAuthentication(JWTAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, token = result
        session = get_active_session(token, user)
        request.auth_session = session
        touch_session(session)
        return user, token


class SessionTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        refresh = self.token_class(attrs["refresh"])
        user = self.get_user_for_token(refresh)
        session = get_active_session(refresh, user)
        data = super().validate(attrs)
        touch_session(session)
        return data

    @staticmethod
    def get_user_for_token(token):
        from django.contrib.auth import get_user_model
        from rest_framework_simplejwt.settings import api_settings

        user_id = token.get(api_settings.USER_ID_CLAIM)
        if user_id is None:
            raise AuthenticationFailed("This session is no longer valid.")
        try:
            return get_user_model().objects.get(
                **{api_settings.USER_ID_FIELD: user_id}, is_active=True
            )
        except get_user_model().DoesNotExist as error:
            raise AuthenticationFailed("No active account was found.") from error


@transaction.atomic
def tokens_for_user(user, request):
    metadata = get_request_metadata(request)
    is_new_device = not UserSession.objects.filter(
        user=user, device_hash=metadata["device_hash"]
    ).exists()
    reference = secrets.token_urlsafe(32)
    refresh = RefreshToken.for_user(user)
    refresh[SESSION_CLAIM] = reference
    expires_at = datetime.fromtimestamp(refresh["exp"], tz=datetime_timezone.utc)
    session = UserSession.objects.create(
        user=user,
        token_hash=hash_session_reference(reference),
        expires_at=expires_at,
        **metadata,
    )
    LoginEvent.objects.create(
        user=user,
        session=session,
        is_new_device=is_new_device,
        **{
            key: metadata[key]
            for key in (
                "device_name",
                "device_type",
                "browser",
                "operating_system",
                "ip_address",
                "location",
            )
        },
    )
    update_last_login(None, user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}
