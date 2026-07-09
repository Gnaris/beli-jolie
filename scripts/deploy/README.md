# scripts/deploy — Multi-boutiques

Outils pour heberger plusieurs boutiques (chacune = un clone du repo `beli-jolie`)
sur le meme VPS.

Chaque boutique a :
- son propre dossier `/var/www/<slug>/`
- sa propre BDD MySQL (`<slug>` + user MySQL dedie)
- son propre process `pm2` (nomme `<slug>`)
- son propre vhost Nginx + certificat Let's Encrypt
- son propre port interne (Beli & Jolie = 3000, boutiques suivantes = 3001, 3002, ...)

Le **registre** central est `/root/.beliboutiques/shops.tsv` : c'est la source de verite,
il liste toutes les boutiques et est lu par `deploy-all.sh`, `list-shops.sh`, etc.

## Scripts disponibles

### Boutiques

| Script            | Role                                                 |
|-------------------|------------------------------------------------------|
| `new-shop.sh`     | Cree une nouvelle boutique (clone + BDD + build + Nginx + HTTPS + pm2) |
| `deploy-all.sh`   | Deploie la derniere version de master sur toutes les boutiques |
| `list-shops.sh`   | Affiche le tableau de bord (statut, disque, HEAD)    |
| `remove-shop.sh`  | Backup + suppression totale d'une boutique           |
| `auto-pull.sh`    | Detecte un nouveau commit et declenche `deploy-all.sh` (a mettre en cron) |

### Mail (Postfix + Dovecot + OpenDKIM + Sieve)

| Script                  | Role                                                     |
|-------------------------|----------------------------------------------------------|
| `add-mail-domain.sh`    | Cree une boite `<local>@<domaine>` + forward auto vers un mail perso |
| `remove-mail-domain.sh` | Backup + suppression d'une boite (nettoie DKIM/Postfix/Dovecot si domaine vide) |

## Prerequis VPS

Deja installes sur le VPS Beli & Jolie :
- Nginx, Certbot (`--nginx`)
- MySQL 8
- Node 20 LTS + npm
- pm2 (global, geree par systemd)
- Cle SSH deploy read-only vers GitHub (`~/.ssh/id_ed25519_beliandjolie`)

## Utilisation

### 1. Enregistrer Beli & Jolie dans le registre (une seule fois)

Pour que Beli & Jolie soit mise a jour comme les autres boutiques, elle doit
figurer dans `shops.tsv` :

```bash
sudo mkdir -p /root/.beliboutiques
sudo bash -c 'cat > /root/.beliboutiques/shops.tsv <<EOF
slug	domain	port	db_name	db_user	created_at
beliandjolie	beliandjolie.com	3000	beliandjolie	beliandjolie	2025-11-01T00:00:00+00:00
EOF'
sudo chmod 600 /root/.beliboutiques/shops.tsv
```

### 2. Creer une nouvelle boutique

Prealable : la cliente doit avoir achete son domaine et fait pointer les
enregistrements DNS **A** (`@` et `www`) vers l'IP du VPS. Compter 10 minutes
de propagation.

```bash
sudo /var/www/beliandjolie/scripts/deploy/new-shop.sh marie bijoux-de-marie.fr contact@marie.fr
```

Le script :
1. Verifie que le DNS pointe bien vers le VPS.
2. Cree la BDD + user MySQL isole.
3. Clone le repo, ecrit le `.env`, installe les deps, migre la BDD.
4. Cree le compte admin avec un mot de passe genere.
5. Configure Nginx + Let's Encrypt HTTPS.
6. Lance le process pm2.
7. Affiche l'URL, l'email admin et le mot de passe genere. **Notez-le, il ne
   sera pas reaffiche.**

Si le DNS n'est pas encore propage, `--skip-dns-check` permet de bypasser mais
Certbot echouera : la boutique restera en HTTP, a relancer plus tard avec
`sudo certbot --nginx -d <domaine> -d www.<domaine> --redirect`.

### 3. Deployer une mise a jour du code

Manuel :
```bash
sudo /var/www/beliandjolie/scripts/deploy/deploy-all.sh
# ou pour cibler une boutique :
sudo /var/www/beliandjolie/scripts/deploy/deploy-all.sh marie
```

Automatique (recommande) : installer `auto-pull.sh` en cron root, verifie GitHub
chaque minute :

```bash
sudo crontab -e
# ajouter la ligne suivante :
* * * * * /var/www/beliandjolie/scripts/deploy/auto-pull.sh >> /var/log/beliboutiques-auto-pull.log 2>&1
```

### 4. Voir l'etat des boutiques

```bash
sudo /var/www/beliandjolie/scripts/deploy/list-shops.sh
```

