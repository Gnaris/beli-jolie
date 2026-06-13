# Format Excel d'import Beli & Jolie

Référence : `scripts/generate-import-hors-ligne.js` à la racine du projet.

## Structure du fichier généré

5 lignes d'en-tête figées, puis les données à partir de la ligne 5 :

| Ligne | Rôle                                                                    |
|-------|-------------------------------------------------------------------------|
| 1     | Bandeaux de section : « Fiche produit » + « Variante »                  |
| 2     | En-têtes de colonnes                                                    |
| 3     | Marqueur « Obligatoire » / « Facultatif »                               |
| 4     | Exemple `(ex : …)`                                                      |
| 5+    | Une ligne par variante. La première variante d'un produit a tous les champs produit ; les variantes suivantes du même produit n'ont que la `Référence` répétée. |

## Colonnes produit (PRODUCT_COLUMNS)

| Clé                      | En-tête               | Obligatoire | Exemple                  |
|--------------------------|-----------------------|-------------|--------------------------|
| `reference`              | Référence *           | oui         | PRD-001                  |
| `name`                   | Nom *                 | oui         | Produit Étoile           |
| `description`            | Description *         | oui         | Produit fin avec motif…  |
| `category`               | Catégorie *           | oui         | Accessoires              |
| `sub_categories`         | Sous-catégories       | non         | Sautoir,Fin              |
| `tags`                   | Tags                  | non         | étoile,fin,tendance      |
| `composition`            | Composition *         | oui         | Coton:100                |
| `primary_color`          | Couleur principale    | non         | Doré                     |
| `pays_fabrication`       | Pays fabrication *    | oui         | France                   |
| `saison`                 | Saison *              | oui         | Été 2026                 |
| `hs_code`                | Code SH               | non         | 71171900                 |
| `taille_unique_details`  | Détail taille unique *| oui         | 52-56                    |
| `dimension_length`       | Longueur (cm)         | non         | 45                       |
| `dimension_width`        | Largeur (cm)          | non         | 2                        |
| `dimension_height`       | Hauteur (cm)          | non         |                          |
| `dimension_diameter`     | Diamètre (cm)         | non         | 6.5                      |
| `dimension_circumference`| Circonférence (cm)    | non         |                          |
| `similar_refs`           | Réf. similaires       | non         | PRD-002,PRD-003          |
| `best_seller`            | Best Seller           | non         | false                    |

## Colonnes variante (VARIANT_COLUMNS)

| Clé              | En-tête          | Obligatoire | Exemple |
|------------------|------------------|-------------|---------|
| `color`          | Couleur *        | oui         | Doré    |
| `sale_type`      | Type de vente *  | oui         | UNIT    |
| `size`           | Taille *         | oui         | M       |
| `unit_price`     | Prix unitaire *  | oui         | 12.50   |
| `stock`          | Stock *          | oui         | 200     |
| `pack_qty`       | Qté pack         | non         |         |
| `discount_type`  | Type remise      | non         | PERCENT |
| `discount_value` | Valeur remise    | non         | 10      |
| `weight_g`       | Poids (g)        | non         | 30      |

## Règles de validation Excel (data validation)

- `sale_type` : liste `"UNIT,PACK"`
- `discount_type` : liste `"PERCENT,AMOUNT"`
- `best_seller` : liste `"true,false"`

## Style visuel (cohérence avec le template officiel)

Palette `COLORS` reprise depuis `scripts/generate-import-hors-ligne.js`. Bordures fines `BORDER_THIN`, rangées alternées par groupe de produit, en-têtes colorés (rouge clair pour obligatoire, gris clair pour facultatif).

## Endroit où sauvegarder le fichier final

Dossier Downloads de la cliente : `C:/Users/Admin/Downloads/`.
Nom du fichier : `import-<NomFournisseur>.xlsx` (ex : `import-A.xlsx`, `import-ZC.xlsx`).
