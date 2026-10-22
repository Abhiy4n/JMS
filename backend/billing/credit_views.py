from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import CustomerCredit
from .credit_serializers import CustomerCreditSerializer, CustomerCreditPaymentSerializer


class CustomerCreditListView(generics.ListCreateAPIView):
    serializer_class = CustomerCreditSerializer

    def get_queryset(self):
        queryset = CustomerCredit.objects.select_related("customer").prefetch_related("payments")
        customer_id = self.request.query_params.get("customer", "")
        if customer_id:
            if not customer_id.isdecimal() or int(customer_id) <= 0:
                raise serializers.ValidationError({"customer": "Enter a valid customer ID."})
            queryset = queryset.filter(customer_id=customer_id)
        return queryset


class CustomerCreditDetailView(generics.RetrieveAPIView):
    queryset = CustomerCredit.objects.select_related("customer").prefetch_related("payments")
    serializer_class = CustomerCreditSerializer


class CustomerCreditPaymentView(APIView):
    @transaction.atomic
    def post(self, request, credit_id):
        # Validate while holding a lock so concurrent payments cannot overpay.
        credit = get_object_or_404(CustomerCredit.objects.select_for_update(), pk=credit_id)
        serializer = CustomerCreditPaymentSerializer(data=request.data, context={"credit": credit})
        serializer.is_valid(raise_exception=True)
        serializer.save(credit=credit, effective_date=timezone.localdate())
        return Response(CustomerCreditSerializer(credit).data, status=status.HTTP_201_CREATED)
