/**
 * Tests unitaires pour lib/microstore-goods-crud.ts — focus sur les fonctions
 * pures de sérialisation (pas d'appel réseau).
 */

import { describe, it, expect } from "vitest";
import {
  serializeSkuForApi,
  buildGoodsFormBody,
  type MicrostoreGoodsPayload,
  type MicrostoreSkuInput,
} from "@/lib/microstore-goods-crud";

describe("serializeSkuForApi", () => {
  it("inclut l'id quand fourni (SKU existant à préserver)", () => {
    const sku: MicrostoreSkuInput = {
      id: 25443,
      color_id: 7,
      color_name: "Blanc",
      stock: 333,
      price: 56.98,
      orderBy: 1,
      goodsSn: "2039760025443",
      bhbStatus: 1,
    };
    const out = serializeSkuForApi(sku) as Record<string, unknown>;
    expect(out.id).toBe(25443);
    expect(out.color_id).toBe("7");
    expect(out.color_name).toBe("Blanc");
    expect(out.stock_1).toBe("333");
    expect(out.num_1).toBe("333");
    expect(out.price).toBe("56.98");
    expect(out.price_1).toBe("56.98");
    expect(out.goods_sn).toBe("2039760025443");
    expect(out.bhb_status).toBe(1);
    expect(out.imgs).toEqual([""]); // SKU existant → un placeholder image
  });

  it("omet l'id pour un nouveau SKU (create)", () => {
    const sku: MicrostoreSkuInput = {
      color_id: "39",
      color_name: "Rose",
      stock: 789,
      price: 56.98,
      orderBy: 2,
    };
    const out = serializeSkuForApi(sku) as Record<string, unknown>;
    expect(out.id).toBeUndefined();
    expect(out.imgs).toEqual([]); // nouveau SKU → pas de placeholder
    expect(out.bhb_status).toBe(1); // nouveau → 1 par défaut (actif H5)
    expect(out.goods_sn).toBe("");
  });

  it("force color_id en string (l'API accepte les 2 mais les HAR envoient string)", () => {
    const out = serializeSkuForApi({
      color_id: 94, // number en entrée
      color_name: "Bleu-19",
      stock: 35,
      price: 12.5,
      orderBy: 1,
    }) as Record<string, unknown>;
    expect(out.color_id).toBe("94");
  });

  it("formate le prix avec 2 décimales (jamais d'entier ou float scientifique)", () => {
    const out = serializeSkuForApi({
      color_id: "1",
      color_name: "Test",
      stock: 1,
      price: 12,
      orderBy: 1,
    }) as Record<string, unknown>;
    expect(out.price).toBe("12.00");
    expect(out.price_1).toBe("12.00");
  });

  it("sale_1..sale_4 = '1.0000' quand aucune remise", () => {
    const out = serializeSkuForApi({
      color_id: "1",
      color_name: "Test",
      stock: 1,
      price: 10,
      orderBy: 1,
    }) as Record<string, unknown>;
    expect(out.sale_1).toBe("1.0000");
    expect(out.sale_2).toBe("1.0000");
    expect(out.sale_3).toBe("1.0000");
    expect(out.sale_4).toBe("1.0000");
  });

  it("sale_1..sale_4 = facteur remise (0.75 pour -25 %)", () => {
    const out = serializeSkuForApi({
      color_id: "1",
      color_name: "Test",
      stock: 1,
      price: 10,
      orderBy: 1,
      saleFactor: 0.75,
    }) as Record<string, unknown>;
    expect(out.sale_1).toBe("0.7500");
    expect(out.sale_4).toBe("0.7500");
  });

  it("clampe le facteur remise dans [0, 1] (protège contre valeurs invalides)", () => {
    const overOne = serializeSkuForApi({
      color_id: "1", color_name: "Test", stock: 1, price: 10, orderBy: 1,
      saleFactor: 1.5,
    }) as Record<string, unknown>;
    expect(overOne.sale_1).toBe("1.0000");

    const negative = serializeSkuForApi({
      color_id: "1", color_name: "Test", stock: 1, price: 10, orderBy: 1,
      saleFactor: -0.2,
    }) as Record<string, unknown>;
    expect(negative.sale_1).toBe("0.0000");
  });
});

