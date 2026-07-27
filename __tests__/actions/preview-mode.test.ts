/**
 * Tests pour app/actions/admin/preview-mode.ts.
 *
 * Bug historique (issyma) : redirect() serveur restait en soft nav RSC et
 * resservait la home du domaine BJ. La nouvelle stratégie ne redirige plus
 * côté serveur — le client fait un window.location.href = "/" (full reload).
 * On vérifie donc que :
 *  1. enableAdminPreview pose bien le cookie et NE redirige PAS
 *  2. disableAdminPreview supprime bien le cookie et NE redirige PAS
 *  3. les deux refusent les non-admins
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCookies = vi.hoisted(() => ({
  set: vi.fn(),
  delete: vi.fn(),
}));

const mockRedirect = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookies),
}));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import { getServerSession } from "next-auth";
import { enableAdminPreview, disableAdminPreview } from "@/app/actions/admin/preview-mode";

const mockedGetServerSession = getServerSession as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCookies.set.mockReset();
  mockCookies.delete.mockReset();
  mockRedirect.mockReset();
  mockedGetServerSession.mockReset();
});

describe("enableAdminPreview", () => {
  it("pose le cookie bj_admin_preview=1 pour l'admin", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { role: "ADMIN" } });
    await enableAdminPreview();
    expect(mockCookies.set).toHaveBeenCalledWith(
      "bj_admin_preview",
      "1",
      expect.objectContaining({ path: "/", sameSite: "lax" }),
    );
  });

  it("ne redirige pas côté serveur (le client fait window.location.href)", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { role: "ADMIN" } });
    await enableAdminPreview();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("refuse les non-admins", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { role: "CLIENT" } });
    await expect(enableAdminPreview()).rejects.toThrow(/autorisé/i);
    expect(mockCookies.set).not.toHaveBeenCalled();
  });

  it("refuse les non-authentifiés", async () => {
    mockedGetServerSession.mockResolvedValue(null);
    await expect(enableAdminPreview()).rejects.toThrow(/autorisé/i);
    expect(mockCookies.set).not.toHaveBeenCalled();
  });
});

describe("disableAdminPreview", () => {
  it("supprime le cookie pour l'admin", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { role: "ADMIN" } });
    await disableAdminPreview();
    expect(mockCookies.delete).toHaveBeenCalledWith("bj_admin_preview");
  });

  it("ne redirige pas côté serveur (le client fait window.location.href)", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { role: "ADMIN" } });
    await disableAdminPreview();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("refuse les non-admins", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { role: "CLIENT" } });
    await expect(disableAdminPreview()).rejects.toThrow(/autorisé/i);
    expect(mockCookies.delete).not.toHaveBeenCalled();
  });
});
