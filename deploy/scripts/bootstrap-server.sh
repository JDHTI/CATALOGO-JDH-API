#!/usr/bin/env bash
# Prepara una VM Debian/Ubuntu limpia para alojar este stack. Idempotente; se
# corre UNA vez, como el usuario de despliegue (no root), que necesita sudo:
#
#   deploy/scripts/bootstrap-server.sh [--firewall]
#
# Hace:
#   - zona horaria America/Bogota (los cron y los logs coinciden con la oficina)
#   - paquetes base: git, curl, openssl, util-linux (flock), ca-certificates
#   - Docker Engine + plugin compose desde el repositorio oficial de Docker
#     y el usuario de despliegue en el grupo docker
#   - ~/apps y ~/backups, y el cron diario de respaldo
#   - --firewall: ufw con SSH, 80 y 443 abiertos y todo lo demás cerrado
#
# Después: cerrar la sesión y volver a entrar (grupo docker), y seguir
# deploy/README.md → Primera instalación.
set -euo pipefail

firewall=false
[[ ${1:-} == --firewall ]] && firewall=true

[[ $EUID -ne 0 ]] || { echo "Correr como el usuario de despliegue, no como root." >&2; exit 1; }
sudo -v

. /etc/os-release
case ${ID:-} in
  debian|ubuntu) ;;
  *) echo "Distribución no soportada: ${ID:-desconocida} (Debian/Ubuntu)" >&2; exit 1 ;;
esac

echo "▸ Zona horaria"
sudo timedatectl set-timezone America/Bogota

echo "▸ Paquetes base"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  ca-certificates curl git openssl util-linux gnupg cron

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "▸ Docker Engine"
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo systemctl enable --now docker
id -nG "$USER" | grep -qw docker || sudo usermod -aG docker "$USER"

echo "▸ Directorios"
mkdir -p "$HOME/apps" "$HOME/backups"
chmod 700 "$HOME/backups"

echo "▸ Cron de respaldo (02:30)"
job="30 2 * * * $HOME/apps/CATALOGO-JDH-API/deploy/scripts/backup.sh daily >> $HOME/backups/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -vF 'CATALOGO-JDH-API/deploy/scripts/backup.sh' || true; echo "$job" ) | crontab -

if $firewall; then
  echo "▸ Firewall (ufw)"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw
  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw allow 22/tcp
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw allow 443/udp
  sudo ufw --force enable
fi

echo
echo "Listo. Cerrar sesión y volver a entrar para activar el grupo docker."
docker --version
