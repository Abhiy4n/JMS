from django.db import transaction
from django.db.models import Q
from rest_framework import generics, permissions

from .models import Pledge
from .serializers import PledgeFilterSerializer, PledgeSerializer


class PledgeListCreateView(generics.ListCreateAPIView):
    serializer_class = PledgeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Pledge.objects.select_related(
            "customer",
            "customer__business_source",
        ).prefetch_related("items")
        search = self.request.query_params.get("search", "").strip()
        filter_params = {
            key: value.strip()
            for key, value in self.request.query_params.items()
            if value.strip()
        }
        filter_serializer = PledgeFilterSerializer(data=filter_params)
        filter_serializer.is_valid(raise_exception=True)
        filters = filter_serializer.validated_data

        if search:
            queryset = queryset.filter(
                Q(pledge_number__icontains=search)
                | Q(customer__name__icontains=search)
                | Q(customer__business_source__name__icontains=search)
            )
        if "customer" in filters:
            queryset = queryset.filter(customer_id=filters["customer"])
        if "status" in filters:
            queryset = queryset.filter(status=filters["status"])
        if "pledge_date" in filters:
            queryset = queryset.filter(pledge_date=filters["pledge_date"])
        if "date_from" in filters:
            queryset = queryset.filter(pledge_date__gte=filters["date_from"])
        if "date_to" in filters:
            queryset = queryset.filter(pledge_date__lte=filters["date_to"])
        return queryset


class PledgeDetailView(generics.RetrieveUpdateAPIView):
    queryset = Pledge.objects.select_related(
        "customer",
        "customer__business_source",
    ).prefetch_related("items")
    serializer_class = PledgeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.method in ("PUT", "PATCH"):
            return queryset.select_for_update()
        return queryset

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)
