import { describe, it, expect } from "vitest";

/**
 * Tests for quick-create PFS mapping field extraction logic.
 * Tests the pure logic used in the MissingEntitiesPanel to build
 * PFS body fields from selected mappings.
 */

interface PfsCategory {
  id: string;
  family: { id: string } | string;
  labels: Record<string, string>;
  gender: string;
}

interface MissingEntity {
  type: "category" | "color" | "subcategory" | "composition" | "country" | "season";
  name: string;
  usedBy: number;
  parentCategoryName?: string;
}

// Mirrors getPfsFields logic from MissingEntitiesPanel (after removal of color refs)
function getPfsFields(
  entity: MissingEntity,
  pfsCategoryIds: Record<string, string>,
  pfsCompositionRefs: Record<string, string>,
  pfsCountryRefs: Record<string, string>,
  pfsSeasonRefs: Record<string, string>,
  pfsCategories: PfsCategory[],
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (entity.type === "category" && pfsCategoryIds[entity.name]) {
    const catId = pfsCategoryIds[entity.name];
    fields.pfsCategoryId = catId;
    const pfsCat = pfsCategories.find((c) => c.id === catId);
    if (pfsCat) {
      fields.pfsGender = pfsCat.gender;
      const familyId = typeof pfsCat.family === "string" ? pfsCat.family : pfsCat.family?.id;
      if (familyId) fields.pfsFamilyId = familyId;
    }
  }
  if (entity.type === "composition" && pfsCompositionRefs[entity.name]) {
    fields.pfsCompositionRef = pfsCompositionRefs[entity.name];
  }
  if (entity.type === "country" && pfsCountryRefs[entity.name]) {
    fields.pfsCountryRef = pfsCountryRefs[entity.name];
  }
  if (entity.type === "season" && pfsSeasonRefs[entity.name]) {
    fields.pfsRef = pfsSeasonRefs[entity.name];
  }
  return fields;
}

describe("getPfsFields — PFS mapping field extraction", () => {
  const pfsCategories: PfsCategory[] = [
    { id: "cat-001", family: { id: "fam-001" }, labels: { fr: "Bijoux" }, gender: "WOMAN" },
    { id: "cat-002", family: { id: "fam-002" }, labels: { fr: "Textiles" }, gender: "MAN" },
  ];

  it("returns empty object for a color entity (colors no longer mapped to PFS)", () => {
    const entity: MissingEntity = { type: "color", name: "Doré", usedBy: 3 };
    const result = getPfsFields(entity, {}, {}, {}, {}, pfsCategories);
    expect(result).toEqual({});
  });

  it("returns pfsCategoryId + pfsGender + pfsFamilyId for a category entity with mapping", () => {
    const entity: MissingEntity = { type: "category", name: "Bijoux", usedBy: 5 };
    const result = getPfsFields(entity, { Bijoux: "cat-001" }, {}, {}, {}, pfsCategories);
    expect(result).toEqual({
      pfsCategoryId: "cat-001",
      pfsGender: "WOMAN",
      pfsFamilyId: "fam-001",
    });
  });

  it("returns only pfsCategoryId if PFS category not found in list", () => {
    const entity: MissingEntity = { type: "category", name: "Inconnu", usedBy: 1 };
    const result = getPfsFields(entity, { Inconnu: "cat-999" }, {}, {}, {}, pfsCategories);
    expect(result).toEqual({ pfsCategoryId: "cat-999" });
  });

  it("returns pfsCompositionRef for a composition entity with mapping", () => {
    const entity: MissingEntity = { type: "composition", name: "Coton", usedBy: 2 };
    const result = getPfsFields(entity, {}, { Coton: "COTON" }, {}, {}, pfsCategories);
    expect(result).toEqual({ pfsCompositionRef: "COTON" });
  });

  it("returns pfsCountryRef for a country entity with mapping", () => {
    const entity: MissingEntity = { type: "country", name: "Chine", usedBy: 2 };
    const result = getPfsFields(entity, {}, {}, { Chine: "CN" }, {}, pfsCategories);
    expect(result).toEqual({ pfsCountryRef: "CN" });
  });

  it("returns pfsRef for a season entity with mapping", () => {
    const entity: MissingEntity = { type: "season", name: "PE 2026", usedBy: 1 };
    const result = getPfsFields(entity, {}, {}, {}, { "PE 2026": "PE2026" }, pfsCategories);
    expect(result).toEqual({ pfsRef: "PE2026" });
  });

  it("returns empty object for a subcategory entity (no PFS mapping)", () => {
    const entity: MissingEntity = { type: "subcategory", name: "Colliers", usedBy: 1, parentCategoryName: "Bijoux" };
    const result = getPfsFields(entity, {}, {}, {}, {}, pfsCategories);
    expect(result).toEqual({});
  });
});
