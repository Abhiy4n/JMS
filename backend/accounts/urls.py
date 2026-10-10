from django.urls import path

from .views import AuthTokenRefreshView, LoginView, MeView, ProfilePictureView, RegisterView

urlpatterns = [
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("token/refresh/", AuthTokenRefreshView.as_view(), name="auth-token-refresh"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("me/profile-picture/", ProfilePictureView.as_view(), name="auth-profile-picture"),
]