describe("buildGoodsFormBody", () => {
  const basePayload: MicrostoreGoodsPayload = {
    itemRef: "TESTPRODUIT",
    name: "PRODUIT TEST NOM",
    desc: "Description test",
    price: 56.12,
    weightGrams: 25,
    productCountry: "CN",
    remarkMaterial: "50% Laiton - 50% Acier inoxydable",
    remarkPackage: 1,
    catId: 495,
    brandId: 50,
    yearId: 160,
    seasonId: 165,
    skus: [
      {
        color_id: 158,
        color_name: "Anthracite",
        stock: 125,
        price: 56.12,
        orderBy: 1,
      },
    ],
  };

  it("pour un CREATE (productId=null), omet le champ id", () => {
    const body = buildGoodsFormBody({
      sessionKey: "5_test",
      productId: null,
      payload: basePayload,
    });
    expect(body.get("id")).toBeNull();
    expect(body.get("item_ref")).toBe("TESTPRODUIT");
    expect(body.get("name")).toBe("PRODUIT TEST NOM");
  });

  it("pour un UPDATE, inclut id + del_id JSON string", () => {
    const body = buildGoodsFormBody({
      sessionKey: "5_test",
      productId: 10929,
      payload: basePayload,
      deleteVariantIds: [25440, 25441],
    });
    expect(body.get("id")).toBe("10929");
    expect(body.get("del_id")).toBe('["25440","25441"]');
  });

  it("del_id vaut '[]' quand aucune suppression demandée", () => {
    const body = buildGoodsFormBody({
      sessionKey: "5_test",
      productId: 10929,
      payload: basePayload,
    });
    expect(body.get("del_id")).toBe("[]");
  });

  it("sérialise le tableau sku[] en JSON string (form-urlencoded)", () => {
    const body = buildGoodsFormBody({
      sessionKey: "5_test",
      productId: null,
      payload: basePayload,
    });
    const skuStr = body.get("sku");
    expect(skuStr).toBeTruthy();
    const parsed = JSON.parse(skuStr!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].color_id).toBe("158");
    expect(parsed[0].color_name).toBe("Anthracite");
    expect(parsed[0].stock_1).toBe("125");
    expect(parsed[0].id).toBeUndefined(); // nouveau SKU
  });

  it("préserve tous les champs constants du HAR mobile (app_pid, api_version, lang…)", () => {
    const body = buildGoodsFormBody({
      sessionKey: "5_test",
      productId: null,
      payload: basePayload,
    });
    expect(body.get("app_pid")).toBe("91");
    expect(body.get("api_version")).toBe("1.0");
    expect(body.get("lang")).toBe("en");
    expect(body.get("app_version")).toBe("2.76.21");
    expect(body.get("box1")).toBe("0");
    expect(body.get("box2")).toBe("0");
    expect(body.get("box3")).toBe("0");
    expect(body.get("size_list")).toBe("[]");
    expect(body.get("size_ratio_switch")).toBe("0");
    expect(body.get("new_order")).toBe("1");
  });

  it("le pays vaut CN par défaut si vide (jamais chaîne vide qui écraserait Microstore)", () => {
    const body = buildGoodsFormBody({
      sessionKey: "5_test",
      productId: null,
      payload: { ...basePayload, productCountry: "" },
    });
    expect(body.get("product_country")).toBe("CN");
  });

  it("sale_1..sale_4 (niveau produit) suivent le facteur remise du payload", () => {
    const body = buildGoodsFormBody({
      sessionKey: "5_test",
      productId: null,
      payload: { ...basePayload, saleFactor: 0.9 },
    });
    expect(body.get("sale_1")).toBe("0.9000");
    expect(body.get("sale_2")).toBe("0.9000");
    expect(body.get("sale_3")).toBe("0.9000");
    expect(body.get("sale_4")).toBe("0.9000");
  });

  it("sale_1..sale_4 (niveau produit) = '1.0000' sans saleFactor (défaut = pas de remise)", () => {
    const body = buildGoodsFormBody({
      sessionKey: "5_test",
      productId: null,
      payload: basePayload,
    });
    expect(body.get("sale_1")).toBe("1.0000");
    expect(body.get("sale_4")).toBe("1.0000");
  });

  it("num_per_pack vaut 1 par défaut si non fourni", () => {
    const body = buildGoodsFormBody({
      sessionKey: "5_test",
      productId: null,
      payload: basePayload,
    });
    expect(body.get("num_per_pack")).toBe("1");
  });

  it("mix create + preserve : les SKUs existants gardent leur id, les nouveaux non", () => {
    const body = buildGoodsFormBody({
      sessionKey: "5_test",
      productId: 10929,
      payload: {
        ...basePayload,
        skus: [
          { id: 25443, color_id: 7, color_name: "Blanc", stock: 333, price: 56.98, orderBy: 1 },
          { color_id: 39, color_name: "Rose", stock: 789, price: 56.98, orderBy: 2 },
        ],
      },
    });
    const parsed = JSON.parse(body.get("sku")!);
    expect(parsed[0].id).toBe(25443);
    expect(parsed[0].color_name).toBe("Blanc");
    expect(parsed[1].id).toBeUndefined();
    expect(parsed[1].color_name).toBe("Rose");
    expect(parsed[1].stock_1).toBe("789");
  });
});
