import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { sanitizeImage, assertPdfSafe } from "@/lib/upload-security";

/**
 * Ces tests vérifient que l'assainissement des fichiers uploadés à
 * l'inscription bloque bien les vecteurs d'attaque courants sur les
 * justificatifs d'entreprise.
 */

async function makeJpeg(exifComment = ""): Promise<Buffer> {
  return sharp({ create: { width: 10, height: 10, channels: 3, background: "#ffffff" } })
    .withMetadata({ exif: exifComment ? { IFD0: { Copyright: exifComment } } : undefined })
    .jpeg()
    .toBuffer();
}

describe("sanitizeImage — Sharp re-encode strip payloads", () => {
  it("re-encode un JPEG valide et purge les métadonnées", async () => {
    const input = await makeJpeg("copyright-malveillant");
    const { buffer, mime, extension } = await sanitizeImage(input, "image/jpeg");
    expect(mime).toBe("image/jpeg");
    expect(extension).toBe("jpg");
    // Sharp par défaut ne conserve pas les métadonnées → EXIF purgé.
    const meta = await sharp(buffer).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("bloque un PDF déguisé en JPEG (polyglot)", async () => {
    const fakeJpeg = Buffer.from("%PDF-1.4 malicious payload here");
    await expect(sanitizeImage(fakeJpeg, "image/jpeg")).rejects.toThrow();
  });

  it("refuse un MIME non-image (SVG interdit — vecteur XSS)", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await expect(sanitizeImage(svg, "image/svg+xml" as never)).rejects.toThrow(
      /non autorisé/i,
    );
  });

  it("re-encode un PNG valide", async () => {
    const input = await sharp({
      create: { width: 5, height: 5, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const { mime, extension } = await sanitizeImage(input, "image/png");
    expect(mime).toBe("image/png");
    expect(extension).toBe("png");
  });
});

describe("assertPdfSafe — refus des PDF à actions automatiques", () => {
  it("accepte un PDF minimal sans code exécutable", () => {
    const buf = Buffer.from("%PDF-1.4\n%%EOF\n");
    expect(() => assertPdfSafe(buf)).not.toThrow();
  });

  it("rejette un fichier non-PDF (mauvais magic bytes)", () => {
    const buf = Buffer.from("not a pdf");
    expect(() => assertPdfSafe(buf)).toThrow(/PDF/);
  });

  it("rejette un PDF contenant /JavaScript", () => {
    const buf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /JavaScript (alert('x')) >>\nendobj\n%%EOF");
    expect(() => assertPdfSafe(buf)).toThrow(/code exécutable|action automatique/i);
  });

  it("rejette un PDF contenant /Launch (exec de fichier externe)", () => {
    const buf = Buffer.from("%PDF-1.4\n<< /Launch /F (calc.exe) >>\n%%EOF");
    expect(() => assertPdfSafe(buf)).toThrow(/code exécutable|action automatique/i);
  });

  it("rejette un PDF contenant /OpenAction", () => {
    const buf = Buffer.from("%PDF-1.4\n<< /OpenAction << >> >>\n%%EOF");
    expect(() => assertPdfSafe(buf)).toThrow(/code exécutable|action automatique/i);
  });

  it("rejette un PDF contenant /EmbeddedFile", () => {
    const buf = Buffer.from("%PDF-1.4\n<< /EmbeddedFile 12 0 R >>\n%%EOF");
    expect(() => assertPdfSafe(buf)).toThrow(/code exécutable|action automatique/i);
  });
});
