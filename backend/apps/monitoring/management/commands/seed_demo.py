"""Demo data for local development, demos and screenshots (every module, 30 days of history).

    python manage.py seed_demo            # only with DEBUG=true and an instance without demo data
    python manage.py seed_demo --force    # also outside DEBUG (never in production)

What it creates: developers and a client, organizations, servers, 8 projects with
environments, deployments and trace events, health checks with 30 days of results, internal
metrics (pushed by the "apps"), open/acknowledged/resolved alerts, a service token, portal
access and commercial data (contracts, receivables, payments, expenses).

The URLs are fictitious (*.demo.devhub.test). Stop the `monitor` service while you use this
data: real probes against those hosts fail and would overwrite the simulated states.
"""

from __future__ import annotations

import math
import random
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.deployments.models import Deployment, DeploymentSource, DeploymentStatus
from apps.deployments.services import create_service_token
from apps.infrastructure.models import Environment, Server
from apps.monitoring.models import (
    Alert,
    AlertKind,
    AlertStatus,
    CheckResult,
    HealthCheck,
    HealthStatus,
    MetricSample,
)
from apps.organizations.models import Membership, Organization
from apps.projects.models import Project, ProjectMember, Release
from apps.traceability import services as trace
from apps.traceability.models import EventSource, EventType, Severity
from apps.users import services as user_services
from apps.users.models import User
from apps.users.roles import Role

PASSWORD = "Demo-DevHub-2026!"  # noqa: S105 - published demo credential, local only
DOMAIN = "demo.devhub.test"
MARKER = "tienda-en-linea"
CHECK_INTERVAL = timedelta(minutes=5)
METRIC_INTERVAL = timedelta(minutes=10)


# Each project: environments, traffic profile and the incidents that shape its history.
# Offsets are minutes before "now"; an open incident has no end.
PROJECTS = [
    {
        "name": "Tienda en Línea",
        "slug": "tienda-en-linea",
        "status": "AVAILABLE",
        "tech": ["React", "Django", "PostgreSQL"],
        "description": "Comercio electrónico con catálogo, carrito y pagos en línea.",
        "envs": {"PRODUCTION": "tienda", "DEMO": "demo-tienda"},
        "rpm": 420,
        "base_ms": 180,
        "cpu": 38,
        "mem": 55,
        "outages": [(9 * 1440 + 300, 12)],
    },
    {
        "name": "Portal de Citas Médicas",
        "slug": "portal-de-citas-medicas",
        "status": "AVAILABLE",
        "tech": ["Vue", "FastAPI", "PostgreSQL"],
        "description": "Agenda de citas para clínicas con recordatorios por correo y SMS.",
        "envs": {"PRODUCTION": "citas", "DEMO": "demo-citas"},
        "rpm": 260,
        "base_ms": 240,
        "cpu": 44,
        "mem": 62,
        "outages": [(18 * 1440 + 600, 35), (26, None)],
        "now": {"error_rate_percent": 22.4, "cpu_percent": 71, "latency_p95_ms": 2900},
    },
    {
        "name": "Sistema de Inventarios",
        "slug": "sistema-de-inventarios",
        "status": "AVAILABLE",
        "tech": ["Angular", ".NET", "SQL Server"],
        "description": "Control de existencias, entradas, salidas y almacenes.",
        "envs": {"PRODUCTION": "inventarios"},
        "rpm": 180,
        "base_ms": 420,
        "cpu": 58,
        "mem": 66,
        "outages": [(6 * 1440 + 200, 18)],
        "slow_now": 2650,
        "now": {"cpu_percent": 91.3, "latency_p95_ms": 1820},
    },
    {
        "name": "App de Reservaciones",
        "slug": "app-de-reservaciones",
        "status": "TESTING",
        "tech": ["React Native", "Node.js", "MongoDB"],
        "description": "Reservación de mesas y espacios con confirmación inmediata.",
        "envs": {"PRODUCTION": "reservas", "DEMO": "demo-reservas"},
        "rpm": 95,
        "base_ms": 210,
        "cpu": 31,
        "mem": 79,
        "outages": [],
        "now": {"memory_percent": 88.6},
    },
    {
        "name": "Facturación Electrónica",
        "slug": "facturacion-electronica",
        "status": "AVAILABLE",
        "tech": ["Django", "Celery", "PostgreSQL"],
        "description": "Emisión y timbrado de CFDI 4.0 con complementos de pago.",
        "envs": {"PRODUCTION": "facturacion"},
        "rpm": 140,
        "base_ms": 260,
        "cpu": 35,
        "mem": 48,
        "outages": [(3 * 1440 + 420, 42), (12 * 1440 + 90, 95)],
    },
    {
        "name": "CRM de Ventas",
        "slug": "crm-de-ventas",
        "status": "DEVELOPMENT",
        "tech": ["Next.js", "NestJS", "PostgreSQL"],
        "description": "Seguimiento de prospectos, oportunidades y cotizaciones.",
        "envs": {"DEVELOPMENT": None},
        "rpm": 20,
        "base_ms": 0,
        "cpu": 22,
        "mem": 41,
        "outages": [],
        "metrics_stop": 27,
    },
    {
        "name": "Blog Corporativo",
        "slug": "blog-corporativo",
        "status": "MAINTENANCE",
        "tech": ["Astro", "Strapi"],
        "description": "Sitio de contenidos y noticias de la empresa.",
        "envs": {"PRODUCTION": "blog"},
        "rpm": 35,
        "base_ms": 120,
        "cpu": 12,
        "mem": 34,
        "outages": [(21 * 1440, 8)],
    },
    {
        "name": "Control Escolar",
        "slug": "control-escolar",
        "status": "PLANNING",
        "tech": ["Laravel", "MySQL"],
        "description": "Inscripciones, calificaciones y pagos de colegiaturas.",
        "envs": {},
    },
]


