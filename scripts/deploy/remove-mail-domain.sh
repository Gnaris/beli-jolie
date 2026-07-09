#!/usr/bin/env bash
# Supprime une boite mail creee par add-mail-domain.sh.
#
# Usage :
#   sudo ./remove-mail-domain.sh <email> [--yes]
#
# Etapes :
#   1. Backup Maildir + entree registre
#   2. Retirer la regle Sieve
#   3. Retirer le compte Dovecot
#   4. Retirer le mapping virtual_mailbox
#   5. Si plus aucun compte sur le domaine : retirer le domaine des
#      virtual_mailbox_domains + retirer entrees OpenDKIM + supprimer la cle
#   6. Recharger services
#   7. Confirmer

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root
require_cmd postconf postmap sievec systemctl
ensure_registry
ensure_mail_registry

AUTO_YES=0
EMAIL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) AUTO_YES=1; shift ;;
    -h|--help) grep -E '^#' "$0" | sed -E 's/^# ?//'; exit 0 ;;
    *)
      [[ -z "${EMAIL}" ]] || die "Argument inattendu : $1"
      EMAIL="$1"; shift
      ;;
  esac
done

[[ -n "${EMAIL}" ]] || die "Usage : $0 <email> [--yes]"
if [[ "${EMAIL}" == "contact@beliandjolie.com" ]]; then
  die "Refus : la boite historique contact@beliandjolie.com ne peut pas etre supprimee par ce script."
fi
mail_registry_has_email "${EMAIL}" || die "Email « ${EMAIL} » absent du registre mail."

LINE=$(awk -F'\t' -v e="${EMAIL}" 'NR>1 && $1==e {print}' "${MAIL_REGISTRY_FILE}")
IFS=$'\t' read -r _ DOMAIN LOCAL_PART FORWARD_TO SELECTOR _ <<<"${LINE}"

if [[ "${AUTO_YES}" -ne 1 ]]; then
  echo
  log_warn "Vous allez SUPPRIMER le compte mail :"
  echo "    email    : ${EMAIL}"
  echo "    domaine  : ${DOMAIN}"
  echo "    forward  : ${FORWARD_TO}"
  echo "    Maildir  : ${VMAIL_ROOT}/${DOMAIN}/${LOCAL_PART}/"
  echo
  read -r -p "  Tapez EXACTEMENT l'email pour confirmer : " CONFIRM
  if [[ "${CONFIRM}" != "${EMAIL}" ]]; then
    die "Annule."
  fi
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_BASE="${BACKUPS_DIR}/mail-${LOCAL_PART}-at-${DOMAIN}-${TIMESTAMP}"
mkdir -p "${BACKUP_BASE}"

# ------------------------------------------------------------------
# 1. Backup Maildir
# ------------------------------------------------------------------
log_step "Backup"
if [[ -d "${VMAIL_ROOT}/${DOMAIN}/${LOCAL_PART}" ]]; then
  tar -czf "${BACKUP_BASE}/maildir.tar.gz" \
    -C "${VMAIL_ROOT}/${DOMAIN}" "${LOCAL_PART}" 2>&1 | tail -3 || true
  log_ok "  Maildir sauvegarde : ${BACKUP_BASE}/maildir.tar.gz"
fi
echo "${LINE}" > "${BACKUP_BASE}/registry-entry.tsv"

# ------------------------------------------------------------------
# 2. Retirer la regle Sieve
# ------------------------------------------------------------------
log_step "Sieve : retrait de la regle"
if [[ -f "${DOVECOT_SIEVE_GLOBAL}" ]]; then
  tmp=$(mktemp)
  # Retirer le bloc "# Forward automatique pour <email>..." et les 3 lignes suivantes
  awk -v e="${EMAIL}" '
    /^# Forward automatique pour /{
      if (index($0, e)) { skip=5; next }
    }
    skip>0 { skip--; next }
    { print }
  ' "${DOVECOT_SIEVE_GLOBAL}" > "${tmp}"
  mv "${tmp}" "${DOVECOT_SIEVE_GLOBAL}"
  sievec "${DOVECOT_SIEVE_GLOBAL}"
  log_ok "  Regle retiree"
