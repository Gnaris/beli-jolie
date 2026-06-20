# Tables de correspondance — Bon de commande → Excel import Beli & Jolie

> **Règle d'or** : ne JAMAIS deviner. Si une valeur n'est pas dans ces tables, **demander à la cliente** avant de générer le fichier. Une fois confirmée, **mettre à jour ce fichier**.

---

## Catégories chinoises → catégorie Beli & Jolie

La colonne `品名` (« pinming ») du bon de commande indique le type de bijou.
Si elle contient `返单`, le produit existe déjà → à mettre dans la liste séparée (ne pas inclure dans l'Excel).

> ⚠️ **Règles d'orthographe cliente (confirmées 2026-06-12)** :
> - Catégories au **singulier** sauf **« Boucles d'oreilles »** qui reste au pluriel (cas particulier — l'objet va par paire).
> - **« Bracelet de main »** et **« Chaîne de cheville »** sont des **sous-catégories** de Bracelet, pas des catégories à part.

| Chinois (品名) | Catégorie BDD       | Sous-catégorie       | Notes                                         |
|----------------|---------------------|----------------------|-----------------------------------------------|
| 耳环           | Boucles d'oreilles  | —                    | Boucles d'oreilles standard                   |
| 耳钉           | Boucles d'oreilles  | —                    | Puce d'oreille (stud) — confirmé 2026-06-12   |
| 耳骨夹         | Boucles d'oreilles  | Clips                | Confirmé par la cliente le 2026-06-12         |
| 耳夹           | Boucles d'oreilles  | Clips                | Confirmé 2026-06-18 (idem 耳骨夹)             |
| 单只耳环       | Boucles d'oreilles  | À l'unité            | Une boucle pour une seule oreille (mono-puce) |
| 项链           | Collier             | —                    | Collier                                       |
| 胸链           | Collier             | Collier de dos       | Confirmé par la cliente le 2026-06-12         |
| 戒指           | Bague               | —                    | Bague                                         |
| 手链           | Bracelet            | —                    | Bracelet chaîne                               |
| 手镯           | Bracelet            | Jonc                 | Confirmé par la cliente le 2026-06-12         |
| 光面手镯       | Bracelet            | Jonc                 | Jonc lisse                                    |
| 豹纹绳子手镯   | Bracelet            | Jonc                 | Cas unique (motif léopard cordon)             |
| 脚链           | Bracelet            | Chaîne de cheville   | Confirmé 2026-06-12 (sous-cat de Bracelet)    |
| 手背链         | Bracelet            | Bracelet de main     | Confirmé 2026-06-12 (sous-cat de Bracelet)    |
| 胸针           | Broche              | —                    | **Nouvelle catégorie** — confirmée 2026-06-12 |

---

## Couleurs chinoises → couleur Beli & Jolie

La colonne `颜色` (« yanse ») indique la couleur.

| Chinois (颜色) | Couleur BDD | Notes                                            |
|----------------|-------------|--------------------------------------------------|
| 金色           | Doré        | Or                                               |
| 钢色           | Argent      | Acier brut (couleur naturelle)                   |
| 蓝色           | Bleu        | Bleu                                             |
| 白色           | Blanc       | Confirmé 2026-06-12 (à créer)                    |
| 黑色           | Noir        | Confirmé 2026-06-12 (à créer)                    |
| 粉色           | Rose        | Confirmé 2026-06-12 (à créer)                    |
| 绿色           | Vert        | Confirmé 2026-06-12 (à créer)                    |
| 紫色           | Violet      | Confirmé 2026-06-12 (à créer)                    |
| 米色           | Beige       | Confirmé 2026-06-12 (à créer)                    |
| 米白           | Beige       | Confirmé 2026-06-12                              |
| 桔色           | Orange      | Confirmé 2026-06-12 (à créer)                    |
| 橙色           | Orange      | Confirmé 2026-06-12 (à créer, idem 桔色)         |
| 玫红           | Fuchsia     | Confirmé 2026-06-12 (à créer)                    |
| 咖啡           | Marron      | Confirmé 2026-06-12 (existe déjà)                |
| 胡兰           | Marine      | Confirmé 2026-06-12 (à créer)                    |
| 七彩           | Multicolore | Confirmé 2026-06-12 (à créer)                    |
| 间金           | Bicolore    | Confirmé 2026-06-13 (à créer)                    |
| 金+白          | Blanc       | Bicolore doré+blanc : couleur principale = Blanc |
| 金+兰          | Bleu        | Bicolore doré+bleu  : couleur principale = Bleu  |
| 16K金色        | Doré        | Fournisseur E : placage or 16K (confirmé 2026-06-12) |
| 16K金白色      | Blanc       | Fournisseur E : placage 16K + base blanc          |
| 16K金蓝色      | Bleu        | Fournisseur E : placage 16K + base bleu           |
| 16K金粉色      | Rose        | Fournisseur E : placage 16K + base rose           |
| 16K炉内真金    | Doré        | Fournisseur ZC : placage or 16K (confirmé 2026-06-18) |
| 14K炉内真金    | Doré        | Fournisseur ZC : placage or 14K (confirmé 2026-06-18) |
| 白             | Blanc       | Fournisseur ZC : abrégé de 白色 (说明) — 2026-06-18 |
| 粉             | Rose        | Fournisseur ZC : abrégé de 粉色 (说明) — 2026-06-18 |
| 蓝             | Bleu        | Fournisseur ZC : abrégé de 蓝色 (说明) — 2026-06-18 |
| 彩             | Multicolore | Fournisseur ZC : abrégé de 七彩 (说明) — 2026-06-18 |
| 黄             | Jaune       | Fournisseur ZC : abrégé de 黄色 (à créer — 2026-06-18) |
| 绿             | Vert        | Fournisseur ZC : abrégé de 绿色 (说明) — 2026-06-18 |

