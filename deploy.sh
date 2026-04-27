#!/usr/bin/env bash
# Script de mise a jour beli-jolie — a lancer sur le VPS depuis /var/www/beli-jolie
# Usage : ./deploy.sh

set -e  # arrete tout si une commande echoue

APP_NAME="beli-jolie"

echo ""
echo "==> 1/6  Recuperation du code depuis GitHub..."
git pull

echo ""
echo "==> 2/6  Installation des dependances..."
npm install

echo ""
echo "==> 3/6  Mise a jour de la structure de la base de donnees..."
npx prisma db push

echo ""
echo "==> 4/6  Regeneration du client Prisma..."
npx prisma generate

echo ""
echo "==> 5/6  Construction du site..."
npm run build

echo ""
echo "==> 6/6  Demarrage / redemarrage du site avec PM2..."
if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start npm --name "$APP_NAME" -- run start
  pm2 save
fi

echo ""
echo "Deploiement termine. Le site tourne en arriere-plan."
pm2 status "$APP_NAME"
