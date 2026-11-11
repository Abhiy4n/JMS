from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessSource

from .bs_dates import ad_to_bs, bs_month_calendar
from .models import (
    Pledge,
    PledgePayment,
    nepal_today,
    record_pledge_changes,
)
from .serializers import (
    PledgeFilterSerializer,
    PledgePaymentCorrectionSerializer,
    PledgePaymentDueSerializer,
    PledgePaymentSerializer,
    PledgeSerializer,
    PledgeStatusSerializer,
    business_source_financial_summary,
    payment_due_amount,
    payment_history_representation,
    pledge_financial_summary,
    validate_payment_history,
)


class IsStaffMember(permissions.BasePermission):
    message = "Only staff members can perform this action."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)


class PledgeFormDefaultsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({"today_bs": ad_to_bs(nepal_today())})


class PledgeCalendarView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        try:
            year = int(request.query_params["year"])
            month = int(request.query_params["month"])
            calendar = bs_month_calendar(year, month)
        except (KeyError, TypeError, ValueError):
            raise serializers.ValidationError(
                {"calendar": "Enter a valid Bikram Sambat year and month between 1975-01 and 2100-12."}
            )
        return Response(calendar)


class PledgeListCreateView(generics.ListCreateAPIView):
    serializer_class = PledgeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Pledge.objects.select_related("customer", "business_source").prefetch_related(
            "items", "payments", "edit_logs",
        )
        search = self.request.query_params.get("search", "").strip()
        filter_params = {key: value.strip() for key, value in self.request.query_params.items() if value.strip()}
        filter_serializer = PledgeFilterSerializer(data=filter_params)
        filter_serializer.is_valid(raise_exception=True)
        filters = filter_serializer.validated_data
        if search:
            queryset = queryset.filter(
                Q(pledge_number__icontains=search)
                | Q(customer__name__icontains=search)
                | Q(business_source__name__icontains=search)
            )
        for field in ("customer", "business_source", "status"):
            if field in filters:
                queryset = queryset.filter(**{f"{field}_id" if field != "status" else "status": filters[field]})
        if "pledge_date" in filters:
            queryset = queryset.filter(pledge_date=filters["pledge_date"])
        if "date_from" in filters:
            queryset = queryset.filter(pledge_date__gte=filters["date_from"])
        if "date_to" in filters:
            queryset = queryset.filter(pledge_date__lte=filters["date_to"])
        return queryset


class PledgeDetailView(generics.RetrieveUpdateAPIView):
    queryset = Pledge.objects.select_related("customer", "business_source").prefetch_related(
        "items", "payments", "edit_logs",
    )
    serializer_class = PledgeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.request.method in ("PUT", "PATCH"):
            return [permissions.IsAuthenticated(), IsStaffMember()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.method in ("PUT", "PATCH"):
            return queryset.select_for_update()
        return queryset

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)


class PledgePaymentListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pledge_id):
        pledge = get_object_or_404(Pledge.objects.prefetch_related("payments"), pk=pledge_id)
        return Response(payment_history_representation(pledge))

    @transaction.atomic
    def post(self, request, pledge_id):
        pledge = get_object_or_404(Pledge.objects.select_for_update(), pk=pledge_id)
        serializer = PledgePaymentSerializer(
            data=request.data,
            context={"pledge": pledge, "request": request},
        )
        serializer.is_valid(raise_exception=True)
        payment = serializer.save()
        response = next(
            item for item in payment_history_representation(pledge)
            if item["id"] == payment.id
        )
        return Response(response, status=status.HTTP_201_CREATED)


class PledgePaymentDueView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pledge_id):
        pledge = get_object_or_404(Pledge.objects.prefetch_related("payments", "edit_logs"), pk=pledge_id)
        serializer = PledgePaymentDueSerializer(
            data=request.query_params,
            context={"pledge": pledge},
        )
        serializer.is_valid(raise_exception=True)
        as_of = serializer.validated_data["as_of"]
        payments = list(pledge.payments.all())
        edit_logs = list(pledge.edit_logs.all())
        edited_payment = serializer.validated_data.get("payment")
        if edited_payment:
            edited_key = (as_of, edited_payment.recorded_at, edited_payment.id)
            prior_payments = [
                payment for payment in payments
                if not payment.is_voided
                and payment.id != edited_payment.id
                and (payment.payment_date, payment.recorded_at, payment.id) < edited_key
            ]
        else:
            prior_payments = [
                payment for payment in payments
                if not payment.is_voided and payment.payment_date <= as_of
            ]
        same_day_principal = [
            payment for payment in payments
            if not payment.is_voided
            and payment.type == PledgePayment.Type.PRINCIPAL
            and payment.payment_date == as_of
        ]
        return Response({
            "as_of": ad_to_bs(as_of),
            "principal_due": str(payment_due_amount(
                pledge, PledgePayment.Type.PRINCIPAL, as_of, prior_payments, edit_logs,
            )),
            "interest_due": str(payment_due_amount(
                pledge,
                PledgePayment.Type.INTEREST,
                as_of,
                prior_payments,
                edit_logs,
                same_day_principal_payments=same_day_principal,
            )),
        })


class PledgeFinancialSummaryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pledge_id):
        pledge = get_object_or_404(
            Pledge.objects.prefetch_related("payments", "edit_logs"),
            pk=pledge_id,
        )
        as_of = nepal_today()
        return Response({
            "as_of": ad_to_bs(as_of),
            **pledge_financial_summary(pledge, as_of),
        })


class BusinessSourcePledgeSummaryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, source_id):
        get_object_or_404(BusinessSource, pk=source_id)
        return Response(business_source_financial_summary(source_id, nepal_today()))


class PledgePaymentCorrectionView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsStaffMember]

    @transaction.atomic
    def patch(self, request, payment_id):
        payment = get_object_or_404(
            PledgePayment.objects.select_for_update().select_related("pledge"),
            pk=payment_id,
        )
        pledge = Pledge.objects.select_for_update().get(pk=payment.pledge_id)
        if pledge.status != Pledge.Status.ACTIVE:
            raise serializers.ValidationError({"detail": "Reopen the pledge before correcting or removing a payment."})
        if payment.is_voided:
            raise serializers.ValidationError({"detail": "A removed payment cannot be corrected."})
        serializer = PledgePaymentCorrectionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        new_date = values.get("payment_date", payment.payment_date)
        new_amount = values.get("amount", payment.amount)
        history = list(pledge.payments.all())
        ordered = sorted(
            (item for item in history if not item.is_voided),
            key=lambda item: (item.payment_date, item.recorded_at, item.id),
        )
        position = next(index for index, item in enumerate(ordered) if item.pk == payment.pk)
        previous_date = ordered[position - 1].payment_date if position else pledge.pledge_date
        next_date = ordered[position + 1].payment_date if position + 1 < len(ordered) else nepal_today()
        if new_date < previous_date or new_date > next_date:
            raise serializers.ValidationError({
                "payment_date": "Date must stay between the previous and next payments."
            })

        candidate = PledgePayment(
            id=payment.id,
            pledge=pledge,
            payment_date=new_date,
            type=payment.type,
            amount=new_amount,
            is_voided=False,
            recorded_by=payment.recorded_by,
            recorded_at=payment.recorded_at,
        )
        edit_logs = list(pledge.edit_logs.all())
        validate_payment_history(
            pledge,
            [candidate if item.pk == payment.pk else item for item in history],
            edit_logs,
            changed_payment_id=payment.pk,
        )

        changes = []
        if payment.payment_date != new_date:
            changes.append(("payment_date", ad_to_bs(payment.payment_date), ad_to_bs(new_date)))
        if payment.amount != new_amount:
            changes.append(("amount", payment.amount, new_amount))
        if not changes:
            raise serializers.ValidationError({"detail": "No payment fields changed."})
        payment.payment_date = new_date
        payment.amount = new_amount
        payment.full_clean()
        payment.save(update_fields=("payment_date", "amount"))
        record_pledge_changes(
            pledge, changes, request.user, values["reason"], effective_date=new_date, payment=payment,
        )
        response = next(
            item for item in payment_history_representation(pledge)
            if item["id"] == payment.id
        )
        return Response(response)


class PledgeStatusPermission(permissions.BasePermission):
    message = "Staff may close pledges; only superusers may forfeit or reopen them."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        target = request.data.get("status")
        if target == Pledge.Status.CLOSED:
            return user.is_staff
        if target in (Pledge.Status.FORFEITED, Pledge.Status.ACTIVE):
            return user.is_superuser
        return True


class PledgeStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated, PledgeStatusPermission]

    @transaction.atomic
    def post(self, request, pledge_id):
        pledge = get_object_or_404(
            Pledge.objects.select_for_update().prefetch_related("payments", "edit_logs"),
            pk=pledge_id,
        )
        serializer = PledgeStatusSerializer(data=request.data, context={"pledge": pledge})
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data["status"]
        reason = serializer.validated_data["reason"]
        old_status = pledge.status
        pledge.status = new_status
        pledge.save(update_fields=("status", "updated_at"))
        record_pledge_changes(
            pledge,
            [("status", old_status, new_status)],
            request.user,
            reason,
            effective_date=nepal_today(),
        )
        return Response(PledgeSerializer(pledge, context={"request": request}).data)
