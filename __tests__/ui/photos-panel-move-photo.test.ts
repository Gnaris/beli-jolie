import { describe, it, expect } from "vitest";
import { movePhotoInColorImages } from "@/components/admin/products/PhotosPanel";
import type { ColorImageState } from "@/components/admin/products/ColorVariantManager";

// PhotosPanel — déplacement de photos entre slots et entre couleurs.
//
// La logique clé est extraite dans `movePhotoInColorImages` pour être testée
// indépendamment du rendu React (le drag & drop côté DOM est trop lourd à
// simuler en unit test — on couvre ici la sémantique métier).

function makeGroup(overrides: Partial<ColorImageState> & { groupKey: string }): ColorImageState {
  return {
    groupKey: overrides.groupKey,
    colorId: overrides.colorId ?? overrides.groupKey,
    colorName: overrides.colorName ?? overrides.groupKey,
    colorHex: overrides.colorHex ?? "#000000",
    imagePreviews: overrides.imagePreviews ?? [],
    uploadedPaths: overrides.uploadedPaths ?? [],
    orders: overrides.orders ?? [],
    pendingFiles: overrides.pendingFiles ?? [],
    uploading: overrides.uploading ?? false,
  };
}

describe("PhotosPanel — movePhotoInColorImages", () => {
  it("même couleur, slot cible vide : simple changement d'ordre", () => {
    const state: ColorImageState[] = [
      makeGroup({
        groupKey: "noir",
        imagePreviews: ["blob:noir-A"],
        uploadedPaths: ["/uploads/noir-A.webp"],
        orders: [0],
        pendingFiles: [null],
      }),
    ];
    const next = movePhotoInColorImages(state, "noir", 0, "noir", 2);
    expect(next[0].orders).toEqual([2]);
    expect(next[0].imagePreviews).toEqual(["blob:noir-A"]);
  });

  it("même couleur, slot cible occupé : permutation", () => {
    const state: ColorImageState[] = [
      makeGroup({
        groupKey: "noir",
        imagePreviews: ["blob:A", "blob:B"],
        uploadedPaths: ["/A.webp", "/B.webp"],
        orders: [0, 1],
        pendingFiles: [null, null],
      }),
    ];
    const next = movePhotoInColorImages(state, "noir", 0, "noir", 1);
    // La photo qui était en 0 se retrouve en 1, celle qui était en 1 revient en 0.
    const noir = next[0];
    const idxA = noir.imagePreviews.indexOf("blob:A");
    const idxB = noir.imagePreviews.indexOf("blob:B");
    expect(noir.orders[idxA]).toBe(1);
    expect(noir.orders[idxB]).toBe(0);
  });

  it("couleur différente, slot cible vide : la photo passe à cette position", () => {
    const state: ColorImageState[] = [
      makeGroup({
        groupKey: "noir",
        imagePreviews: ["blob:A", "blob:B"],
        uploadedPaths: ["/A.webp", "/B.webp"],
        orders: [0, 1],
        pendingFiles: [null, null],
      }),
      makeGroup({ groupKey: "blanc" }),
    ];
    const next = movePhotoInColorImages(state, "noir", 1, "blanc", 0);
    const noir = next.find((g) => g.groupKey === "noir")!;
    const blanc = next.find((g) => g.groupKey === "blanc")!;
    expect(noir.imagePreviews).toEqual(["blob:A"]);
    expect(noir.orders).toEqual([0]);
    expect(blanc.imagePreviews).toEqual(["blob:B"]);
    expect(blanc.orders).toEqual([0]);
  });

  it("couleur différente, slot cible occupé : la photo va au premier slot libre du groupe cible", () => {
    const state: ColorImageState[] = [
      makeGroup({
        groupKey: "noir",
        imagePreviews: ["blob:A"],
        uploadedPaths: ["/A.webp"],
        orders: [0],
        pendingFiles: [null],
      }),
      makeGroup({
        groupKey: "blanc",
        imagePreviews: ["blob:X", "blob:Y"],
        uploadedPaths: ["/X.webp", "/Y.webp"],
        orders: [0, 2],
        pendingFiles: [null, null],
      }),
    ];
    // On drop la photo de "noir" position 0 sur "blanc" position 0 (occupé).
    // Le 1er slot libre côté blanc = 1.
    const next = movePhotoInColorImages(state, "noir", 0, "blanc", 0);
    const blanc = next.find((g) => g.groupKey === "blanc")!;
    const noir = next.find((g) => g.groupKey === "noir")!;
    expect(noir.imagePreviews).toEqual([]);
    expect(blanc.imagePreviews).toContain("blob:A");
    const idxA = blanc.imagePreviews.indexOf("blob:A");
    expect(blanc.orders[idxA]).toBe(1);
  });

  it("couleur différente : les positions du groupe source se compactent après retrait", () => {
    const state: ColorImageState[] = [
      makeGroup({
        groupKey: "noir",
        imagePreviews: ["blob:A", "blob:B", "blob:C"],
        uploadedPaths: ["/A.webp", "/B.webp", "/C.webp"],
        orders: [0, 1, 2],
        pendingFiles: [null, null, null],
      }),
      makeGroup({ groupKey: "blanc" }),
    ];
    // On retire la position 1 de noir en la déplaçant vers blanc.
    // Résultat attendu côté noir : ordres restants = [0, 1] (compactés).
    const next = movePhotoInColorImages(state, "noir", 1, "blanc", 0);
    const noir = next.find((g) => g.groupKey === "noir")!;
    expect(noir.orders.sort()).toEqual([0, 1]);
    expect(noir.imagePreviews).toEqual(["blob:A", "blob:C"]);
  });

  it("couleur cible pleine : aucun changement", () => {
    const state: ColorImageState[] = [
      makeGroup({
        groupKey: "noir",
        imagePreviews: ["blob:A"],
        uploadedPaths: ["/A.webp"],
        orders: [0],
        pendingFiles: [null],
      }),
      makeGroup({
        groupKey: "blanc",
        imagePreviews: ["b:1", "b:2", "b:3", "b:4", "b:5"],
        uploadedPaths: ["/1", "/2", "/3", "/4", "/5"],
        orders: [0, 1, 2, 3, 4],
        pendingFiles: [null, null, null, null, null],
      }),
    ];
    const next = movePhotoInColorImages(state, "noir", 0, "blanc", 0);
    expect(next).toBe(state); // même référence : aucun changement
  });

  it("groupe source inconnu : aucun changement", () => {
    const state: ColorImageState[] = [makeGroup({ groupKey: "noir" })];
    const next = movePhotoInColorImages(state, "inconnu", 0, "noir", 0);
    expect(next).toBe(state);
  });

  it("même groupe, même position : aucun changement", () => {
    const state: ColorImageState[] = [
      makeGroup({
        groupKey: "noir",
        imagePreviews: ["blob:A"],
        uploadedPaths: ["/A.webp"],
        orders: [0],
        pendingFiles: [null],
      }),
    ];
    const next = movePhotoInColorImages(state, "noir", 0, "noir", 0);
    expect(next).toBe(state);
  });

  it("la photo garde son fichier en attente lors du déplacement inter-couleurs", () => {
    const pendingFile = new File(["x"], "img.jpg", { type: "image/jpeg" });
    const state: ColorImageState[] = [
      makeGroup({
        groupKey: "noir",
        imagePreviews: ["blob:pending"],
        uploadedPaths: [""],
        orders: [0],
        pendingFiles: [pendingFile],
      }),
      makeGroup({ groupKey: "blanc" }),
    ];
    const next = movePhotoInColorImages(state, "noir", 0, "blanc", 0);
    const blanc = next.find((g) => g.groupKey === "blanc")!;
    expect(blanc.pendingFiles[0]).toBe(pendingFile);
    expect(blanc.uploadedPaths[0]).toBe("");
    expect(blanc.imagePreviews[0]).toBe("blob:pending");
  });
});
