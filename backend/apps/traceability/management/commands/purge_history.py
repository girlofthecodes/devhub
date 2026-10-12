"""Retention policy: delete trace events and audit records older than N days.

The append-only tables are protected by a PostgreSQL trigger; this command is the only
code path that enables deletion (`SET LOCAL devhub.allow_purge = on`), and only inside
its own transaction.
"""

from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, models, transaction
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.traceability.models import Event

MIN_DAYS = 30


class Command(BaseCommand):
    help = "Purga eventos de trazabilidad y auditoría según la política de retención."

    def add_arguments(self, parser):
        parser.add_argument("--events-days", type=int, default=settings.TRACE_RETENTION_DAYS)
        parser.add_argument("--audit-days", type=int, default=settings.AUDIT_RETENTION_DAYS)
        parser.add_argument(
            "--dry-run", action="store_true", help="Solo muestra cuántos se borrarían."
        )

    def handle(self, *args, events_days: int, audit_days: int, dry_run: bool, **options):
        for name, days in (("--events-days", events_days), ("--audit-days", audit_days)):
            if days < MIN_DAYS:
                raise CommandError(f"{name} debe ser al menos {MIN_DAYS} días.")
        now = timezone.now()
        events = Event.objects.filter(occurred_at__lt=now - timedelta(days=events_days))
        audits = AuditLog.objects.filter(created_at__lt=now - timedelta(days=audit_days))
        counts = {"eventos": events.count(), "auditoría": audits.count()}
        if dry_run:
            self.stdout.write(f"[dry-run] Se borrarían: {counts}")
            return
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL devhub.allow_purge = 'on'")
            # Bypass the append-only QuerySet guard on purpose (retention only).
            models.QuerySet.delete(events)
            models.QuerySet.delete(audits)
        self.stdout.write(self.style.SUCCESS(f"Purgados: {counts}"))
