#!/usr/bin/env bash
# Script de déploiement beli-jolie — à lancer sur le VPS depuis /var/www/beli-jolie
# Usage : ./deploy.sh

set -e  # arrête tout si une commande échoue

APP_NAME="beli-jolie"

echo ""
echo "==> 1/5  Récupération du code depuis GitHub…"
git pull

echo ""
echo "==> 2/5  Installation des dépendances…"
npm install

echo ""
echo "==> 3/5  Mise à jour de la base de données…"
npx prisma db push
npx prisma generate

echo ""
echo "==> 4/5  Construction du site…"
npm run build

echo ""
echo "==> 5/5  Redémarrage du site…"
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
  pm2 restart "$APP_NAME"
else
  pm2 start npm --name "$APP_NAME" -- start
  pm2 save
fi

echo ""
echo "Déploiement terminé. Le site tourne."
pm2 status "$APP_NAME"
