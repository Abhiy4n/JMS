from django.db.models import Count, Q
from django.db.models.functions import Lower
from django.db.models.deletion import ProtectedError
from django.db import transaction
from rest_framework import generics, permissions, status, serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from .models import BusinessSource, Customer
from .serializers import (
    BusinessSourceSerializer,
    CustomerSerializer,
    LoginSerializer,
    RegisterSerializer,
    UserSerializer,
)


def tokens_for_user(user):
    refresh = RefreshToken.for_user(user)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    }


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            {
                **tokens_for_user(user),
                "user": UserSerializer(user).data,
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        return Response(
            {
                **tokens_for_user(user),
                "user": UserSerializer(user).data,
            }
        )


class MeView(generics.RetrieveAPIView):
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user


class AuthTokenRefreshView(TokenRefreshView):
    permission_classes = [permissions.AllowAny]


class BusinessSourceListCreateView(generics.ListCreateAPIView):
    serializer_class = BusinessSourceSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = BusinessSource.objects.annotate(customer_count=Count("customers"))
        search = self.request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(name__icontains=search)
        source_type = self.request.query_params.get("source_type", "").strip()
        if source_type:
            if source_type not in BusinessSource.Type.values:
                raise serializers.ValidationError(
                    {"source_type": "Choose Individual, Company or Dynamic."}
                )
            queryset = queryset.filter(source_type=source_type)

        ordering = self.request.query_params.get("ordering", "first_added")
        if ordering == "first_added":
            return queryset.order_by("created_at", "id")
        if ordering == "recently_added":
            return queryset.order_by("-created_at", "-id")
        if ordering == "name_asc":
            return queryset.order_by(Lower("name"), "id")
        if ordering == "name_desc":
            return queryset.order_by(Lower("name").desc(), "id")
        raise serializers.ValidationError({
            "ordering": "Choose first_added, recently_added, name_asc or name_desc."
        })

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class BusinessSourceSummaryView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({
            "total_sources": BusinessSource.objects.count(),
            "total_linked_customers": Customer.objects.filter(business_source__isnull=False).count(),
        })


class BusinessSourceDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = BusinessSource.objects.annotate(customer_count=Count("customers"))
    serializer_class = BusinessSourceSerializer
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        source = self.get_object()
        try:
            source.delete()
        except ProtectedError:
            return Response({"detail": "This business source is assigned to customers. Reassign or unlink those customers before deleting it."}, status=status.HTTP_409_CONFLICT)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomerListCreateView(generics.ListCreateAPIView):
    serializer_class = CustomerSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Customer.objects.select_related("business_source")
        search = self.request.query_params.get("search", "").strip()
        source_id = self.request.query_params.get("business_source", "").strip()
        customer_type = self.request.query_params.get("customer_type", "").strip()
        if customer_type:
            if customer_type not in Customer.Type.values:
                raise serializers.ValidationError({"customer_type": "Choose Individual, Company or Dynamic Customer."})
            queryset = queryset.filter(
                Q(business_source__source_type=customer_type)
                | Q(business_source__isnull=True, customer_type=customer_type)
            )
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(phone__icontains=search)
                | Q(email__icontains=search)
                | Q(business_source__name__icontains=search)
            )
        if source_id:
            if not source_id.isdecimal():
                raise serializers.ValidationError({"business_source": "Enter a valid legacy source ID."})
            queryset = queryset.filter(business_source_id=source_id)
        # Keep alphabetical order for legacy callers; the directory requests its choice.
        # ID breaks equal-name/date ties so serial numbers stay deterministic.
        ordering = self.request.query_params.get("ordering", "name_asc")
        if ordering == "first_added":
            return queryset.order_by("created_at", "id")
        if ordering == "recently_added":
            return queryset.order_by("-created_at", "-id")
        if ordering == "name_asc":
            return queryset.order_by(Lower("name"), "id")
        if ordering == "name_desc":
            return queryset.order_by(Lower("name").desc(), "id")
        raise serializers.ValidationError({"ordering": "Choose first_added, recently_added, name_asc or name_desc."})


class CustomerDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Customer.objects.select_related("business_source")
    serializer_class = CustomerSerializer

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        customer = self.get_object()
        if customer.source_entry_id:
            return Response({"detail": "This customer represents a Business Source. Deactivate the customer instead; its source and financial history will be preserved."}, status=status.HTTP_409_CONFLICT)
        try:
            customer.delete()
        except ProtectedError:
            return Response({"detail": "This customer has Bhaka Patras, bills or credit history. Deactivate the customer to preserve those records."}, status=status.HTTP_409_CONFLICT)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomerTypeListView(APIView):
    """The three fixed types are product configuration, not seeded customers."""

    def get(self, request):
        return Response([
            {"code": code, "name": label, "customer_count": Customer.objects.filter(customer_type=code).count(),
             "period_days": 15 if code == Customer.Type.COMPANY else 30,
             "interest_amount": None if code == Customer.Type.DYNAMIC else "2000.00",
             "credit_basis": None if code == Customer.Type.DYNAMIC else "100000.00"}
            for code, label in Customer.Type.choices
        ])
