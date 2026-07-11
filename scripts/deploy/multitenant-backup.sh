#!/usr/bin/env bash
# Backup complet AVANT la bascule multi-tenant.
# Génère 4 archives horodatées dans /root/backups/multitenant/{timestamp}/ :
#   - beli-jolie-db.sql.gz     : dump complet BDD beli-jolie
#   - issyma-db.sql.gz         : dump complet BDD issyma
#   - beli-jolie-uploads.tar.gz : public/ + private/uploads de Beli & Jolie
#   - issyma-uploads.tar.gz    : idem pour Issyma
#
# À conserver au moins 30 jours après cutover réussi.
#
# Usage (sur le VPS root@72.61.106.128) :
#   bash /var/www/beliandjolie/scripts/deploy/multitenant-backup.sh

set -euo pipefail

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/root/backups/multitenant/${TIMESTAMP}"
mkdir -p "${BACKUP_DIR}"

# Boutiques à sauvegarder — lues depuis le registre clone.
# Format : slug<TAB>dossier<TAB>domaine<TAB>db_name<TAB>...
REGISTRY="/root/.beliboutiques/shops.tsv"

if [[ ! -f "${REGISTRY}" ]]; then
  echo "Erreur : registre boutiques introuvable (${REGISTRY})"
  exit 1
fi

echo "== Backup multi-tenant vers ${BACKUP_DIR} =="
echo

while IFS=$'\t' read -r SLUG DIR DOMAIN DB_NAME REST; do
  # Ignore lignes de commentaire et vides
  [[ "${SLUG}" =~ ^#.*$ || -z "${SLUG}" ]] && continue

  echo "-- Boutique ${SLUG} (BDD=${DB_NAME}, dossier=${DIR})"

  # Dump BDD
  DB_DUMP="${BACKUP_DIR}/${SLUG}-db.sql.gz"
  mysqldump --single-transaction --routines --triggers --events \
    --databases "${DB_NAME}" \
    | gzip > "${DB_DUMP}"
  DB_SIZE=$(du -h "${DB_DUMP}" | cut -f1)
  echo "   BDD  : ${DB_DUMP} (${DB_SIZE})"

  # Backup uploads
  UPLOADS_TAR="${BACKUP_DIR}/${SLUG}-uploads.tar.gz"
  if [[ -d "${DIR}/public/uploads" || -d "${DIR}/private/uploads" ]]; then
    tar -czf "${UPLOADS_TAR}" \
      -C "${DIR}" \
      $([ -d "${DIR}/public/uploads" ] && echo "public/uploads") \
      $([ -d "${DIR}/private/uploads" ] && echo "private/uploads")
    UPLOADS_SIZE=$(du -h "${UPLOADS_TAR}" | cut -f1)
    echo "   Files: ${UPLOADS_TAR} (${UPLOADS_SIZE})"
  else
    echo "   Files: (aucun dossier uploads à sauvegarder)"
  fi

  # Backup .env
  if [[ -f "${DIR}/.env" ]]; then
    cp "${DIR}/.env" "${BACKUP_DIR}/${SLUG}.env"
    chmod 600 "${BACKUP_DIR}/${SLUG}.env"
    echo "   Env  : ${BACKUP_DIR}/${SLUG}.env"
  fi

  echo
done < "${REGISTRY}"

# Hash de contrôle pour vérifier l'intégrité plus tard
sha256sum "${BACKUP_DIR}"/*.gz "${BACKUP_DIR}"/*.env 2>/dev/null > "${BACKUP_DIR}/checksums.sha256"

echo "== Backup terminé =="
echo "Dossier : ${BACKUP_DIR}"
echo "Taille  : $(du -sh "${BACKUP_DIR}" | cut -f1)"
echo
echo "Pour restaurer une BDD :"
echo "  zcat ${BACKUP_DIR}/{slug}-db.sql.gz | mysql"
echo
echo "Pour restaurer des uploads :"
echo "  tar -xzf ${BACKUP_DIR}/{slug}-uploads.tar.gz -C {chemin-destination}"
