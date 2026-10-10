from django.urls import include, path

from accounts import business_urls
from .views import health


urlpatterns = [
    path("health/", health, name="health"),
    path("", include(business_urls)),
    path("", include("billing.urls")),
    path("", include("pledges.urls")),
    path("auth/", include("accounts.urls")),
]
