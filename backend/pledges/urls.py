from django.urls import path

from .views import (
    PledgeDetailView,
    PledgeCalendarView,
    PledgeFormDefaultsView,
    PledgeListCreateView,
    PledgePaymentCorrectionView,
    PledgePaymentListCreateView,
    PledgePaymentRemovalView,
    PledgeStatusView,
)


urlpatterns = [
    path("pledges/form-defaults/", PledgeFormDefaultsView.as_view(), name="pledge-form-defaults"),
    path("pledges/calendar/", PledgeCalendarView.as_view(), name="pledge-calendar"),
    path("pledges/", PledgeListCreateView.as_view(), name="pledge-list"),
    path("pledges/<int:pk>/", PledgeDetailView.as_view(), name="pledge-detail"),
    path("pledges/<int:pledge_id>/payments/", PledgePaymentListCreateView.as_view(), name="pledge-payment-list"),
    path("pledges/<int:pledge_id>/status/", PledgeStatusView.as_view(), name="pledge-status"),
    path("pledge-payments/<int:payment_id>/corrections/", PledgePaymentCorrectionView.as_view(), name="pledge-payment-correction"),
    path("pledge-payments/<int:payment_id>/removals/", PledgePaymentRemovalView.as_view(), name="pledge-payment-removal"),
]
