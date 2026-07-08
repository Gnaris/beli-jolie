#!/usr/bin/env bash
# Supprime completement une boutique du VPS APRES avoir sauvegarde ses donnees.
#
# Usage :
#   sudo ./remove-shop.sh <slug> [--yes]
#
# Etapes :
#   1. Backup BDD (mysqldump)
#   2. Backup uploads (tar gz)
#   3. Stop + delete pm2
#   4. Supprimer vhost Nginx + reload
#   5. Supprimer les certs Let's Encrypt
#   6. Drop BDD + user MySQL
#   7. Retirer du registre
#   8. rm -rf du dossier
#
# La sauvegarde est deposee dans /root/.beliboutiques/backups/<slug>-<date>.tar.gz.
# La commande demande confirmation sauf si --yes est passe.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root
require_cmd mysql mysqldump tar nginx pm2 certbot
ensure_registry

AUTO_YES=0
SLUG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) AUTO_YES=1; shift ;;
    -h|--help)
      grep -E '^#' "$0" | sed -E 's/^# ?//'
      exit 0
      ;;
    *)
      if [[ -z "${SLUG}" ]]; then
        SLUG="$1"
      else
        die "Argument inattendu : $1"
      fi
      shift
      ;;
  esac
done

[[ -n "${SLUG}" ]] || die "Usage : $0 <slug> [--yes]"
if [[ "${SLUG}" == "beliandjolie" ]]; then
  die "Refus : la boutique historique « beliandjolie » ne peut pas etre supprimee par ce script."
fi
if ! registry_has_slug "${SLUG}"; then
  die "Slug « ${SLUG} » absent du registre."
fi

# Lire les infos de la boutique
LINE=$(awk -F'\t' -v s="${SLUG}" 'NR>1 && $1==s {print}' "${REGISTRY_FILE}")
IFS=$'\t' read -r _ DOMAIN PORT DB_NAME DB_USER _ <<<"${LINE}"

if [[ "${AUTO_YES}" -ne 1 ]]; then
  echo
  log_warn "Vous allez SUPPRIMER la boutique suivante :"
  echo "    slug   : ${SLUG}"
  echo "    domain : ${DOMAIN}"
  echo "    BDD    : ${DB_NAME}"
  echo "    dossier: ${WWW_ROOT}/${SLUG}"
  echo
  read -r -p "  Tapez EXACTEMENT le slug pour confirmer : " CONFIRM
  if [[ "${CONFIRM}" != "${SLUG}" ]]; then
    die "Annule."
  fi
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_BASE="${BACKUPS_DIR}/${SLUG}-${TIMESTAMP}"
mkdir -p "${BACKUP_BASE}"

# ------------------------------------------------------------------
# 1. Backup BDD
# ------------------------------------------------------------------
log_step "Backup BDD"
if mysqldump --single-transaction --routines --triggers "${DB_NAME}" \
    > "${BACKUP_BASE}/${DB_NAME}.sql" 2>/dev/null; then
  gzip "${BACKUP_BASE}/${DB_NAME}.sql"
  log_ok "  BDD sauvegardee : ${BACKUP_BASE}/${DB_NAME}.sql.gz"
else
  log_warn "  Erreur mysqldump (BDD inexistante ?). On continue."
fi

# ------------------------------------------------------------------
# 2. Backup uploads
# ------------------------------------------------------------------
log_step "Backup uploads"
SHOP_DIR="${WWW_ROOT}/${SLUG}"
if [[ -d "${SHOP_DIR}/public/uploads" || -d "${SHOP_DIR}/private/uploads" ]]; then
  tar -czf "${BACKUP_BASE}/uploads.tar.gz" \
    -C "${SHOP_DIR}" \
    $([[ -d "${SHOP_DIR}/public/uploads" ]] && echo "public/uploads") \
    $([[ -d "${SHOP_DIR}/private/uploads" ]] && echo "private/uploads") \
    2>/dev/null || log_warn "  tar a signale des erreurs (fichiers en cours d'ecriture ?)."
  log_ok "  Uploads sauvegardes : ${BACKUP_BASE}/uploads.tar.gz"
else
  log_dim "  Aucun dossier uploads a sauvegarder."
fi

# .env aussi (Stripe, SMTP, secrets)
if [[ -f "${SHOP_DIR}/.env" ]]; then
  cp "${SHOP_DIR}/.env" "${BACKUP_BASE}/.env"
  chmod 600 "${BACKUP_BASE}/.env"
  log_ok "  .env sauvegarde."
fi

# ------------------------------------------------------------------
# 3. pm2
# ------------------------------------------------------------------
log_step "Arret pm2"
if pm2 describe "${SLUG}" >/dev/null 2>&1; then
  pm2 delete "${SLUG}"
  pm2 save
  log_ok "  Process pm2 supprime."
else
  log_dim "  Aucun process pm2 « ${SLUG} »."
fi

# ------------------------------------------------------------------
# 4. Nginx
# ------------------------------------------------------------------
log_step "Nginx"
rm -f "${NGINX_ENABLED}/${SLUG}" "${NGINX_AVAILABLE}/${SLUG}"
if nginx -t 2>/dev/null; then
  systemctl reload nginx
  log_ok "  Vhost supprime + Nginx recharge."
else
  log_warn "  nginx -t echoue, non recharge. A verifier a la main."
fi

# ------------------------------------------------------------------
# 5. Certbot
# ------------------------------------------------------------------
log_step "Certificats Let's Encrypt"
if certbot certificates 2>/dev/null | grep -q "Certificate Name: ${DOMAIN}"; then
  certbot delete --cert-name "${DOMAIN}" --non-interactive || log_warn "  certbot delete a echoue."
  log_ok "  Certificat supprime."
else
  log_dim "  Aucun certificat pour ${DOMAIN}."
fi

# ------------------------------------------------------------------
# 6. MySQL
# ------------------------------------------------------------------
log_step "Drop BDD + user MySQL"
mysql <<SQL
DROP DATABASE IF EXISTS \`${DB_NAME}\`;
DROP USER IF EXISTS '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
log_ok "  BDD ${DB_NAME} et user ${DB_USER} supprimes."

# ------------------------------------------------------------------
# 7. Registre + dossier
# ------------------------------------------------------------------
registry_remove "${SLUG}"

log_step "Suppression du dossier"
rm -rf "${SHOP_DIR}"
log_ok "  ${SHOP_DIR} supprime."

log_step "Termine"
echo "  Backup disponible : ${BACKUP_BASE}/"
echo "  (a conserver au moins 30j pour rollback eventuel)"
