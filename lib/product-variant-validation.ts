/**
 * Validation des variantes produit (UNIT, PACK mono-couleur, PACK multi-couleurs).
 *
 * Extrait de `app/actions/admin/products.ts` : un fichier "use server" ne peut exporter
 * que des fonctions async, donc cette logique synchrone vit ici. Le module est appelé
 * depuis les server actions et depuis les tests Vitest.
 *
 * NB : pour `dbId` fourni (variante existante), `updateProduct()` ignore les champs
 * `colorId / saleType / packQuantity / sizeEntries / packLines` envoyés par le client
 * et conserve les valeurs en base. Ces champs sont verrouillés en UI dans
 * `ColorVariantManager.tsx` (raison : compatibilité avec les marketplaces qui
 * n'autorisent pas leur modification après publication).
 */

export interface SizeEntryInput {
  sizeId: string;
  quantity: number;
  pricePerUnit?: number; // PACK only — prix par unité pour cette taille
}

export interface PackLineInput {
  colorId: string;
  sizeEntries: SizeEntryInput[];
  /** Mapping PFS secondaire propre à cette ligne dans ce pack. null/undefined = utilise le principal. */
  pfsColorRefOverride?: string | null;
  /** Mapping eFashion secondaire propre à cette ligne dans ce pack. */
  efashionColorIdOverride?: number | null;
  /** Override du nom envoyé à Ankorstore pour cette ligne. null/vide = Color.name. */
  ankorsColorNameOverride?: string | null;
  /** Override du nom envoyé à Faire pour cette ligne. null/vide = Color.name. */
  faireColorNameOverride?: string | null;
}

export interface ColorInput {
  dbId?: string;
  colorId: string | null; // Couleur (ou 1ère couleur du pack multi-couleurs)
  unitPrice: number;
  weight: number;
  stock: number;
  isPrimary: boolean;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  sizeEntries: SizeEntryInput[]; // Tailles (UNIT ou PACK mono-couleur)
  /** PACK multi-couleurs : si présent, supplante sizeEntries pour la composition. */
  packLines?: PackLineInput[];
  disabled?: boolean;
  /** Mapping PFS secondaire propre à cette variante. null/undefined = utilise le principal. */
  pfsColorRefOverride?: string | null;
  /** Mapping eFashion secondaire propre à cette variante. */
  efashionColorIdOverride?: number | null;
  /** Override du nom envoyé à Ankorstore pour cette variante. null/vide = Color.name. */
  ankorsColorNameOverride?: string | null;
  /** Override du nom envoyé à Faire pour cette variante. null/vide = Color.name. */
  faireColorNameOverride?: string | null;
}

export function isMultiColorPackInput(c: ColorInput): boolean {
  return c.saleType === "PACK" && Array.isArray(c.packLines) && c.packLines.length > 0;
}

/**
 * Garde-fous bornes numériques (AUDIT 2026-05-29 — point [7]).
 *
 * Sans ces vérifications, le formulaire produit acceptait sans broncher un
 * prix de -50€, un stock de -10, un poids négatif, une quantité de pack
 * négative — autant de portes ouvertes à des produits affichés à perte ou
 * à un auto-archivage cassé si un signe « - » se collait par mégarde.
 */
function assertNonNegativeFinite(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} doit être un nombre.`);
  }
  if (value < 0) {
    throw new Error(`${label} ne peut pas être négatif.`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} doit être un nombre entier.`);
  }
  if (value < 0) {
    throw new Error(`${label} ne peut pas être négatif.`);
  }
}

/**
 * Garde-fous champs produit (remise %, etc.). Appelée en tête de
 * `createProduct` / `updateProduct`. Cf. AUDIT [7].
 */
export function validateProductFields(input: {
  discountPercent: number | null;
}): void {
  const d = input.discountPercent;
  if (d == null) return;
  if (typeof d !== "number" || !Number.isFinite(d)) {
    throw new Error("La remise produit doit être un nombre.");
  }
  if (d < 0 || d > 100) {
    throw new Error("La remise produit doit être comprise entre 0 et 100 %.");
  }
}

/**
 * Bornes numériques sur les variantes — toujours appliquées, y compris en
 * brouillon. Refuse prix/stock/poids/quantités négatifs avant que les
 * données ne touchent la BDD.
 */
