# Bascule multi-tenant — playbook

**Objectif** : passer d'une architecture 1-clone-par-boutique à un codebase multi-tenant unifié.

**Cible finale** : 1 dossier `/var/www/beliandjolie`, 1 BDD `beli_jolie`, N domaines (beliandjolie.com, issyma.com, …) tous mappés au même Next.js sur `127.0.0.1:3000`.

---

## Pré-requis (à valider AVANT la fenêtre de cutover)

### Côté code (à finir en local, testé, poussé sur `master`)
- [ ] SiteConfig PK composite `@@id([tenantId, key])` + adapter les 126 appels `siteConfig.findUnique/upsert` dans 19 fichiers (transformer `findUnique({where:{key}})` → `findFirst({where:{key}})` — l'extension multi-tenant scopera par tenantId automatiquement)
- [ ] `Product.reference`, `Order.orderNumber`, `User.email`, `User.siret`, `User.stripeCustomerId` : passer les `@unique` globaux en `@@unique([tenantId, X])` pour permettre le doublon inter-boutique
- [ ] Cache tags des `getCached*` préfixés par `tenantSlug` (sinon leak entre boutiques)
- [ ] `tenantId` passe en `NOT NULL` sur tous les modèles (backfill validé)
- [ ] Callers des helpers `xxxDir(...)` de `lib/storage.ts` migrés pour passer `tenant.slug`
- [ ] Middleware : durcir le "unknown host" en 404 (aujourd'hui il laisse passer sans header)
- [ ] Tests : `npm run test` full pass + `npm run test:pfs-smoke` OK

### Côté infra
- [ ] Backup complet frais (< 24h) via `scripts/deploy/multitenant-backup.sh`
- [ ] Nginx : préparer le nouveau vhost catch-all qui proxifie **tous** les domaines vers `127.0.0.1:3000`
- [ ] Certificats SSL : `certbot certonly -d beliandjolie.com -d www.beliandjolie.com -d issyma.com -d www.issyma.com` (renouveler manuellement une fois avant cutover)
- [ ] Fenêtre de maintenance annoncée (email, bannière)

### Côté client
- [ ] Issyma prévenu : "ton onboarding est en pause pendant 1-2 jours"
- [ ] Feu vert de la cliente

---

## Étape 1 — Backup complet (~5 min)

Sur le VPS root :

```bash
bash /var/www/beliandjolie/scripts/deploy/multitenant-backup.sh
```

Vérifier que les 4 archives (2 BDD + 2 uploads) sont générées dans `/root/backups/multitenant/{timestamp}/`.

**Ne pas continuer si le backup a échoué ou si l'archive fait 0 octet.**

---

## Étape 2 — Passage en maintenance (~1 min)

Sur le VPS, pour chaque boutique :

```bash
# Beli & Jolie
mysql beli_jolie -e "REPLACE INTO SiteConfig (\`key\`, value) VALUES ('maintenance_mode', 'true');"

# Issyma
mysql issyma -e "REPLACE INTO SiteConfig (\`key\`, value) VALUES ('maintenance_mode', 'true');"
```

Vérifier que les 2 sites affichent la page maintenance.

---

## Étape 3 — Fusion des BDD (~5 min)

Sur le VPS :

```bash
cd /var/www/beliandjolie

# 1. La BDD beli-jolie porte déjà tous les tenantId=beli-jolie (après phase 1 en local + push).
#    On importe issyma DEDANS avec un tenantId=issyma.

# 2. Créer le tenant issyma (le seed est idempotent)
DEFAULT_TENANT_SLUG=issyma \
DEFAULT_TENANT_NAME="Issyma" \
DEFAULT_TENANT_HOSTS='[{"host":"issyma.com","isPrimary":true},{"host":"www.issyma.com","isPrimary":false}]' \
npx tsx scripts/seed-tenant.ts   # à créer sur le modèle de seed-default-tenant.ts

# 3. Extraire les données Issyma (peu volumineuses — quelques SiteConfig + CompanyInfo)
mysqldump --skip-add-drop-table --no-create-info \
  --tables SiteConfig CompanyInfo \
  issyma > /tmp/issyma-data.sql

# 4. Adapter les INSERT pour poser tenantId (issyma)
ISSYMA_ID=$(mysql beli_jolie -Nse "SELECT id FROM Tenant WHERE slug='issyma'")
sed -i "s/INSERT INTO \`SiteConfig\` VALUES (/INSERT INTO SiteConfig (tenantId, \`key\`, value, updatedAt) VALUES ('${ISSYMA_ID}', /g" /tmp/issyma-data.sql
# (idem pour CompanyInfo — script à écrire proprement)

# 5. Importer dans beli_jolie
mysql beli_jolie < /tmp/issyma-data.sql
```

Attention : cette étape suppose que Issyma n'a que du CompanyInfo + SiteConfig (état actuel : uniquement quelques données d'onboarding). Si Issyma a créé des produits/commandes entre-temps, adapter la liste des tables.

---

## Étape 4 — Migration des uploads Issyma (~2 min)

```bash
# Déplacer les uploads d'Issyma sous /public/uploads/issyma/ dans le dossier beliandjolie
mv /var/www/issyma/public/uploads/* /var/www/beliandjolie/public/uploads/issyma/
mv /var/www/issyma/private/uploads/* /var/www/beliandjolie/private/uploads/issyma/
```

---

## Étape 5 — Bascule Nginx (~2 min)

```bash
# 1. Sauvegarder l'ancien
cp /etc/nginx/sites-enabled/beliandjolie /root/nginx-backup-beliandjolie.conf
cp /etc/nginx/sites-enabled/issyma       /root/nginx-backup-issyma.conf

# 2. Écrire le nouveau vhost multi-tenant
cat > /etc/nginx/sites-available/multitenant <<'EOF'
server {
    listen 443 ssl http2;
    server_name beliandjolie.com www.beliandjolie.com issyma.com www.issyma.com;

    ssl_certificate     /etc/letsencrypt/live/beliandjolie.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/beliandjolie.com/privkey.pem;
    # (Nginx sélectionne le bon cert via SNI si plusieurs certs — sinon un cert par vhost)

    client_max_body_size 300m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/multitenant /etc/nginx/sites-enabled/multitenant
rm /etc/nginx/sites-enabled/beliandjolie
rm /etc/nginx/sites-enabled/issyma

nginx -t && systemctl reload nginx
```

---

## Étape 6 — Arrêt PM2 Issyma, restart Beli & Jolie (~1 min)

```bash
pm2 stop issyma
pm2 delete issyma

# Rebuild + restart beli-jolie avec le nouveau code multi-tenant
cd /var/www/beliandjolie
git fetch origin
git reset --hard origin/master
npm install
npx prisma generate
npx prisma db push --skip-generate
NODE_OPTIONS='--max-old-space-size=4096' npm run build
pm2 restart beliandjolie
pm2 save
```

---

## Étape 7 — Sortie de maintenance + vérifications (~5 min)

```bash
mysql beli_jolie -e "REPLACE INTO SiteConfig (\`key\`, value) VALUES ('maintenance_mode', 'false');"
```

**Vérifs visiteur** :

```bash
# Beli & Jolie
curl -sL https://beliandjolie.com | grep -i "<title>"
curl -sL https://beliandjolie.com/fr/produits | head -50
curl -sI https://beliandjolie.com/uploads/beli-jolie/produits/e807/e807-argent-1.webp
# → doit renvoyer 200

# Issyma
curl -sL https://issyma.com | grep -i "<title>"
```

**Vérifs admin** :
- Se connecter sur beliandjolie.com/admin → dashboard chargé, produits présents
- Se connecter sur issyma.com/admin (compte séparé) → onboarding reprend là où il s'était arrêté

**Vérifs marketplaces** :
- Aller dans /admin/parametres → cartes PFS/Ankorstore/eFashion/Faire toutes vertes
- Pousser un produit test sur PFS → passe
- (Ankorstore n'est vérifiable qu'après callback, patienter 5 min)

---

## Rollback (si un truc casse)

```bash
# 1. Nginx : remettre les 2 vhosts d'origine
rm /etc/nginx/sites-enabled/multitenant
ln -sf /root/nginx-backup-beliandjolie.conf /etc/nginx/sites-enabled/beliandjolie
ln -sf /root/nginx-backup-issyma.conf       /etc/nginx/sites-enabled/issyma
nginx -t && systemctl reload nginx

# 2. Restaurer les BDD depuis le backup
zcat /root/backups/multitenant/{timestamp}/beli-jolie-db.sql.gz | mysql
zcat /root/backups/multitenant/{timestamp}/issyma-db.sql.gz | mysql

# 3. Restaurer les uploads
tar -xzf /root/backups/multitenant/{timestamp}/beli-jolie-uploads.tar.gz -C /var/www/beliandjolie/
tar -xzf /root/backups/multitenant/{timestamp}/issyma-uploads.tar.gz -C /var/www/issyma/

# 4. Restart les 2 process
pm2 start /var/www/beliandjolie/ecosystem.config.js
pm2 start /var/www/issyma/ecosystem.config.js
```

---

## Nettoyage post-cutover (à faire APRÈS 7 jours sans incident)

- Supprimer `/var/www/issyma` (dossier code obsolète)
- Supprimer la BDD `issyma` (`DROP DATABASE issyma;`)
- Supprimer les scripts `new-shop.sh` / `deploy-all.sh` / `auto-pull.sh` / `remove-shop.sh` (workflow clone obsolète)
- Remplacer par un simple `git pull && npm install && prisma generate && prisma db push && build && pm2 restart beliandjolie` en cron ou webhook
- Archiver les backups multi-tenant sur stockage froid
