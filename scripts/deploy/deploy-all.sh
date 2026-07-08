#!/usr/bin/env bash
# Deploie la derniere version de master sur TOUTES les boutiques du registre
# (Beli & Jolie incluse, si elle a ete ajoutee au registre).
#
# Usage :
#   sudo ./deploy-all.sh                # deploie sur toutes les boutiques
#   sudo ./deploy-all.sh <slug> [<slug2>...]   # deploie uniquement sur les slugs listes
#
# A chaque boutique :
#   - git fetch + git reset --hard origin/master
#   - npm install si package-lock.json a change
#   - npx prisma generate + prisma db push si schema.prisma a change
#   - npm run build
#   - pm2 restart <slug>
#
# Utilise un lock pour eviter les deploiements concurrents (auto-pull.sh + humain).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root
require_cmd git npm node pm2 sha256sum
ensure_registry

acquire_lock "deploy" 120

TARGETS=("$@")

deploy_one() {
  local slug="$1" domain="$2" port="$3" db_name="$4" db_user="$5" created_at="$6"

  # Filtre si des slugs sont passes en argument
  if [[ ${#TARGETS[@]} -gt 0 ]]; then
    local found=0
    local t
    for t in "${TARGETS[@]}"; do
      [[ "${t}" == "${slug}" ]] && found=1 && break
    done
    [[ "${found}" -eq 1 ]] || return 0
  fi

  local shop_dir="${WWW_ROOT}/${slug}"
  if [[ ! -d "${shop_dir}/.git" ]]; then
    log_warn "  ${slug} : dossier absent ou non-git, ignore."
    return 0
  fi

  log_step "Deploiement : ${slug} (${domain})"
  cd "${shop_dir}"

  local pkg_before schema_before pkg_after schema_after
  pkg_before=$(sha256sum package-lock.json 2>/dev/null | awk '{print $1}' || echo "")
  schema_before=$(sha256sum prisma/schema.prisma 2>/dev/null | awk '{print $1}' || echo "")

  git fetch origin "${DEFAULT_BRANCH}" --quiet
  local before after
  before=$(git rev-parse HEAD)
  git reset --hard "origin/${DEFAULT_BRANCH}" --quiet
  after=$(git rev-parse HEAD)

  if [[ "${before}" == "${after}" ]]; then
    log_dim "  Deja a jour (${after:0:7}). Pas de rebuild."
    return 0
  fi
  log_info "  ${before:0:7} -> ${after:0:7}"

  pkg_after=$(sha256sum package-lock.json 2>/dev/null | awk '{print $1}' || echo "")
  schema_after=$(sha256sum prisma/schema.prisma 2>/dev/null | awk '{print $1}' || echo "")

  if [[ "${pkg_before}" != "${pkg_after}" ]]; then
    log_info "  package-lock.json a change -> npm install"
    npm install --no-audit --no-fund
  fi

  if [[ "${schema_before}" != "${schema_after}" ]]; then
    log_info "  schema.prisma a change -> prisma generate + db push"
    npx prisma generate
    npx prisma db push --skip-generate
  fi

  log_info "  Build Next.js"
  NODE_OPTIONS="${NODE_BUILD_OPTS}" npm run build

  log_info "  pm2 restart ${slug}"
  pm2 restart "${slug}" --update-env
  log_ok "  ${slug} deploye."
}

log_step "Deploiement multi-boutiques"
registry_foreach deploy_one
pm2 save >/dev/null
log_ok "Termine."
