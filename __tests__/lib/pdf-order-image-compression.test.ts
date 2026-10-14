import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { compressImageForPdf } from "@/lib/pdf-order";

async function makePng(width: number, height: number, channels: 3 | 4 = 3, rgba = { r: 128, g: 200, b: 50, alpha: 1 }): Promise<Buffer> {
  return sharp({
    create: { width, height, channels, background: rgba },
  })
    .png()
    .toBuffer();
}

describe("compressImageForPdf", () => {
  it("renvoie un buffer JPEG (magic bytes FF D8 FF)", async () => {
    const raw = await makePng(400, 400);
    const out = await compressImageForPdf(raw);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out[2]).toBe(0xff);
  });

  it("réduit drastiquement le poids d'une image lossless 2000x2000", async () => {
    const raw = await makePng(2000, 2000);
    const out = await compressImageForPdf(raw);
    // Un fond uni compresse enormement : on exige au moins /10
    expect(out.length).toBeLessThan(raw.length / 10);
  });

  it("plafonne la plus grande dimension a 540 px pour une image carree", async () => {
    const raw = await makePng(2000, 2000);
    const out = await compressImageForPdf(raw);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(540);
    expect(meta.height).toBe(540);
  });

  it("preserve le ratio pour une image rectangulaire 2000x1000", async () => {
    const raw = await makePng(2000, 1000);
    const out = await compressImageForPdf(raw);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(540);
    expect(meta.height).toBe(270);
  });

  it("n'agrandit pas une image deja plus petite que 540 px", async () => {
    const raw = await makePng(300, 300);
    const out = await compressImageForPdf(raw);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(300);
  });

  it("aplatit un fond transparent en blanc (sinon JPEG afficherait du noir)", async () => {
    const raw = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const out = await compressImageForPdf(raw);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const idx = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 3;
    expect(data[idx]).toBeGreaterThan(240);
    expect(data[idx + 1]).toBeGreaterThan(240);
    expect(data[idx + 2]).toBeGreaterThan(240);
  });
});
