from django.urls import path
from .folio import CustomerBhakaPatraList, CustomerBhakaPatraDetail, CustomerBhakaPatraSummary

from .views import (
    BusinessSourceDetailView,
    BusinessSourceListCreateView,
    BusinessSourceSummaryView,
    CustomerListCreateView,
    CustomerDetailView,
    CustomerTypeListView,
)

urlpatterns = [
    path("customers/summary/", CustomerBhakaPatraSummary.as_view(), name="customer-bhaka-patra-summary"),
    path("customers/<int:customer_id>/bhaka-patras/", CustomerBhakaPatraList.as_view(), name="customer-bhaka-patra-list"),
    path("customers/<int:customer_id>/bhaka-patras/<int:pk>/", CustomerBhakaPatraDetail.as_view(), name="customer-bhaka-patra-detail"),
    path("business-sources/", BusinessSourceListCreateView.as_view(), name="business-source-list"),
    path("business-sources/summary/", BusinessSourceSummaryView.as_view(), name="business-source-summary"),
    path("business-sources/<int:pk>/", BusinessSourceDetailView.as_view(), name="business-source-detail"),
    path("customers/", CustomerListCreateView.as_view(), name="customer-list"),
    path("customers/<int:pk>/", CustomerDetailView.as_view(), name="customer-detail"),
    path("customer-types/", CustomerTypeListView.as_view(), name="customer-type-list"),
]
