from django.urls import path

from .views import BillDetailView, BillListCreateView, BusinessSourceAccountView, CustomerAccountView
from .credit_views import CustomerCreditListView, CustomerCreditDetailView, CustomerCreditPaymentView


urlpatterns = [
    path("credits/", CustomerCreditListView.as_view(), name="credit-list"),
    path("credits/<int:pk>/", CustomerCreditDetailView.as_view(), name="credit-detail"),
    path("credits/<int:credit_id>/payments/", CustomerCreditPaymentView.as_view(), name="credit-payment"),
    path("customers/<int:customer_id>/account/", CustomerAccountView.as_view(), name="customer-account"),
    path(
        "business-sources/<int:source_id>/account/",
        BusinessSourceAccountView.as_view(),
        name="business-source-account",
    ),
    path("bills/", BillListCreateView.as_view(), name="bill-list"),
    path("bills/<int:pk>/", BillDetailView.as_view(), name="bill-detail"),
]