### Convention fournisseur WF (Weifan) — confirmée 2026-06-12

Les couleurs du fournisseur WF utilisent toutes des préfixes/suffixes :
- **« 金- »** = placage doré sur couleur de base → on **garde la couleur de base**
- **« 钢色- » / « 钢- »** = couleur acier inox → **Argent**
- **suffixe « 如样 »** (« comme l'échantillon ») → on **ignore**, on garde juste le métal (Doré / Argent)
- **suffixe « 锆 » (zircon) ou « 钻 » (diamant)** : couleur de la **pierre** devient la couleur principale, sauf pour 金-/钢-白钻 où on garde Doré/Argent (cas unique cliente).

| Chinois (颜色) | Couleur BDD | Notes                                                       |
|----------------|-------------|-------------------------------------------------------------|
| 金-黑色        | Noir        | Placage doré sur base noire                                 |
| 金-白色        | Blanc       | Placage doré sur base blanche                               |
| 金-粉色        | Rose        | Placage doré sur base rose                                  |
| 金-绿色        | Vert        | Placage doré sur base verte                                 |
| 金-蓝色        | Bleu        | Placage doré sur base bleue                                 |
| 金-橘黄        | Orange      | Placage doré sur base orange jaune                          |
| 金色-如样      | Doré        | Doré « comme l'échantillon »                                |
| 金-如样        | Doré        | idem                                                        |
| 钢色-如样      | Argent      | Acier « comme l'échantillon »                               |
| 钢-如样        | Argent      | idem                                                        |
| 金色-白锆      | Blanc       | Doré avec zircon blanc → couleur = pierre                   |
| 金色-蓝锆      | Bleu        | Doré avec zircon bleu → couleur = pierre                    |
| 金-白钻        | Doré        | Cas unique cliente : on garde le métal                      |
| 钢-白钻        | Argent      | Cas unique cliente : on garde le métal                      |
| 金-白+粉       | Rose        | Bicolore blanc+rose → couleur dominante choisie : Rose      |
| 金-白+蓝       | Bleu        | Bicolore blanc+bleu → couleur dominante choisie : Bleu      |
| 金-梅红+紫+浅粉| Multicolore | Tricolore magenta+violet+rose clair (cas unique)            |
| 金-绿+黄+粉    | Rose        | Tricolore vert+jaune+rose → cliente a choisi Rose (unique)  |

---

## Catégories couleur déjà créées en BDD (au 2026-06-12)

- Argent
- Doré
- Bleu
- Rouge
- Marron

## Catégories produits déjà créées en BDD (au 2026-06-12)

- Boucles d'oreilles
- Colliers
- Bracelets
- Bagues
- Pendentif
- Parures de bijoux

---

## Fournisseurs identifiés

| Lettre(s) de référence | Nom du fournisseur            | Notes                                       |
|------------------------|-------------------------------|---------------------------------------------|
| A                      | (à nommer par la cliente)     | Premier bon traité 2026-06-12 (142 produits)|
| WF                     | Weifan (薇梵饰品)              | 义乌市薇梵饰品有限公司 — bon traité 2026-06-12. Format différent : en-têtes en ligne 7, colonne couleur = 电镀色, prix = 单价 préfixé ￥, bicolores type 金-X+Y, suffixes 如样/锆/钻 |
| G                      | (à nommer par la cliente)     | Bon traité 2026-06-12 (16 produits). **Pas de colonne 品名 (catégorie)** — la cliente doit fournir la catégorie produit par produit via overrides. Format : en-tête ligne 1, colonne ref = 条码, couleur = 颜色, prix = 单价, parfois catégorie collée dans la couleur (« 金色手链 ») → extraite automatiquement. Suffixe « 合计 » et « 第X箱 » à la fin (ignorés). |
| E                      | (à nommer par la cliente)     | Bon traité 2026-06-12 (22 produits). Format à **plusieurs boîtes** (1号箱 / 2号箱 / 3号箱) avec en-têtes répétées — parseur ignore les ré-en-têtes (`条码`), notes (`备注：`) et bandeaux de boîte. Colonne ref = 条码, **catégorie = 说明** (peut contenir description en plus, ex « 戒指点钻 », « 耳环50大 », « 戒指 空心 要确认 ») → mot-catégorie extrait via KNOWN_CAT_TOKENS. Si la description ne contient aucun mot-cat connu (ex « 配件改八角星… »), la cliente doit fournir l'override. Préfixe couleur **« 16K金 »** = placage or 16 carats → couleur de base. |
| N                      | Buquanhui (布泉汇)            | Bon traité 2026-06-12 (11 produits). Format : en-tête ligne 2, colonne ref = **编号**, catégorie = **类型** (souvent codes internes ZZEH-/EH-/SBL- au lieu de mots chinois → la cliente doit fournir l'override pour ces refs). Stop bottom : « 总计/数量/金额/元 ». Couleurs condensées : **金** (sans 色) = Doré, **金+粉** = Rose, **金+混色** = Multicolore. **16k金色** (k minuscule, équivalent au 16K de E) = Doré. Parfois des produits hors convention (ex « SZ-9050(A） ») doivent être skippés à la demande de la cliente. |
| M                      | Rongxin (荣鑫饰品)            | Bon traité 2026-06-12 (12 produits). Format : en-tête ligne 5, colonne couleur = **颜色要求** (ajouté à HEADER_ALIASES.yanse). Particularité : **货号 ré-inscrit** sur chaque ligne de couleur d'un même produit (pas laissé vide comme A/WF) → parse-po.cjs détecte le doublon de fullRef et traite comme couleur additionnelle. Couleur **白钢** = Argent (équivalent à 钢色). Quand un produit n'a aucune couleur déclarée (cellule 颜色要求 vide), la cliente doit fournir la couleur par défaut via patch JSON. |
| W                      | Piment Rouge Bijoux (红辣椒饰品) | Bon traité 2026-06-13 (10 produits, 6 refs déjà en BDD prod exclues). Format PDF scanné (Excel non fourni) → texte lu via pdf-parse. En-tête `产品图片 / 货号 / 款式 / 颜色 / 数量 / 单价 / 金额 / 箱数`. **Particularité prix** : la colonne 单价 ne correspond PAS au prix de vente — le vrai prix est encodé dans le **dernier segment** de la référence (ex `W125-880-380` → 3,80 €). Toutes les couleurs d'un même produit ont donc le même prix. Couleur **间金** (or entremêlé) = **Bicolore**. Tel fournisseur 13957921131. |
| J                      | YI WU U.N.K (优妮珂饰品厂)    | Bon traité 2026-06-12 (11 produits). Format **très différent** : pas de colonne 品名/颜色/数量 séparée. Tout empilé dans la cellule **客人条码** au format `<ref-fullRef>\n1.<colorZh>：<qty><unit>\n2.<colorZh>：<qty><unit>...` (séparateur fullwidth `：`, unités 对/条/个). En-têtes attendus : `编号 / 箱号 / 图片 / 客人条码 / 打数 / 单位 / 总数量 / 单价 / 总金额 / 箱规`. Parse-po.cjs **ne gère pas ce format** — utiliser le script ad-hoc dans `C:/Users/Admin/AppData/Local/Temp/parse-J-adhoc.cjs` (à intégrer dans parse-po.cjs comme branche conditionnelle). Catégories absentes du bon → toujours overrides cliente. Couleurs « échantillon » et « n° » : 样色蓝 = Bleu, 白色珍珠 = Blanc, 样色 = Écru, 1号红色 = Rouge, 9号粉色 = Rose, 12号蓝色 = Bleu. |
| ZK                     | 凯西钢饰 (Kaixi Gangshi) C2-4461 — tél 18606896632 | Bon traité 2026-06-13 (7 produits). Format **sans colonne couleur** (juste 箱号 / 货号 / 图片 / 品名 / 装箱数/PCS / 单价/PCS / 金额 / 箱规). En-tête ligne 4. Alias ajoutés : `装箱数/pcs` (qty), `单价/pcs` (price). Parseur rendu tolérant à l'absence de 颜色 → la cliente fournit les couleurs par produit (et la composition) au moment de la génération, stock réparti à parts égales par couleur. Nouvelle composition vue : **« Laiton:50,Acier inoxydable:50 »** (moitié laiton / moitié inox). |
| ZC                     | Yachan (雅婵饰品)              | Bon traité 2026-06-18 (44 produits, 74 lignes). Format **deux niveaux de couleur** : colonne `电镀颜色` = plating (16K/14K炉内真金 → Doré, 钢色 → Argent) ; colonne `说明` = sous-couleurs avec qty (« 白143，粉71，蓝50，彩73 » → 4 variantes). Règle confirmée 2026-06-18 : si `说明` rempli avec sous-couleurs, **chaque sous-couleur devient une variante** (qty = chiffre suivant) ; si `说明` vide ou texte non-couleur (« 不滴油 »), 1 variante = couleur de plating. Référence dans la colonne `客户编号` (ZC72-660-300 → ref = ZC72). Catégorie dans `品名`. Parseur dédié : `parse-po-zc.cjs`. Fusion auto Doré 14K + Doré 16K. |

> Ajouter chaque nouveau fournisseur découvert (ZC, etc.).

---

## Champs Excel — valeurs par défaut connues

Ces valeurs ont été validées dans `scripts/generate-import-hors-ligne.js`. À reprendre tant que la cliente ne demande pas autre chose.

| Champ                  | Valeur par défaut                 | À confirmer ?                          |
|------------------------|-----------------------------------|----------------------------------------|
| `composition`          | `Acier inoxydable:100`            | Oui si nouveau fournisseur             |
| `pays_fabrication`     | `Chine`                           | Oui si nouveau fournisseur             |
| `saison`               | `Toutes saisons`                  | Oui si nouveau fournisseur             |
| `taille_unique_details`| `0` (placeholder)                 | À demander par produit ?               |
| `sale_type`            | `UNIT`                            | Oui si pack                             |
| `best_seller`          | `false`                           | OK                                     |
| `stock`                | quantité réelle du bon (`数量`)   | OK — utilise la valeur réelle du bon   |
| `hs_code`              | vide                              | Vide par défaut (générique tous types) |

### Nom + description du produit

Le script utilise des phrases génériques par catégorie (cf. `generate-import-hors-ligne.js`).
Ces phrases peuvent être améliorées plus tard via le skill `produits-nom`.

| Catégorie           | Nom généré                                | Description générée                                                                                          |
|---------------------|-------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| Boucles d'oreilles  | Boucles d'oreilles en acier inoxydable     | Boucles d'oreilles en acier inoxydable, hypoallergéniques et résistantes à l'eau. […]                         |
| Colliers            | Collier en acier inoxydable                | Collier en acier inoxydable, hypoallergénique et résistant à l'eau. […]                                       |
| Bagues              | Bague en acier inoxydable                  | Bague en acier inoxydable, hypoallergénique et résistante à l'eau. […]                                        |
| Bracelets           | Bracelet en acier inoxydable               | Bracelet en acier inoxydable, hypoallergénique et résistant à l'eau. […]                                       |

---

## Règle d'extraction prix depuis la référence (peu fiable)

Format souvent rencontré : `A2235-1118-520` → ref = `A2235`, dernière partie `520` ≈ prix `5.20€`.

⚠️ **En pratique**, la colonne `价格` (« jiage ») du bon de commande donne le **vrai prix**, parfois différent de ce qui est codé dans la référence (le prix peut avoir changé). **Toujours privilégier `价格`** si présente. Garder la règle d'extraction depuis la référence comme fallback uniquement si pas de colonne prix.

---

## Règle d'extraction référence

`货号` (« huohao ») du bon = la référence complète (ex: `A2493-448-280`).
**Référence produit côté site** = première partie avant le premier `-` → `A2493`.
Le suffixe `A` (ex: `A2518A`) fait partie de la référence (variante du même ensemble) — à garder tel quel.

---

## Règle 返单 (« fandan »)

Si la cellule `品名` contient `返单` (souvent sous la forme `耳环\r\n返单`) → ce produit **existe déjà** sur le site, donc :

- **NE PAS** l'inclure dans l'Excel d'import
- **LISTER la référence** dans la sortie pour la cliente (« références déjà présentes — à ignorer »)
