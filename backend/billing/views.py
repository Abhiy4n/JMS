from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessSource

from .models import Bill
from .serializers import BillListFilterSerializer, BillSerializer


class BillListCreateView(generics.ListCreateAPIView):
    serializer_class = BillSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Bill.objects.select_related("customer", "customer__business_source").prefetch_related("items")
        search = self.request.query_params.get("search", "").strip()
        filter_params = {
            key: value.strip()
            for key, value in self.request.query_params.items()
            if value.strip()
        }
        filter_serializer = BillListFilterSerializer(data=filter_params)
        filter_serializer.is_valid(raise_exception=True)
        filters = filter_serializer.validated_data

        if search:
            queryset = queryset.filter(
                Q(bill_number__icontains=search)
                | Q(customer__name__icontains=search)
                | Q(customer__business_source__name__icontains=search)
            )
        if "customer" in filters:
            queryset = queryset.filter(customer_id=filters["customer"])
        if "status" in filters:
            queryset = queryset.filter(status=filters["status"])
        if "bill_date" in filters:
            queryset = queryset.filter(bill_date=filters["bill_date"])
        if "date_from" in filters:
            queryset = queryset.filter(bill_date__gte=filters["date_from"])
        if "date_to" in filters:
            queryset = queryset.filter(bill_date__lte=filters["date_to"])
        return queryset


class BillDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Bill.objects.select_related("customer", "customer__business_source").prefetch_related("items")
    serializer_class = BillSerializer
    permission_classes = [permissions.IsAuthenticated]


class BusinessSourceAccountFiltersSerializer(serializers.Serializer):
    search = serializers.CharField(required=False, allow_blank=True, max_length=255)
    status = serializers.ChoiceField(
        choices=("ALL", "PAID", "PARTIAL", "DUE", "CANCELLED"),
        required=False,
        default="ALL",
    )
    date_from = serializers.DateField(required=False)
    date_to = serializers.DateField(required=False)
    page = serializers.IntegerField(required=False, min_value=1, default=1)
    page_size = serializers.IntegerField(required=False, min_value=1, max_value=100, default=25)

    def validate(self, attrs):
        date_from = attrs.get("date_from")
        date_to = attrs.get("date_to")
        if date_from and date_to and date_from > date_to:
            raise serializers.ValidationError({"date_to": "Must be on or after date_from."})
        return attrs


def account_summary(queryset):
    totals = queryset.aggregate(
        total_bills=Count("id"),
        total_purchases=Sum("grand_total"),
        total_paid=Sum("amount_paid"),
        paid_bills=Count("id", filter=Q(status=Bill.Status.PAID)),
        partial_bills=Count("id", filter=Q(status=Bill.Status.PARTIAL)),
        due_bills=Count("id", filter=Q(status=Bill.Status.UNPAID)),
    )
    purchases = totals["total_purchases"] or Decimal("0.00")
    paid = totals["total_paid"] or Decimal("0.00")
    outstanding = max(purchases - paid, Decimal("0.00"))
    return {
        "total_bills": totals["total_bills"],
        "total_purchases": f"{purchases:.2f}",
        "total_paid": f"{paid:.2f}",
        "total_outstanding": f"{outstanding:.2f}",
        "paid_bills": totals["paid_bills"],
        "partial_bills": totals["partial_bills"],
        "due_bills": totals["due_bills"],
        "credit_status": "CREDIT" if outstanding > 0 else "CLEAR",
    }


