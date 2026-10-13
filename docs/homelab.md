# Guía de despliegue en el Home Lab

Esta guía explica cómo poner DevHub en producción en dos equipos:

- **Servidor A (aplicaciones):** DevHub, el proxy y el túnel.
- **Servidor B (datos):** PostgreSQL y los backups.

> **Leyenda:**
> - **[Validado]**: comando ejecutado durante la verificación de la Fase 6 (Home Lab simulado en un solo equipo con Docker).
> - **[EJEMPLO]**: comando o configuración que depende de hosts reales y no se ha ejecutado aquí. Revísalo antes de aplicarlo.

## 0. Requisitos

| | Servidor A | Servidor B |
|---|---|---|
| Sistema | Linux con systemd (p. ej. Debian 12 / Ubuntu 24.04) | Igual |
| Software | Docker Engine + Compose v2, git, curl | Docker Engine + Compose v2; `rclone` y `age` si usas copia externa y cifrado |
| Red | Solo conexiones salientes (Cloudflare) y la VPN | La VPN; SSH solo desde la LAN de administración |
| Cuentas externas | Cloudflare (dominio + Zero Trust), GitHub (runner) | Proveedor de almacenamiento para la copia externa (opcional) |

Clona el repositorio en `/opt/devhub` en ambos equipos. Los archivos de configuración con secretos viven **fuera** del repositorio, en `/etc/devhub/` con permisos `600`.

## 1. VPN entre servidores [EJEMPLO]

Opción **WireGuard** (subred `10.66.0.0/24`; A = `10.66.0.1`, B = `10.66.0.2`):

```bash
# En cada servidor
sudo apt install wireguard
umask 077; wg genkey | tee /etc/wireguard/private.key | wg pubkey > /etc/wireguard/public.key
sudo cp infrastructure/vpn/wireguard/wg0-server-X.conf.example /etc/wireguard/wg0.conf  # X = a | b
sudo chmod 600 /etc/wireguard/wg0.conf   # sustituye las claves <...> y el Endpoint
sudo systemctl enable --now wg-quick@wg0
ping 10.66.0.2   # desde A
```

Opción **Tailscale**: instala Tailscale en ambos equipos, restringe con ACLs el acceso de A a B en el puerto 5432 y usa las IPs `100.x` de Tailscale en lugar de `10.66.0.x`. DevHub admite rangos privados y CGNAT para `vpn_address`.

### Firewall [EJEMPLO]

```bash
sudo ADMIN_LAN=192.168.1.0/24 SERVER_A_VPN_IP=10.66.0.1 infrastructure/vpn/firewall-server-b.sh
sudo ADMIN_LAN=192.168.1.0/24 infrastructure/vpn/firewall-server-a.sh
```

Ambos scripts deniegan todo lo entrante por defecto y solo permiten SSH desde la LAN de administración. En el Servidor B, PostgreSQL solo se admite desde la IP VPN de A y por `wg0`. El Servidor A no abre puertos públicos.

## 2. Servidor B — PostgreSQL

```bash
cd /opt/devhub
sudo mkdir -p /etc/devhub
sudo scripts/setup.sh --server b --env-file /etc/devhub/server-b.env      # [Validado] genera secretos
sudo nano /etc/devhub/server-b.env      # VPN_BIND_IP=10.66.0.2, DB_ALLOWED_CIDR=10.66.0.0/24
sudo docker compose -f infrastructure/compose/server-b.compose.yaml \
     --env-file /etc/devhub/server-b.env up -d --wait                     # [Validado]
```

- PostgreSQL **solo escucha en `VPN_BIND_IP`**: el compose no arranca si la variable está vacía. `pg_hba.conf` acepta únicamente `DB_ALLOWED_CIDR` con `scram-sha-256`.
- Base y rol de DevHub, y de cada microaplicación **[Validado]**:

  ```bash
  sudo scripts/create-app-db.sh --app devhub  --env-file /etc/devhub/server-b.env
  sudo scripts/create-app-db.sh --app pedidos --env-file /etc/devhub/server-b.env
  ```

  Cada aplicación recibe su rol `app_<nombre>`, su base y una contraseña que **se muestra una sola vez**: guárdala en el gestor de secretos. Para cambiarla, usa `--rotate`.

## 3. Servidor A — DevHub

