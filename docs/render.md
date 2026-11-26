# Despliegue del backend en Render

La imagen de producción (`backend/Dockerfile`, target `prod`) funciona sin cambios en Render:

- Lee `DATABASE_URL`, que tiene prioridad sobre las `POSTGRES_*`.
- Escucha en `$PORT`.
- Usa `$WEB_CONCURRENCY` workers de gunicorn.

Sin esas variables, todo se comporta como en el Home Lab: puerto 8000 y 3 workers.

## Pasos

1. **Crea la base de datos.** Crea un **PostgreSQL** en Render, en la **misma región** que el servicio web.
2. **Crea el servicio web.** Usa el runtime Docker, con *Dockerfile path* `backend/Dockerfile`, *Docker build context* `backend` y *Docker target* `prod`.
3. **Configura las variables de entorno** del servicio web:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La **Internal Database URL** del PostgreSQL. La externa es para conectarte desde tu equipo. |
| `DJANGO_SECRET_KEY` | Al menos 50 caracteres aleatorios. Si es más corta o contiene `change-me`, el arranque falla. |
| `DJANGO_ALLOWED_HOSTS` | `tu-servicio.onrender.com` |
| `DJANGO_NUM_PROXIES` | `1` (Render pone un proxy delante) |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://<dominio del frontend>` |
| `FRONTEND_URL` | `https://<dominio del frontend>` |
| `RUN_MIGRATIONS` | `true` |
| `BOOTSTRAP_ADMIN`, `DJANGO_ADMIN_EMAIL`, `DJANGO_ADMIN_PASSWORD` | Para crear el primer administrador |

4. **Ajusta el health check.** Usa la ruta `/api/v1/health/`.

## Problemas frecuentes

- **`[entrypoint] Database unreachable: ConnectionTimeout`.** El host de la base no es alcanzable desde Render. Revisa el host que aparece en la línea `[entrypoint] Database host:` del log y compruébalo:
  - `DATABASE_URL` debe ser la URL **interna** y la base debe estar en la misma región.
  - Las `POSTGRES_HOST` del Home Lab (IPs de la VPN, como `10.8.0.x`) no existen en Render.
  - Si la base está fuera de Render, debe aceptar conexiones públicas con TLS (`?sslmode=require`).
- **`No open ports detected`.** Aparece mientras el contenedor espera la base de datos, porque gunicorn todavía no ha arrancado. Se va cuando la conexión funciona.
