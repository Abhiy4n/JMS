from django.urls import path

from .views import PledgeDetailView, PledgeListCreateView


urlpatterns = [
    path("pledges/", PledgeListCreateView.as_view(), name="pledge-list"),
    path("pledges/<int:pk>/", PledgeDetailView.as_view(), name="pledge-detail"),
]
