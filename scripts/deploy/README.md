# scripts/deploy — Multi-tenant

Outils de déploiement pour l'architecture multi-tenant (1 codebase, 1 BDD unifiée,
N domaines pointant vers le même Next.js).

## Contexte

Depuis le 2026-07-11, l'approche « 1 boutique = 1 clone du repo + 1 BDD dédiée »
est abandonnée au profit d'une architecture multi-tenant :

- 1 seul dossier `/var/www/beliandjolie/`
- 1 seule BDD `beli_jolie` avec un `tenantId` sur toutes les tables métier
- N domaines (`beliandjolie.com`, `issyma.com`, …) qui pointent vers le même
  process Next.js sur `127.0.0.1:3000`
- Nginx catch-all qui proxyfie tous les hosts

Les anciens scripts (`new-shop.sh`, `deploy-all.sh`, `auto-pull.sh`,
`list-shops.sh`, `remove-shop.sh`, `add-mail-domain.sh`,
`remove-mail-domain.sh`, `lib/common.sh`, `lib/nginx-shop.conf.template`)
ont été supprimés. Le workflow de déploiement est désormais celui décrit dans
`multitenant-cutover-playbook.md`.

## Scripts restants

| Script                              | Rôle                                                 |
|-------------------------------------|------------------------------------------------------|
| `multitenant-backup.sh`             | Backup complet BDD + uploads + `.env` avant cutover |
| `multitenant-cutover-playbook.md`   | Procédure de bascule prod en 7 étapes + rollback     |
| `add-dns-zone.sh`                   | Ajout d'une zone DNS Hostinger pour un nouveau domaine cliente |
| `mysql_init.sql`                    | Init MySQL (rôles, users) — historique               |
| `nginx-beliandjolie.conf`           | Config Nginx historique (à remplacer par le catch-all multi-tenant, voir playbook) |
| `mount-vps.ps1`                     | Mount SSHFS du VPS depuis Windows (dev)              |

## Nouveau workflow de déploiement

Manuel, explicite, sans cron auto-pull :

```bash
# Sur le VPS
cd /var/www/beliandjolie
git fetch origin
git reset --hard origin/master
npm install
npx prisma generate
npx prisma db push --skip-generate
NODE_OPTIONS='--max-old-space-size=4096' npm run build
pm2 restart beliandjolie
```

Une seule commande peut être scriptée si besoin (`deploy.sh`) mais reste
lancée à la main pour garder le contrôle sur les moments de déploiement.

## Déploiement rapide (build local) — `deploy-fast.ps1`

Depuis 2026-07-27 : script PowerShell qui **compile sur le PC** au lieu du VPS,
puis rsync le `.next/` compilé. Réduit un deploy de ~10 min à ~1-2 min.

Étapes exécutées :

1. Pre-flight VPS (jobs marketplace/images/traduction/mail/Ankor callbacks)
2. Vérif git local + commit/push si nécessaire
3. Backup complet VPS (mysqldump + git archive + `.env` + uploads hardlinks)
4. `npm run build` **en local**
5. `tar` + `scp` du `.next/` vers le VPS (sans `.next/cache/`)
6. Sur le VPS : `git reset --hard origin/master` + `npm install` + `prisma generate` + `prisma db push --skip-generate` + extract `.next/` + `pm2 restart beliandjolie`
7. Vérif visiteur (curl `beliandjolie.com` + `issyma.fr`)
8. Vérif post-deploy des jobs bloqués

**Usage** (depuis la racine du projet, dans PowerShell) :

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy/deploy-fast.ps1
```

**Pré-requis PC** : `git`, `npm`, `ssh`, `scp`, `tar` (tous natifs Windows 10+
avec Git for Windows installé). Clé SSH configurée pour `root@72.61.106.128`.

**Rollback** : le script affiche à la fin le chemin du backup + les commandes
exactes pour revenir en arrière (git reset + zcat mysql).
