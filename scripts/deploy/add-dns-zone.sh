#!/usr/bin/env bash
# Cree la zone DNS bind9 d'un domaine cliente et pose les records
# essentiels : A (@ + www), MX, SPF, DKIM, DMARC + NS ns1/ns2.
#
# Usage :
#   sudo ./add-dns-zone.sh <domaine> <forward_to>
#
# Exemple :
#   sudo ./add-dns-zone.sh bijoux-de-marie.fr marie.dupont@gmail.com
#
# Prerequis : bind9 installe + /etc/opendkim/keys/<domaine>/default.txt
# genere prealablement par add-mail-domain.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

BIND_ZONES_DIR="/etc/bind/zones"
BIND_LOCAL_CONF="/etc/bind/named.conf.local"
NS1="ns1.beliandjolie.com"
NS2="ns2.beliandjolie.com"

if [[ $# -lt 2 ]]; then
  grep -E '^#' "$0" | sed -E 's/^# ?//'
  exit 1
fi

DOMAIN="$1"
FORWARD_TO="$2"

require_root
require_cmd named-checkzone rndc

validate_domain "${DOMAIN}"
validate_email "${FORWARD_TO}"

VPS_IP=$(curl -fs --max-time 5 https://api.ipify.org 2>/dev/null || echo "72.61.106.128")

ZONE_FILE="${BIND_ZONES_DIR}/${DOMAIN}.db"
DKIM_TXT_FILE="${OPENDKIM_KEYS_DIR}/${DOMAIN}/default.txt"

log_step "Creation zone DNS pour ${DOMAIN}"

mkdir -p "${BIND_ZONES_DIR}"

# --------------------------------------------------------------
# 1. Recuperer la cle DKIM (obligatoire — doit exister avant)
# --------------------------------------------------------------
if [[ ! -f "${DKIM_TXT_FILE}" ]]; then
  die "Cle DKIM manquante : ${DKIM_TXT_FILE}. Lancez d'abord add-mail-domain.sh."
fi

# Extraire les chunks entre guillemets, les rejoindre en une chaine unique.
DKIM_VALUE=$(grep -oE '"[^"]*"' "${DKIM_TXT_FILE}" | tr -d '"' | tr -d '\n' | tr -s ' ')
if [[ -z "${DKIM_VALUE}" ]]; then
  die "Impossible d'extraire la cle DKIM depuis ${DKIM_TXT_FILE}."
fi

# Bind9 impose des chunks de 255 caracteres max entre "".
# Fonction : re-splitter la chaine DKIM en morceaux de 250 caracteres.
split_txt() {
  local str="$1"
  local out=""
  while [[ -n "${str}" ]]; do
    local chunk="${str:0:250}"
    out+="\"${chunk}\" "
    str="${str:250}"
  done
  echo "${out}"
}

DKIM_CHUNKED=$(split_txt "${DKIM_VALUE}")

# --------------------------------------------------------------
# 2. Ecrire le fichier de zone
# --------------------------------------------------------------
SERIAL=$(date +%Y%m%d%H)
cat > "${ZONE_FILE}" <<EOF
;
; Zone DNS pour ${DOMAIN} — geree par bind9 sur ${NS1}/${NS2}.
; Generee le $(date -Iseconds) par add-dns-zone.sh
;
\$TTL 3600
@       IN  SOA ${NS1}. admin.beliandjolie.com. (
                ${SERIAL}   ; serial
                3600        ; refresh
                1800        ; retry
                1209600     ; expire
                600 )       ; minimum

        IN  NS  ${NS1}.
        IN  NS  ${NS2}.

; --- Site web (visiteurs) ---
@       IN  A   ${VPS_IP}
www     IN  A   ${VPS_IP}

; --- Email (contact@${DOMAIN}) ---
@       IN  MX  10 ${MAIL_HOSTNAME}.

; SPF : autorise l'IP du VPS a envoyer des mails pour ce domaine
@       IN  TXT "v=spf1 ip4:${VPS_IP} ~all"

; DKIM : signature cryptographique posee par OpenDKIM
default._domainkey  IN  TXT ${DKIM_CHUNKED}

; DMARC : rapport a envoyer si un mail echoue SPF/DKIM
_dmarc  IN  TXT "v=DMARC1; p=none; rua=mailto:${FORWARD_TO}"
EOF

chown root:bind "${ZONE_FILE}"
chmod 644 "${ZONE_FILE}"

# --------------------------------------------------------------
# 3. Ajouter la declaration de zone dans named.conf.local
# --------------------------------------------------------------
if ! grep -q "zone \"${DOMAIN}\"" "${BIND_LOCAL_CONF}" 2>/dev/null; then
  cat >> "${BIND_LOCAL_CONF}" <<EOF

zone "${DOMAIN}" {
    type master;
    file "${ZONE_FILE}";
};
EOF
  log_ok "  Zone declaree dans named.conf.local"
else
  log_dim "  Zone deja declaree dans named.conf.local"
fi

# --------------------------------------------------------------
# 4. Valider et recharger bind9
# --------------------------------------------------------------
if ! named-checkzone "${DOMAIN}" "${ZONE_FILE}" >/dev/null; then
  named-checkzone "${DOMAIN}" "${ZONE_FILE}" || true
  die "named-checkzone a rejete la zone ${DOMAIN}."
fi

rndc reload "${DOMAIN}" 2>/dev/null || rndc reload
log_ok "  bind9 recharge"

# --------------------------------------------------------------
# 5. Recap pour la console (parse par la server action Node)
# --------------------------------------------------------------
cat <<RECAP

  Zone DNS creee pour ${DOMAIN}.
  Nameservers a fournir a la cliente :
    ${NS1}
    ${NS2}
  Propagation : 1 a 6 heures apres qu'elle change ses nameservers.

RECAP
RECAP_DONE=1
export RECAP_DONE
