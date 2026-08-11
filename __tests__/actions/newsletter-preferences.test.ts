/**
 * Tests des server actions liées au consentement newsletter :
 *   - setNewsletterPreference  : bascule côté client (espace pro)
 *   - setUserNewsletter        : bascule côté admin (fiche client)
 *
 * Contexte : une seule case newsletter couvre nouveautés + promos + rappels
 * panier abandonné. Le client doit pouvoir se désinscrire en 1 clic (CNIL),
 * et l'admin doit pouvoir forcer l'état sur demande téléphonique du client.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
}));

const mockGetServerSession = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({
  getServerSession: mockGetServerSession,
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { setNewsletterPreference } from "@/app/actions/client/profile";
import { setUserNewsletter } from "@/app/actions/admin/setUserNewsletter";

describe("setNewsletterPreference (client)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse sans session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    await expect(setNewsletterPreference(true)).rejects.toThrow("Non autorise");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("active la newsletter pour l'utilisateur connecte", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "client-1", role: "CLIENT" } });
    const res = await setNewsletterPreference(true);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "client-1" },
      data: { acceptsNewsletter: true },
    });
    expect(res).toEqual({ success: true, acceptsNewsletter: true });
  });

  it("desactive la newsletter en 1 clic", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "client-2", role: "CLIENT" } });
    const res = await setNewsletterPreference(false);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "client-2" },
      data: { acceptsNewsletter: false },
    });
    expect(res).toEqual({ success: true, acceptsNewsletter: false });
  });

  it("caste correctement les valeurs truthy en booleen", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "client-3", role: "CLIENT" } });
    // Simule un appel avec une valeur non-booleenne (defensive)
    await setNewsletterPreference("yes" as unknown as boolean);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "client-3" },
      data: { acceptsNewsletter: true },
    });
  });
});

describe("setUserNewsletter (admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuse sans session admin", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    await expect(setUserNewsletter("u1", true)).rejects.toThrow("Acces non autorise");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("refuse un utilisateur CLIENT tentant l'action", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "u1", role: "CLIENT" } });
    await expect(setUserNewsletter("u1", true)).rejects.toThrow("Acces non autorise");
  });

  it("refuse si l'utilisateur cible n'existe pas", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } });
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(setUserNewsletter("missing", true)).rejects.toThrow("introuvable");
  });

  it("refuse de modifier un autre admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "admin-2", role: "ADMIN" });
    await expect(setUserNewsletter("admin-2", false)).rejects.toThrow("administrateur");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("desinscrit un client à la demande verbale", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "client-1", role: "CLIENT" });
    const res = await setUserNewsletter("client-1", false);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "client-1" },
      data: { acceptsNewsletter: false },
    });
    expect(res).toEqual({ success: true, acceptsNewsletter: false });
  });

  it("réinscrit un client depuis l'admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "admin-1", role: "ADMIN" } });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "client-2", role: "CLIENT" });
    const res = await setUserNewsletter("client-2", true);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "client-2" },
      data: { acceptsNewsletter: true },
    });
    expect(res.acceptsNewsletter).toBe(true);
  });
});
