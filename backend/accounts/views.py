from django.db.models import Count, Q
from rest_framework import generics, permissions, status
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
            queryset = queryset.filter(Q(name__icontains=search) | Q(channel_type__icontains=search))
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class BusinessSourceDetailView(generics.RetrieveAPIView):
    queryset = BusinessSource.objects.annotate(customer_count=Count("customers"))
    serializer_class = BusinessSourceSerializer
    permission_classes = [permissions.IsAuthenticated]


class CustomerListCreateView(generics.ListCreateAPIView):
    serializer_class = CustomerSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Customer.objects.select_related("business_source")
        search = self.request.query_params.get("search", "").strip()
        source_id = self.request.query_params.get("business_source", "").strip()
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(phone__icontains=search)
                | Q(email__icontains=search)
                | Q(business_source__name__icontains=search)
            )
        if source_id:
            queryset = queryset.filter(business_source_id=source_id)
        return queryset
