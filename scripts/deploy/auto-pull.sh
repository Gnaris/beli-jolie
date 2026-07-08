#!/usr/bin/env bash
# Polling GitHub -> declenche deploy-all.sh si un nouveau commit est detecte
# sur la branche master.
#
# A installer en cron sur le VPS :
#   * * * * * /var/www/beliandjolie/scripts/deploy/auto-pull.sh >> /var/log/beliboutiques-auto-pull.log 2>&1
#
# On utilise le repo de reference (Beli & Jolie historique) comme sonde. Si son
# HEAD distant differe de son HEAD local, on lance deploy-all.sh qui repropagera
# sur toutes les boutiques (Beli & Jolie incluse si presente au registre).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_cmd git flock

SENTINEL_REPO="/var/www/beliandjolie"
if [[ ! -d "${SENTINEL_REPO}/.git" ]]; then
  # En dernier recours, prend la premiere boutique du registre comme sonde.
  ensure_registry
  first_slug=$(awk -F'\t' 'NR==2 {print $1; exit}' "${REGISTRY_FILE}" || echo "")
  [[ -n "${first_slug}" ]] || { log_dim "Aucune boutique, rien a poller."; exit 0; }
  SENTINEL_REPO="${WWW_ROOT}/${first_slug}"
fi

cd "${SENTINEL_REPO}"

# Recuperer la ref distante sans modifier l'index local.
REMOTE_HEAD=$(git ls-remote origin "${DEFAULT_BRANCH}" 2>/dev/null | awk '{print $1}')
LOCAL_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")

if [[ -z "${REMOTE_HEAD}" ]]; then
  log_warn "Impossible de contacter GitHub. On reessaie au prochain tick."
  exit 0
fi

if [[ "${REMOTE_HEAD}" == "${LOCAL_HEAD}" ]]; then
  # Rien a faire - silencieux pour ne pas polluer les logs.
  exit 0
fi

log_info "$(date --iso-8601=seconds) : nouveau commit detecte ${LOCAL_HEAD:0:7} -> ${REMOTE_HEAD:0:7}"

# deploy-all.sh gere son propre lock. On l'appelle en root.
"${SCRIPT_DIR}/deploy-all.sh"
