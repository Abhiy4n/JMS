from django.urls import path

from .views import (
    AuthTokenRefreshView,
    LoginActivityView,
    LoginView,
    LogoutView,
    MeView,
    ProfilePictureView,
    RegisterView,
    RevokeOtherSessionsView,
    RevokeSessionView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("token/refresh/", AuthTokenRefreshView.as_view(), name="auth-token-refresh"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("me/profile-picture/", ProfilePictureView.as_view(), name="auth-profile-picture"),
    path("sessions/", LoginActivityView.as_view(), name="auth-session-list"),
    path(
        "sessions/revoke-others/",
        RevokeOtherSessionsView.as_view(),
        name="auth-session-revoke-others",
    ),
    path(
        "sessions/<uuid:session_id>/revoke/",
        RevokeSessionView.as_view(),
        name="auth-session-revoke",
    ),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
]
