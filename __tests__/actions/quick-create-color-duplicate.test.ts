import { describe, it, expect, vi, beforeEach } from "vitest";

const mockColorCreate = vi.fn();
const mockColorFindFirst = vi.fn();
const mockColorTranslationUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    color: {
      create: (...a: unknown[]) => mockColorCreate(...a),
      findFirst: (...a: unknown[]) => mockColorFindFirst(...a),
    },
    colorTranslation: { upsert: (...a: unknown[]) => mockColorTranslationUpsert(...a) },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Isole les branches Microstore + auto-translate : cette suite ne teste que
// la logique BJ pure (dédoublonnage nom, retour d'erreur lisible).
vi.mock("@/lib/microstore-attribute-propagation", () => ({
  autoCreateColorOnMicrostore: vi
    .fn()
    .mockResolvedValue({ status: "skipped_not_configured" }),
}));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateColor: vi.fn().mockResolvedValue(undefined),
}));

import { createColorQuick } from "@/app/actions/admin/quick-create";

/**
 * Le doublon de nom est renvoyé comme donnée (`{ ok: false, error }`) plutôt que
 * via `throw`, car en production Next.js masque le message des erreurs jetées
 * dans une server action ("An error occurred in the Server Components render").
 * Retourner l'erreur permet à la modale d'afficher un message lisible.
 */
describe("createColorQuick — refuse les doublons de nom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("crée la couleur quand le nom est libre", async () => {
    mockColorFindFirst.mockResolvedValue(null);
    mockColorCreate.mockResolvedValue({ id: "col-1", name: "Rouge", hex: "#ff0000", patternImage: null });

    const res = await createColorQuick({ fr: "Rouge" }, "#ff0000", null);

    expect(mockColorFindFirst).toHaveBeenCalledWith({
      where: { name: { equals: "Rouge" } },
      select: { name: true },
    });
    expect(mockColorCreate).toHaveBeenCalledTimes(1);
    // `microstore` reflète le status de l'auto-lien Microstore (ici skip car
    // le helper est mocké → « pas configuré »). Le reste du payload est stable.
    expect(res).toEqual({
      ok: true,
      id: "col-1",
      name: "Rouge",
      hex: "#ff0000",
      patternImage: null,
      microstore: { status: "skipped_not_configured" },
    });
  });

  it("renvoie un message lisible si une couleur du même nom existe déjà", async () => {
    mockColorFindFirst.mockResolvedValue({ name: "Rouge" });

    const res = await createColorQuick({ fr: "Rouge" }, "#ff0000", null);

    expect(res).toEqual({
      ok: false,
      error: "La couleur « Rouge » existe déjà dans la bibliothèque.",
    });
    expect(mockColorCreate).not.toHaveBeenCalled();
  });

  it("renvoie un message si le nom (FR) est vide", async () => {
    const res = await createColorQuick({ fr: "   " }, "#ff0000", null);
    expect(res).toEqual({ ok: false, error: "Le nom (FR) est requis." });
    expect(mockColorFindFirst).not.toHaveBeenCalled();
    expect(mockColorCreate).not.toHaveBeenCalled();
  });
});
