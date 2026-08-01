import { describe, it, expect } from "vitest";
import {
  isPushSupportedLotB,
  isPullSupportedLotB,
  isFieldSupportedLotB,
  issueKey,
  extractDimensionsFromPfs,
} from "@/lib/pfs-verify-apply";
import type { PfsVerifyIssue } from "@/lib/pfs-verify";

describe("pfs-verify-apply — support checks (Lot B)", () => {
  it("supporte les champs produit simples des deux côtés", () => {
    for (const f of ["name", "description", "dimensions", "isBestSeller", "productStatus"]) {
      expect(isPushSupportedLotB("product", f)).toBe(true);
      expect(isPullSupportedLotB("product", f)).toBe(true);
      expect(isFieldSupportedLotB("product", f)).toBe(true);
    }
  });

  it("supporte le PULL composition (ajouté 2026-08-01 — pull auto via API admin PFS + resolvePfsCompositionsToLocal)", () => {
    expect(isPushSupportedLotB("product", "composition")).toBe(true);
    expect(isPullSupportedLotB("product", "composition")).toBe(true);
    expect(isFieldSupportedLotB("product", "composition")).toBe(true);
  });

  it("supporte les champs variante simples (prix / stock / poids / actif)", () => {
    for (const f of ["price", "stock", "weight", "isActive"]) {
      expect(isPushSupportedLotB("color", f)).toBe(true);
      expect(isPullSupportedLotB("color", f)).toBe(true);
    }
  });

  it("autorise l'ENVOI pour pays/saison/genre/catégorie/famille (push OK), mais BLOQUE la récupération (pull KO — Lot C restant)", () => {
    for (const f of ["country", "season", "gender", "category", "family"]) {
      expect(isPushSupportedLotB("product", f)).toBe(true);
      expect(isPullSupportedLotB("product", f)).toBe(false);
    }
  });

  it("accepte les 2 actions structurelles sur variante (missing/extra) — introduites 2026-07-24", () => {
    for (const f of ["missingVariant", "extraVariant"]) {
      // Push et pull sont supportés : la modale d'écarts propose désormais
      // « Ajouter/Retirer sur PFS » et « Ajouter/Retirer chez nous ».
      expect(isPushSupportedLotB("color", f)).toBe(true);
      expect(isPullSupportedLotB("color", f)).toBe(true);
    }
  });

  it("refuse toujours saleType (changement de type de vente non automatisé)", () => {
    expect(isPushSupportedLotB("color", "saleType")).toBe(false);
    expect(isPullSupportedLotB("color", "saleType")).toBe(false);
  });
});

describe("pfs-verify-apply — issueKey", () => {
  it("génère une clé stable pour un écart produit", () => {
    const iss: PfsVerifyIssue = {
      scope: "product",
      field: "name",
      fieldLabel: "Nom",
      pfsValue: "Ancien",
      expectedValue: "Nouveau",
    };
    expect(issueKey(iss)).toBe("product:name::");
  });

  it("génère une clé stable pour un écart variante (couleur + type)", () => {
    const iss: PfsVerifyIssue = {
      scope: "color",
      field: "price",
      fieldLabel: "Prix",
      colorRef: "ROSE",
      variantType: "UNIT",
      pfsValue: "10 €",
      expectedValue: "12 €",
    };
    expect(issueKey(iss)).toBe("color:price:ROSE:UNIT");
  });

  it("génère des clés distinctes pour la même couleur mais deux types de vente", () => {
    const unit: PfsVerifyIssue = {
      scope: "color", field: "price", fieldLabel: "Prix",
      colorRef: "ROSE", variantType: "UNIT",
      pfsValue: null, expectedValue: null,
    };
    const pack: PfsVerifyIssue = {
      scope: "color", field: "price", fieldLabel: "Prix",
      colorRef: "ROSE", variantType: "PACK",
      pfsValue: null, expectedValue: null,
    };
    expect(issueKey(unit)).not.toBe(issueKey(pack));
  });
});

describe("pfs-verify-apply — extractDimensionsFromPfs", () => {
  it("parse un suffixe complet 'Longueur / Largeur / Hauteur / Diamètre / Circonférence'", () => {
    const desc =
      "Bracelet doré fin en laiton.\n\n" +
      "Dimensions : Longueur : 180mm / Largeur : 5mm / Hauteur : 2mm / Diamètre : 60mm / Circonférence : 190mm";
    const d = extractDimensionsFromPfs(desc);
    expect(d).toEqual({
      length: 180,
      width: 5,
      height: 2,
      diameter: 60,
      circumference: 190,
    });
  });

  it("retourne tout à null si la section « Dimensions : » est absente", () => {
    const d = extractDimensionsFromPfs("Une description sans dimensions.");
    expect(d).toEqual({
      length: null,
      width: null,
      height: null,
      diameter: null,
      circumference: null,
    });
  });

  it("tolère les décimales avec virgule et l'accent absent sur diamètre", () => {
    const desc = "Dimensions : Longueur : 12,5mm / Diametre : 3mm";
    const d = extractDimensionsFromPfs(desc);
    expect(d.length).toBe(12.5);
    expect(d.diameter).toBe(3);
    expect(d.width).toBeNull();
  });
});