class BusinessSourceAccountView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, source_id):
        source = get_object_or_404(BusinessSource, pk=source_id)
        filters_serializer = BusinessSourceAccountFiltersSerializer(data=request.query_params)
        filters_serializer.is_valid(raise_exception=True)
        filters = filters_serializer.validated_data

        source_bills = Bill.objects.filter(customer__business_source_id=source.id)
        valid_bills = source_bills.exclude(
            status__in=(Bill.Status.DRAFT, Bill.Status.CANCELLED)
        )

        filtered_bills = source_bills
        status_filter = filters["status"]
        if status_filter == "CANCELLED":
            filtered_bills = filtered_bills.filter(status=Bill.Status.CANCELLED)
        else:
            filtered_bills = filtered_bills.exclude(
                status__in=(Bill.Status.DRAFT, Bill.Status.CANCELLED)
            )
            if status_filter == "DUE":
                filtered_bills = filtered_bills.filter(status=Bill.Status.UNPAID)
            elif status_filter in (Bill.Status.PAID, Bill.Status.PARTIAL):
                filtered_bills = filtered_bills.filter(status=status_filter)

        search = filters.get("search", "").strip()
        if search:
            filtered_bills = filtered_bills.filter(
                Q(bill_number__icontains=search) | Q(customer__name__icontains=search)
            )
        if filters.get("date_from"):
            filtered_bills = filtered_bills.filter(bill_date__gte=filters["date_from"])
        if filters.get("date_to"):
            filtered_bills = filtered_bills.filter(bill_date__lte=filters["date_to"])

        filtered_valid_bills = filtered_bills.exclude(
            status__in=(Bill.Status.DRAFT, Bill.Status.CANCELLED)
        )
        history_count = filtered_bills.count()
        page_size = filters["page_size"]
        total_pages = max((history_count + page_size - 1) // page_size, 1)
        page_number = min(filters["page"], total_pages)
        offset = (page_number - 1) * page_size
        ordered_bills = filtered_bills.order_by("bill_date", "id")
        bill_rows = list(
            ordered_bills.select_related("customer")
            .values(
                "id",
                "bill_number",
                "customer__name",
                "bill_date",
                "grand_total",
                "amount_paid",
                "amount_due",
                "status",
            )[offset:offset + page_size]
        )

        statement = []
        running_balance = Decimal("0.00")
        if offset and filtered_valid_bills.exists():
            prior_bill_ids = filtered_valid_bills.order_by("bill_date", "id").values("id")[:offset]
            prior_totals = filtered_valid_bills.filter(id__in=prior_bill_ids).aggregate(
                purchases=Sum("grand_total"),
                paid=Sum("amount_paid"),
            )
            running_balance = max(
                (prior_totals["purchases"] or Decimal("0.00"))
                - (prior_totals["paid"] or Decimal("0.00")),
                Decimal("0.00"),
            )
        statement_opening_balance = running_balance
        for bill in bill_rows:
            if bill["status"] in (Bill.Status.DRAFT, Bill.Status.CANCELLED):
                continue
            total = bill["grand_total"]
            amount_paid = bill["amount_paid"]
            running_balance += total
            statement.append({
                "date": bill["bill_date"].isoformat(),
                "reference": bill["bill_number"],
                "description": "Purchase",
                "debit": f"{total:.2f}",
                "credit": "0.00",
                "balance": f"{running_balance:.2f}",
            })
            if amount_paid > 0:
                running_balance -= amount_paid
                statement.append({
                    "date": bill["bill_date"].isoformat(),
                    "reference": bill["bill_number"],
                    "description": "Payment recorded",
                    "debit": "0.00",
                    "credit": f"{amount_paid:.2f}",
                    "balance": f"{running_balance:.2f}",
                })

        return Response({
            "source": {"id": source.id, "name": source.name},
            "summary": account_summary(valid_bills),
            "filtered_summary": account_summary(filtered_valid_bills),
            "history": {
                "page": page_number,
                "page_size": page_size,
                "total_bills": history_count,
                "total_pages": total_pages,
            },
            "statement_opening_balance": f"{statement_opening_balance:.2f}",
            "filters": {
                "search": search,
                "status": status_filter,
                "date_from": filters.get("date_from").isoformat() if filters.get("date_from") else "",
                "date_to": filters.get("date_to").isoformat() if filters.get("date_to") else "",
            },
            "bills": [
                {
                    "id": bill["id"],
                    "bill_number": bill["bill_number"],
                    "customer_name": bill["customer__name"],
                    "bill_date": bill["bill_date"].isoformat(),
                    "grand_total": f"{bill['grand_total']:.2f}",
                    "amount_paid": f"{bill['amount_paid']:.2f}",
                    "amount_due": (
                        f"{bill['amount_due']:.2f}"
                        if bill["status"] not in (Bill.Status.DRAFT, Bill.Status.CANCELLED)
                        else "0.00"
                    ),
                    "status": bill["status"],
                }
                for bill in bill_rows
            ],
            "statement": statement,
        })