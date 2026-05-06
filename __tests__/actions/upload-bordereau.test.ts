/**
 * Tests pour app/actions/client/upload-bordereau.ts.
 *
 * Vérifie la validation côté serveur :
 *  - Authentification requise
 *  - Fichier obligatoire et non vide
 *  - Taille max 5 Mo
 *  - Types autorisés : PDF, JPG, PNG uniquement
 *  - Le path renvoyé est sous /uploads/bordereaux/
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockSession = vi.hoisted(() => ({ user: { id: "user-42" } }));
const mockUploadFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/storage", () => ({
  uploadFile: mockUploadFile,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { uploadBordereau } from "@/app/actions/client/upload-bordereau";
import { getServerSession } from "next-auth";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServerSession).mockResolvedValue(mockSession as never);
});

function makeFormData(file: File | null): FormData {
  const fd = new FormData();
  if (file) fd.append("file", file);
  return fd;
}

describe("uploadBordereau — authentification", () => {
  it("refuse si pas de session", async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never);
    const res = await uploadBordereau(makeFormData(new File(["x"], "x.pdf", { type: "application/pdf" })));
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/authentif/i);
  });
});

describe("uploadBordereau — validation du fichier", () => {
  it("refuse si pas de fichier", async () => {
    const res = await uploadBordereau(makeFormData(null));
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/manquant/i);
  });

  it("refuse un fichier vide", async () => {
    const file = new File([], "vide.pdf", { type: "application/pdf" });
    const res = await uploadBordereau(makeFormData(file));
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/vide/i);
  });

  it("refuse au-delà de 5 Mo", async () => {
    const sixMb = new Uint8Array(6 * 1024 * 1024);
    const file = new File([sixMb], "trop-gros.pdf", { type: "application/pdf" });
    const res = await uploadBordereau(makeFormData(file));
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/5 Mo/);
  });

  it("refuse un type non supporté (.docx)", async () => {
    const file = new File(["x"], "doc.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const res = await uploadBordereau(makeFormData(file));
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/format/i);
  });
});

describe("uploadBordereau — succès et stockage", () => {
  it("accepte un PDF valide et renvoie un path /uploads/bordereaux/", async () => {
    const file = new File(["%PDF-1.4 …"], "bordereau.pdf", { type: "application/pdf" });
    const res = await uploadBordereau(makeFormData(file));
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.path).toMatch(/^\/uploads\/bordereaux\/user-42-[a-f0-9]+\.pdf$/);
    }
    expect(mockUploadFile).toHaveBeenCalledOnce();
  });

  it("accepte un JPG (extension jpg)", async () => {
    const file = new File(["jpegdata"], "bord.jpg", { type: "image/jpeg" });
    const res = await uploadBordereau(makeFormData(file));
    expect(res.success).toBe(true);
    if (res.success) expect(res.path).toMatch(/\.jpg$/);
  });

  it("accepte un PNG (extension png)", async () => {
    const file = new File(["pngdata"], "b.png", { type: "image/png" });
    const res = await uploadBordereau(makeFormData(file));
    expect(res.success).toBe(true);
    if (res.success) expect(res.path).toMatch(/\.png$/);
  });

  it("renvoie une erreur si le stockage échoue", async () => {
    mockUploadFile.mockRejectedValueOnce(new Error("ENOSPC"));
    const file = new File(["data"], "x.pdf", { type: "application/pdf" });
    const res = await uploadBordereau(makeFormData(file));
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/enregistrer/i);
  });
});
