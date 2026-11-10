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
    PledgeEditLog,
    PledgePayment,
    nepal_today,
    record_pledge_changes,
)
from .serializers import (
    PledgeFilterSerializer,
    PledgePaymentCorrectionSerializer,
    PledgePaymentSerializer,
    PledgeSerializer,
    PledgeStatusSerializer,
    validate_payment_sequence,
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

    @transaction.atomic
    def post(self, request, pledge_id):
        pledge = get_object_or_404(Pledge.objects.select_for_update(), pk=pledge_id)
        serializer = PledgePaymentSerializer(
            data=request.data,
            context={"pledge": pledge, "request": request},
        )
        serializer.is_valid(raise_exception=True)
        payment = serializer.save()
        return Response(PledgePaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


class PledgePaymentCorrectionView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsStaffMember]

    @transaction.atomic
    def post(self, request, payment_id):
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
        new_values = {
            "payment_date": values.get("payment_date", payment.payment_date),
            "interest_amount": values.get("interest_amount", payment.interest_amount),
            "principal_amount": values.get("principal_amount", payment.principal_amount),
        }
        if not new_values["interest_amount"] and not new_values["principal_amount"]:
            raise serializers.ValidationError({"detail": "A corrected payment cannot have both amounts set to zero; use the removal action."})
        history = [
            {
                "id": item.id,
                "payment_date": item.payment_date,
                "interest_amount": item.interest_amount,
                "principal_amount": item.principal_amount,
                "is_voided": item.is_voided,
            }
            for item in pledge.payments.all()
            if item.pk != payment.pk
        ]
        candidate = {"id": payment.pk, **new_values}
        validate_payment_sequence(pledge, history + [candidate], list(pledge.edit_logs.all()))
        changes = []
        for field, new_value in new_values.items():
            old_value = getattr(payment, field)
            if old_value != new_value:
                if field == "payment_date":
                    old_value, new_value = ad_to_bs(old_value), ad_to_bs(new_value)
                changes.append((field, old_value, new_value))
                setattr(payment, field, new_values[field])
        if not changes:
            raise serializers.ValidationError({"detail": "No payment fields changed."})
        payment.full_clean()
        payment.save(update_fields=tuple(new_values))
        record_pledge_changes(
            pledge, changes, request.user, values["reason"], effective_date=payment.payment_date, payment=payment,
        )
        return Response(PledgePaymentSerializer(payment).data)


class PledgePaymentRemovalView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsStaffMember]

    @transaction.atomic
    def post(self, request, payment_id):
        payment = get_object_or_404(
            PledgePayment.objects.select_for_update().select_related("pledge"),
            pk=payment_id,
        )
        pledge = Pledge.objects.select_for_update().get(pk=payment.pledge_id)
        if pledge.status != Pledge.Status.ACTIVE:
            raise serializers.ValidationError({"detail": "Reopen the pledge before correcting or removing a payment."})
        if payment.is_voided:
            raise serializers.ValidationError({"detail": "This payment has already been removed."})
        serializer = PledgePaymentCorrectionSerializer(data={"reason": request.data.get("reason", "")})
        serializer.is_valid(raise_exception=True)
        history = [
            {
                "id": item.id,
                "payment_date": item.payment_date,
                "interest_amount": item.interest_amount,
                "principal_amount": item.principal_amount,
                "is_voided": item.is_voided,
            }
            for item in pledge.payments.all()
            if item.pk != payment.pk
        ]
        validate_payment_sequence(pledge, history, list(pledge.edit_logs.all()))
        payment.is_voided = True
        payment.save(update_fields=("is_voided",))
        record_pledge_changes(
            pledge,
            [("is_voided", "false", "true")],
            request.user,
            serializer.validated_data["reason"],
            effective_date=payment.payment_date,
            payment=payment,
        )
        return Response({"detail": "Payment removed.", "payment_id": payment.pk})


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