export function validateVariantBounds(colors: ColorInput[]): void {
  for (const c of colors) {
    assertNonNegativeFinite(c.unitPrice, "Le prix d'une variante");
    assertNonNegativeFinite(c.weight, "Le poids d'une variante");
    assertNonNegativeInteger(c.stock, "Le stock d'une variante");
    for (const se of c.sizeEntries) {
      assertNonNegativeInteger(se.quantity, "La quantité d'une taille");
      if (se.pricePerUnit != null) {
        assertNonNegativeFinite(se.pricePerUnit, "Le prix par unité");
      }
    }
    for (const pl of c.packLines ?? []) {
      for (const se of pl.sizeEntries) {
        assertNonNegativeInteger(se.quantity, "La quantité d'une taille du pack");
      }
    }
  }
}

export function validateVariants(colors: ColorInput[]): void {
  // Bornes numériques d'abord (refuse les négatifs avant toute autre vérif).
  validateVariantBounds(colors);

  // Empêche les vrais doublons (composition strictement identique, quantités comprises).
  // Plusieurs paquets avec mêmes couleurs/tailles mais quantités différentes restent autorisés
  // (ex : produit ayant un grand paquet "complet" + un petit paquet "découverte").
  const seenGroups = new Map<string, boolean>();
  for (const c of colors) {
    if (!c.colorId) throw new Error("Chaque variante doit avoir une couleur.");
    let groupKey: string;
    if (isMultiColorPackInput(c)) {
      const lineKey = (c.packLines ?? [])
        .map((l) => {
          const sizeKey = [...l.sizeEntries]
            .sort((a, b) => a.sizeId.localeCompare(b.sizeId))
            .map((s) => `${s.sizeId}:${s.quantity}`)
            .join(",");
          return `${l.colorId}:[${sizeKey}]`;
        })
        .sort()
        .join("|");
      groupKey = `PACK::MULTI::${lineKey}`;
    } else {
      const sizeKey = [...c.sizeEntries]
        .sort((a, b) => a.sizeId.localeCompare(b.sizeId))
        .map((se) => `${se.sizeId}:${se.quantity}`)
        .join(",");
      groupKey = `${c.saleType}::${c.colorId}::${sizeKey}`;
    }
    if (seenGroups.has(groupKey)) {
      throw new Error("Deux variantes ne peuvent pas être strictement identiques (mêmes couleurs, tailles ET quantités).");
    }
    seenGroups.set(groupKey, true);
  }

  for (const c of colors) {
    if (c.saleType === "PACK") {
      if (c.packQuantity == null || c.packQuantity < 1) {
        throw new Error("Un paquet doit avoir une quantité d'au moins 1.");
      }
      if (isMultiColorPackInput(c)) {
        // Chaque ligne couleur doit avoir au moins une taille avec qty > 0, et pas de doublon couleur/size.
        // Règle PFS : toutes les couleurs du paquet doivent avoir EXACTEMENT le même
        // ensemble de tailles (les quantités peuvent différer).
        const seenColors = new Set<string>();
        let referenceSizeSet: string | null = null;
        for (const line of c.packLines ?? []) {
          if (!line.colorId) throw new Error("Chaque ligne d'un pack multi-couleurs doit avoir une couleur.");
          if (seenColors.has(line.colorId)) {
            throw new Error("Une couleur ne peut apparaître qu'une seule fois dans un pack multi-couleurs.");
          }
          seenColors.add(line.colorId);
          if (!line.sizeEntries || line.sizeEntries.length < 1) {
            throw new Error("Chaque couleur d'un pack multi-couleurs doit avoir au moins une taille.");
          }
          const seenSizes = new Set<string>();
          for (const se of line.sizeEntries) {
            if (!se.sizeId) throw new Error("Une taille du pack est invalide.");
            if (seenSizes.has(se.sizeId)) {
              throw new Error("Une même taille apparaît deux fois pour une couleur du pack.");
            }
            seenSizes.add(se.sizeId);
            if (!se.quantity || se.quantity < 1) {
              throw new Error("Chaque taille du pack doit avoir une quantité d'au moins 1.");
            }
          }
          const sortedSizeKey = [...seenSizes].sort().join(",");
          if (referenceSizeSet === null) {
            referenceSizeSet = sortedSizeKey;
          } else if (referenceSizeSet !== sortedSizeKey) {
            throw new Error("Toutes les couleurs d'un paquet multi-couleurs doivent avoir les mêmes tailles (les quantités peuvent différer).");
          }
        }
      } else if (!c.sizeEntries || c.sizeEntries.length < 1) {
        throw new Error("Un paquet doit avoir au moins une taille.");
      }
    }
    if (c.saleType === "UNIT" && c.sizeEntries.length > 1) {
      throw new Error("Une variante à l'unité ne peut avoir qu'une seule taille.");
    }
  }
}
