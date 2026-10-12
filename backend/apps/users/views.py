import django_filters
from django.contrib.auth import authenticate, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.audit import services as audit
from apps.audit.models import AuditAction
from common.permissions import IsAdmin

from . import services
from .models import User
from .roles import Role
from .serializers import (
    ChangePasswordSerializer,
    DetailSerializer,
    LoginSerializer,
    MeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileUpdateSerializer,
    RoleSerializer,
    UserCreateSerializer,
    UserSerializer,
    UserUpdateSerializer,
)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the CSRF cookie that the SPA must echo in the X-CSRFToken header."""

    permission_classes = [AllowAny]

    @extend_schema(responses=DetailSerializer)
    def get(self, request):
        return Response({"detail": "ok"})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    @extend_schema(request=LoginSerializer, responses=MeSerializer)
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        user = authenticate(request, email=email, password=serializer.validated_data["password"])
        if user is None:
            audit.record(AuditAction.LOGIN_FAILED, metadata={"email": email}, request=request)
            return Response(
                {"code": "invalid_credentials", "detail": "Correo o contraseña incorrectos."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        login(request, user)
        audit.record(AuditAction.LOGIN_SUCCEEDED, actor=user, target=user, request=request)
        return Response(MeSerializer(user).data)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        audit.record(AuditAction.LOGOUT, actor=request.user, target=request.user, request=request)
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=MeSerializer)
    def get(self, request):
        return Response(MeSerializer(request.user).data)

    @extend_schema(request=ProfileUpdateSerializer, responses=MeSerializer)
    def patch(self, request):
        serializer = ProfileUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = services.update_user(
            request.user, data=serializer.validated_data, actor=request.user, request=request
        )
        return Response(MeSerializer(user).data)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=ChangePasswordSerializer, responses=DetailSerializer)
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.change_password(request.user, request=request, **serializer.validated_data)
        return Response({"detail": "Contraseña actualizada."})


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    @extend_schema(request=PasswordResetRequestSerializer, responses=DetailSerializer)
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.request_password_reset(serializer.validated_data["email"], request=request)
        return Response(
            {"detail": "Si la cuenta existe, recibirás un correo con instrucciones."},
            status=status.HTTP_202_ACCEPTED,
        )


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    @extend_schema(request=PasswordResetConfirmSerializer, responses=DetailSerializer)
    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.confirm_password_reset(request=request, **serializer.validated_data)
        return Response({"detail": "Contraseña restablecida. Ya puedes iniciar sesión."})


class RoleListView(APIView):
    permission_classes = [IsAdmin]

    @extend_schema(responses=RoleSerializer(many=True))
    def get(self, request):
        return Response([{"value": r.value, "label": r.label} for r in Role])


class UserFilter(django_filters.FilterSet):
    role = django_filters.ChoiceFilter(choices=Role.choices, field_name="groups__name")
    organization = django_filters.UUIDFilter(field_name="memberships__organization")

    class Meta:
        model = User
        fields = ["is_active", "role", "organization"]


class UserViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """User administration. Users are never deleted: they are deactivated."""

    permission_classes = [IsAdmin]
    serializer_class = UserSerializer
    filterset_class = UserFilter
    search_fields = ["email", "first_name", "last_name"]
    ordering_fields = ["email", "date_joined", "last_login"]
    ordering = ["email"]

    def get_queryset(self):
        return User.objects.prefetch_related("groups").distinct()

    @extend_schema(request=UserCreateSerializer, responses={201: UserSerializer})
    def create(self, request, *args, **kwargs):
        serializer = UserCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = services.create_user(
            actor=request.user, request=request, **serializer.validated_data
        )
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=UserUpdateSerializer, responses=UserSerializer)
    def update(self, request, *args, **kwargs):
        user = self.get_object()
        serializer = UserUpdateSerializer(data=request.data, partial=kwargs.get("partial", False))
        serializer.is_valid(raise_exception=True)
        user = services.update_user(
            user, data=serializer.validated_data, actor=request.user, request=request
        )
        return Response(UserSerializer(user).data)

    @extend_schema(request=None, responses=UserSerializer)
    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        user = services.activate_user(self.get_object(), actor=request.user, request=request)
        return Response(UserSerializer(user).data)

    @extend_schema(request=None, responses=UserSerializer)
    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        user = services.deactivate_user(self.get_object(), actor=request.user, request=request)
        return Response(UserSerializer(user).data)

    @extend_schema(request=None, responses=DetailSerializer)
    @action(detail=True, methods=["post"], url_path="revoke-sessions")
    def revoke_sessions(self, request, pk=None):
        count = services.admin_revoke_sessions(
            self.get_object(), actor=request.user, request=request
        )
        return Response({"detail": f"Sesiones revocadas: {count}."})
