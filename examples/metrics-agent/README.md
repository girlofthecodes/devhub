# Agente de métricas de DevHub (referencia)

Cada aplicación **envía** sus métricas internas a DevHub (modelo *push*). DevHub nunca se
conecta a direcciones internas para recolectarlas.

1. En **Integraciones**, crea un token de servicio con alcance a los proyectos que reportarán.
2. Ejecuta el agente junto a la aplicación (mismo contenedor o *sidecar*):

```bash
DEVHUB_URL=https://devhub.example.com \
DEVHUB_TOKEN=dhs_xxxx_yyyy \
DEVHUB_PROJECT=tienda-en-linea \
DEVHUB_ENVIRONMENT=PRODUCTION \
python devhub_metrics_agent.py
```

El agente reporta CPU, memoria y tiempo de actividad cada 60 s usando solo la biblioteca
estándar (Linux, `/proc`). Las métricas de la aplicación (peticiones/min, tasa de errores,
latencia p95, conexiones) conviene enviarlas desde el propio código:

```bash
curl -X POST "$DEVHUB_URL/api/v1/integrations/metrics/" \
  -H "Authorization: Bearer $DEVHUB_TOKEN" -H "Content-Type: application/json" \
  -d '{"project": "tienda-en-linea", "environment": "PRODUCTION",
       "requests_per_minute": 312, "error_rate_percent": 0.4, "latency_p95_ms": 380}'
```

Todos los campos de métrica son opcionales, pero cada envío debe incluir al menos uno. Si el
agente deja de reportar más de 10 minutos, DevHub abre la alerta **Sin métricas recientes**.
