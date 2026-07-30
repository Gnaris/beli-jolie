import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as crypto from "crypto";
import {
  extractPictureStationKey,
  validatePictureStationKey,
  buildOssObjectKey,
  buildOssPostPolicy,
  getMicrostoreOssToken,
  uploadImageToMicrostoreOss,
  getMicrostoreGoodsByItemRef,
  patchMicrostoreGoodsImages,
  bulkImportMicrostorePictures,
} from "@/lib/microstore-picture-station";

describe("extractPictureStationKey", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("retourne le key nu s'il ressemble à un token alphanumérique", async () => {
    expect(await extractPictureStationKey("NBqdsz")).toBe("NBqdsz");
    expect(await extractPictureStationKey("  abc123XY  ")).toBe("abc123XY");
  });

  it("refuse les tokens trop courts ou avec espaces", async () => {
    expect(await extractPictureStationKey("ab")).toBeNull();
    expect(await extractPictureStationKey("hello world")).toBeNull();
  });

  it("extrait le key d'une URL complète avec fragment", async () => {
    const url =
      "https://belijolie.microstore.app/imageTransferStation#/imageTransferStation?shortUrl=wuu9t&key=NBqdsz";
    expect(await extractPictureStationKey(url)).toBe("NBqdsz");
  });

  it("extrait le key d'une query string nue", async () => {
    expect(await extractPictureStationKey("?shortUrl=wuu9t&key=NBqdsz")).toBe("NBqdsz");
    expect(await extractPictureStationKey("shortUrl=wuu9t&key=NBqdsz")).toBe("NBqdsz");
  });

  it("suit la redirection d'un lien court microstore.app/s/…", async () => {
    // Microstore renvoie la 301 avec le fragment dans le header Location.
    // On lit la 301 en manual pour ne pas perdre le fragment.
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 301,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "location"
            ? "https://belijolie.microstore.app/imageTransferStation#/imageTransferStation?shortUrl=wuu9t&key=RESOLVED42"
            : null,
      },
    });
    expect(await extractPictureStationKey("https://microstore.app/s/wuu9t")).toBe(
      "RESOLVED42",
    );
  });

  it("retourne null pour une chaîne vide ou irrécupérable", async () => {
    expect(await extractPictureStationKey("")).toBeNull();
    expect(await extractPictureStationKey("https://google.com")).toBeNull();
  });
});

describe("validatePictureStationKey", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("retourne la date d'expiration quand Microstore répond avec un expiredTime futur", async () => {
    const future = Date.now() + 6 * 24 * 3600 * 1000;
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ expiredTime: future }),
    });
    const res = await validatePictureStationKey("NBqdsz");
    expect(res.key).toBe("NBqdsz");
    expect(res.expiresAt.getTime()).toBe(future);
  });

  it("throw si Microstore renvoie une expiration passée", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ expiredTime: Date.now() - 3600_000 }),
    });
    await expect(validatePictureStationKey("expired")).rejects.toThrow(/expiré/i);
  });

  it("throw sur une réponse sans expiredTime", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    await expect(validatePictureStationKey("bad")).rejects.toThrow();
  });

  it("throw sur un HTTP non-OK", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    await expect(validatePictureStationKey("bad")).rejects.toThrow(/HTTP 404/);
  });
});

describe("buildOssObjectKey", () => {
  it("respecte la convention <companyId>/MSH5_<hash>.<EXT>", () => {
    const k = buildOssObjectKey(3976, "photo.jpg");
    expect(k).toMatch(/^3976\/MSH5_[a-f0-9]{32}\.JPG$/);
  });

  it("uppercase l'extension mais garde le companyId numérique", () => {
    const k = buildOssObjectKey(3976, "IMG_0001.PNG");
    expect(k).toMatch(/^3976\/MSH5_[a-f0-9]{32}\.PNG$/);
  });

  it("tolère un fichier sans extension et pose 'JPG' par défaut", () => {
    const k = buildOssObjectKey(3976, "sans-extension");
    expect(k).toMatch(/^3976\/MSH5_[a-f0-9]{32}\.JPG$/);
  });

  it("génère des noms uniques à chaque appel", () => {
    const a = buildOssObjectKey(3976, "x.jpg");
    const b = buildOssObjectKey(3976, "x.jpg");
    expect(a).not.toBe(b);
  });
});

