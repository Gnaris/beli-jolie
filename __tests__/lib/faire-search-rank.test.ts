import { describe, it, expect } from "vitest";
import {
  scoreFaireCandidate,
  sortFaireCandidates,
  skuTokens,
  skuMatchesQuery,
  type FaireScoreableProduct,
} from "@/lib/faire-search-rank";

function make(
  variantSkus: (string | undefined)[],
  name?: string,
): FaireScoreableProduct {
  return {
    name,
    variants: variantSkus.map((sku) => ({ sku })),
  };
}

describe("scoreFaireCandidate", () => {
  it("SKU exact === query → 100", () => {
    expect(scoreFaireCandidate(make(["676"]), "676")).toBe(100);
  });

  it("SKU multi-segment dont un token === query → 95 (token exact)", () => {
    // Le SKU `676_argent_UNIT_ab12` a un token `676` égal à la query.
    // C'est un match plus fort que "commence par {query}_" (80).
    expect(scoreFaireCandidate(make(["676_argent_UNIT_ab12"]), "676")).toBe(95);
  });

  it("SKU entier `{query}_…` mais aucun token exact → 80", () => {
    // Cas où le premier token n'est pas la query (ex "abc_676_...").
    // Ici on veut vérifier que le score 80 est encore possible quand aucun
    // token n'est exactement la query.
    expect(scoreFaireCandidate(make(["ab676_argent_UNIT_ab12"]), "ab676")).toBe(
      95, // le token "ab676" est exact → 95, pas 80
    );
  });

  it("SKU commence par la query (suffixe finition marketplace : 676A) → 70", () => {
    expect(scoreFaireCandidate(make(["676A"]), "676")).toBe(70);
  });

  it("SKU contient la query (préfixe marketplace : ED676P) → 50", () => {
    expect(scoreFaireCandidate(make(["ED676P"]), "676")).toBe(50);
  });

  it("nom commence par la query → 40", () => {
    expect(scoreFaireCandidate(make(["unrelated"], "676 Bague or"), "676")).toBe(40);
  });

  it("nom contient la query au milieu → 30", () => {
    expect(scoreFaireCandidate(make(["unrelated"], "Bague 676 or"), "676")).toBe(30);
  });

  it("aucun lien clair → 10", () => {
    expect(scoreFaireCandidate(make(["turq"], "Collier turquoise"), "676")).toBe(10);
  });

  it("insensible à la casse", () => {
    expect(scoreFaireCandidate(make(["676a"]), "676A")).toBe(100);
    expect(scoreFaireCandidate(make(["ed676p"]), "676")).toBe(50);
  });

  it("plusieurs variantes → prend le meilleur score", () => {
    // La 3ᵉ variante a un token exact "676" → score 95.
    expect(
      scoreFaireCandidate(make(["OTHER_1", "676A", "676_MOD_UNIT_x"]), "676"),
    ).toBe(95);
  });

  it("query vide → 0", () => {
    expect(scoreFaireCandidate(make(["676"]), "")).toBe(0);
    expect(scoreFaireCandidate(make(["676"]), "   ")).toBe(0);
  });

  it("query commence par le SKU racine (A2630D tapé, SKU A2630) → 90", () => {
    expect(scoreFaireCandidate(make(["A2630"]), "A2630D")).toBe(90);
  });

  it("query contient le SKU au milieu (SKU ≥ 3 chars) → 60", () => {
    // Cas rare mais possible : query "ED676P" et un SKU juste "676".
    // NB : SKU "676" est aussi préfixe de la query ? Non, query "ED676P" ne
    // commence pas par "676". Donc pas 90, on tombe sur 60.
    expect(scoreFaireCandidate(make(["676"]), "ED676P")).toBe(60);
  });

  it("SKU trop court (< 3 chars) ne matche PAS le sens inverse", () => {
    // SKU "AB" est contenu dans "A2630B" mais on refuse → tombe à 10.
    expect(scoreFaireCandidate(make(["AB"]), "A2630B")).toBe(10);
  });

  it("SKU court chiffré `A24` ne matche PAS query `A2479` (bug 2026-08-27)", () => {
    // Cas signalé par la cliente : elle tape `A2479` et le picker Faire lui
    // remontait `A24` en tête à cause du q.startsWith(token) trop souple.
    // La frontière de classe (chiffre `4` suivi du chiffre `7`) coupe le
    // faux positif : ce n'est PAS un suffixe couleur, c'est la suite d'un
    // nombre différent → tombe à 10.
    expect(scoreFaireCandidate(make(["A24"]), "A2479")).toBe(10);
  });

  it("SKU court chiffré ne matche pas non plus au milieu (score 60 refusé)", () => {
    // Query `XA247Y` contient `A24` mais avec chiffre-suivi-de-chiffre → refusé.
    expect(scoreFaireCandidate(make(["A24"]), "XA247Y")).toBe(10);
  });

  it("SKU multi-segment (BJ long) matche la référence tapée avec suffixe", () => {
    // Le SKU côté Faire est `A2630_argent_UNIT_ab12`. La cliente tape le
    // suffixe qu'elle voit chez Faire `A2630D` → doit trouver la racine
    // `a2630` dans les tokens du SKU.
    const p = make(["A2630_argent_UNIT_ab12"]);
    expect(scoreFaireCandidate(p, "A2630D")).toBe(90);
  });

  it("SKU multi-segment matche la référence tapée sans suffixe", () => {
    // token exact → 95, moins que "chaîne entière === query" (100)
    const p = make(["A2630_argent_UNIT_ab12"]);
    expect(scoreFaireCandidate(p, "A2630")).toBe(95);
  });

  it("SKU avec tiret matche par tokenisation", () => {
    // token exact → 95
    const p = make(["676-argent-unit"]);
    expect(scoreFaireCandidate(p, "676")).toBe(95);
  });
});