```bash
cd /opt/devhub
sudo scripts/setup.sh --server a --env-file /etc/devhub/server-a.env      # [Validado]
sudo nano /etc/devhub/server-a.env
#   DJANGO_ALLOWED_HOSTS / DJANGO_CSRF_TRUSTED_ORIGINS / FRONTEND_URL → tu dominio
#   POSTGRES_HOST=10.66.0.2, POSTGRES_DB/USER/PASSWORD → los que imprimió create-app-db.sh --app devhub
#   (sustituyen al POSTGRES_PASSWORD aleatorio que puso setup.sh)
#   EMAIL_* → tu SMTP
sudo DEVHUB_ENV_FILE=/etc/devhub/server-a.env scripts/deploy.sh          # [Validado]
```

`deploy.sh` construye las imágenes, aplica migraciones, levanta los servicios (`backend`, `monitor`, `frontend`, `proxy`), espera a que estén sanos y ejecuta `healthcheck.sh`. Se puede repetir sin efectos secundarios.

Administrador inicial, una sola vez:

```bash
sudo docker compose -f infrastructure/compose/server-a.compose.yaml --env-file /etc/devhub/server-a.env \
     run --rm -e DJANGO_ADMIN_EMAIL=tu@correo -e DJANGO_ADMIN_PASSWORD='…' backend python manage.py bootstrap_admin
```

Para no dejar la contraseña en el historial del shell, introdúcela con `read -s` en una variable y pásala con `-e DJANGO_ADMIN_PASSWORD`.

### Proxies de confianza

La cadena es `Cloudflare → cloudflared → Caddy → gunicorn`. Caddy confía en los `X-Forwarded-*` que llegan de la red interna, y Django usa `DJANGO_NUM_PROXIES=2` para tomar la IP real del cliente. Si cambias la cadena (por ejemplo, quitando Caddy), ajusta este valor. Un valor demasiado alto permite falsificar la IP para eludir el rate limiting.

## 4. Cloudflare Tunnel [EJEMPLO]

Modo recomendado, con el túnel gestionado en el dashboard:

1. En Cloudflare, ve a **Zero Trust → Networks → Tunnels → Create tunnel** (tipo *Cloudflared*).
2. Copia el **token** a `CLOUDFLARE_TUNNEL_TOKEN` en `/etc/devhub/server-a.env`.
3. Crea un *Public hostname* `devhub.tudominio` → servicio `http://proxy:8080`.
4. Despliega con el túnel:

   ```bash
   sudo DEVHUB_ENV_FILE=/etc/devhub/server-a.env scripts/deploy.sh --tunnel
   ```

   `deploy.sh` se niega a continuar si el token está vacío **[Validado]**.

Las microaplicaciones publicadas por el mismo túnel se añaden como otros *Public hostnames*. Si prefieres gestionar el túnel con un archivo local, consulta `infrastructure/cloudflare/config.example.yml`.

Recomendado: protege `/django-admin/*` con una política de **Cloudflare Access**. Las demos privadas ya están protegidas por los tickets de DevHub (Fase 5).

## 5. Backups y restauración

```bash
# [Validado] respaldo manual (Servidor B)
sudo scripts/backup.sh --env-file /etc/devhub/server-b.env
# [Validado] comprobar que un respaldo se restaura (base temporal, se elimina al final)
sudo scripts/restore.sh --env-file /etc/devhub/server-b.env --dump /var/backups/devhub/<fecha>/devhub.dump --verify
# [Validado] restauración real: detén antes las apps que usan esa base
sudo scripts/restore.sh --env-file /etc/devhub/server-b.env --dump /var/backups/devhub/<fecha>/devhub.dump --db devhub
```

- Cada respaldo genera un `.dump` por base, `globals.sql` (roles, **sin** contraseñas) y `SHA256SUMS`. La restauración rechaza un archivo alterado.
- **Copia externa** [EJEMPLO]: configura un remoto con `rclone config` y define `BACKUP_REMOTE=remoto:bucket/ruta`. Para cifrar, define `BACKUP_AGE_RECIPIENT=age1…` y guarda la clave privada **fuera** de los servidores.
- **Prueba la restauración periódicamente** con `--verify`, por ejemplo una vez al mes.

### Tareas programadas [EJEMPLO]

```bash
sudo cp infrastructure/systemd/devhub-backup.* /etc/systemd/system/     # Servidor B
sudo cp infrastructure/systemd/devhub-purge.*  /etc/systemd/system/     # Servidor A
sudo systemctl daemon-reload
sudo systemctl enable --now devhub-backup.timer   # diario 03:15
sudo systemctl enable --now devhub-purge.timer    # domingo 04:30
systemctl list-timers 'devhub-*'
```

## 6. CI/CD con GitHub Actions

