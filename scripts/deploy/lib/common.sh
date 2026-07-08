#!/usr/bin/env bash
# Fonctions partagees pour les scripts scripts/deploy/*.sh.
# A sourcer, pas a executer directement.

set -euo pipefail

# ------------------------------------------------------------------
# Constantes globales
# ------------------------------------------------------------------
REGISTRY_DIR="/root/.beliboutiques"
REGISTRY_FILE="${REGISTRY_DIR}/shops.tsv"
BACKUPS_DIR="${REGISTRY_DIR}/backups"
LOCK_DIR="${REGISTRY_DIR}/locks"

WWW_ROOT="/var/www"
NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"

REPO_SSH="git@github.com:Gnaris/beli-jolie.git"
DEFAULT_BRANCH="master"

BASE_PORT=3000  # Beli & Jolie occupe le 3000, les nouvelles boutiques prennent 3001+
NODE_BUILD_OPTS="--max-old-space-size=4096"

# ------------------------------------------------------------------
# Logging colore
# ------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_INFO='\033[1;34m'
  C_OK='\033[1;32m'
  C_WARN='\033[1;33m'
  C_ERR='\033[1;31m'
  C_DIM='\033[2m'
  C_RESET='\033[0m'
else
  C_INFO='' C_OK='' C_WARN='' C_ERR='' C_DIM='' C_RESET=''
fi

log_info()  { printf "${C_INFO}[i]${C_RESET} %s\n" "$*"; }
log_ok()    { printf "${C_OK}[+]${C_RESET} %s\n" "$*"; }
log_warn()  { printf "${C_WARN}[!]${C_RESET} %s\n" "$*"; }
log_err()   { printf "${C_ERR}[x]${C_RESET} %s\n" "$*" >&2; }
log_step()  { printf "\n${C_INFO}==>${C_RESET} %s\n" "$*"; }
log_dim()   { printf "${C_DIM}%s${C_RESET}\n" "$*"; }

die() {
  log_err "$*"
  exit 1
}

# ------------------------------------------------------------------
# Verifications
# ------------------------------------------------------------------
require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Doit etre lance en root (sudo)."
  fi
}

require_cmd() {
  local cmd
  for cmd in "$@"; do
    command -v "${cmd}" >/dev/null 2>&1 || die "Commande manquante : ${cmd}"
  done
}

ensure_registry() {
  mkdir -p "${REGISTRY_DIR}" "${BACKUPS_DIR}" "${LOCK_DIR}"
  chmod 700 "${REGISTRY_DIR}"
  if [[ ! -f "${REGISTRY_FILE}" ]]; then
    printf "slug\tdomain\tport\tdb_name\tdb_user\tcreated_at\n" > "${REGISTRY_FILE}"
    chmod 600 "${REGISTRY_FILE}"
    log_ok "Registre initialise : ${REGISTRY_FILE}"
  fi
}

# ------------------------------------------------------------------
# Validation slug
# ------------------------------------------------------------------
# Regles : minuscules, chiffres, tirets. 2-32 caracteres. Ne commence pas par
# un chiffre (contraintes MySQL identifier + Nginx server_name friendly).
validate_slug() {
  local slug="$1"
  if [[ ! "${slug}" =~ ^[a-z][a-z0-9-]{1,31}$ ]]; then
    die "Slug invalide : « ${slug} ». Regles : 2-32 caracteres, minuscules/chiffres/tirets, commence par une lettre."
  fi
}

