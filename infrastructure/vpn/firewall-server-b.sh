#!/usr/bin/env bash
# EJEMPLO — Firewall restrictivo (UFW) para el Servidor B (datos).
# Revisa las variables antes de ejecutarlo como root en el servidor. Idempotente.
#
#   - Deniega todo lo entrante por defecto.
#   - Permite SSH solo desde la LAN de administración.
#   - Permite WireGuard (UDP) desde Internet (el puerto reenviado en el router).
#   - Permite PostgreSQL SOLO desde la IP de VPN del Servidor A y SOLO por wg0.
set -euo pipefail

ADMIN_LAN="${ADMIN_LAN:-192.168.1.0/24}"
WG_PORT="${WG_PORT:-51820}"
SERVER_A_VPN_IP="${SERVER_A_VPN_IP:-10.66.0.1}"
PG_PORT="${PG_PORT:-5432}"

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta como root" >&2; exit 1; }
command -v ufw >/dev/null || { echo "Instala ufw (apt install ufw)" >&2; exit 1; }

ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$ADMIN_LAN" to any port 22 proto tcp comment "SSH administración"
ufw allow "$WG_PORT"/udp comment "WireGuard"
ufw allow in on wg0 from "$SERVER_A_VPN_IP" to any port "$PG_PORT" proto tcp comment "PostgreSQL desde Servidor A"
# Docker publica puertos con iptables propias: además, el compose liga PostgreSQL a la IP
# de wg0 (VPN_BIND_IP), así que no es alcanzable por otras interfaces.
ufw --force enable
ufw status verbose