- `ci.yml` funciona sin configuración en cuanto el repositorio está en GitHub.
- Despliegue al Home Lab (`deploy-demo.yml`) [EJEMPLO]:
  1. Ve a **Settings → Actions → Runners → New self-hosted runner** e instálalo en el Servidor A con la etiqueta `homelab`, como un usuario dedicado del grupo `docker`. El runner solo abre conexiones salientes.
  2. Si el repositorio es público, en **Settings → Actions → General** exige aprobación para los workflows de forks. El workflow de despliegue ya solo admite `workflow_dispatch` desde `main`.
  3. En **Settings → Environments → `demo`**, añade *required reviewers* y los secretos `DEVHUB_URL` y `DEVHUB_TOKEN`. El token se crea en DevHub, en **Integraciones → Tokens de servicio**, limitado al proyecto.
  4. Lanza el despliegue desde **Actions → deploy-demo → Run workflow**, indicando el motivo.

## 7. Operación diaria

| Tarea | Comando |
|---|---|
| Estado de contenedores | `scripts/status.sh --server a` / `--server b` |
| Salud | `scripts/healthcheck.sh https://devhub.tudominio` |
| Logs | `docker compose -f infrastructure/compose/server-a.compose.yaml --env-file /etc/devhub/server-a.env logs -f backend monitor` |
| Verificación de monitoreo puntual | `… exec monitor python manage.py run_monitor --once` |
| Purga manual | `… exec backend python manage.py purge_history --dry-run` |

## 8. Solución de problemas

| Síntoma | Causa probable | Acción |
|---|---|---|
| La API responde `503 database_unavailable` | El Servidor B o la VPN están caídos | `wg show` / `ping 10.66.0.2`; `scripts/status.sh --server b`. DevHub se recupera solo al volver la base. |
| Todos los monitores aparecen como «Verificación desactualizada» | El servicio `monitor` está parado o no tiene base de datos | `scripts/status.sh --server a` y `logs monitor` |
| Un monitor muestra «Destino rechazado» | La URL resuelve a una IP privada o usa un puerto no permitido | Publica el servicio con un hostname público (túnel) o ajusta `MONITOR_ALLOWED_PORTS` |
| Error `400 Bad Request` en todas las páginas | Dominio ausente en `DJANGO_ALLOWED_HOSTS` | Corrige el archivo env y ejecuta `deploy.sh --skip-build` |
| Error `403 CSRF` al iniciar sesión | `DJANGO_CSRF_TRUSTED_ORIGINS` no coincide con `https://dominio` | Corrige el archivo env |
| El rate limiting bloquea a todos a la vez | `DJANGO_NUM_PROXIES` es incorrecto: todos comparten la IP del proxy | Ajústalo a la cadena real (2 con cloudflared + Caddy) |
| `deploy.sh --tunnel` aborta | `CLOUDFLARE_TUNNEL_TOKEN` está vacío | Copia el token del dashboard |
| `restore.sh`: «checksum no coincide» | El respaldo está corrupto o alterado | Usa otro respaldo o la copia externa |

## 9. Variables de entorno de producción

Las plantillas comentadas son `infrastructure/compose/server-a.env.example` y `server-b.env.example`. Las más importantes:

| Variable | Servidor | Descripción |
|---|---|---|
| `DJANGO_SECRET_KEY` | A | ≥ 50 caracteres; la genera `setup.sh` |
| `DJANGO_ALLOWED_HOSTS`, `DJANGO_CSRF_TRUSTED_ORIGINS`, `FRONTEND_URL` | A | Dominio público |
| `DJANGO_NUM_PROXIES` | A | Proxies de confianza (2) |
| `DEVHUB_ALLOWED_PUBLIC_DOMAINS` | A | Dominios permitidos para URLs públicas y monitoreo (vacío = cualquiera público) |
| `POSTGRES_HOST/PORT/DB/USER/PASSWORD`, `DB_*` | A | Conexión al Servidor B por la VPN |
| `MONITOR_ALLOWED_PORTS`, `MONITOR_MIN_INTERVAL_SECONDS`, `MONITOR_MANUAL_MIN_SECONDS`, `MONITOR_LOOP_SECONDS`, `MONITOR_MAX_WORKERS` | A | Monitoreo |
| `TRACE_RETENTION_DAYS`, `AUDIT_RETENTION_DAYS`, `CHECK_RESULT_RETENTION_DAYS` | A | Retención (365 / 730 / 30) |
| `CLOUDFLARE_TUNNEL_TOKEN` | A | Token del túnel |
| `VPN_BIND_IP`, `DB_ALLOWED_CIDR` | B | Dónde escucha PostgreSQL y desde qué red acepta conexiones |
| `POSTGRES_SUPERUSER_PASSWORD` | B | Solo para administración y backups |
| `BACKUP_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_REMOTE`, `BACKUP_AGE_RECIPIENT` | B | Backups |