### 5. Supprimer une boutique (fin d'abonnement)

```bash
sudo /var/www/beliandjolie/scripts/deploy/remove-shop.sh marie
# Confirmation manuelle demandee : retaper le slug pour confirmer.
```

Un backup complet (BDD + uploads + .env) est depose dans
`/root/.beliboutiques/backups/<slug>-<date>/` avant la suppression.

## Restaurer une boutique depuis un backup

```bash
cd /root/.beliboutiques/backups/marie-20260710-140502

# 1. Recreer la BDD + user (mysql_init de la boutique) puis :
gunzip -c marie.sql.gz | mysql marie

# 2. Recreer le dossier + le repo puis :
tar -xzf uploads.tar.gz -C /var/www/marie/

# 3. Remettre le .env
cp .env /var/www/marie/.env

# 4. Relancer new-shop.sh manuellement en sautant la partie BDD, ou plus
#    simple : relancer new-shop.sh sur un slug/domaine different et copier les
#    donnees dedans.
```

Restauration = intervention manuelle, pas de script auto (rare, delicat).

## Choix techniques

- **Un port par boutique** (3000, 3001, ...) : invisible pour les clients, purement
  interne. Le script trouve automatiquement le prochain port libre.
- **Une BDD MySQL isolee** : impossible qu'une boutique lise les donnees d'une
  autre, meme en cas de bug applicatif.
- **`.env` non versionne** : chaque boutique a le sien, `git reset --hard` ne
  l'ecrase pas.
- **HTTPS gere par Certbot `--nginx`** : renouvellement auto tous les 60 jours
  (deja actif via le timer systemd standard `certbot.timer`).

## Depannage

**Un deploiement a echoue au milieu** : le lock `~/.beliboutiques/locks/deploy.lock`
peut rester. `sudo rm /root/.beliboutiques/locks/deploy.lock` pour debloquer, puis
relancer `deploy-all.sh`.

**pm2 ne redemarre pas apres reboot** : `pm2 startup` + `pm2 save` (deja fait
pour Beli & Jolie via `pm2-root.service`).

**Certbot echoue avec « unauthorized »** : le DNS ne pointe pas encore vers le
VPS. Verifier avec `getent hosts <domaine>`.

---

## Mail : creer une boite pour une cliente

Prealable : serveur mail deja installe sur le VPS (Postfix + Dovecot + OpenDKIM
+ Sieve + PostSRSd + Let's Encrypt sur `mail.beliandjolie.com`).

### Creer un compte

```bash
sudo /var/www/beliandjolie/scripts/deploy/add-mail-domain.sh \
  bijoux-de-marie.fr contact marie.dupont@gmail.com
```

Le script :
1. Ajoute `bijoux-de-marie.fr` aux domaines geres par Postfix.
2. Genere une cle DKIM 2048 bits propre au domaine.
3. Migre OpenDKIM en mode multi-domaines (KeyTable/SigningTable) la premiere fois.
4. Cree le compte Dovecot `contact@bijoux-de-marie.fr` avec un mot de passe genere.
5. Ajoute une regle Sieve : tout mail arrivant est **stocke localement** ET **transfere** vers `marie.dupont@gmail.com`.
6. Affiche les 4 DNS a ajouter chez le registrar :
   - MX -> `mail.beliandjolie.com`
   - SPF -> `v=spf1 ip4:72.61.106.128 ~all`
   - DKIM -> valeur affichee (2048 bits)
   - DMARC -> `v=DMARC1; p=none; rua=mailto:contact@bijoux-de-marie.fr`

La cliente n'a plus qu'a **ajouter ces 4 DNS chez Hostinger** (idealement,
comme tous les domaines sont sur votre compte, c'est vous qui le faites) et
tout est operationnel. Elle recoit les mails de sa boutique dans son Gmail
perso, sans configuration.

**Envoyer des mails** : elle peut aussi ajouter dans son Gmail « Envoyer en
tant que `contact@bijoux-de-marie.fr` » avec :
- Serveur SMTP `mail.beliandjolie.com` port `587` STARTTLS
- Auth `contact@bijoux-de-marie.fr` + le mot de passe genere

### Supprimer un compte

```bash
sudo /var/www/beliandjolie/scripts/deploy/remove-mail-domain.sh \
  contact@bijoux-de-marie.fr
```

Backup du Maildir + de l'entree registre dans `/root/.beliboutiques/backups/`.
Si c'etait le dernier compte sur le domaine, le domaine est retire de la config
Postfix, la cle DKIM est archivee et supprimee.

### Registre mail

`/root/.beliboutiques/mail-accounts.tsv` — colonnes : `email`, `domain`,
`local_part`, `forward_to`, `dkim_selector`, `created_at`.
