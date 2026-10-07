import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock des deps externes AVANT l'import du module teste. Prisma et la
// session Baileys sont hors scope ici : on verifie uniquement la logique
// de rate-limit + cache + routing selon l'etat de la session.
const checkMock = vi.fn<[], Promise<boolean | null>>();
const findUniqueMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/whatsapp-session", () => ({
  checkWhatsappNumberRaw: (phone: string) => checkMock(phone as unknown as never),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (args: unknown) => findUniqueMock(args),
      update: (args: unknown) => updateMock(args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs.readFile / writeFile pour que le compteur disque soit maitrise.
const readMock = vi.fn<[string, string], Promise<string>>();
const writeMock = vi.fn();
const mkdirMock = vi.fn();
vi.mock("node:fs", () => ({
  promises: {
    readFile: (p: string, enc: string) => readMock(p, enc),
    writeFile: (...args: unknown[]) => writeMock(...args),
    mkdir: (...args: unknown[]) => mkdirMock(...args),
  },
}));

import {
  checkWhatsappNumber,
  isLikelyLandline,
  resetWhatsappDailyCounter,
  getWhatsappDailyCounter,
} from "@/lib/whatsapp-check";

describe("isLikelyLandline", () => {
  it("detecte les fixes francais 01-05 et 09", () => {
    expect(isLikelyLandline("0123456789")).toBe(true);
    expect(isLikelyLandline("0298765432")).toBe(true);
    expect(isLikelyLandline("0345678901")).toBe(true);
    expect(isLikelyLandline("0456789012")).toBe(true);
    expect(isLikelyLandline("0567890123")).toBe(true);
    expect(isLikelyLandline("0912345678")).toBe(true);
  });

  it("laisse passer les mobiles 06-08", () => {
    expect(isLikelyLandline("0612345678")).toBe(false);
    expect(isLikelyLandline("0712345678")).toBe(false);
    expect(isLikelyLandline("0812345678")).toBe(false);
  });

  it("gere le format international +33", () => {
    expect(isLikelyLandline("+33123456789")).toBe(true); // 01 fixe
    expect(isLikelyLandline("+33612345678")).toBe(false); // 06 mobile
    expect(isLikelyLandline("+33912345678")).toBe(true); // 09 fixe
  });

  it("gere le format 0033", () => {
    expect(isLikelyLandline("0033123456789")).toBe(true);
    expect(isLikelyLandline("0033612345678")).toBe(false);
  });

  it("gere les espaces et separateurs", () => {
    expect(isLikelyLandline("01 23 45 67 89")).toBe(true);
    expect(isLikelyLandline("06.12.34.56.78")).toBe(false);
    expect(isLikelyLandline("+33 6 12 34 56 78")).toBe(false);
  });

  it("renvoie false pour les cas douteux (etranger, trop court)", () => {
    expect(isLikelyLandline("")).toBe(false);
    expect(isLikelyLandline("+1 212 555 0100")).toBe(false);
    expect(isLikelyLandline("12345")).toBe(false);
  });
});

describe("checkWhatsappNumber — routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Compteur vide par defaut.
    readMock.mockRejectedValue(new Error("ENOENT"));
    writeMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);
    findUniqueMock.mockResolvedValue(null);
    updateMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    void resetWhatsappDailyCounter();
  });

  it("renvoie 'unknown' pour une ligne fixe sans toucher Baileys", async () => {
    const res = await checkWhatsappNumber("0123456789", "user-1");
    expect(res).toBe("unknown");
    expect(checkMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("renvoie 'unknown' pour un numero vide", async () => {
    expect(await checkWhatsappNumber("", "user-1")).toBe("unknown");
    expect(await checkWhatsappNumber(null, "user-1")).toBe("unknown");
    expect(await checkWhatsappNumber(undefined, "user-1")).toBe("unknown");
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("ressort la valeur cachee en BDD sans appeler Baileys", async () => {
    findUniqueMock.mockResolvedValueOnce({
      hasWhatsapp: true,
      whatsappCheckedAt: new Date(),
    });
    const res = await checkWhatsappNumber("0612345678", "user-1");
    expect(res).toBe("yes");
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("ressort 'no' depuis le cache quand hasWhatsapp=false", async () => {
    findUniqueMock.mockResolvedValueOnce({
      hasWhatsapp: false,
      whatsappCheckedAt: new Date(),
    });
    const res = await checkWhatsappNumber("0612345678", "user-1");
    expect(res).toBe("no");
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("appelle Baileys quand le cache est null et persiste le resultat", async () => {
    findUniqueMock.mockResolvedValueOnce({ hasWhatsapp: null, whatsappCheckedAt: null });
    checkMock.mockResolvedValueOnce(true);

    const res = await checkWhatsappNumber("0612345678", "user-1");
    expect(res).toBe("yes");
    expect(checkMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { hasWhatsapp: true, whatsappCheckedAt: expect.any(Date) },
    });
  });

  it("renvoie 'unknown' quand Baileys indique session pas prete (null)", async () => {
    findUniqueMock.mockResolvedValueOnce({ hasWhatsapp: null, whatsappCheckedAt: null });
    checkMock.mockResolvedValueOnce(null);

    const res = await checkWhatsappNumber("0612345678", "user-1");
    expect(res).toBe("unknown");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("renvoie 'ratelimited' quand le compteur journalier est atteint", async () => {
    // On remplit le compteur en simulant 100 appels prealables.
    await resetWhatsappDailyCounter();
    findUniqueMock.mockResolvedValue({ hasWhatsapp: null, whatsappCheckedAt: null });
    checkMock.mockResolvedValue(true);
    for (let i = 0; i < 100; i++) {
      await checkWhatsappNumber("0612345678", `user-${i}`);
    }

    findUniqueMock.mockResolvedValueOnce({ hasWhatsapp: null, whatsappCheckedAt: null });
    const res = await checkWhatsappNumber("0612345678", "user-101");
    expect(res).toBe("ratelimited");
    const counter = await getWhatsappDailyCounter();
    expect(counter.used).toBe(100);
    expect(counter.limit).toBe(100);
  });
});