fi

# ------------------------------------------------------------------
# 3. Retirer le compte Dovecot
# ------------------------------------------------------------------
log_step "Dovecot : retrait du compte"
if grep -q "^${EMAIL}:" "${DOVECOT_USERS_FILE}" 2>/dev/null; then
  sed -i "\|^${EMAIL}:|d" "${DOVECOT_USERS_FILE}"
  log_ok "  Compte retire"
fi

# ------------------------------------------------------------------
# 4. Retirer le mapping vmailbox Postfix
# ------------------------------------------------------------------
log_step "Postfix : retrait du mapping"
if grep -q "^${EMAIL}[[:space:]]" "${POSTFIX_VMAILBOX}" 2>/dev/null; then
  sed -i "\|^${EMAIL}[[:space:]]|d" "${POSTFIX_VMAILBOX}"
  postmap "${POSTFIX_VMAILBOX}"
  log_ok "  Mapping retire"
fi

# ------------------------------------------------------------------
# 5. Si plus aucun mail sur ce domaine, nettoyer le domaine
# ------------------------------------------------------------------
remaining_on_domain=$(awk -F'\t' -v d="${DOMAIN}" 'NR>1 && $2==d && $1!="'"${EMAIL}"'" {c++} END {print c+0}' "${MAIL_REGISTRY_FILE}")
if [[ "${remaining_on_domain}" -eq 0 ]]; then
  log_step "Aucun mail restant sur ${DOMAIN} - nettoyage complet"

  # Retirer le domaine de virtual_mailbox_domains
  current_domains=$(postconf -h virtual_mailbox_domains 2>/dev/null || echo "")
  new_domains=$(echo "${current_domains}" | sed -E "s/(^| )${DOMAIN},?( |$)/ /; s/,[[:space:]]*${DOMAIN}([, ]|$)/\1/; s/,[[:space:]]*$//; s/^[[:space:]]+//; s/[[:space:]]+/ /g")
  postconf -e "virtual_mailbox_domains = ${new_domains}"
  log_ok "  Domaine retire de virtual_mailbox_domains"

  # Retirer entrees OpenDKIM
  if [[ -f "${OPENDKIM_KEY_TABLE}" ]]; then
    sed -i "\|^default._domainkey.${DOMAIN} |d" "${OPENDKIM_KEY_TABLE}"
  fi
  if [[ -f "${OPENDKIM_SIGNING_TABLE}" ]]; then
    sed -i "\|^\*@${DOMAIN} |d" "${OPENDKIM_SIGNING_TABLE}"
  fi

  # Supprimer la cle DKIM
  if [[ -d "${OPENDKIM_KEYS_DIR}/${DOMAIN}" ]]; then
    cp -r "${OPENDKIM_KEYS_DIR}/${DOMAIN}" "${BACKUP_BASE}/dkim-keys"
    rm -rf "${OPENDKIM_KEYS_DIR}/${DOMAIN}"
    log_ok "  Cle DKIM sauvegardee + supprimee"
  fi

  # Supprimer le dossier Maildir du domaine
  if [[ -d "${VMAIL_ROOT}/${DOMAIN}" ]]; then
    rm -rf "${VMAIL_ROOT}/${DOMAIN}"
  fi
fi

# ------------------------------------------------------------------
# 6. Reload services
# ------------------------------------------------------------------
log_step "Rechargement des services"
systemctl restart opendkim
systemctl reload postfix
systemctl restart dovecot

# ------------------------------------------------------------------
# 7. Registre
# ------------------------------------------------------------------
mail_registry_remove "${EMAIL}"

log_step "Termine"
echo "  Backup disponible : ${BACKUP_BASE}/"
if [[ "${remaining_on_domain}" -eq 0 ]]; then
  echo "  Le domaine ${DOMAIN} n'a plus aucun compte mail (nettoyage complet)."
  echo "  Pensez a retirer les DNS (MX, SPF, DKIM, DMARC) chez le registrar si le domaine n'est plus utilise."
fi
