#!/usr/bin/env bash
# Creation d'une nouvelle boutique sur le VPS.
#
# Usage :
#   sudo ./new-shop.sh <slug> <domaine> <email-admin> [--skip-dns-check]
#
# Exemple :
#   sudo ./new-shop.sh marie bijoux-de-marie.fr contact@marie.fr
#
# Etapes :
#   1. Valider les arguments + DNS
#   2. Trouver un port libre
#   3. Generer les secrets (mdp MySQL, session, chiffrement, mdp admin)
#   4. Creer la BDD MySQL + user isole
#   5. git clone dans /var/www/<slug>
#   6. Ecrire le .env
#   7. npm install + prisma generate + prisma db push
#   8. Creer le compte admin
#   9. npm run build
#  10. Ecrire le vhost Nginx + reload
#  11. Certbot -> HTTPS
#  12. Reecrire NEXTAUTH_URL en https:// dans le .env + rebuild
#  13. Ajouter en pm2 + save
#  14. Enregistrer au registre
#  15. Afficher le recap (URL + login admin + mdp genere)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

# ------------------------------------------------------------------
# Parsing des arguments
# ------------------------------------------------------------------
SKIP_DNS_CHECK=0
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-dns-check) SKIP_DNS_CHECK=1; shift ;;
    -h|--help)
      grep -E '^#' "$0" | sed -E 's/^# ?//'
      exit 0
      ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