describe("buildOssPostPolicy", () => {
  it("renvoie une policy base64 décodable en JSON valide", () => {
    const { policy } = buildOssPostPolicy("secret");
    const decoded = JSON.parse(Buffer.from(policy, "base64").toString("utf8"));
    expect(decoded.expiration).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
    expect(decoded.conditions).toEqual([["content-length-range", 0, 20 * 1024 * 1024]]);
  });

  it("signature = HMAC-SHA1 base64 du policy avec le secret", () => {
    const { policy, signature } = buildOssPostPolicy("mySecret");
    const expected = crypto
      .createHmac("sha1", "mySecret")
      .update(policy)
      .digest("base64");
    expect(signature).toBe(expected);
  });

  it("respecte maxSizeBytes personnalisé", () => {
    const { policy } = buildOssPostPolicy("secret", { maxSizeBytes: 500 });
    const decoded = JSON.parse(Buffer.from(policy, "base64").toString("utf8"));
    expect(decoded.conditions).toEqual([["content-length-range", 0, 500]]);
  });
});

describe("getMicrostoreOssToken", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("parse la réponse et retourne les credentials", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessKeyId: "STS.abc",
        accessKeySecret: "secret42",
        securityToken: "tok",
        ossRegion: "oss-eu-central-1",
        ossHost: "https://dcdn.microstore.app",
        ossBucket: "micro-store-bucket",
        ossCdnHost: "https://dcdn.microstore.app",
        ossUploadUrl: "https://dcdn.microstore.app",
      }),
    });
    const token = await getMicrostoreOssToken("NBqdsz");
    expect(token.accessKeyId).toBe("STS.abc");
    expect(token.ossUploadUrl).toBe("https://dcdn.microstore.app");
  });

  it("throw si la réponse ne contient pas accessKeyId", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    await expect(getMicrostoreOssToken("bad")).rejects.toThrow(/invalide/i);
  });
});

describe("uploadImageToMicrostoreOss", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("chaine ossToken → POST multipart → renvoie URL CDN", async () => {
    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessKeyId: "STS.abc",
        accessKeySecret: "secret42",
        securityToken: "tok",
        ossRegion: "oss-eu-central-1",
        ossHost: "https://dcdn.microstore.app",
        ossBucket: "micro-store-bucket",
        ossCdnHost: "https://dcdn.microstore.app",
        ossUploadUrl: "https://dcdn.microstore.app",
      }),
    });
    mock.mockResolvedValueOnce({ ok: true });

    const buffer = Buffer.from("fake image bytes");
    const res = await uploadImageToMicrostoreOss("NBqdsz", 3976, buffer, "test.png");

    expect(res.publicUrl).toMatch(
      /^https:\/\/dcdn\.microstore\.app\/3976\/MSH5_[a-f0-9]{32}\.PNG$/,
    );
    expect(res.size).toBe(buffer.byteLength);

    // Vérifie qu'on a bien envoyé un multipart POST vers ossUploadUrl
    const [url, init] = mock.mock.calls[1];
    expect(url).toBe("https://dcdn.microstore.app");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("OSSAccessKeyId")).toBe("STS.abc");
    expect(form.get("success_action_status")).toBe("200");
    expect(form.get("x-oss-security-token")).toBe("tok");
    expect(form.get("key")).toMatch(/^3976\/MSH5_[a-f0-9]{32}\.PNG$/);
    expect(typeof form.get("policy")).toBe("string");
    expect(typeof form.get("signature")).toBe("string");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("throw si l'OSS renvoie un HTTP non-OK", async () => {
    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessKeyId: "STS.abc",
        accessKeySecret: "secret",
        securityToken: "tok",
        ossRegion: "x",
        ossHost: "https://dcdn.microstore.app",
        ossBucket: "b",
        ossCdnHost: "https://dcdn.microstore.app",
        ossUploadUrl: "https://dcdn.microstore.app",
      }),
    });
    mock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "SignatureDoesNotMatch",
    });
    await expect(
      uploadImageToMicrostoreOss("NBqdsz", 3976, Buffer.from(""), "x.jpg"),
    ).rejects.toThrow(/HTTP 403.*SignatureDoesNotMatch/);
  });
});

