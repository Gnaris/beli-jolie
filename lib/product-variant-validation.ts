/**
 * Validation des variantes produit (UNIT, PACK mono-couleur, PACK multi-couleurs).
 *
 * Extrait de `app/actions/admin/products.ts` : un fichier "use server" ne peut exporter
 * que des fonctions async, donc cette logique synchrone vit ici. Le module est appelé
 * depuis les server actions et depuis les tests Vitest.
 */

export interface SizeEntryInput {
  sizeId: string;
  quantity: number;
  pricePerUnit?: number; // PACK only — prix par unité pour cette taille
}

export interface PackLineInput {
  colorId: string;
  sizeEntries: SizeEntryInput[];
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
}

export function isMultiColorPackInput(c: ColorInput): boolean {
  return c.saleType === "PACK" && Array.isArray(c.packLines) && c.packLines.length > 0;
}

export function validateVariants(colors: ColorInput[]): void {
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
