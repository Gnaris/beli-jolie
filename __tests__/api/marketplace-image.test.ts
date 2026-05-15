/**
 * Tests pour app/api/marketplace-image/route.ts
 *
 * Vérifie que la route sert correctement les images, en les upscalant à la
 * volée seulement quand leur largeur est inférieure à 500px.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { GET } from "@/app/api/marketplace-image/route";

const TEST_PREFIX = "uploads/__test_marketplace_image__";
const TEST_DIR_ABS = path.resolve(process.cwd(), "public", TEST_PREFIX);

async function writeTestImage(
  filename: string,
  width: number,
  height: number,
): Promise<string> {
  await fs.mkdir(TEST_DIR_ABS, { recursive: true });
  const abs = path.join(TEST_DIR_ABS, filename);
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 50, g: 80, b: 120 } },
  })
    .webp({ lossless: true })
    .toBuffer();
  await fs.writeFile(abs, buffer);
  return `/${TEST_PREFIX}/${filename}`;
}

function makeRequest(dbPath: string | null): import("next/server").NextRequest {
  const url = new URL("http://localhost/api/marketplace-image");
  if (dbPath !== null) url.searchParams.set("path", dbPath);
  // NextRequest reste compatible avec un Request basique pour nos besoins
  const req = new Request(url) as unknown as import("next/server").NextRequest;
  return req;
}

beforeEach(async () => {
  await fs.rm(TEST_DIR_ABS, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(TEST_DIR_ABS, { recursive: true, force: true });
});

describe("GET /api/marketplace-image", () => {
  it("returns 400 when path query param is missing", async () => {
    const res = await GET(makeRequest(null));
    expect(res.status).toBe(400);
  });

  it("returns 400 when path is not under /uploads/", async () => {
    const res = await GET(makeRequest("/etc/passwd"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty path", async () => {
    const res = await GET(makeRequest(""));
    expect(res.status).toBe(400);
  });

  it("returns 404 for missing file", async () => {
    const res = await GET(makeRequest(`/${TEST_PREFIX}/missing.webp`));
    expect(res.status).toBe(404);
  });

  it("serves a large image unchanged (≥ 500px width)", async () => {
    const dbPath = await writeTestImage("big.webp", 800, 600);
    const res = await GET(makeRequest(dbPath));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    const body = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(body).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  it("upscales a small image to 500px width on the fly", async () => {
    const dbPath = await writeTestImage("small.webp", 400, 300);
    const res = await GET(makeRequest(dbPath));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    const body = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(body).metadata();
    expect(meta.width).toBe(500);
    // Ratio préservé : 300 × (500/400) = 375
    expect(meta.height).toBe(375);
  });

  it("sets long-lived cache headers", async () => {
    const dbPath = await writeTestImage("cached.webp", 800, 800);
    const res = await GET(makeRequest(dbPath));
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("does NOT modify the source file on disk", async () => {
    const dbPath = await writeTestImage("source.webp", 400, 400);
    const absBefore = path.join(TEST_DIR_ABS, "source.webp");
    const beforeBuf = await fs.readFile(absBefore);
    const beforeMeta = await sharp(beforeBuf).metadata();
    expect(beforeMeta.width).toBe(400);

    await GET(makeRequest(dbPath));

    const afterBuf = await fs.readFile(absBefore);
    const afterMeta = await sharp(afterBuf).metadata();
    expect(afterMeta.width).toBe(400);
    expect(afterBuf.equals(beforeBuf)).toBe(true);
  });
});