validate_domain() {
  local domain="$1"
  if [[ ! "${domain}" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
    die "Domaine invalide : « ${domain} »."
  fi
}

validate_email() {
  local email="$1"
  if [[ ! "${email}" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
    die "Email invalide : « ${email} »."
  fi
}

# ------------------------------------------------------------------
# Registre : parse / lookup
# ------------------------------------------------------------------
# Renvoie 0 si le slug est dans le registre, 1 sinon.
registry_has_slug() {
  local slug="$1"
  awk -F'\t' -v s="${slug}" 'NR>1 && $1==s {found=1} END {exit !found}' "${REGISTRY_FILE}"
}

registry_has_domain() {
  local domain="$1"
  awk -F'\t' -v d="${domain}" 'NR>1 && $2==d {found=1} END {exit !found}' "${REGISTRY_FILE}"
}

registry_has_port() {
  local port="$1"
  awk -F'\t' -v p="${port}" 'NR>1 && $3==p {found=1} END {exit !found}' "${REGISTRY_FILE}"
}

# Prochain port libre : max des ports actifs + 1 (min BASE_PORT+1).
registry_next_port() {
  local max_port
  max_port=$(awk -F'\t' -v base="${BASE_PORT}" 'NR>1 && $3+0>max {max=$3+0} END {print (max>base ? max : base)}' "${REGISTRY_FILE}")
  echo $((max_port + 1))
}

# Ajoute une ligne au registre.
registry_add() {
  local slug="$1" domain="$2" port="$3" db_name="$4" db_user="$5"
  local created_at
  created_at=$(date --iso-8601=seconds)
  printf "%s\t%s\t%s\t%s\t%s\t%s\n" \
    "${slug}" "${domain}" "${port}" "${db_name}" "${db_user}" "${created_at}" \
    >> "${REGISTRY_FILE}"
  log_ok "Ajoute au registre : ${slug}"
}

# Retire une ligne du registre par slug.
registry_remove() {
  local slug="$1"
  local tmp
  tmp=$(mktemp)
  awk -F'\t' -v s="${slug}" 'NR==1 || $1!=s' "${REGISTRY_FILE}" > "${tmp}"
  mv "${tmp}" "${REGISTRY_FILE}"
  chmod 600 "${REGISTRY_FILE}"
  log_ok "Retire du registre : ${slug}"
}

# Iterateur : appelle une fonction avec (slug domain port db_name db_user created_at).
registry_foreach() {
  local callback="$1"
  awk -F'\t' 'NR>1 {print}' "${REGISTRY_FILE}" | while IFS=$'\t' read -r slug domain port db_name db_user created_at; do
    "${callback}" "${slug}" "${domain}" "${port}" "${db_name}" "${db_user}" "${created_at}"
  done
}

# ------------------------------------------------------------------
# Generation de secrets
# ------------------------------------------------------------------
gen_secret_base64() {
  # 32 octets aleatoires en base64 (sur une ligne).
  openssl rand -base64 32 | tr -d '\n'
}

gen_password() {
  # 24 caracteres alphanumeriques (evite les caracteres speciaux pour MySQL/URL).
  local pwd
  pwd=$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24)
  echo "${pwd}"
}

# ------------------------------------------------------------------
# Verification DNS
# ------------------------------------------------------------------
# Verifie que le domaine resout vers l'IP publique du VPS.
# Renvoie 0 si OK, 1 sinon. --skip-dns-check pour bypass en test.
check_dns() {
  local domain="$1"
  local vps_ip
  vps_ip=$(curl -fs --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
  if [[ -z "${vps_ip}" ]]; then
    log_warn "Impossible de recuperer l'IP publique du VPS (offline ?). DNS non verifie."
    return 0
  fi
  local resolved
  resolved=$(getent hosts "${domain}" 2>/dev/null | awk '{print $1}' | head -1)
  if [[ -z "${resolved}" ]]; then
    log_err "Le domaine ${domain} ne resout vers aucune IP. Attendez la propagation DNS."
    return 1
  fi
  if [[ "${resolved}" != "${vps_ip}" ]]; then
    log_err "Le domaine ${domain} pointe vers ${resolved} au lieu de ${vps_ip} (IP VPS)."
    return 1
  fi
  log_ok "DNS OK : ${domain} -> ${vps_ip}"
  return 0
}

# ------------------------------------------------------------------
# Lock (pour eviter deploy-all + auto-pull concurrents)
# ------------------------------------------------------------------
acquire_lock() {
  local name="$1"
  local timeout="${2:-60}"
  local lockfile="${LOCK_DIR}/${name}.lock"
  mkdir -p "${LOCK_DIR}"
  exec 200>"${lockfile}"
  if ! flock -w "${timeout}" 200; then
    die "Impossible d'acquerir le lock ${name} apres ${timeout}s."
  fi
}