describe("getMicrostoreGoodsByItemRef", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("retourne goodsId + skus quand Microstore trouve la référence", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        goodsId: 10726,
        itemRef: "A2620",
        name: "Chaîne",
        skus: [
          { skuId: 24901, colorId: 33, colorName: "Doré", sizeName: "" },
          { skuId: 24902, colorId: 34, colorName: "Argent", sizeName: "" },
        ],
      }),
    });
    const res = await getMicrostoreGoodsByItemRef("NBqdsz", "A2620");
    expect(res?.goodsId).toBe(10726);
    expect(res?.skus).toHaveLength(2);
    expect(res?.skus[0].colorName).toBe("Doré");
  });

  it("retourne null si Microstore renvoie 404", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    expect(await getMicrostoreGoodsByItemRef("NBqdsz", "INEXISTANT")).toBeNull();
  });

  it("retourne null si la réponse n'a pas de goodsId", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    expect(await getMicrostoreGoodsByItemRef("NBqdsz", "X")).toBeNull();
  });
});

describe("patchMicrostoreGoodsImages", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("envoie un PATCH JSON avec le bon body", async () => {
    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({ ok: true });
    await patchMicrostoreGoodsImages("NBqdsz", 10726, {
      coverImage: "https://dcdn.microstore.app/3976/MSH5_a.JPG",
      mainImages: [],
      imageSetting: {
        skuImage: [
          { skuIds: [24901], images: ["https://dcdn.microstore.app/3976/MSH5_a.JPG"] },
        ],
      },
    });
    const [url, init] = mock.mock.calls[0];
    expect(url).toContain("/api/goods/10726");
    expect(url).toContain("pictureStationKey=NBqdsz");
    expect(init?.method).toBe("PATCH");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json; charset=utf-8" });
    const body = JSON.parse(init?.body as string);
    expect(body.coverImage).toBe("https://dcdn.microstore.app/3976/MSH5_a.JPG");
    expect(body.imageSetting.skuImage[0].skuIds).toEqual([24901]);
  });

  it("throw sur un HTTP non-OK avec le message d'erreur", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => "InvalidSkuId",
    });
    await expect(
      patchMicrostoreGoodsImages("NBqdsz", 99, {
        coverImage: "",
        mainImages: [],
        imageSetting: { skuImage: [] },
      }),
    ).rejects.toThrow(/HTTP 422.*InvalidSkuId/);
  });
});

describe("bulkImportMicrostorePictures", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("envoie un POST JSON avec pictures[] et respecte les params HAR", async () => {
    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ successCount: 2, failedCount: 0, causes: [] }),
    });
    const res = await bulkImportMicrostorePictures("NBqdsz", [
      {
        name: "A2620 Argent 1",
        fileName: "A2620 Argent 1.JPG",
        image: "https://dcdn.microstore.app/3976/MSH5_a.JPG",
        goodsImageSetting: { itemRef: "A2620", colorName: "Argent", order: 1 },
      },
      {
        name: "A2620 Doré 1",
        fileName: "A2620 Doré 1.JPG",
        image: "https://dcdn.microstore.app/3976/MSH5_b.JPG",
        goodsImageSetting: { itemRef: "A2620", colorName: "Doré", order: 1 },
      },
    ]);
    expect(res.successCount).toBe(2);
    expect(res.failedCount).toBe(0);

    const [url, init] = mock.mock.calls[0];
    expect(url).toContain("/api/v3/pictureStations");
    expect(url).toContain("importToGoods=true");
    expect(url).toContain("mixSymbol=mix");
    expect(url).toContain("pictureStationKey=NBqdsz");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.pictures).toHaveLength(2);
    expect(body.pictures[0].goodsImageSetting).toEqual({
      itemRef: "A2620",
      colorName: "Argent",
      order: 1,
    });
  });

  it("throw sur un HTTP non-OK", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "InternalError",
    });
    await expect(bulkImportMicrostorePictures("NBqdsz", [])).rejects.toThrow(
      /HTTP 500.*InternalError/,
    );
  });
});
