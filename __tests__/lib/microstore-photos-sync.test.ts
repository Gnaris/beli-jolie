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
      findUnique: vi.fn(),
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

describe("sendProductPhotosToMicrostoreCore — garde-fou microstorePhotosDirty", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saute l'envoi si photosDirty=false et pas de force, sans appeler Microstore", async () => {
    const preflight = await import("@/lib/microstore-preflight");
    (preflight.assertMicrostorePushAllowed as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const ps = await import("@/lib/microstore-picture-station");
    (ps.getStoredPictureStation as ReturnType<typeof vi.fn>).mockResolvedValue({
      key: "K",
      expiresAt: new Date(Date.now() + 3600_000),
      shortUrl: null,
    });
    const { prisma } = await import("@/lib/prisma");
    (prisma.product.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      reference: "A1234",
      name: "Test",
      primaryColorId: null,
      microstoreProductId: 10259,
      colors: [],
      colorImages: [],
    });
    (prisma.product.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      microstorePhotosDirty: false,
    });
    (prisma.siteConfig.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { sendProductPhotosToMicrostoreCore } = await loadCore();
    const res = await sendProductPhotosToMicrostoreCore("A1234");
    expect(res.success).toBe(true);
    // Aucun contact Microstore ne doit avoir été tenté.
    expect(ps.getMicrostorePictureStationCompany).not.toHaveBeenCalled();
    expect(ps.uploadImageToMicrostoreOss).not.toHaveBeenCalled();
    expect(ps.patchMicrostoreGoodsImages).not.toHaveBeenCalled();
    const uploadJobs = await import("@/lib/microstore-upload-jobs");
    // Pas de MicrostoreUploadJob créé — sinon le widget se remplirait de
    // "0 photo envoyée" à chaque save fiche seule.
    expect(uploadJobs.createMicrostoreUploadJob).not.toHaveBeenCalled();
  });

  it("PROCÈDE quand force=true même si photosDirty=false", async () => {
    const preflight = await import("@/lib/microstore-preflight");
    (preflight.assertMicrostorePushAllowed as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const ps = await import("@/lib/microstore-picture-station");
    (ps.getStoredPictureStation as ReturnType<typeof vi.fn>).mockResolvedValue({
      key: "K",
      expiresAt: new Date(Date.now() + 3600_000),
      shortUrl: null,
    });
    (ps.getMicrostorePictureStationCompany as ReturnType<typeof vi.fn>).mockResolvedValue({
      companyId: 3976,
      companyName: "BJ",
    });
    const { prisma } = await import("@/lib/prisma");
    (prisma.product.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      reference: "A1234",
      name: "Test",
      primaryColorId: null,
      microstoreProductId: 10259,
      colors: [],
      colorImages: [],
    });
    (prisma.product.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      microstorePhotosDirty: false, // pourtant force=true dessous
    });
    (prisma.siteConfig.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { sendProductPhotosToMicrostoreCore } = await loadCore();
    await sendProductPhotosToMicrostoreCore("A1234", { force: true });
    // Le core est allé au moins jusqu'à récupérer la company (preuve qu'il
    // n'a pas short-circuité sur le flag dirty).
    expect(ps.getMicrostorePictureStationCompany).toHaveBeenCalled();
  });

  it("PROCÈDE quand photosDirty=true (nouveau produit, photos non poussées)", async () => {
    const preflight = await import("@/lib/microstore-preflight");
    (preflight.assertMicrostorePushAllowed as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    const ps = await import("@/lib/microstore-picture-station");
    (ps.getStoredPictureStation as ReturnType<typeof vi.fn>).mockResolvedValue({
      key: "K",
      expiresAt: new Date(Date.now() + 3600_000),
      shortUrl: null,
    });
    (ps.getMicrostorePictureStationCompany as ReturnType<typeof vi.fn>).mockResolvedValue({
      companyId: 3976,
      companyName: "BJ",
    });
    const { prisma } = await import("@/lib/prisma");
    (prisma.product.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "p1",
      reference: "A1234",
      name: "Test",
      primaryColorId: null,
      microstoreProductId: 10259,
      colors: [],
      colorImages: [],
    });
    (prisma.product.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      microstorePhotosDirty: true,
    });
    (prisma.siteConfig.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { sendProductPhotosToMicrostoreCore } = await loadCore();
    await sendProductPhotosToMicrostoreCore("A1234");
    expect(ps.getMicrostorePictureStationCompany).toHaveBeenCalled();
  });
});

describe("withMicrostorePhotoLock — sérialisation par tenant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("empêche 2 envois du même tenant de tourner en parallèle", async () => {
    const { withMicrostorePhotoLock } = await loadCore();

    const events: string[] = [];
    async function task(label: string, holdMs: number): Promise<void> {
      await withMicrostorePhotoLock("tenant-A", label, async () => {
        events.push(`start:${label}`);
        await new Promise((r) => setTimeout(r, holdMs));
        events.push(`end:${label}`);
      });
    }

    // Lance 2 tâches concurrentes ; la seconde doit attendre la 1re.
    await Promise.all([task("A", 60), task("B", 30)]);

    // Ordre garanti : la 1re commence et finit AVANT que la 2e commence.
    expect(events).toEqual(["start:A", "end:A", "start:B", "end:B"]);
  });

  it("laisse 2 envois de tenants différents tourner en parallèle", async () => {
    const { withMicrostorePhotoLock } = await loadCore();

    const events: string[] = [];
    async function task(tenantId: string, label: string, holdMs: number): Promise<void> {
      await withMicrostorePhotoLock(tenantId, label, async () => {
        events.push(`start:${label}`);
        await new Promise((r) => setTimeout(r, holdMs));
        events.push(`end:${label}`);
      });
    }

    await Promise.all([task("t1", "T1", 50), task("t2", "T2", 20)]);

    // T2 finit avant T1 (parallèle possible entre tenants distincts).
    expect(events[0]).toBe("start:T1");
    expect(events[1]).toBe("start:T2");
    expect(events[2]).toBe("end:T2");
    expect(events[3]).toBe("end:T1");
  });
});
