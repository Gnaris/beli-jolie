import { describe, it, expect } from "vitest";
import { validateFileName, verifyMagicBytes } from "@/lib/chat-upload-security";

describe("chat-upload-security / validateFileName", () => {
  it("accepte un nom simple avec extension autorisée", () => {
    const r = validateFileName("photo.jpg");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.extension).toBe("jpg");
  });

  it("refuse une double extension avec .exe intermédiaire", () => {
    const r = validateFileName("facture.exe.pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exe/);
  });

  it("refuse une extension finale interdite", () => {
    const r = validateFileName("virus.exe");
    expect(r.ok).toBe(false);
  });

  it("refuse un fichier .bat même déguisé en .pdf", () => {
    const r = validateFileName("innocent.bat.pdf");
    expect(r.ok).toBe(false);
  });

  it("refuse un fichier sans extension", () => {
    const r = validateFileName("noext");
    expect(r.ok).toBe(false);
  });

  it("refuse un caractère de contrôle dans le nom (null byte)", () => {
    const r = validateFileName("photo\x00.jpg");
    expect(r.ok).toBe(false);
  });

  it("refuse un séparateur de chemin (défense path traversal)", () => {
    expect(validateFileName("../secret.pdf").ok).toBe(false);
    expect(validateFileName("dir\\file.pdf").ok).toBe(false);
  });

  it("accepte les 8 extensions autorisées (images + pdf)", () => {
    for (const ext of ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "pdf"]) {
      const r = validateFileName(`fichier.${ext}`);
      expect(r.ok, `extension .${ext}`).toBe(true);
    }
  });

  it("refuse les documents bureautiques (Word, Excel, PPT, TXT, CSV)", () => {
    for (const ext of ["docx", "xlsx", "pptx", "txt", "csv", "doc", "xls", "ppt"]) {
      const r = validateFileName(`fichier.${ext}`);
      expect(r.ok, `extension .${ext}`).toBe(false);
    }
  });
});

describe("chat-upload-security / verifyMagicBytes", () => {
  it("valide un PDF avec entête %PDF-", () => {
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(verifyMagicBytes("application/pdf", buf)).toBe(true);
  });

  it("refuse un « faux PDF » qui commence par MZ (PE/EXE Windows)", () => {
    // Signature classique des .exe Windows
    const exeBuf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(verifyMagicBytes("application/pdf", exeBuf)).toBe(false);
  });

  it("valide un PNG standard", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(verifyMagicBytes("image/png", buf)).toBe(true);
  });

  it("refuse un JPG qui ne commence pas par FF D8 FF", () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(verifyMagicBytes("image/jpeg", buf)).toBe(false);
  });

  it("valide un GIF89a", () => {
    const buf = Buffer.from("GIF89a", "ascii");
    expect(verifyMagicBytes("image/gif", buf)).toBe(true);
  });

  it("refuse un MIME hors whitelist (documents Office ne sont plus supportés)", () => {
    const docxBuf = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(
      verifyMagicBytes(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        docxBuf,
      ),
    ).toBe(false);
  });
});
