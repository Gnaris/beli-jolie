#!/usr/bin/env bash
# Cree une nouvelle boite mail sur un domaine cliente et configure le forward
# automatique vers l'email personnel du client (via Sieve + SRS).
#
# Usage :
#   sudo ./add-mail-domain.sh <domaine> <local_part> <forward_to>
#
# Exemple :
#   sudo ./add-mail-domain.sh bijoux-de-marie.fr contact marie.dupont@gmail.com
#
# Etapes :
#   1. Valider les arguments
#   2. Ajouter le domaine dans virtual_mailbox_domains (Postfix)
#   3. Generer une cle DKIM propre au domaine (2048 bits)
#   4. Migrer OpenDKIM en mode multi-domaines si necessaire (KeyTable/SigningTable)
#   5. Ajouter la cle a la KeyTable + SigningTable
#   6. Creer le compte Dovecot avec mot de passe aleatoire
#   7. Ajouter la regle Sieve de forward vers l'email personnel
#   8. Recompiler le script Sieve global
#   9. Recharger Postfix, OpenDKIM, Dovecot
#  10. Enregistrer dans /root/.beliboutiques/mail-accounts.tsv
#  11. Afficher les 4 DNS a ajouter chez Hostinger + credentials

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# ------------------------------------------------------------------
# Arguments
# ------------------------------------------------------------------
if [[ $# -lt 3 ]]; then
  grep -E '^#' "$0" | sed -E 's/^# ?//'
  exit 1
fi

DOMAIN="$1"
LOCAL_PART="$2"
FORWARD_TO="$3"
EMAIL="${LOCAL_PART}@${DOMAIN}"

# ------------------------------------------------------------------
# Verifications prealables
# ------------------------------------------------------------------
require_root
require_cmd postconf postmap opendkim-genkey sievec systemctl doveadm openssl awk sed

ensure_registry
ensure_mail_registry

validate_domain "${DOMAIN}"
validate_email "${FORWARD_TO}"
if [[ ! "${LOCAL_PART}" =~ ^[a-z0-9._-]{1,32}$ ]]; then
  die "local_part invalide : « ${LOCAL_PART} ». Regles : minuscules/chiffres/._-, max 32."
fi

if mail_registry_has_email "${EMAIL}"; then
  die "Le compte mail « ${EMAIL} » est deja dans le registre."
fi

log_step "Creation compte mail « ${EMAIL} » avec forward vers ${FORWARD_TO}"

# ------------------------------------------------------------------
# 1. Postfix : ajouter le domaine aux virtual_mailbox_domains
# ------------------------------------------------------------------
log_step "Postfix : ajout du domaine ${DOMAIN}"
current_domains=$(postconf -h virtual_mailbox_domains 2>/dev/null || echo "")
if [[ ",${current_domains// /}," != *",${DOMAIN},"* ]]; then
  if [[ -z "${current_domains}" ]]; then
    new_domains="${DOMAIN}"
  else
    new_domains="${current_domains}, ${DOMAIN}"
  fi
  postconf -e "virtual_mailbox_domains = ${new_domains}"
  log_ok "  ${DOMAIN} ajoute a virtual_mailbox_domains"
else
  log_dim "  ${DOMAIN} deja dans virtual_mailbox_domains"
fi

# Mapping local_part -> chemin Maildir
mkdir -p "${VMAIL_ROOT}/${DOMAIN}/${LOCAL_PART}"
chown -R "${VMAIL_UID}:${VMAIL_UID}" "${VMAIL_ROOT}/${DOMAIN}"

# vmailbox : "email  domain/local/"
if ! grep -q "^${EMAIL}[[:space:]]" "${POSTFIX_VMAILBOX}" 2>/dev/null; then
  echo "${EMAIL}  ${DOMAIN}/${LOCAL_PART}/" >> "${POSTFIX_VMAILBOX}"
  postmap "${POSTFIX_VMAILBOX}"
  log_ok "  Mapping mailbox ajoute"
fi

# ------------------------------------------------------------------
# 2. OpenDKIM : migrer en mode multi-domaines si necessaire
# ------------------------------------------------------------------
log_step "OpenDKIM : preparation multi-domaines"
if grep -qE '^(Domain|KeyFile|Selector)[[:space:]]' /etc/opendkim.conf 2>/dev/null; then
  log_info "  Migration de la config OpenDKIM en mode KeyTable + SigningTable"
  # Backup
  cp /etc/opendkim.conf /etc/opendkim.conf.bak.$(date +%s)

  # Retirer les directives mono-domaine
  sed -i -E '/^(Domain|KeyFile|Selector)[[:space:]]/d' /etc/opendkim.conf

  # Ajouter KeyTable/SigningTable si absent
  grep -q '^KeyTable[[:space:]]' /etc/opendkim.conf \
    || echo "KeyTable file:${OPENDKIM_KEY_TABLE}" >> /etc/opendkim.conf
  grep -q '^SigningTable[[:space:]]' /etc/opendkim.conf \
    || echo "SigningTable refile:${OPENDKIM_SIGNING_TABLE}" >> /etc/opendkim.conf

  # Amorcer les tables avec beliandjolie.com (deja configure en mono avant migration)
  mkdir -p "$(dirname "${OPENDKIM_KEY_TABLE}")"
  touch "${OPENDKIM_KEY_TABLE}" "${OPENDKIM_SIGNING_TABLE}"
  if ! grep -q "beliandjolie.com" "${OPENDKIM_KEY_TABLE}"; then
    echo "default._domainkey.beliandjolie.com beliandjolie.com:default:${OPENDKIM_KEYS_DIR}/beliandjolie.com/default.private" \
      >> "${OPENDKIM_KEY_TABLE}"
  fi
  if ! grep -q "beliandjolie.com" "${OPENDKIM_SIGNING_TABLE}"; then
    echo "*@beliandjolie.com default._domainkey.beliandjolie.com" >> "${OPENDKIM_SIGNING_TABLE}"
  fi
  log_ok "  OpenDKIM migre en multi-domaines"
else
  log_dim "  OpenDKIM deja en mode multi-domaines"
fi

# ------------------------------------------------------------------
# 3. Generer la cle DKIM du nouveau domaine
# ------------------------------------------------------------------
log_step "OpenDKIM : cle DKIM pour ${DOMAIN}"
key_dir="${OPENDKIM_KEYS_DIR}/${DOMAIN}"
mkdir -p "${key_dir}"
if [[ ! -f "${key_dir}/default.private" ]]; then
  (cd "${key_dir}" && opendkim-genkey -s default -d "${DOMAIN}" -b 2048)
  chown opendkim:opendkim "${key_dir}/default.private"
  chmod 600 "${key_dir}/default.private"
  log_ok "  Cle 2048 bits generee"
else
  log_dim "  Cle existante conservee"
fi

# Enregistrer dans les tables OpenDKIM
if ! grep -q "^default._domainkey.${DOMAIN} " "${OPENDKIM_KEY_TABLE}" 2>/dev/null; then
  echo "default._domainkey.${DOMAIN} ${DOMAIN}:default:${key_dir}/default.private" >> "${OPENDKIM_KEY_TABLE}"
fi
if ! grep -q "\*@${DOMAIN} " "${OPENDKIM_SIGNING_TABLE}" 2>/dev/null; then
  echo "*@${DOMAIN} default._domainkey.${DOMAIN}" >> "${OPENDKIM_SIGNING_TABLE}"
fi

DKIM_TXT=$(grep -oE '"[^"]*"' "${key_dir}/default.txt" | tr -d '"' | tr -d '\n' | sed -E 's/ +/ /g;s/^ //;s/ $//')

# ------------------------------------------------------------------
# 4. Dovecot : creer le compte
# ------------------------------------------------------------------
log_step "Dovecot : creation du compte ${EMAIL}"
if grep -q "^${EMAIL}:" "${DOVECOT_USERS_FILE}" 2>/dev/null; then
  die "Le compte Dovecot ${EMAIL} existe deja."
fi
PASSWORD=$(gen_password)
HASH=$(doveadm pw -s SHA512-CRYPT -p "${PASSWORD}")
echo "${EMAIL}:${HASH}::::::" >> "${DOVECOT_USERS_FILE}"
chmod 640 "${DOVECOT_USERS_FILE}"
chgrp dovecot "${DOVECOT_USERS_FILE}"
log_ok "  Compte cree"

# ------------------------------------------------------------------
# 5. Sieve : forward pur (aucune copie locale — zero stockage sur le VPS)
# ------------------------------------------------------------------
log_step "Sieve : regle de forward vers ${FORWARD_TO}"
mkdir -p "$(dirname "${DOVECOT_SIEVE_GLOBAL}")"

# S'assurer que le fichier existe avec le require minimal.
if [[ ! -f "${DOVECOT_SIEVE_GLOBAL}" ]] || ! grep -q '"envelope"' "${DOVECOT_SIEVE_GLOBAL}" 2>/dev/null; then
  cat > "${DOVECOT_SIEVE_GLOBAL}" <<'EOF'
require ["envelope"];
EOF
fi

# Ajouter la regle si absente
if ! grep -q "envelope :is \"to\" \"${EMAIL}\"" "${DOVECOT_SIEVE_GLOBAL}"; then
  cat >> "${DOVECOT_SIEVE_GLOBAL}" <<EOF

# Forward pur pour ${EMAIL} vers ${FORWARD_TO} (pas de copie locale)
if envelope :is "to" "${EMAIL}" {
    redirect "${FORWARD_TO}";
}
EOF
fi

sievec "${DOVECOT_SIEVE_GLOBAL}"
# Permissions : le binaire doit etre lisible par tout Dovecot, sans qu'il essaie
# de le recompiler dans un dossier read-only.
chmod 755 "$(dirname "${DOVECOT_SIEVE_GLOBAL}")"
chmod 644 "${DOVECOT_SIEVE_GLOBAL}" "${DOVECOT_SIEVE_GLOBAL%.sieve}.svbin" 2>/dev/null || true

# ------------------------------------------------------------------
# 6. Reload services
# ------------------------------------------------------------------
log_step "Rechargement des services"
systemctl restart opendkim
systemctl reload postfix
systemctl restart dovecot
systemctl is-active opendkim postfix dovecot

# ------------------------------------------------------------------
# 7. Registre + recap
# ------------------------------------------------------------------
mail_registry_add "${EMAIL}" "${DOMAIN}" "${LOCAL_PART}" "${FORWARD_TO}" "default"

VPS_IP=$(curl -fs --max-time 5 https://api.ipify.org 2>/dev/null || echo "72.61.106.128")

cat <<RECAP

  ╭──────────────────────────────────────────────────────────────
  │  Compte mail « ${EMAIL} » cree.
  │
  │  Forward auto vers : ${FORWARD_TO}
  │  Mot de passe      : ${PASSWORD}
  │  Serveur IMAP      : ${MAIL_HOSTNAME}  port 993  SSL/TLS
  │  Serveur SMTP      : ${MAIL_HOSTNAME}  port 587  STARTTLS
  │
  │  ═════════ DNS a ajouter sur ${DOMAIN} (Hostinger) ═════════
  │
  │  1. MX record (reception)
  │     Type: MX   Nom: @   Priorite: 10   Valeur: ${MAIL_HOSTNAME}
  │
  │  2. SPF (TXT)
  │     Type: TXT  Nom: @
  │     Valeur: "v=spf1 ip4:${VPS_IP} ~all"
  │
  │  3. DKIM (TXT)
  │     Type: TXT  Nom: default._domainkey
  │     Valeur:
  │     ${DKIM_TXT}
  │
  │  4. DMARC (TXT)
  │     Type: TXT  Nom: _dmarc
  │     Valeur: "v=DMARC1; p=none; rua=mailto:${EMAIL}"
  │
  ╰──────────────────────────────────────────────────────────────

RECAP
log_warn "Notez le mot de passe ci-dessus, il ne sera pas reaffiche."
log_dim "Une fois les DNS ajoutes, tout mail envoye a ${EMAIL} sera transfere vers ${FORWARD_TO}."
