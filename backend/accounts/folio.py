from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Sum
from django.shortcuts import get_object_or_404
from rest_framework import generics, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import BhakaPatra, BhakaPatraItem, Customer


class CustomerBhakaPatraSummary(APIView):
    def get(self, request):
        # Aggregate documents directly, without an item join that would multiply totals.
        # Directory search/type/order parameters intentionally do not scope these KPIs.
        totals = BhakaPatra.objects.aggregate(count=Count("id"), amount=Sum("principal_amount"))
        return Response({"total_rakha_patra": totals["count"],
                         "total_amount": format(totals["amount"] or Decimal("0.00"), ".2f")})


class BhakaPatraItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = BhakaPatraItem
        fields = ("id", "name", "description", "quantity", "rate", "amount")
        read_only_fields = ("id",)
        extra_kwargs = {field: {"min_value": Decimal("0")} for field in ("quantity", "rate", "amount")}


class BhakaPatraSerializer(serializers.ModelSerializer):
    customer_id = serializers.ReadOnlyField()
    items = BhakaPatraItemSerializer(many=True, required=False)

    class Meta:
        model = BhakaPatra
        fields = ("id", "customer_id", "reference", "transaction_date", "principal_amount",
                  "interest_amount", "subtotal", "additional_charges", "discount",
                  "outstanding_balance", "notes", "settlement_notes", "created_at", "items")
        read_only_fields = ("id", "customer_id", "created_at")
        extra_kwargs = {field: {"min_value": Decimal("0")} for field in (
            "principal_amount", "interest_amount", "subtotal", "additional_charges", "discount", "outstanding_balance")}

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("items", [])
        record = BhakaPatra.objects.create(**validated_data)
        BhakaPatraItem.objects.bulk_create([BhakaPatraItem(bhaka_patra=record, **item) for item in items])
        return record

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        record = super().update(instance, validated_data)
        # Omitting items preserves them; sending [] explicitly clears the collection.
        # The transaction rolls back both document and item changes on failure.
        if items is not None:
            record.items.all().delete()
            BhakaPatraItem.objects.bulk_create([BhakaPatraItem(bhaka_patra=record, **item) for item in items])
        return record


class CustomerBhakaPatraList(generics.ListCreateAPIView):
    serializer_class = BhakaPatraSerializer

    def get_queryset(self):
        # Fetch items with the list, avoiding a separate database query for every row.
        customer = get_object_or_404(Customer, pk=self.kwargs["customer_id"])
        return customer.bhaka_patras.prefetch_related("items")

    def perform_create(self, serializer):
        customer = get_object_or_404(Customer, pk=self.kwargs["customer_id"])
        if not customer.is_active:
            raise serializers.ValidationError({"customer_id": "Cannot add documents to an inactive customer."})
        serializer.save(customer=customer)


class CustomerBhakaPatraDetail(generics.RetrieveUpdateAPIView):
    # Historical documents cannot be silently deleted through a generic endpoint.
    serializer_class = BhakaPatraSerializer

    def get_queryset(self):
        # Both URL IDs must match; a document cannot be opened under another customer.
        return BhakaPatra.objects.filter(customer_id=self.kwargs["customer_id"]).prefetch_related("items")
