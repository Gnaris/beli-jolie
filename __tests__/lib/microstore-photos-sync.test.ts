import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Contrat clé du cœur métier `microstore-photos-sync` :
 *
 *   1. Il NE dépend PAS de `requireAdmin` / cookies HTTP — donc appelable depuis
 *      un fire-and-forget lancé après retour de la réponse HTTP.
 *   2. Il retourne un `{ success, error }` typé même quand un pré-requis manque
 *      (station de transfert absente, preflight refusé, produit introuvable).
 *
 * Régression cible : bug 2026-08-25 où le fire-and-forget appelait la server
 * action qui faisait `requireAdmin()` → `getServerSession()` sans cookies HTTP
 * → throw silencieux → aucun MicrostoreUploadJob créé → widget vide.
 */

vi.mock("@/lib/microstore-preflight", () => ({
  assertMicrostorePushAllowed: vi.fn(),
}));
vi.mock("@/lib/microstore-picture-station", () => ({
  getStoredPictureStation: vi.fn(),
  getMicrostorePictureStationCompany: vi.fn(),
  uploadImageToMicrostoreOss: vi.fn(),
  getMicrostoreGoodsByItemRef: vi.fn(),
  patchMicrostoreGoodsImages: vi.fn(),
  bulkImportMicrostorePictures: vi.fn(),
}));
vi.mock("@/lib/microstore-upload-jobs", () => ({
  createMicrostoreUploadJob: vi.fn().mockResolvedValue("job-id-1"),
  markMicrostoreUploadJobStarted: vi.fn(),
  bumpMicrostoreUploadJobCounters: vi.fn(),
  markMicrostoreUploadJobStatus: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    siteConfig: { findFirst: vi.fn() },
  },
}));

async function loadCore() {
  return await import("@/lib/microstore-photos-sync");
}

describe("sendProductPhotosToMicrostoreCore — pré-requis absents", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("retourne une erreur claire si la référence est vide, sans throw", async () => {
    const { sendProductPhotosToMicrostoreCore } = await loadCore();
    const res = await sendProductPhotosToMicrostoreCore("");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/référence/i);
  });

  it("retourne une erreur claire si le preflight refuse (kill switch, session…)", async () => {
    const preflight = await import("@/lib/microstore-preflight");
    (preflight.assertMicrostorePushAllowed as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "Session Microstore expirée.",
    });

    const { sendProductPhotosToMicrostoreCore } = await loadCore();
    const res = await sendProductPhotosToMicrostoreCore("A1234");
    expect(res.success).toBe(false);
    expect(res.error).toBe("Session Microstore expirée.");
  });

  it("retourne une erreur si aucun lien de Station de transfert n'est configuré", async () => {
    const preflight = await import("@/lib/microstore-preflight");
    (preflight.assertMicrostorePushAllowed as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
    });
    const ps = await import("@/lib/microstore-picture-station");
    (ps.getStoredPictureStation as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { sendProductPhotosToMicrostoreCore } = await loadCore();
    const res = await sendProductPhotosToMicrostoreCore("A1234");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/station de transfert/i);
  });

  it("retourne une erreur si le produit BJ n'existe pas", async () => {
    const preflight = await import("@/lib/microstore-preflight");
    (preflight.assertMicrostorePushAllowed as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
    });
    const ps = await import("@/lib/microstore-picture-station");
    (ps.getStoredPictureStation as ReturnType<typeof vi.fn>).mockResolvedValue({
      key: "K",
      expiresAt: new Date(Date.now() + 3600_000),
      shortUrl: null,
    });
    const { prisma } = await import("@/lib/prisma");
    (prisma.product.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.siteConfig.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { sendProductPhotosToMicrostoreCore } = await loadCore();
    const res = await sendProductPhotosToMicrostoreCore("A1234");
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/A1234/);
  });

  it("N'IMPORTE PAS auth-helpers ni next-auth (contrat fire-and-forget)", async () => {
    // Le module lui-même ne doit pas importer auth-helpers ni next-auth : sinon
    // le core ré-introduirait implicitement une dépendance à la session HTTP,
    // ce qui casserait l'appel depuis un fire-and-forget post-réponse.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(process.cwd(), "lib", "microstore-photos-sync.ts"),
      "utf8",
    );
    // Seul le contrat d'import est vérifié — le mot "requireAdmin" peut
    // apparaître dans un commentaire d'explication historique.
    expect(source).not.toMatch(/from ["'](?:@\/lib\/auth-helpers|next-auth)/);
    expect(source).not.toMatch(/getServerSession\s*\(/);
  });
});

describe("bulkSendPhotosToMicrostoreCore — pré-requis absents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retourne success:true et compte 0 si productIds est vide", async () => {
    const { bulkSendPhotosToMicrostoreCore } = await loadCore();
    const res = await bulkSendPhotosToMicrostoreCore([]);
    expect(res.success).toBe(true);
    expect(res.attempted).toBe(0);
    expect(res.photosUploaded).toBe(0);
  });

  it("retourne l'erreur du preflight quand le kill switch bloque", async () => {
    const preflight = await import("@/lib/microstore-preflight");
    (preflight.assertMicrostorePushAllowed as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: "Microstore désactivée dans Paramètres.",
    });

    const { bulkSendPhotosToMicrostoreCore } = await loadCore();
    const res = await bulkSendPhotosToMicrostoreCore(["p1", "p2"]);
    expect(res.success).toBe(false);
    expect(res.error).toBe("Microstore désactivée dans Paramètres.");
    expect(res.attempted).toBe(2);
    expect(res.failedCount).toBe(2);
  });
});
