import django_filters
from rest_framework import viewsets

from apps.projects import selectors as project_selectors
from apps.users.roles import Role
from common.permissions import IsStaffMember

from .models import Event, EventSource, EventType, Severity
from .serializers import EventSerializer


class ChoiceInFilter(django_filters.BaseInFilter, django_filters.ChoiceFilter):
    """Comma-separated values, each validated against the choices."""


class EventFilter(django_filters.FilterSet):
    event_type = ChoiceInFilter(choices=EventType.choices, lookup_expr="in")
    severity = ChoiceInFilter(choices=Severity.choices, lookup_expr="in")
    source = django_filters.ChoiceFilter(choices=EventSource.choices)
    occurred_from = django_filters.IsoDateTimeFilter(field_name="occurred_at", lookup_expr="gte")
    occurred_to = django_filters.IsoDateTimeFilter(field_name="occurred_at", lookup_expr="lte")

    class Meta:
        model = Event
        fields = ["project", "environment", "deployment", "correlation_id"]


class EventViewSet(viewsets.ReadOnlyModelViewSet):
    """Trace timeline. Events are created only by the backend or authorized integrations.

    Admins see every event; developers only events of projects they can see (events
    without a project are internal and admin-only).
    """

    serializer_class = EventSerializer
    permission_classes = [IsStaffMember]
    filterset_class = EventFilter
    search_fields = ["description", "actor_label", "correlation_id"]
    ordering_fields = ["occurred_at"]
    ordering = ["-occurred_at", "-created_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Event.objects.none()
        user = self.request.user
        qs = Event.objects.select_related("project", "environment", "deployment")
        if user.role == Role.ADMIN:
            return qs
        return qs.filter(project__in=project_selectors.projects_visible_to(user))
