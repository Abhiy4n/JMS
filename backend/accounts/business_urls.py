from django.urls import path

from .views import (
    BusinessSourceDetailView,
    BusinessSourceListCreateView,
    CustomerListCreateView,
)

urlpatterns = [
    path("business-sources/", BusinessSourceListCreateView.as_view(), name="business-source-list"),
    path("business-sources/<int:pk>/", BusinessSourceDetailView.as_view(), name="business-source-detail"),
    path("customers/", CustomerListCreateView.as_view(), name="customer-list"),
]