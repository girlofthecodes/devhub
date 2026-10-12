"""Create the initial administrator from environment variables (idempotent)."""

import os

from django.core.management.base import BaseCommand, CommandError

from apps.users.models import User


class Command(BaseCommand):
    help = "Crea el administrador inicial a partir de DJANGO_ADMIN_EMAIL/DJANGO_ADMIN_PASSWORD."

    def handle(self, *args, **options):
        email = os.environ.get("DJANGO_ADMIN_EMAIL", "").strip().lower()
        password = os.environ.get("DJANGO_ADMIN_PASSWORD", "")
        if not email or not password:
            raise CommandError("Define DJANGO_ADMIN_EMAIL y DJANGO_ADMIN_PASSWORD.")
        if User.objects.filter(email=email).exists():
            self.stdout.write(f"El administrador {email} ya existe; no se modifica.")
            return
        User.objects.create_superuser(email=email, password=password)
        self.stdout.write(self.style.SUCCESS(f"Administrador {email} creado."))