def traffic(at, peak_local_hour=13.0) -> float:
    """Daily curve (0.25 at night .. 1.0 at peak) plus a weekly dip on weekends."""
    local = timezone.localtime(at)
    h = local.hour + local.minute / 60
    daily = 0.25 + 0.75 * (0.5 + 0.5 * math.cos((h - peak_local_hour) / 24 * 2 * math.pi)) ** 2
    return daily * (0.7 if local.weekday() >= 5 else 1.0)


class Command(BaseCommand):
    help = "Carga datos de demostración en todos los módulos (solo desarrollo/demos)."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Permitir sin DEBUG.")
        parser.add_argument("--seed", type=int, default=2026, help="Semilla aleatoria.")

    def handle(self, *args, force: bool, seed: int, **options):
        if not settings.DEBUG and not force:
            raise CommandError("seed_demo solo se ejecuta con DEBUG=true (o --force).")
        if Project.objects.filter(slug=MARKER).exists():
            raise CommandError("Los datos de demostración ya existen en esta base de datos.")
        self.rng = random.Random(seed)  # noqa: S311 - simulated data, not security
        self.now = timezone.now().replace(second=0, microsecond=0)
        with transaction.atomic():
            self.users()
            self.organizations()
            self.servers()
            for spec in PROJECTS:
                self.project(spec)
            self.service_token()
            self.commercial()
        self.stdout.write(self.style.SUCCESS("Datos de demostración cargados."))
        self.stdout.write(
            f"Usuarios (contraseña {PASSWORD}): ana.torres@devhub.local (desarrolladora), "
            "luis.mendez@devhub.local (desarrollador), cliente@acme.mx (cliente)."
        )

    # --- people & infrastructure ------------------------------------------------------

    def _user(self, email, role, first, last):
        user = User.objects.create_user(
            email=email, password=PASSWORD, first_name=first, last_name=last
        )
        user_services._apply_role(user, role)
        return user

    def users(self):
        self.admin = User.objects.filter(is_superuser=True).order_by("date_joined").first()
        if self.admin is None:
            self.admin = User.objects.create_superuser(
                email="admin@devhub.local", password=PASSWORD
            )
        self.ana = self._user("ana.torres@devhub.local", Role.DEVELOPER, "Ana", "Torres")
        self.luis = self._user("luis.mendez@devhub.local", Role.DEVELOPER, "Luis", "Méndez")
        self.client = self._user("cliente@acme.mx", Role.CLIENT, "Carla", "Ríos")

    def organizations(self):
        self.acme = Organization.objects.create(
            name="Comercializadora Acme",
            slug="acme",
            contact_email="ti@acme.mx",
            description="Cliente minorista con tiendas en el Bajío.",
        )
        self.clinic = Organization.objects.create(
            name="Clínica Santa Fe", slug="clinica-santa-fe", contact_email="sistemas@csf.mx"
        )
        Organization.objects.create(
            name="Grupo Logística Norte", slug="logistica-norte", contact_email="it@gln.mx"
        )
        Membership.objects.create(organization=self.acme, user=self.client, role="OWNER")

    def servers(self):
        self.srv_a = Server.objects.create(
            name="Servidor A",
            identifier="srv-a",
            location="Home Lab · rack 1",
            server_type="APPLICATION",
            operating_system="Ubuntu Server 24.04",
            vpn_address="10.8.0.1",
            notes="Aplicaciones, Caddy y Cloudflare Tunnel.",
        )
        self.srv_b = Server.objects.create(
            name="Servidor B",
            identifier="srv-b",
            location="Home Lab · rack 1",
            server_type="DATABASE",
            operating_system="Debian 12",
            vpn_address="10.8.0.2",
            notes="PostgreSQL solo en la IP de la VPN.",
        )
        Server.objects.create(
            name="Raspberry Lab",
            identifier="rpi-lab",
            location="Oficina",
            server_type="MIXED",
            operating_system="Raspberry Pi OS",
            vpn_address="10.8.0.7",
            status="MAINTENANCE",
        )

    # --- projects ---------------------------------------------------------------------

    def project(self, spec):
        owner = self.ana if len(spec["name"]) % 2 else self.luis
        project = Project.objects.create(
            name=spec["name"],
            slug=spec["slug"],
            description=spec["description"],
            client_description=spec["description"],
            technologies=spec["tech"],
            status=spec["status"],
            owner=owner,
            repository_url=f"https://github.com/girlofthecodes/{spec['slug']}",
            site_url=(
                f"https://{spec['envs']['PRODUCTION']}.{DOMAIN}"
                if spec["envs"].get("PRODUCTION")
                else ""
            ),
        )
        ProjectMember.objects.create(
            project=project, user=self.luis if owner == self.ana else self.ana, role="MAINTAINER"
        )
        trace.emit(
            EventType.PROJECT_CREATED,
            description=f"Proyecto creado: {project.name}",
            project=project,
            actor=self.admin,
            source=EventSource.USER,
            occurred_at=self.now - timedelta(days=45),
        )
        for kind, host in spec["envs"].items():
            env = Environment.objects.create(
                project=project,
                kind=kind,
                server=self.srv_a,
                public_url=f"https://{host}.{DOMAIN}" if host else "",
                deployed_version="v1.4.2" if kind == "PRODUCTION" else "v1.5.0-rc.1",
            )
            self.deployments(env)
            if host:
                self.health_history(env, spec)
            self.metrics_history(env, spec)
        if spec["slug"] in {"tienda-en-linea", "app-de-reservaciones"}:
            Release.objects.create(
                project=project,
                version="v1.4.2",
                title="Mejoras de rendimiento",
                notes="Carga más rápida del catálogo y corrección de errores.",
                status="PUBLISHED",
                published_at=self.now - timedelta(days=5),
                created_by=self.admin,
            )
        setattr(self, spec["slug"].replace("-", "_"), project)

    def deployments(self, env):
        versions = ["v1.2.0", "v1.3.0", "v1.3.1", "v1.4.0", "v1.4.1", "v1.4.2"]
        if env.kind != "PRODUCTION":
            versions = ["v1.4.2", "v1.5.0-rc.1"]
        for i, version in enumerate(versions):
            started = self.now - timedelta(
                days=(len(versions) - i) * 4, hours=self.rng.randint(1, 9)
            )
            failed = version == "v1.4.0" and env.kind == "PRODUCTION"
            status = DeploymentStatus.FAILED if failed else DeploymentStatus.SUCCESS
            dep = Deployment.objects.create(
                environment=env,
                version=version,
                commit_sha=f"{self.rng.getrandbits(160):040x}",
                branch="main" if env.kind == "PRODUCTION" else "develop",
                source=DeploymentSource.GITHUB_ACTIONS,
                triggered_by_label=self.rng.choice(["ana-torres", "luis-mendez"]),
                status=status,
                started_at=started,
                finished_at=started + timedelta(seconds=self.rng.randint(70, 260)),
                ci_run_id=str(9_100_000 + self.rng.randint(0, 99_999)),
                ci_run_url="https://github.com/girlofthecodes/devhub/actions",
                message="Migraciones fallidas: columna duplicada" if failed else "",
            )
            Deployment.objects.filter(pk=dep.pk).update(created_at=started)
            trace.emit(
                EventType.DEPLOYMENT_STARTED,
                description=f"Despliegue {version} iniciado",
                deployment=dep,
                environment=env,
                source=EventSource.GITHUB_ACTIONS,
                actor_label=dep.triggered_by_label,
                correlation_id=dep.correlation_id,
                occurred_at=started,
            )
            trace.emit(
                EventType.DEPLOYMENT_FAILED if failed else EventType.DEPLOYMENT_SUCCESS,
                description=f"Despliegue {version} {'fallido' if failed else 'exitoso'}",
                deployment=dep,
                environment=env,
                severity=Severity.ERROR if failed else Severity.INFO,
                source=EventSource.GITHUB_ACTIONS,
                actor_label=dep.triggered_by_label,
                correlation_id=dep.correlation_id,
                occurred_at=dep.finished_at,
            )

    # --- monitoring -------------------------------------------------------------------

    def _outages(self, spec):
        out = []
        for start_min, length in spec.get("outages", []):
            start = self.now - timedelta(minutes=start_min)
            end = start + timedelta(minutes=length) if length else None
            out.append((start, end))
        return out

    def health_history(self, env, spec):
        is_prod = env.kind == "PRODUCTION"
        check = HealthCheck.objects.create(
            environment=env, path="/health", interval_seconds=300, degraded_threshold_ms=2000
        )
        outages = self._outages(spec) if is_prod else []
        slow_now = spec.get("slow_now") if is_prod else None
        rows = []
        t = self.now - timedelta(days=30)
        last = None
        while t <= self.now - timedelta(minutes=1):
            down = any(s <= t and (e is None or t < e) for s, e in outages)
            if down:
                row = CheckResult(
                    health_check=check,
                    checked_at=t,
                    status=HealthStatus.UNAVAILABLE,
                    error="Tiempo de espera agotado (5 s)"
                    if self.rng.random() < 0.6
                    else "Código HTTP inesperado: 502",
                    status_code=None,
                )
            else:
                load = traffic(t)
                ms = int(spec["base_ms"] * (0.8 + 0.6 * load) * self.rng.uniform(0.85, 1.2))
                if slow_now and t > self.now - timedelta(minutes=50):
                    ms = int(slow_now * self.rng.uniform(0.95, 1.15))
                elif self.rng.random() < 0.004:
                    ms = self.rng.randint(2100, 3200)  # occasional slow check
                status = HealthStatus.DEGRADED if ms > 2000 else HealthStatus.HEALTHY
                row = CheckResult(
                    health_check=check,
                    checked_at=t,
                    status=status,
                    response_ms=ms,
                    status_code=200,
                    error=f"Respuesta lenta ({ms} ms)" if status == HealthStatus.DEGRADED else "",
                )
            rows.append(row)
            last = row
            t += CHECK_INTERVAL
        CheckResult.objects.bulk_create(rows, batch_size=5000)

        # Current state, consistent with the last result.
        open_outage = next((s for s, e in outages if e is None), None)
        check.status = last.status
        check.last_checked_at = last.checked_at
        check.last_response_ms = last.response_ms
        check.last_status_code = last.status_code
        check.last_error = last.error
        check.consecutive_failures = (
            int((self.now - open_outage) / CHECK_INTERVAL) if open_outage else 0
        )
        check.status_changed_at = open_outage or (
            self.now - timedelta(minutes=50) if slow_now else self.now - timedelta(days=2)
        )
        check.save()

        # Incidents: trace events and alerts (resolved for past outages).
        severity = Severity.CRITICAL if is_prod else Severity.ERROR
        for start, end in outages:
            trace.emit(
                EventType.SERVICE_UNAVAILABLE,
                description=f"{env} no disponible: Tiempo de espera agotado (5 s)",
                environment=env,
                severity=severity,
                source=EventSource.MONITORING,
                actor_label="monitor",
                occurred_at=start,
            )
            alert = Alert.objects.create(
                environment=env,
                kind=AlertKind.SERVICE_DOWN,
                severity=severity,
                status=AlertStatus.OPEN if end is None else AlertStatus.RESOLVED,
                message=f"{env.display_name} no responde: Tiempo de espera agotado (5 s)",
                hits=max(1, int(((end or self.now) - start) / CHECK_INTERVAL)),
                opened_at=start,
                last_seen_at=end or last.checked_at,
                resolved_at=end,
            )
            if end:
                trace.emit(
                    EventType.SERVICE_RECOVERED,
                    description=f"{env} recuperado",
                    environment=env,
                    source=EventSource.MONITORING,
                    actor_label="monitor",
                    metadata={"downtime_seconds": int((end - start).total_seconds())},
                    occurred_at=end,
                )
                if start > self.now - timedelta(days=4):
                    Alert.objects.filter(pk=alert.pk).update(
                        acknowledged_at=start + timedelta(minutes=6), acknowledged_by=self.ana
                    )
        if slow_now:
            Alert.objects.create(
                environment=env,
                kind=AlertKind.SLOW_RESPONSE,
                severity=Severity.WARNING,
                message=f"{env.display_name} degradado: Respuesta lenta ({last.response_ms} ms)",
                value=last.response_ms,
                threshold=2000,
                hits=10,
                opened_at=self.now - timedelta(minutes=50),
                last_seen_at=last.checked_at,
            )

    def metrics_history(self, env, spec):
        if "rpm" not in spec:
            return
        outages = self._outages(spec) if env.kind == "PRODUCTION" else []
        scale = 1.0 if env.kind == "PRODUCTION" else 0.08
        stop = spec.get("metrics_stop")
        end = self.now - timedelta(minutes=stop) if stop else self.now - timedelta(seconds=30)
        start = self.now - timedelta(days=30)
        rows = []
        t = start
        boot = start
        overrides = spec.get("now", {}) if env.kind == "PRODUCTION" else {}
        while t <= end:
            fine = t > self.now - timedelta(hours=6)
            load = traffic(t)
            down = any(s <= t and (e is None or t < e) for s, e in outages)
            days_up = (t - boot).total_seconds() / 86400
            if days_up > 4 + self.rng.random() * 3:  # periodic redeploy resets memory
                boot = t
                days_up = 0
            rpm = spec["rpm"] * scale * load * self.rng.uniform(0.88, 1.12)
            cpu = spec["cpu"] * (0.45 + 0.75 * load) * self.rng.uniform(0.9, 1.1)
            mem = spec["mem"] + days_up * 2.2 + self.rng.uniform(-1.5, 1.5)
            err = max(0.0, self.rng.gauss(0.35, 0.15))
            p95 = int(spec.get("base_ms", 150) * 2.1 * (0.8 + 0.5 * load) + self.rng.randint(0, 60))
            if down:
                rpm *= 0.1
                err = self.rng.uniform(35, 60)
                p95 = self.rng.randint(4000, 5000)
            recent = t > self.now - timedelta(minutes=45)
            sample = {
                "cpu_percent": cpu,
                "memory_percent": mem,
                "requests_per_minute": rpm,
                "error_rate_percent": err,
                "latency_p95_ms": p95,
            }
            if recent:
                for key, value in overrides.items():
                    sample[key] = value * self.rng.uniform(0.97, 1.03)
            rows.append(
                MetricSample(
                    environment=env,
                    recorded_at=t,
                    cpu_percent=round(min(100, sample["cpu_percent"]), 1),
                    memory_percent=round(min(100, sample["memory_percent"]), 1),
                    memory_used_mb=int(sample["memory_percent"] * 20.48),
                    requests_per_minute=round(sample["requests_per_minute"], 1),
                    error_rate_percent=round(min(100, sample["error_rate_percent"]), 2),
                    latency_p95_ms=int(sample["latency_p95_ms"]),
                    active_connections=int(rpm / 6) + self.rng.randint(0, 4),
                    process_uptime_seconds=int((t - boot).total_seconds()),
                )
            )
            t += timedelta(minutes=1) if fine else METRIC_INTERVAL
        MetricSample.objects.bulk_create(rows, batch_size=5000)
        last = rows[-1]

        # Current metric alerts, consistent with the last sample.
        rules = {
            "cpu_percent": (AlertKind.HIGH_CPU, "CPU", " %", 85, 95),
            "memory_percent": (AlertKind.HIGH_MEMORY, "Memoria", " %", 85, 95),
            "error_rate_percent": (AlertKind.HIGH_ERROR_RATE, "Tasa de errores", " %", 5, 15),
            "latency_p95_ms": (AlertKind.HIGH_LATENCY, "Latencia p95", " ms", 1500, 3000),
        }
        for field, (kind, label, unit, warn, crit) in rules.items():
            value = getattr(last, field)
            if value is None or value < warn:
                continue
            acknowledged = kind == AlertKind.HIGH_MEMORY
            Alert.objects.create(
                environment=env,
                kind=kind,
                severity=Severity.CRITICAL if value >= crit else Severity.WARNING,
                status=AlertStatus.ACKNOWLEDGED if acknowledged else AlertStatus.OPEN,
                message=f"{label} en {value:.0f}{unit} (umbral {warn}{unit})",
                value=value,
                threshold=warn,
                hits=40,
                opened_at=self.now - timedelta(minutes=40),
                last_seen_at=last.recorded_at,
                acknowledged_at=self.now - timedelta(minutes=31) if acknowledged else None,
                acknowledged_by=self.ana if acknowledged else None,
            )
        if stop:
            Alert.objects.create(
                environment=env,
                kind=AlertKind.METRICS_STALE,
                severity=Severity.WARNING,
                message=f"La aplicación no reporta métricas desde hace {stop - 10} min",
                opened_at=self.now - timedelta(minutes=stop - 10),
                last_seen_at=self.now - timedelta(minutes=1),
            )
        # A few past metric alerts for the history.
        for days_ago, kind, sev, msg, minutes in (
            (2, AlertKind.HIGH_CPU, Severity.WARNING, "CPU en 89 % (umbral 85 %)", 22),
            (
                8,
                AlertKind.HIGH_LATENCY,
                Severity.CRITICAL,
                "Latencia p95 en 3400 ms (umbral 1500 ms)",
                14,
            ),
        ):
            if self.rng.random() < 0.55:
                opened = self.now - timedelta(days=days_ago, hours=self.rng.randint(0, 10))
                Alert.objects.create(
                    environment=env,
                    kind=kind,
                    severity=sev,
                    status=AlertStatus.RESOLVED,
                    message=msg,
                    hits=minutes // 5 + 1,
                    opened_at=opened,
                    last_seen_at=opened + timedelta(minutes=minutes),
                    resolved_at=opened + timedelta(minutes=minutes),
                )

    # --- integrations, portal and commercial ------------------------------------------

    def service_token(self):
        create_service_token(
            name="Agente de métricas Home Lab",
            projects=Project.objects.exclude(status="ARCHIVED"),
            actor=self.admin,
        )

    def commercial(self):
        from apps.commercial import services as com

        today = timezone.localdate()
        tienda = self.tienda_en_linea
        citas = self.portal_de_citas_medicas
        reservas = self.app_de_reservaciones
        for project, status in (
            (tienda, "FOR_RENT"),
            (citas, "FOR_SALE_AND_RENT"),
            (reservas, "FOR_RENT"),
            (self.facturacion_electronica, "FOR_SALE"),
            (self.crm_de_ventas, "PREPARING"),
        ):
            com.update_profile(project, actor=self.admin, data={"status": status})

        rent = com.create_contract(
            project=tienda,
            organization=self.acme,
            kind="SUBSCRIPTION",
            amount=Decimal("4500.00"),
            start_date=today - timedelta(days=150),
            billing_period="MONTHLY",
            portal_visible=True,
            actor=self.admin,
            terms="Renta mensual con soporte y hosting incluidos.",
        )
        com.transition(rent, to_status="ACTIVE", actor=self.admin, effective_date=rent.start_date)
        for i in range(5):
            receivable = com.generate_next_receivable(rent, actor=self.admin)
            if i < 4:
                com.record_payment(
                    receivable=receivable,
                    amount=receivable.expected_amount,
                    paid_on=receivable.due_date + timedelta(days=2),
                    method="TRANSFER",
                    reference=f"SPEI-{4800 + i}",
                    actor=self.admin,
                )

        rent2 = com.create_contract(
            project=reservas,
            organization=self.acme,
            kind="SUBSCRIPTION",
            amount=Decimal("2800.00"),
            start_date=today - timedelta(days=60),
            billing_period="MONTHLY",
            portal_visible=True,
            actor=self.admin,
        )
        com.transition(rent2, to_status="ACTIVE", actor=self.admin, effective_date=rent2.start_date)
        com.generate_next_receivable(rent2, actor=self.admin)

        sale = com.create_contract(
            project=citas,
            organization=self.clinic,
            kind="SALE",
            amount=Decimal("85000.00"),
            start_date=today - timedelta(days=90),
            actor=self.admin,
            terms="Licencia perpetua con implementación; 50 % anticipo y 50 % a la entrega.",
        )
        com.transition(sale, to_status="ACTIVE", actor=self.admin, effective_date=sale.start_date)
        first = com.create_receivable(
            contract=sale,
            concept="Anticipo 50 %",
            due_date=sale.start_date,
            expected_amount=Decimal("42500.00"),
            actor=self.admin,
        )
        com.record_payment(
            receivable=first,
            amount=Decimal("42500.00"),
            paid_on=sale.start_date,
            method="TRANSFER",
            reference="SPEI-3311",
            actor=self.admin,
        )
        com.create_receivable(
            contract=sale,
            concept="Liquidación a la entrega",
            due_date=today - timedelta(days=10),
            expected_amount=Decimal("42500.00"),
            actor=self.admin,
        )

        for concept, category, amount, project in (
            ("Internet fibra 500 Mbps", "INTERNET", "899.00", None),
            ("Electricidad Home Lab", "ELECTRICITY", "640.00", None),
            ("Dominios y DNS", "DOMAINS", "310.00", None),
            ("Servicio de correo transaccional", "EXTERNAL_SERVICES", "450.00", citas),
        ):
            com.create_expense(
                actor=self.admin,
                concept=concept,
                category=category,
                amount=Decimal(amount),
                incurred_on=today.replace(day=1),
                kind="RECURRING",
                recurrence="MONTHLY",
                project=project,
            )
        com.create_expense(
            actor=self.admin,
            concept="Disco SSD 2 TB para Servidor B",
            category="SERVERS",
            amount=Decimal("2350.00"),
            incurred_on=today - timedelta(days=20),
            kind="ONE_TIME",
        )
