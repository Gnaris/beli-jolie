# Procédure en attente — Nettoyage binlogs MySQL (VPS prod)

**État :** ⏳ en attente du feu vert de la cliente
**Phrase de code déclencheuse :** **« feu vert journaux »**
**Créé le :** 2026-05-10

## Contexte (résumé du diagnostic)

Le 2026-05-10, VPS prod (`72.61.106.128`) constaté lent + disque à 83 % (80/96 Go). Cause identifiée : **57 Go de binlogs MySQL** accumulés en 4 jours (571 fichiers `binlog.NNNNNN` de 105 Mo chacun, sous `/var/lib/mysql/`). MySQL 8 active les binlogs par défaut côté Ubuntu (aucun fichier de config perso ne les active), rétention 30 jours (`binlog_expire_logs_seconds = 2592000`).

Les imports PFS répétés génèrent énormément d'écritures (Product, ProductColor, ProductColorImage, VariantSize, ProductTranslation × 7 langues, etc.) qui gonflent le journal.

La cliente a validé l'**option « purge + désactivation complète »** (pas de réplica configuré, donc les binlogs sont inutiles ici). Elle a préféré attendre la fin de l'import PFS en cours.

## Préconditions à vérifier AVANT de lancer

1. **Import PFS terminé** : `ssh root@72.61.106.128 "tail -50 /root/.pm2/logs/beliandjolie-out.log"` — ne plus voir de lignes `[PFS Import]` récentes (> 2 min sans nouvelle ligne). Si encore actif, **demander confirmation à la cliente** avant d'interrompre.
2. **Espace disque libre suffisant pour le dump** : `df -h /` — au moins 500 Mo libres (le dump fait ~100-200 Mo).
3. **Aucun déploiement / opération critique en cours**.

## Procédure exacte

### Étape 1 — Sauvegarde par sécurité

```bash
ssh root@72.61.106.128 "mkdir -p /root/backups && mysqldump --single-transaction --quick --routines --triggers beliandjolie | gzip > /root/backups/beliandjolie-before-binlog-purge-$(date +%Y%m%d-%H%M).sql.gz && ls -lh /root/backups/ | tail -3"
```

**Ne pas continuer** si le dump échoue ou pèse < 50 Mo (anormal).

### Étape 2 — Désactiver les binlogs dans la config

D'abord vérifier l'état actuel :

```bash
ssh root@72.61.106.128 "grep -nE '\[mysqld\]|log_bin|disable_log_bin' /etc/mysql/mysql.conf.d/mysqld.cnf"
```

Puis ajouter `disable_log_bin` juste après la section `[mysqld]` :

```bash
ssh root@72.61.106.128 "sed -i '/^\[mysqld\]/a disable_log_bin' /etc/mysql/mysql.conf.d/mysqld.cnf && grep -A2 '^\[mysqld\]' /etc/mysql/mysql.conf.d/mysqld.cnf"
```

### Étape 3 — Redémarrer MySQL (mini-coupure 5-10 sec)

```bash
ssh root@72.61.106.128 "systemctl restart mysql && sleep 3 && systemctl status mysql --no-pager | head -10"
```

### Étape 4 — Vérifier que les binlogs sont bien désactivés

```bash
ssh root@72.61.106.128 "mysql -e \"SHOW VARIABLES LIKE 'log_bin';\""
```

Doit retourner `log_bin | OFF`.

### Étape 5 — Supprimer les anciens binlogs (orphelins)

Une fois MySQL relancé sans binlogs, les anciens fichiers sont juste des fichiers sur disque, sans danger à supprimer :

```bash
ssh root@72.61.106.128 "rm -v /var/lib/mysql/binlog.* 2>&1 | tail -5 && df -h /"
```

### Étape 6 — Vérification visiteur

```bash
curl -sL -o /dev/null -w 'HTTP %{http_code} | %{time_total}s\n' https://beliandjolie.com/
curl -sL https://beliandjolie.com/ | grep -oP '<title>\K[^<]+'
```

Le titre doit correspondre à la page d'accueil. Si erreur 500 ou timeout → rollback.

### Étape 7 — Confirmer à la cliente en français simple

Annoncer :
- Espace récupéré (devrait passer de ~80 Go → ~23 Go utilisés sur 96 Go).
- Site OK (HTTP 200 + bon titre).
- Plus aucun journal ne s'accumulera désormais.

## Rollback si problème

Si MySQL ne redémarre pas ou le site est cassé :

```bash
ssh root@72.61.106.128 "sed -i '/^disable_log_bin$/d' /etc/mysql/mysql.conf.d/mysqld.cnf && systemctl restart mysql && systemctl status mysql --no-pager | head -10"
```

Et si la base est corrompue (très peu probable, on n'a touché à aucune donnée) : restaurer depuis le dump de l'étape 1 :

```bash
ssh root@72.61.106.128 "gunzip < /root/backups/beliandjolie-before-binlog-purge-XXXX.sql.gz | mysql beliandjolie"
```

## Notes pour Claude

- La cliente est non-technique. Annoncer chaque étape en français simple, pas par commande shell.
- Ne **pas** demander de re-confirmation entre les étapes — elle a déjà validé le plan global.
- **Stopper et alerter** si une étape échoue de façon inattendue.
- Après succès, supprimer ce fichier (`docs/operations/mysql-binlog-cleanup.md`) et retirer la mention dans `CLAUDE.md`, puis commit + push.
