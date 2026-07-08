#!/usr/bin/env bash
# Affiche un tableau des boutiques enregistrees + leur etat pm2 + disque.
#
# Usage :
#   ./list-shops.sh
#
# Colonnes : SLUG, DOMAINE, PORT, PM2, DISK, HEAD, CREE_LE

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_cmd du pm2 git awk
ensure_registry

printf "%-16s %-32s %-6s %-9s %-9s %-9s %-25s\n" \
  "SLUG" "DOMAINE" "PORT" "PM2" "DISK" "HEAD" "CREE_LE"
printf "%.s-" {1..115}; printf "\n"

pm2_status() {
  local slug="$1"
  # pm2 jlist renvoie du JSON, on grep sans jq (pas installe partout)
  pm2 jlist 2>/dev/null \
    | tr ',' '\n' \
    | grep -E "\"name\":\"${slug}\"|\"status\":" \
    | grep -A1 "\"name\":\"${slug}\"" \
    | grep "\"status\":" \
    | head -1 \
    | sed -E 's/.*"status":"([^"]+)".*/\1/' \
    || echo "absent"
}

# Fallback simple : pm2 list retourne "online" ou pas.
pm2_status_simple() {
  local slug="$1"
  if pm2 describe "${slug}" 2>/dev/null | grep -q "status.*online"; then
    echo "online"
  elif pm2 describe "${slug}" 2>/dev/null | grep -q "status"; then
    pm2 describe "${slug}" 2>/dev/null | grep "status" | head -1 | awk '{print $NF}'
  else
    echo "absent"
  fi
}

print_row() {
  local slug="$1" domain="$2" port="$3" _db="$4" _dbu="$5" created="$6"
  local shop_dir="${WWW_ROOT}/${slug}"
  local status disk head created_short

  status=$(pm2_status_simple "${slug}")
  if [[ -d "${shop_dir}" ]]; then
    disk=$(du -sh "${shop_dir}" 2>/dev/null | awk '{print $1}')
    head=$(git -C "${shop_dir}" rev-parse --short HEAD 2>/dev/null || echo "?")
  else
    disk="-"
    head="-"
  fi
  created_short="${created:0:19}"

  printf "%-16s %-32s %-6s %-9s %-9s %-9s %-25s\n" \
    "${slug}" "${domain}" "${port}" "${status}" "${disk}" "${head}" "${created_short}"
}

registry_foreach print_row

echo
log_dim "Registre : ${REGISTRY_FILE}"
