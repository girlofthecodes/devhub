"""DevHub metrics agent (reference). Pushes CPU and memory of the host/container every minute.

Standard library only; Linux (/proc). Run it next to the application (same container or
sidecar). Application metrics (requests/min, error rate, p95) are best reported by the app
itself: call `push()` from your code with the values your framework already measures.

    DEVHUB_URL=https://devhub.example.com DEVHUB_TOKEN=dhs_... \
    DEVHUB_PROJECT=tienda-en-linea DEVHUB_ENVIRONMENT=PRODUCTION \
    python devhub_metrics_agent.py
"""

import json
import os
import time
import urllib.request

URL = os.environ["DEVHUB_URL"].rstrip("/") + "/api/v1/integrations/metrics/"
TOKEN = os.environ["DEVHUB_TOKEN"]
PROJECT = os.environ["DEVHUB_PROJECT"]
ENVIRONMENT = os.environ.get("DEVHUB_ENVIRONMENT", "PRODUCTION")
INTERVAL = int(os.environ.get("DEVHUB_INTERVAL", "60"))
STARTED = time.monotonic()


def _cpu_times():
    with open("/proc/stat") as f:
        values = [int(v) for v in f.readline().split()[1:]]
    idle = values[3] + values[4]  # idle + iowait
    return idle, sum(values)


def cpu_percent(sample_seconds: float = 1.0) -> float:
    idle1, total1 = _cpu_times()
    time.sleep(sample_seconds)
    idle2, total2 = _cpu_times()
    busy = (total2 - total1) - (idle2 - idle1)
    return round(100 * busy / max(1, total2 - total1), 1)


def memory() -> tuple[float, int]:
    info = {}
    with open("/proc/meminfo") as f:
        for line in f:
            key, value = line.split(":", 1)
            info[key] = int(value.split()[0])  # kB
    used = info["MemTotal"] - info["MemAvailable"]
    return round(100 * used / info["MemTotal"], 1), used // 1024


def push(**metrics) -> None:
    body = json.dumps({"project": PROJECT, "environment": ENVIRONMENT, **metrics}).encode()
    request = urllib.request.Request(
        URL,
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:  # noqa: S310 - fixed https URL
        response.read()


def main() -> None:
    while True:
        try:
            mem_pct, mem_mb = memory()
            push(
                cpu_percent=cpu_percent(),
                memory_percent=mem_pct,
                memory_used_mb=mem_mb,
                process_uptime_seconds=int(time.monotonic() - STARTED),
            )
        except Exception as exc:  # never crash the agent; DevHub raises METRICS_STALE if it stops
            print(f"[devhub-metrics] envío fallido: {exc}", flush=True)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