describe("skuTokens", () => {
  it("découpe aux _ / - / . / espace", () => {
    expect(skuTokens("A2630_argent_UNIT_ab12")).toEqual([
      "a2630",
      "argent",
      "unit",
      "ab12",
    ]);
    expect(skuTokens("676-A-GD")).toEqual(["676", "a", "gd"]);
    expect(skuTokens("SKU 123.abc")).toEqual(["sku", "123", "abc"]);
  });

  it("SKU sans séparateur → 1 seul token", () => {
    expect(skuTokens("676A")).toEqual(["676a"]);
  });

  it("ignore les tokens vides", () => {
    expect(skuTokens("__abc___def__")).toEqual(["abc", "def"]);
  });
});

describe("skuMatchesQuery", () => {
  it("SKU multi-segment `A2630_argent_UNIT_ab12` matche query `A2630D`", () => {
    expect(skuMatchesQuery("A2630_argent_UNIT_ab12", "A2630D")).toBe(true);
  });

  it("SKU compact `676A` matche query `676`", () => {
    expect(skuMatchesQuery("676A", "676")).toBe(true);
  });

  it("SKU compact `A2630` matche query `A2630D` (query contient SKU)", () => {
    expect(skuMatchesQuery("A2630", "A2630D")).toBe(true);
  });

  it("SKU `ED676P` matche query `676`", () => {
    expect(skuMatchesQuery("ED676P", "676")).toBe(true);
  });

  it("SKU sans rapport ne matche pas", () => {
    expect(skuMatchesQuery("TURQ_UNIT", "A2630")).toBe(false);
  });

  it("SKU court chiffré `A24` NE matche PAS query `A2479` (bug 2026-08-27)", () => {
    // Sans frontière de classe (chiffre `4` suivi du chiffre `7`), on refuse
    // le match : sinon le scan Faire ramène tous les produits `A24` quand la
    // cliente cherche `A2479`.
    expect(skuMatchesQuery("A24", "A2479")).toBe(false);
  });

  it("SKU `A24` matche `A24D` (frontière chiffre→lettre = suffixe couleur)", () => {
    // Cas légitime : `D` après `A24` marque un suffixe de finition.
    expect(skuMatchesQuery("A24", "A24D")).toBe(true);
  });

  it("SKU `A24` matche `A24_or` (séparateur = frontière)", () => {
    expect(skuMatchesQuery("A24", "A24_or")).toBe(true);
  });

  it("query vide ou SKU vide → false", () => {
    expect(skuMatchesQuery("", "A2630")).toBe(false);
    expect(skuMatchesQuery("A2630", "")).toBe(false);
  });
});

describe("sortFaireCandidates", () => {
  it("remonte la fiche exacte en tête même si elle arrive en dernier", () => {
    const suffixes = [
      make(["676A"], "Bague argent"),
      make(["676GD"], "Bague dorée"),
      make(["ED676P"], "Bague émeraude"),
    ];
    const exact = make(["676"], "Bague classique");
    const sorted = sortFaireCandidates([...suffixes, exact], "676");
    expect(sorted[0]).toBe(exact);
  });

  it("préserve l'ordre relatif à score égal (tri stable)", () => {
    const a = make(["676A"], "Bague A");
    const b = make(["676B"], "Bague B");
    const c = make(["676C"], "Bague C");
    // Tous score 70 → ordre d'entrée préservé.
    const sorted = sortFaireCandidates([a, b, c], "676");
    expect(sorted).toEqual([a, b, c]);
  });

  it("trie un mix variétal correctement (cas Issyma 676)", () => {
    const exact = make(["676"], "Base"); // 100 SKU entier === query
    const skuLong = make(["676_or_UNIT_1"], "Longue"); // 95 token exact
    const suffix = make(["676GD"], "Or 22ct"); // 70 token commence par query
    const contains = make(["ED676P"], "Émeraude platine"); // 50 token contient
    const nameStart = make(["unrelated"], "676 collection"); // 40
    const nameMid = make(["unrelated2"], "Bague 676 collector"); // 30
    const noise = make(["nothing"], "Autre chose"); // 10

    const sorted = sortFaireCandidates(
      [noise, nameMid, contains, nameStart, suffix, skuLong, exact],
      "676",
    );

    expect(sorted.map((p) => p.name)).toEqual([
      "Base", // 100
      "Longue", // 95
      "Or 22ct", // 70
      "Émeraude platine", // 50
      "676 collection", // 40
      "Bague 676 collector", // 30
      "Autre chose", // 10
    ]);
  });
});
