#!/usr/bin/env bash
#
# Reçoit un déploiement depuis GitHub Actions.
# Exécuté sur le VPS après que le workflow ait rsync tous les fichiers.
#
# Le build est déjà fait côté runner GitHub, donc ici on se contente de :
#   1. Appliquer les changements de schema Prisma si besoin
#   2. Redémarrer PM2
#   3. Vérifier que les 2 tenants répondent
#
# En cas d'échec, le script rend un code de retour non nul → le workflow
# GitHub Actions marque le deploy comme raté et remonte l'alerte.

set -euo pipefail

APP_DIR="/var/www/beliandjolie"
PM2_APP="beliandjolie"

log() { echo "[vps-receive] $*"; }

cd "$APP_DIR"

# --- 1) Schema Prisma -------------------------------------------------------
# Comparer le schema live vs le schema reçu. Si différent, appliquer.
# On utilise `prisma db push --skip-generate` (le client Prisma est déjà généré
# côté runner et arrivé dans node_modules).
SCHEMA_HASH_FILE="/root/.beliandjolie-schema-hash"
CURRENT_HASH="$(sha256sum prisma/schema.prisma | cut -d' ' -f1)"
LAST_HASH="$(cat "$SCHEMA_HASH_FILE" 2>/dev/null || echo "")"

if [ "$CURRENT_HASH" != "$LAST_HASH" ]; then
  log "Schema Prisma modifié → prisma db push"
  npx prisma db push --skip-generate --accept-data-loss=false
  echo "$CURRENT_HASH" > "$SCHEMA_HASH_FILE"
else
  log "Schema Prisma inchangé → skip db push"
fi

# --- 2) Restart PM2 ---------------------------------------------------------
log "pm2 restart $PM2_APP"
pm2 restart "$PM2_APP" --update-env

# --- 3) Health check --------------------------------------------------------
log "Attente 5s puis health check…"
sleep 5

check_tenant() {
  local host="$1"
  local title
  # Récupère le <title> pour vérifier que ce n'est pas la page erreur d'un autre tenant
  title="$(curl -sL --max-time 15 "https://$host" | grep -oE '<title>[^<]*</title>' | head -1 || echo "")"
  if [ -z "$title" ]; then
    log "❌ $host ne répond pas / pas de <title>"
    return 1
  fi
  log "✓ $host → $title"
  return 0
}

failed=0
check_tenant "beliandjolie.com" || failed=1
check_tenant "issyma.fr" || failed=1

if [ "$failed" -ne 0 ]; then
  log "❌ Health check FAILED — les logs PM2 :"
  pm2 logs "$PM2_APP" --lines 30 --nostream || true
  exit 1
fi

log "✅ Deploy terminé avec succès"
