#!/usr/bin/env bash
#
# FALLBACK build directement sur le VPS (à utiliser si GitHub Actions est HS
# ou pour un deploy manuel d'urgence).
#
# Diff vs l'ancien workflow "git reset --hard + npm run build" :
#   → On STOP PM2 avant le build pour libérer 2-3 Go de RAM.
#   → Sans ça, le build passe en swap (RAM VPS = 7.8 Go, 6 Go déjà pris par
#     les workers) et prend ~30 min. Avec ce script, on descend à ~10-15 min.
#
# Downtime :
#   - Sans page maintenance : la boutique renvoie 502 pendant tout le build.
#   - Avec page maintenance (recommandé, cf. bloc "PAGE MAINTENANCE") :
#     visiteurs voient une page propre pendant ~10 min.
#
# Usage : bash scripts/deploy/vps-build-with-freeze.sh

set -euo pipefail

APP_DIR="/var/www/beliandjolie"
PM2_APP="beliandjolie"
NGINX_MAINT_FLAG="/etc/nginx/maintenance.flag"

log() { echo "[vps-build-freeze] $*"; }

cd "$APP_DIR"

# --- 0) Pré-flight ----------------------------------------------------------
log "Pré-flight : vérification des jobs en cours…"
QUEUED_JOBS=$(mysql beliandjolie -sN -e "
  SELECT COUNT(*) FROM MarketplaceRefreshJob WHERE status IN ('QUEUED','IN_PROGRESS','AWAITING_CALLBACK');
" 2>/dev/null || echo "0")
IMG_JOBS=$(mysql beliandjolie -sN -e "
  SELECT COUNT(*) FROM ImageProcessingJob WHERE status IN ('PENDING','PROCESSING');
" 2>/dev/null || echo "0")

if [ "$QUEUED_JOBS" -gt 0 ] || [ "$IMG_JOBS" -gt 0 ]; then
  log "⚠️  Jobs en cours : marketplace=$QUEUED_JOBS images=$IMG_JOBS"
  read -r -p "Continuer quand même ? [oui/NON] " ans
  [ "$ans" = "oui" ] || { log "Annulé."; exit 1; }
fi

# --- 1) Git pull ------------------------------------------------------------
log "git fetch + reset origin/master"
git fetch origin master
git reset --hard origin/master

# --- 2) Deps + Prisma -------------------------------------------------------
log "npm install"
npm install --no-audit --no-fund

log "prisma generate + db push"
npx prisma generate
npx prisma db push --skip-generate

# --- 3) Freeze : stop PM2 pour libérer RAM ---------------------------------
log "⏸  pm2 stop $PM2_APP (libère RAM pour le build)"
pm2 stop "$PM2_APP" || true

# Page maintenance nginx (si le fichier /etc/nginx/maintenance.flag existe,
# le vhost renvoie la page statique — à configurer en amont si souhaité).
if [ -f "/etc/nginx/snippets/maintenance.conf" ]; then
  log "Active page maintenance nginx"
  touch "$NGINX_MAINT_FLAG"
  nginx -s reload
fi

# Attendre 3s que la RAM se libère
sleep 3
log "RAM libre : $(free -h | awk '/^Mem:/ {print $7}')"

# --- 4) Build ---------------------------------------------------------------
log "▶️  npm run build"
NODE_OPTIONS='--max-old-space-size=4096' npm run build

# --- 5) Restart PM2 --------------------------------------------------------
log "▶️  pm2 restart $PM2_APP"
pm2 restart "$PM2_APP" --update-env

# Retirer le flag maintenance
if [ -f "$NGINX_MAINT_FLAG" ]; then
  rm -f "$NGINX_MAINT_FLAG"
  nginx -s reload
  log "Page maintenance désactivée"
fi

# --- 6) Health check --------------------------------------------------------
sleep 5
for host in beliandjolie.com issyma.fr; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://$host" || echo "000")
  log "$host → HTTP $code"
done

log "✅ Deploy terminé"
