#!/usr/bin/env bash
# EJEMPLO — Firewall restrictivo (UFW) para el Servidor A (aplicaciones).
# No se abre ningún puerto entrante a Internet: el tráfico web entra por Cloudflare Tunnel
# (conexión saliente de cloudflared). Idempotente.
set -euo pipefail

ADMIN_LAN="${ADMIN_LAN:-192.168.1.0/24}"

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root" >&2; exit 1; }
command -v ufw >/dev/null || { echo "Instala ufw (apt install ufw)" >&2; exit 1; }

ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$ADMIN_LAN" to any port 22 proto tcp comment "SSH administración"
ufw --force enable
ufw status verbose
