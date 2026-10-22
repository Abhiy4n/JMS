from urllib.parse import urlparse
from uuid import uuid4

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Count, Q
from django.db.models.deletion import ProtectedError
from django.db.models.functions import Lower
from django.utils import timezone
from rest_framework import generics, permissions, serializers, status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView

from .models import BusinessSource, Customer, UserSession
from .session_auth import SessionTokenRefreshSerializer, tokens_for_user
from .serializers import (
    PROFILE_PICTURE_EXTENSIONS,
    BusinessSourceSerializer,
    CustomerSerializer,
    LoginEventSerializer,
    LoginSerializer,
    ProfilePictureSerializer,
    RegisterSerializer,
    UserSerializer,
    UserSessionSerializer,
)

PROFILE_PICTURE_DIR = "profile_pictures"


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            user = serializer.save()
            tokens = tokens_for_user(user, request)
        return Response(
            {
                **tokens,
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
                **tokens_for_user(user, request),
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
    serializer_class = SessionTokenRefreshSerializer


class LoginActivityView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        current_session = request.auth_session
        sessions = request.user.auth_sessions.all()
        events = request.user.login_events.all()[: settings.AUTH_LOGIN_EVENT_LIMIT]
        return Response(
            {
                "sessions": UserSessionSerializer(
                    sessions,
                    many=True,
                    context={"current_session": current_session},
                ).data,
                "login_events": LoginEventSerializer(events, many=True).data,
            }
        )


class RevokeSessionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, session_id):
        with transaction.atomic():
            session = UserSession.objects.select_for_update().filter(
                pk=session_id, user=request.user
            ).first()
            if session is None:
                return Response(
                    {"detail": "Session not found."}, status=status.HTTP_404_NOT_FOUND
                )
            if session.revoked_at is None:
                session.revoked_at = timezone.now()
                session.save(update_fields=["revoked_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class RevokeOtherSessionsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        revoked = UserSession.objects.filter(
            user=request.user,
            revoked_at__isnull=True,
        ).exclude(pk=request.auth_session.pk).update(revoked_at=timezone.now())
        return Response({"revoked": revoked})


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        UserSession.objects.filter(
            pk=request.auth_session.pk,
            user=request.user,
            revoked_at__isnull=True,
        ).update(revoked_at=timezone.now())
        return Response(status=status.HTTP_204_NO_CONTENT)


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
