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

// Le proxy appelle getCurrentTenantSlug() qui lit next/headers — indisponible
// hors requête réelle. On désactive l'isolation multi-tenant dans les tests
// unitaires (renvoyer null = pas de garde-fou).
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantSlug: vi.fn(async () => null),
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

  it("upscales a small image so that BOTH sides reach ≥ 500 px", async () => {
    // 400×300 : la plus petite dimension (300) est la hauteur, donc le
    // facteur d'agrandissement est 500/300 ≈ 1.667. La largeur devient
    // 667, la hauteur pile 500. Ankorstore refuse toute image dont l'un
    // des côtés est < 500 px.
    const dbPath = await writeTestImage("small.webp", 400, 300);
    const res = await GET(makeRequest(dbPath));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    const body = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(body).metadata();
    expect(meta.width).toBe(667);
    expect(meta.height).toBe(500);
  });

  it("upscales an image whose ONLY the height is < 500 (regression : jg52-blanc-2 600×338)", async () => {
    // Cas réel : /uploads/issyma/produits/jg52/jg52-blanc-2.webp faisait
    // 600×338 → Ankorstore renvoyait « image height too small (338px) ».
    // Le proxy renvoyait la source telle quelle car `Number("") === 0` et
    // `Number.isFinite(0)` étant `true`, le seuil default de 500 n'était
    // jamais appliqué. Le fix distingue "param absent" de "param=0".
    const dbPath = await writeTestImage("short.webp", 600, 338);
    const res = await GET(makeRequest(dbPath));
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(body).metadata();
    expect(meta.height).toBeGreaterThanOrEqual(500);
    expect(meta.width).toBeGreaterThanOrEqual(500);
  });

  it("honors ?minHeight=0 to explicitly disable the height floor", async () => {
    // Régression opposée : quand un appelant veut n'assurer que la largeur
    // (Faire par ex.), il passe minHeight=0. On doit lui laisser le contrôle.
    const dbPath = await writeTestImage("noheight.webp", 400, 300);
    const url = new URL("http://localhost/api/marketplace-image");
    url.searchParams.set("path", dbPath);
    url.searchParams.set("minHeight", "0");
    const req = new Request(url) as unknown as import("next/server").NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(200);
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
