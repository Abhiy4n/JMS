from urllib.parse import urlparse
from uuid import uuid4

from django.conf import settings
from django.core.files.storage import default_storage
from django.db.models import Count, Q
from rest_framework import generics, permissions, status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from .models import BusinessSource, Customer
from .serializers import (
    PROFILE_PICTURE_EXTENSIONS,
    BusinessSourceSerializer,
    CustomerSerializer,
    LoginSerializer,
    ProfilePictureSerializer,
    RegisterSerializer,
    UserSerializer,
)

PROFILE_PICTURE_DIR = "profile_pictures"


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


def stored_profile_picture_name(url):
    path = urlparse(url).path
    if not path.startswith(settings.MEDIA_URL):
        return None
    name = path[len(settings.MEDIA_URL):]
    return name if name.startswith(f"{PROFILE_PICTURE_DIR}/") else None


class ProfilePictureView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser]

    def post(self, request):
        serializer = ProfilePictureSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        image = serializer.validated_data["profile_picture"]

        user = request.user
        extension = PROFILE_PICTURE_EXTENSIONS[image.content_type]
        name = default_storage.save(
            f"{PROFILE_PICTURE_DIR}/{user.pk}/{uuid4().hex}{extension}", image
        )

        previous_name = stored_profile_picture_name(user.profile_picture)
        user.profile_picture = request.build_absolute_uri(default_storage.url(name))
        user.save(update_fields=["profile_picture"])
        if previous_name:
            default_storage.delete(previous_name)

        return Response(UserSerializer(user).data)

    def delete(self, request):
        user = request.user
        previous_name = stored_profile_picture_name(user.profile_picture)
        if user.profile_picture:
            user.profile_picture = ""
            user.save(update_fields=["profile_picture"])
        if previous_name:
            default_storage.delete(previous_name)

        return Response(UserSerializer(user).data)


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
