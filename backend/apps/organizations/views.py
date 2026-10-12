from django.db.models import Count
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.users.roles import Role
from common.permissions import IsAdmin, IsAdminOrReadOnly

from . import services
from .models import Membership, Organization
from .serializers import (
    MembershipSerializer,
    MembershipUpdateSerializer,
    OrganizationSerializer,
    OrganizationUpdateSerializer,
)


class OrganizationViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Organizations. Admins manage all of them; other users only see their own active ones.

    Organizations are never deleted, only deactivated, to preserve history.
    """

    serializer_class = OrganizationSerializer
    permission_classes = [IsAdminOrReadOnly]
    filterset_fields = ["is_active"]
    search_fields = ["name", "slug", "contact_email"]
    ordering_fields = ["name", "created_at"]
    ordering = ["name"]

    def get_queryset(self):
        qs = Organization.objects.annotate(member_count=Count("memberships", distinct=True))
        if getattr(self, "swagger_fake_view", False):  # OpenAPI schema generation
            return qs.none()
        user = self.request.user
        if user.role == Role.ADMIN:
            return qs
        return qs.filter(memberships__user=user, is_active=True)

    def perform_create(self, serializer):
        serializer.instance = services.create_organization(
            actor=self.request.user, request=self.request, **serializer.validated_data
        )

    @extend_schema(request=OrganizationUpdateSerializer, responses=OrganizationSerializer)
    def update(self, request, *args, **kwargs):
        org = self.get_object()
        serializer = OrganizationUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_organization(
            org, actor=request.user, request=request, **serializer.validated_data
        )
        return Response(OrganizationSerializer(self.get_queryset().get(pk=org.pk)).data)

    def _set_active(self, request, active: bool):
        org = services.set_organization_active(
            self.get_object(), active=active, actor=request.user, request=request
        )
        return Response(OrganizationSerializer(self.get_queryset().get(pk=org.pk)).data)

    @extend_schema(request=None, responses=OrganizationSerializer)
    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        return self._set_active(request, True)

    @extend_schema(request=None, responses=OrganizationSerializer)
    @action(detail=True, methods=["post"])
    def deactivate(self, request, pk=None):
        return self._set_active(request, False)


class MembershipViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Organization memberships (administrators only)."""

    serializer_class = MembershipSerializer
    permission_classes = [IsAdmin]
    filterset_fields = ["organization", "user", "role"]
    search_fields = ["user__email", "user__first_name", "user__last_name", "organization__name"]
    ordering_fields = ["created_at", "user__email"]

    def get_queryset(self):
        return Membership.objects.select_related("organization", "user").prefetch_related(
            "user__groups"
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership = services.add_member(
            actor=request.user, request=request, **serializer.validated_data
        )
        return Response(MembershipSerializer(membership).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=MembershipUpdateSerializer, responses=MembershipSerializer)
    def update(self, request, *args, **kwargs):
        membership = self.get_object()
        serializer = MembershipUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership = services.update_member_role(
            membership, role=serializer.validated_data["role"], actor=request.user, request=request
        )
        return Response(MembershipSerializer(membership).data)

    def perform_destroy(self, instance):
        services.remove_member(instance, actor=self.request.user, request=self.request)
