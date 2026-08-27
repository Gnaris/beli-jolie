/**
 * Vérifie les règles de propagation soft BJ → Microstore pour les attributs
 * bibliothèque (couleur, catégorie, sous-catégorie, saison).
 *
 * Règles couvertes :
 *   1. Auto-création couleur : Microstore appelé + microstoreColorId posé.
 *   2. Renommage : appel edit uniquement si microstore*Id != null.
 *   3. Rien n'est appelé si Microstore n'est pas prêt (kill switch OFF ou
 *      session manquante).
 *   4. Les erreurs Microstore n'invalident jamais la sauvegarde locale
 *      (retour silencieux + warning).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirstConfigMock = vi.fn();
const getSessionKeyMock = vi.fn();
const createColorMock = vi.fn();
const editColorMock = vi.fn();
const editAttrMock = vi.fn();
const listColorsMock = vi.fn();

const findUniqueColorMock = vi.fn();
const updateColorMock = vi.fn();
const findUniqueCategoryMock = vi.fn();
const findUniqueSubCategoryMock = vi.fn();
const findUniqueSeasonMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: { findFirst: findFirstConfigMock },
    color: { findUnique: findUniqueColorMock, update: updateColorMock },
    category: { findUnique: findUniqueCategoryMock },
    subCategory: { findUnique: findUniqueSubCategoryMock },
    season: { findUnique: findUniqueSeasonMock },
  },
}));

vi.mock("@/lib/tenant-als", () => ({
  getCurrentTenantIdSync: () => "tenant-beliandjolie",
}));

vi.mock("@/lib/microstore-auth", () => ({
  getMicrostoreSessionKey: getSessionKeyMock,
}));

vi.mock("@/lib/microstore-attributes", () => ({
  microstoreCreateColor: createColorMock,
  microstoreEditColor: editColorMock,
  microstoreEditAttribute: editAttrMock,
  microstoreListColors: listColorsMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const {
  autoCreateColorOnMicrostore,
  propagateColorRenameToMicrostore,
  propagateCategoryRenameToMicrostore,
  propagateSubCategoryRenameToMicrostore,
  propagateSeasonRenameToMicrostore,
} = await import("@/lib/microstore-attribute-propagation");

beforeEach(() => {
  findFirstConfigMock.mockReset();
  getSessionKeyMock.mockReset();
  createColorMock.mockReset();
  editColorMock.mockReset();
  editAttrMock.mockReset();
  listColorsMock.mockReset();
  findUniqueColorMock.mockReset();
  updateColorMock.mockReset();
  findUniqueCategoryMock.mockReset();
  findUniqueSubCategoryMock.mockReset();
  findUniqueSeasonMock.mockReset();

  // Défaut : Microstore prêt, bibliothèque vide.
  findFirstConfigMock.mockResolvedValue(null); // kill switch défaut ON
  getSessionKeyMock.mockResolvedValue("5_XXX");
  listColorsMock.mockResolvedValue([]);
});

describe("autoCreateColorOnMicrostore", () => {
  it("crée la couleur côté Microstore + pose microstoreColorId sur la Color BJ", async () => {
    createColorMock.mockResolvedValue({ id: "42", name: "Bleu marine" });

    const result = await autoCreateColorOnMicrostore({
      colorId: "clr-bj-1",
      name: "Bleu marine",
    });

    expect(result).toEqual({ status: "created", microstoreColorId: 42 });
    expect(createColorMock).toHaveBeenCalledWith({ name: "Bleu marine" });
    expect(updateColorMock).toHaveBeenCalledWith({
      where: { id: "clr-bj-1" },
      data: { microstoreColorId: 42 },
    });
  });

  it("lie à l'existante si Microstore a déjà une couleur du même nom (case-insensible)", async () => {
    listColorsMock.mockResolvedValue([
      { id: "7", name: "Doré" },
      { id: "42", name: "Bleu Marine" }, // casse différente
    ]);

    const result = await autoCreateColorOnMicrostore({
      colorId: "clr-bj-1",
      name: "bleu marine",
    });

    expect(result).toEqual({
      status: "linked_existing",
      microstoreColorId: 42,
      existingName: "Bleu Marine",
    });
    expect(createColorMock).not.toHaveBeenCalled();
    expect(updateColorMock).toHaveBeenCalledWith({
      where: { id: "clr-bj-1" },
      data: { microstoreColorId: 42 },
    });
  });

  it("n'appelle pas Microstore si le kill switch est OFF", async () => {
    findFirstConfigMock.mockResolvedValue({ value: "false" });

    const result = await autoCreateColorOnMicrostore({
      colorId: "clr-bj-1",
      name: "Bleu marine",
    });

    expect(result).toEqual({ status: "skipped_not_configured" });
    expect(createColorMock).not.toHaveBeenCalled();
    expect(listColorsMock).not.toHaveBeenCalled();
    expect(updateColorMock).not.toHaveBeenCalled();
  });

  it("n'appelle pas Microstore si la session est absente", async () => {
    getSessionKeyMock.mockResolvedValue(null);

    const result = await autoCreateColorOnMicrostore({
      colorId: "clr-bj-1",
      name: "Rouge",
    });

    expect(result).toEqual({ status: "skipped_not_configured" });
    expect(createColorMock).not.toHaveBeenCalled();
  });

  it("swallow toute erreur Microstore et retourne status=error (jamais de throw)", async () => {
    createColorMock.mockRejectedValue(new Error("Microstore HTTP 500"));

    const result = await autoCreateColorOnMicrostore({
      colorId: "clr-bj-1",
      name: "Rouge",
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toMatch(/HTTP 500/);
    }
    expect(updateColorMock).not.toHaveBeenCalled();
  });

  it("ignore un id Microstore non numérique et retourne error sans poser de lien BJ", async () => {
    createColorMock.mockResolvedValue({ id: "not-a-number", name: "Rouge" });

    const result = await autoCreateColorOnMicrostore({
      colorId: "clr-bj-1",
      name: "Rouge",
    });

    expect(result.status).toBe("error");
    expect(updateColorMock).not.toHaveBeenCalled();
  });
});

describe("propagateColorRenameToMicrostore", () => {
  it("renomme côté Microstore si la couleur est liée", async () => {
    findUniqueColorMock.mockResolvedValue({ microstoreColorId: 42 });

    await propagateColorRenameToMicrostore({
      colorId: "clr-bj-1",
      newName: "Bleu ciel",
    });

    expect(editColorMock).toHaveBeenCalledWith({ id: "42", name: "Bleu ciel" });
  });

  it("no-op si aucun lien Microstore posé", async () => {
    findUniqueColorMock.mockResolvedValue({ microstoreColorId: null });

    await propagateColorRenameToMicrostore({
      colorId: "clr-bj-1",
      newName: "Bleu ciel",
    });

    expect(editColorMock).not.toHaveBeenCalled();
  });

  it("no-op si Microstore n'est pas prêt", async () => {
    findUniqueColorMock.mockResolvedValue({ microstoreColorId: 42 });
    getSessionKeyMock.mockResolvedValue(null);

    await propagateColorRenameToMicrostore({
      colorId: "clr-bj-1",
      newName: "Bleu ciel",
    });

    expect(editColorMock).not.toHaveBeenCalled();
  });

  it("swallow toute erreur Microstore (jamais de throw)", async () => {
    findUniqueColorMock.mockResolvedValue({ microstoreColorId: 42 });
    editColorMock.mockRejectedValue(new Error("Microstore HTTP 500"));

    await expect(
      propagateColorRenameToMicrostore({
        colorId: "clr-bj-1",
        newName: "Bleu ciel",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("propagateCategoryRenameToMicrostore", () => {
  it("renomme côté Microstore avec type=category si mappée", async () => {
    findUniqueCategoryMock.mockResolvedValue({ microstoreCategoryId: 7 });

    await propagateCategoryRenameToMicrostore({
      categoryId: "cat-bj-1",
      newName: "Colliers",
    });

    expect(editAttrMock).toHaveBeenCalledWith({
      type: "category",
      id: "7",
      name: "Colliers",
    });
  });

  it("no-op si aucun mapping Microstore", async () => {
    findUniqueCategoryMock.mockResolvedValue({ microstoreCategoryId: null });

    await propagateCategoryRenameToMicrostore({
      categoryId: "cat-bj-1",
      newName: "Colliers",
    });

    expect(editAttrMock).not.toHaveBeenCalled();
  });
});

describe("propagateSubCategoryRenameToMicrostore", () => {
  it("renomme côté Microstore avec type=category (même endpoint que catégorie)", async () => {
    findUniqueSubCategoryMock.mockResolvedValue({ microstoreCategoryId: 99 });

    await propagateSubCategoryRenameToMicrostore({
      subCategoryId: "sub-bj-1",
      newName: "Bracelets thaïlandais",
    });

    expect(editAttrMock).toHaveBeenCalledWith({
      type: "category",
      id: "99",
      name: "Bracelets thaïlandais",
    });
  });

  it("no-op si sous-cat non mappée", async () => {
    findUniqueSubCategoryMock.mockResolvedValue({ microstoreCategoryId: null });

    await propagateSubCategoryRenameToMicrostore({
      subCategoryId: "sub-bj-1",
      newName: "Bracelets thaïlandais",
    });

    expect(editAttrMock).not.toHaveBeenCalled();
  });
});

describe("propagateSeasonRenameToMicrostore", () => {
  it("renomme côté Microstore avec type=season si mappée", async () => {
    findUniqueSeasonMock.mockResolvedValue({ microstoreSeasonId: 3 });

    await propagateSeasonRenameToMicrostore({
      seasonId: "ss-bj-1",
      newName: "Été 2026",
    });

    expect(editAttrMock).toHaveBeenCalledWith({
      type: "season",
      id: "3",
      name: "Été 2026",
    });
  });

  it("no-op si aucun mapping Microstore", async () => {
    findUniqueSeasonMock.mockResolvedValue({ microstoreSeasonId: null });

    await propagateSeasonRenameToMicrostore({
      seasonId: "ss-bj-1",
      newName: "Été 2026",
    });

    expect(editAttrMock).not.toHaveBeenCalled();
  });
});