if [[ ${#POSITIONAL[@]} -ne 3 ]]; then
  die "Usage : $0 <slug> <domaine> <email-admin> [--skip-dns-check]"
fi

SLUG="${POSITIONAL[0]}"
DOMAIN="${POSITIONAL[1]}"
ADMIN_EMAIL="${POSITIONAL[2]}"

# ------------------------------------------------------------------
# Verifications preliminaires
# ------------------------------------------------------------------
require_root
require_cmd git npm node openssl mysql nginx certbot pm2 curl awk sed getent
ensure_registry

validate_slug "${SLUG}"
validate_domain "${DOMAIN}"
validate_email "${ADMIN_EMAIL}"

if [[ "${SLUG}" == "beliandjolie" ]]; then
  die "Le slug « beliandjolie » est reserve a la boutique historique."
fi

if registry_has_slug "${SLUG}"; then
  die "Le slug « ${SLUG} » est deja utilise (registre)."
fi
if [[ -d "${WWW_ROOT}/${SLUG}" ]]; then
  die "Le dossier ${WWW_ROOT}/${SLUG} existe deja."
fi
if registry_has_domain "${DOMAIN}"; then
  die "Le domaine « ${DOMAIN} » est deja utilise (registre)."
fi

if [[ "${SKIP_DNS_CHECK}" -eq 0 ]]; then
  check_dns "${DOMAIN}" || die "Faites pointer ${DOMAIN} vers l'IP du VPS avant de relancer, ou utilisez --skip-dns-check."
else
  log_warn "DNS non verifie (--skip-dns-check). Certbot echouera si le domaine ne pointe pas ici."
fi

# ------------------------------------------------------------------
# Port + secrets
# ------------------------------------------------------------------
log_step "Preparation"
PORT=$(registry_next_port)
log_info "Port choisi : ${PORT}"

DB_NAME="${SLUG//-/_}"           # MySQL n'aime pas les tirets dans les identifiants sans backticks
DB_USER="${DB_NAME}"
if [[ ${#DB_USER} -gt 32 ]]; then
  DB_USER="${DB_USER:0:32}"      # MySQL 8 max = 32 chars
fi
DB_PASSWORD=$(gen_password)
NEXTAUTH_SECRET=$(gen_secret_base64)
ENCRYPTION_KEY=$(gen_secret_base64)
# Clef de chiffrement des Server Actions Next.js. Doit rester stable entre
# redemarrages sinon toutes les pages deja ouvertes echouent avec
# « Failed to find Server Action ».
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$(gen_secret_base64)
ANKORSTORE_WEBHOOK_SECRET=$(gen_secret_base64 | tr -dc 'A-Za-z0-9' | head -c 32)
ADMIN_PASSWORD=$(gen_password)

log_ok "Secrets generes."

# ------------------------------------------------------------------
# 1. BDD MySQL isolee
# ------------------------------------------------------------------
log_step "Creation de la base MySQL"
mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
log_ok "BDD ${DB_NAME} + user ${DB_USER} crees."

# ------------------------------------------------------------------
# 2. Clonage du repo
# ------------------------------------------------------------------
log_step "Clonage du code"
SHOP_DIR="${WWW_ROOT}/${SLUG}"
git clone --branch "${DEFAULT_BRANCH}" --single-branch "${REPO_SSH}" "${SHOP_DIR}"
log_ok "Clone dans ${SHOP_DIR}"

# ------------------------------------------------------------------
# 3. .env de la boutique (NEXTAUTH_URL en HTTP pour l'instant)
# ------------------------------------------------------------------
log_step "Ecriture du .env"
ENV_FILE="${SHOP_DIR}/.env"
cat > "${ENV_FILE}" <<ENV
# Genere par scripts/deploy/new-shop.sh - $(date --iso-8601=seconds)
DATABASE_URL="mysql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:3306/${DB_NAME}"

NEXTAUTH_SECRET="${NEXTAUTH_SECRET}"
NEXTAUTH_URL="http://${DOMAIN}"

ENCRYPTION_KEY="${ENCRYPTION_KEY}"
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}"

PORT=${PORT}
HOST=127.0.0.1

# --- A completer par la cliente via l'admin ---
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=""

SMTP_HOST=""
SMTP_PORT=""
SMTP_USER=""
SMTP_PASSWORD=""

ANKORSTORE_WEBHOOK_SECRET="${ANKORSTORE_WEBHOOK_SECRET}"
ENV
chmod 600 "${ENV_FILE}"
log_ok ".env ecrit (600)."

# ------------------------------------------------------------------
# 4. Install + Prisma + admin
# ------------------------------------------------------------------
log_step "npm install"
cd "${SHOP_DIR}"
npm install --no-audit --no-fund

log_step "Prisma generate + db push"
npx prisma generate
npx prisma db push --skip-generate

log_step "Creation du compte admin"
ADMIN_EMAIL="${ADMIN_EMAIL}" ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  npx tsx scripts/create-admin-from-env.ts

# ------------------------------------------------------------------
# 5. Build
# ------------------------------------------------------------------
log_step "Build Next.js (peut prendre 1-2 min)"
NODE_OPTIONS="${NODE_BUILD_OPTS}" npm run build

# ------------------------------------------------------------------
# 6. Vhost Nginx HTTP + Certbot
# ------------------------------------------------------------------
log_step "Configuration Nginx"
VHOST_FILE="${NGINX_AVAILABLE}/${SLUG}"
sed -e "s/{{SLUG}}/${SLUG}/g" \
    -e "s/{{DOMAIN}}/${DOMAIN}/g" \
    -e "s/{{PORT}}/${PORT}/g" \
    "${SCRIPT_DIR}/lib/nginx-shop.conf.template" > "${VHOST_FILE}"

# Detecter si www.<domaine> resout aussi vers le VPS. Si non, on retire le
# www du server_name Nginx pour eviter que Certbot echoue sur ce sous-domaine.
WWW_ENABLED=0
if check_www_dns "${DOMAIN}"; then
  WWW_ENABLED=1
  log_ok "www.${DOMAIN} resout aussi vers le VPS."
else
  log_warn "www.${DOMAIN} ne resout pas ici -> HTTPS pour ${DOMAIN} uniquement."
  sed -i "s| www\.${DOMAIN}||g" "${VHOST_FILE}"
fi

ln -sf "${VHOST_FILE}" "${NGINX_ENABLED}/${SLUG}"

nginx -t
systemctl reload nginx
log_ok "Vhost HTTP actif pour ${DOMAIN}"

log_step "Certbot -> HTTPS (Let's Encrypt)"
CERTBOT_DOMAINS=(-d "${DOMAIN}")
[[ "${WWW_ENABLED}" -eq 1 ]] && CERTBOT_DOMAINS+=(-d "www.${DOMAIN}")

if certbot --nginx \
    "${CERTBOT_DOMAINS[@]}" \
    --non-interactive --agree-tos --email "${ADMIN_EMAIL}" \
    --redirect; then
  log_ok "HTTPS actif."
  # Recharger le .env avec https://, rebuild + restart pour que NEXTAUTH_URL colle
  sed -i "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=\"https://${DOMAIN}\"|" "${ENV_FILE}"
  log_info "NEXTAUTH_URL mis a jour en https://"
else
  log_warn "Certbot a echoue. La boutique reste accessible en HTTP. Relancez plus tard :"
  log_warn "  sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --redirect"
fi

# ------------------------------------------------------------------
# 7. pm2
# ------------------------------------------------------------------
log_step "Demarrage pm2"
cd "${SHOP_DIR}"
pm2 start npm --name "${SLUG}" --cwd "${SHOP_DIR}" -- start
pm2 save
log_ok "Process pm2 « ${SLUG} » demarre."

# ------------------------------------------------------------------
# 8. Registre + recap
# ------------------------------------------------------------------
registry_add "${SLUG}" "${DOMAIN}" "${PORT}" "${DB_NAME}" "${DB_USER}"

log_step "Termine"
cat <<RECAP

  ╭──────────────────────────────────────────────────────────────
  │  Boutique « ${SLUG} » creee.
  │
  │  URL       : https://${DOMAIN}
  │  Admin URL : https://${DOMAIN}/connexion
  │  Email     : ${ADMIN_EMAIL}
  │  Mdp admin : ${ADMIN_PASSWORD}
  │
  │  BDD       : ${DB_NAME} (user ${DB_USER})
  │  Port      : ${PORT}
  │  Dossier   : ${SHOP_DIR}
  │
  │  Etapes suivantes cote cliente :
  │   1. Se connecter avec les identifiants ci-dessus
  │   2. Changer le mot de passe admin
  │   3. Renseigner Societe / Stripe / SMTP dans Parametres
  ╰──────────────────────────────────────────────────────────────

RECAP
log_warn "Notez le mot de passe admin, il ne sera pas reaffiche."
