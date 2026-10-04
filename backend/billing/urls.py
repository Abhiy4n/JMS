from django.urls import path

from .views import BillDetailView, BillListCreateView, BusinessSourceAccountView


urlpatterns = [
    path(
        "business-sources/<int:source_id>/account/",
        BusinessSourceAccountView.as_view(),
        name="business-source-account",
    ),
    path("bills/", BillListCreateView.as_view(), name="bill-list"),
    path("bills/<int:pk>/", BillDetailView.as_view(), name="bill-detail"),
]