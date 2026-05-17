# Format du journal `name-review-log.json`

Localisation : `/var/www/beliandjolie/data/name-review-log.json` (sur le VPS).

## Structure générale

```json
{
  "version": 1,
  "updated_at": "2026-05-17T21:00:00Z",
  "products": {
    "A382": { ... },
    "A291": { ... }
  }
}
```

- `version` : pour faire évoluer le format plus tard sans casser
- `updated_at` : ISO 8601 UTC, mis à jour à chaque écriture
- `products` : dictionnaire indexé par référence produit (clé = `Product.reference`)

## Statuts possibles

### `validated`
Produit dont le nouveau nom + description ont été appliqués en BDD.
```json
"A382": {
  "status": "validated",
  "name": "Boucles d'oreilles cœur résine et éventail",
  "description": "Boucles d'oreilles cœur en résine avec une feuille striée dorée.",
  "applied_at": "2026-05-17T21:00:00Z",
  "marketplaces": { "pfs": "ok", "ankorstore": "ok" }
}
```

`marketplaces.pfs` et `marketplaces.ankorstore` peuvent valoir :
- `"ok"` — synchronisation réussie
- `"pending_retry"` — la synchro a échoué et est à retenter
- `"skip"` — produit non publié sur cette marketplace

### `pending_revision`
Produit dont aucune proposition n'a convenu, ou seulement le nom OU seulement la description. À retravailler.

Cas 1 — tout à refaire :
```json
"A479": {
  "status": "pending_revision",
  "comments": { "all": "Pas de cœur — anneau rond + perle + ovale" }
}
```

Cas 2 — nom validé, description à refaire :
```json
"A291": {
  "status": "pending_revision",
  "validated_name": "Chaîne de cheville pampilles œil",
  "comments": { "description": "Il n'y a pas de perles mais des coquillages dorés" }
}
```

Cas 3 — description validée, nom à refaire :
```json
"A500": {
  "status": "pending_revision",
  "validated_description": "...",
  "comments": { "name": "..." }
}
```

## Règle d'exclusion

Pour générer un nouveau lot, le script `name-batch-export.ts` **exclut toutes les références présentes dans le journal**, peu importe leur statut. Ainsi un produit en `pending_revision` ne ressort pas dans les lots normaux — il faut explicitement demander « lance les révisions » pour les retraiter.

## Ce qui n'est PAS dans le journal

- Les produits jamais touchés (la majorité au début)
- Les produits ARCHIVED (filtrés en amont par le script d'export)
- Les produits OFFLINE (filtrés)

## Sauvegarde

Le journal vit sur le VPS, sauvegardé avec le reste du serveur. Pour le télécharger localement en cas de besoin :
```bash
scp root@72.61.106.128:/var/www/beliandjolie/data/name-review-log.json ~/Desktop/
```

Pour le visualiser de façon lisible :
```bash
ssh root@72.61.106.128 'cat /var/www/beliandjolie/data/name-review-log.json' | python -m json.tool
```
