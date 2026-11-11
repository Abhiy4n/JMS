from django.urls import path

from .views import (
    PledgeDetailView,
    PledgeCalendarView,
    BusinessSourcePledgeSummaryView,
    PledgeFormDefaultsView,
    PledgeFinancialSummaryView,
    PledgeListCreateView,
    PledgePaymentCorrectionView,
    PledgePaymentDueView,
    PledgePaymentListCreateView,
    PledgeStatusView,
)


urlpatterns = [
    path("pledges/form-defaults/", PledgeFormDefaultsView.as_view(), name="pledge-form-defaults"),
    path("pledges/calendar/", PledgeCalendarView.as_view(), name="pledge-calendar"),
    path("pledges/", PledgeListCreateView.as_view(), name="pledge-list"),
    path("pledges/<int:pk>/", PledgeDetailView.as_view(), name="pledge-detail"),
    path("pledges/<int:pledge_id>/summary/", PledgeFinancialSummaryView.as_view(), name="pledge-financial-summary"),
    path("business-sources/<int:source_id>/pledge-summary/", BusinessSourcePledgeSummaryView.as_view(), name="business-source-pledge-summary"),
    path("pledges/<int:pledge_id>/payments/due/", PledgePaymentDueView.as_view(), name="pledge-payment-due"),
    path("pledges/<int:pledge_id>/payments/", PledgePaymentListCreateView.as_view(), name="pledge-payment-list"),
    path("pledges/<int:pledge_id>/status/", PledgeStatusView.as_view(), name="pledge-status"),
    path("pledge-payments/<int:payment_id>/", PledgePaymentCorrectionView.as_view(), name="pledge-payment-detail"),
]
