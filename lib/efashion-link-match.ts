/**
 * Logique pure de matching pour la liaison en masse eFashion.
 *
 * Pas d'I/O ici : on prend l'état du produit BJ + la liste des candidats
 * eFashion déjà filtrés par reference_base, et on rend une décision :
 *   - linked : on peut auto-lier, voici les liens à poser
 *   - skipped_no_unit : produit 100% paquet, eFashion ne gère pas
 *   - skipped_missing_attrs : attributs (catégorie/pays/saison/composition/
 *     couleur) sans mapping eFashion
 *   - skipped_no_match : 0 candidat trouvé chez eFashion
 *   - skipped_ambiguous : couleurs orphelines/ambiguës d'un côté ou de l'autre
 *
 * Utilisé par scripts/efashion-link-all.ts et testable indépendamment.
 */

export interface EfashionMatchProduct {
  id: string;
  reference: string;
  category: { name: string; efashionCategorieId: number | null } | null;
  // Pays de fabrication déjà résolu via lib/countries.ts par l'appelant
  // (name = libellé FR affiché dans les messages d'erreur, efashionProvenanceId
  // = mapping marketplace figé).
  country: { name: string; efashionProvenanceId: number | null } | null;
  season: { name: string; efashionCollectionId: number | null } | null;
  compositions: Array<{ composition: { name: string; efashionId: number | null } }>;
  colors: Array<{
    saleType: "UNIT" | "PACK";
    color: { id: string; name: string; efashionColorId: number | null } | null;
  }>;
}

export interface EfashionMatchCandidate {
  id_produit: number;
  id_couleur: number;
  couleur: string;
  reference_base: string;
}

export type EfashionMatchDecision =
  | {
      status: "linked";
      referenceBase: string;
      links: Array<{
        localColorId: string;
        efashionProductId: number;
        efashionColorId: number;
      }>;
    }
  | { status: "skipped_no_unit" }
  | { status: "skipped_missing_attrs"; reasons: string[] }
  | { status: "skipped_no_match"; referenceBase: string }
  | { status: "skipped_ambiguous"; referenceBase: string; reason: string };

export function normalizeEfashionColorName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function computeEfashionReferenceBase(reference: string): string {
  return (reference.split(/[-_]/)[0] ?? reference).trim();
}

export function decideEfashionLink(
  product: EfashionMatchProduct,
  candidates: EfashionMatchCandidate[],
): EfashionMatchDecision {
  // 1) Couleurs UNIT du produit (dédupliquées par color.id)
  const unitColors = new Map<
    string,
    { colorId: string; colorName: string; efashionColorId: number | null; norm: string }
  >();
  for (const pc of product.colors) {
    if (pc.saleType !== "UNIT" || !pc.color) continue;
    if (unitColors.has(pc.color.id)) continue;
    unitColors.set(pc.color.id, {
      colorId: pc.color.id,
      colorName: pc.color.name,
      efashionColorId: pc.color.efashionColorId,
      norm: normalizeEfashionColorName(pc.color.name),
    });
  }
  if (unitColors.size === 0) {
    return { status: "skipped_no_unit" };
  }

  // 2) Attributs eFashion manquants
  const reasons: string[] = [];
  if (!product.category?.efashionCategorieId) {
    reasons.push(
      `Catégorie « ${product.category?.name ?? "(vide)"} » sans mapping eFashion`,
    );
  }
  if (!product.country?.efashionProvenanceId) {
    reasons.push(
      `Pays « ${product.country?.name ?? "(vide)"} » sans mapping eFashion`,
    );
  }
  if (!product.season?.efashionCollectionId) {
    reasons.push(`Saison « ${product.season?.name ?? "(vide)"} » sans mapping eFashion`);
  }
  if (product.compositions.length === 0) {
    reasons.push("Aucune matière renseignée");
  } else {
    for (const pc of product.compositions) {
      if (!pc.composition.efashionId) {
        reasons.push(`Matière « ${pc.composition.name} » sans mapping eFashion`);
      }
    }
  }
  for (const uc of unitColors.values()) {
    if (!uc.efashionColorId) {
      reasons.push(`Couleur « ${uc.colorName} » sans mapping eFashion`);
    }
  }
  if (reasons.length > 0) {
    return { status: "skipped_missing_attrs", reasons };
  }

  // 3) reference_base
  const referenceBase = computeEfashionReferenceBase(product.reference);

  // 4) Filtre strict sur les candidats (la liste eFashion peut contenir des
  //    références partielles, ex : "A21" remonte aussi "A210", "A2100"…)
  const needle = referenceBase.toLowerCase();
  const strictCandidates = candidates.filter(
    (c) => c.reference_base.toLowerCase().trim() === needle,
  );

  if (strictCandidates.length === 0) {
    return { status: "skipped_no_match", referenceBase };
  }

  // 5) Matching couleur par couleur — un seul candidat possible par couleur BJ
  const links: Array<{
    localColorId: string;
    efashionProductId: number;
    efashionColorId: number;
  }> = [];
  const usedEfIds = new Set<number>();

  for (const uc of unitColors.values()) {
    const matches = strictCandidates.filter(
      (c) => normalizeEfashionColorName(c.couleur) === uc.norm,
    );
    if (matches.length === 0) {
      return {
        status: "skipped_ambiguous",
        referenceBase,
        reason: `Couleur « ${uc.colorName} » sans équivalent chez eFashion`,
      };
    }
    if (matches.length > 1) {
      return {
        status: "skipped_ambiguous",
        referenceBase,
        reason: `Couleur « ${uc.colorName} » correspond à ${matches.length} lignes eFashion (ambigu)`,
      };
    }
    const m = matches[0];
    if (usedEfIds.has(m.id_produit)) {
      return {
        status: "skipped_ambiguous",
        referenceBase,
        reason: `Ligne eFashion ${m.id_produit} référencée par 2 couleurs BJ`,
      };
    }
    usedEfIds.add(m.id_produit);
    links.push({
      localColorId: uc.colorId,
      efashionProductId: m.id_produit,
      efashionColorId: m.id_couleur,
    });
  }

  // 6) Aucune ligne eFashion ne doit rester orpheline
  const orphans = strictCandidates.filter((c) => !usedEfIds.has(c.id_produit));
  if (orphans.length > 0) {
    return {
      status: "skipped_ambiguous",
      referenceBase,
      reason:
        `${orphans.length} ligne(s) eFashion sans équivalent chez vous : ` +
        orphans.map((c) => c.couleur).join(", "),
    };
  }

  return { status: "linked", referenceBase, links };
}
