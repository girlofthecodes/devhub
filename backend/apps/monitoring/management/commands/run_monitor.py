"""Monitoring worker: runs due health checks periodically, in its own process/container.

Run exactly one instance. Probes run concurrently in a bounded thread pool; DB writes happen
afterwards. The worker touches a heartbeat file so the container healthcheck can detect a
stuck loop.
"""

import logging
import signal
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.db.utils import DatabaseError

from apps.monitoring import services

logger = logging.getLogger("devhub.monitor")


class Command(BaseCommand):
    help = "Ejecuta los health checks pendientes de forma periódica (proceso independiente)."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Una sola pasada y termina.")
        parser.add_argument("--heartbeat", default=settings.MONITOR_HEARTBEAT_FILE)

    def handle(self, *args, once: bool, heartbeat: str, **options):
        self._stop = False
        signal.signal(signal.SIGTERM, self._request_stop)
        signal.signal(signal.SIGINT, self._request_stop)
        beat = Path(heartbeat) if heartbeat else None
        self.stdout.write(f"Monitor iniciado (cada {settings.MONITOR_LOOP_SECONDS} s).")
        while not self._stop:
            try:
                done = self.run_pass()
                if done:
                    self.stdout.write(f"{done} verificación(es) ejecutada(s).")
            except DatabaseError:
                # Data server unreachable (e.g. VPN down): keep running and retry later.
                logger.exception("Monitor: base de datos no disponible; reintentando")
            finally:
                close_old_connections()
            if beat:
                beat.touch()
            if once:
                break
            for _ in range(settings.MONITOR_LOOP_SECONDS):
                if self._stop:
                    break
                time.sleep(1)
        self.stdout.write("Monitor detenido.")

    def _request_stop(self, *_):
        self._stop = True

    def run_pass(self) -> int:
        checks = list(services.due_checks()[: settings.MONITOR_MAX_PER_PASS])
        if not checks:
            return 0
        with ThreadPoolExecutor(max_workers=settings.MONITOR_MAX_WORKERS) as pool:
            futures = {pool.submit(services.execute, c): c for c in checks}
            for future in as_completed(futures):
                check = futures[future]
                try:
                    services.record_result(check.pk, future.result())
                except Exception:  # never let one check kill the loop
                    logger.exception("Monitor: error registrando %s", check.pk)
        return len(checks)
