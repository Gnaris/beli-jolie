/**
 * Tests pour lib/smarty365.ts
 *
 * Couvre les briques critiques du client Smarty365 :
 *   - carrierId (build/parse/roundtrip)
 *   - selection tranche de poids (pickPricingRow)
 *   - calcul prix avec/sans carburant (computeSmartyRangePrice)
 *   - cotation avec filtrage par pays + prix (smarty365Rates)
 *   - création parcel (createSmarty365Parcel : succès + erreurs API)
 *   - téléchargement label (fallback S3 sans header puis retry avec Bearer)
 *
 * Toutes les dépendances externes (cached-data, logger, fetch, tenant-als)
 * sont mockées. Aucun appel réseau réel.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/tenant-als", () => ({
  getCurrentTenantIdSync: vi.fn().mockReturnValue("tenant-test"),
  tenantALS: { run: (_tid: string, fn: () => unknown) => fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Grille tarifaire minimale utilisée par plusieurs tests.
const CHRONO_FR_FR_RANGE = {
  id: 1,
  state: "PUBLISHED" as const,
  applyFuelTax: true,
  validPeriod: [{ startAt: "2026-01-01", endAt: "2099-12-31" }],
  pricingTable: [
    { fee: 8, type: "common", minWeight: 0, maxWeight: 1, minQuantity: 1 },
    { fee: 10, type: "common", minWeight: 1, maxWeight: 5, minQuantity: 1 },
    { fee: 15, type: "common", minWeight: 5, maxWeight: 15, minQuantity: 1 },
    { fee: 25, type: "common", minWeight: 15, maxWeight: 30, minQuantity: 1 },
  ],
  pricingUnit: {
    id: 100,
    senderCountryCodes: ["FR"],
    receiverCountryCodes: ["FR"],
    limitation: "1 - 2 jours",
    routeId: 1000,
    route: {
      id: 1000,
      transporter: "CHRONOPOST",
      code: "CHRONO_FR",
      name: "Chronopost France",
    },
  },
};

const COLISSIMO_FR_FR_RANGE = {
  ...CHRONO_FR_FR_RANGE,
  id: 2,
  applyFuelTax: false,
  pricingTable: [
    { fee: 5.5, type: "common", minWeight: 0, maxWeight: 2, minQuantity: 1 },
  ],
  pricingUnit: {
    ...CHRONO_FR_FR_RANGE.pricingUnit,
    id: 101,
    routeId: 2000,
    limitation: "2 - 3 jours",
    route: { id: 2000, transporter: "COLISSIMO", code: "COLIS_FR", name: "Colissimo France" },
  },
};

const CHRONO_EXPIRED = {
  ...CHRONO_FR_FR_RANGE,
  id: 3,
  state: "EXPIRED" as const,
  pricingTable: [{ fee: 2, type: "common", minWeight: 0, maxWeight: 30, minQuantity: 1 }],
};

const CHRONO_FR_BE_RANGE = {
  ...CHRONO_FR_FR_RANGE,
  id: 4,
  pricingTable: [{ fee: 20, type: "common", minWeight: 0, maxWeight: 30, minQuantity: 1 }],
  pricingUnit: {
    ...CHRONO_FR_FR_RANGE.pricingUnit,
    id: 102,
    receiverCountryCodes: ["BE"],
  },
};

function mockJson(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe("lib/smarty365", () => {
  let mod: typeof import("@/lib/smarty365");
  let cachedDataMock: {
    getCachedSmarty365ApiKey: ReturnType<typeof vi.fn>;
    getCachedCompanyInfo: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockReset();

    cachedDataMock = {
      getCachedSmarty365ApiKey: vi.fn().mockResolvedValue("jwt-test-token"),
      getCachedCompanyInfo: vi.fn().mockResolvedValue({
        name: "Beli & Jolie",
        shopName: "Beli & Jolie",
        email: "contact@beliandjolie.com",
        phone: "0782758158",
        address: "90 rue de la Haie Coq",
        city: "Aubervilliers",
        postalCode: "93300",
        country: "FR",
        siret: "43450618400044",
      }),
    };

    vi.doMock("@/lib/cached-data", () => cachedDataMock);
    vi.doMock("@/lib/logger", () => ({
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
    vi.doMock("@/lib/tenant-als", () => ({
      getCurrentTenantIdSync: () => "tenant-test",
      tenantALS: { run: (_t: string, fn: () => unknown) => fn() },
    }));

    mod = await import("@/lib/smarty365");
    mod.clearSmarty365RangesCache();
  });

  // ─── carrierId helpers ────────────────────────────────────────────

  describe("carrierId helpers", () => {
    it("build/parse roundtrip", () => {
      const id = mod.buildSmarty365CarrierId("CHRONOPOST", "CHRONOPOST_SML_CLASSIC");
      expect(id).toBe("smarty:CHRONOPOST:CHRONOPOST_SML_CLASSIC");
      const parsed = mod.parseSmarty365CarrierId(id);
      expect(parsed).toEqual({ transporter: "CHRONOPOST", routeCode: "CHRONOPOST_SML_CLASSIC" });
    });

    it("gère les route codes contenant des ':'", () => {
      const id = "smarty:X:Y:Z";
      const parsed = mod.parseSmarty365CarrierId(id);
      expect(parsed).toEqual({ transporter: "X", routeCode: "Y:Z" });
    });

    it("isSmarty365CarrierId reconnaît le préfixe", () => {
      expect(mod.isSmarty365CarrierId("smarty:X:Y")).toBe(true);
      expect(mod.isSmarty365CarrierId("base64==")).toBe(false);
      expect(mod.isSmarty365CarrierId(null)).toBe(false);
      expect(mod.isSmarty365CarrierId(undefined)).toBe(false);
    });

    it("parseSmarty365CarrierId retourne null si mal formé", () => {
      expect(mod.parseSmarty365CarrierId("smarty:CHRONO")).toBeNull(); // pas de deuxième :
      expect(mod.parseSmarty365CarrierId("autre:X:Y")).toBeNull();
    });
  });

  // ─── pickPricingRow ────────────────────────────────────────────────

  describe("pickPricingRow", () => {
    const rows = [
      { fee: 8, type: "common", minWeight: 0, maxWeight: 1, minQuantity: 1 },
      { fee: 10, type: "common", minWeight: 1, maxWeight: 5, minQuantity: 1 },
      { fee: 15, type: "common", minWeight: 5, maxWeight: 15, minQuantity: 1 },
    ];

    it("choisit la bonne tranche", () => {
      expect(mod.pickPricingRow(rows, 0.8)?.fee).toBe(8);
      expect(mod.pickPricingRow(rows, 1)?.fee).toBe(8); // limite haute incluse
      expect(mod.pickPricingRow(rows, 1.001)?.fee).toBe(10);
      expect(mod.pickPricingRow(rows, 5)?.fee).toBe(10);
      expect(mod.pickPricingRow(rows, 5.5)?.fee).toBe(15);
    });

    it("retourne null si poids hors barème", () => {
      expect(mod.pickPricingRow(rows, 20)).toBeNull();
    });

    it("ignore les tranches de type 'special_areas'", () => {
      const withSpecial = [
        { fee: 100, type: "special_areas", minWeight: 0, maxWeight: 5, minQuantity: 1 },
        { fee: 10, type: "common", minWeight: 0, maxWeight: 5, minQuantity: 1 },
      ];
      expect(mod.pickPricingRow(withSpecial, 1)?.fee).toBe(10);
    });
  });

  // ─── computeSmartyRangePrice ───────────────────────────────────────

  describe("computeSmartyRangePrice", () => {
    it("sans fuel tax : renvoie le prix brut", () => {
      const price = mod.computeSmartyRangePrice(COLISSIMO_FR_FR_RANGE, 1);
      expect(price).toBe(5.5);
    });

    it("avec fuel tax 20.35 % : applique la majoration", () => {
      // Tranche 8 € × 1.2035 = 9.628 → 9.63 arrondi
      const price = mod.computeSmartyRangePrice(CHRONO_FR_FR_RANGE, 0.8);
      expect(price).toBe(9.63);
    });

    it("respecte le taux fuel tax custom", () => {
      const price = mod.computeSmartyRangePrice(CHRONO_FR_FR_RANGE, 0.8, 10);
      // 8 × 1.10 = 8.80
      expect(price).toBe(8.8);
    });

    it("retourne null si poids hors barème", () => {
      const price = mod.computeSmartyRangePrice(CHRONO_FR_FR_RANGE, 50);
      expect(price).toBeNull();
    });
  });

  // ─── smarty365Rates ────────────────────────────────────────────────

  describe("smarty365Rates", () => {
    it("retourne les routes triées par prix croissant, filtrées par pays", async () => {
      mockFetch.mockResolvedValueOnce(mockJson({
        data: [CHRONO_FR_FR_RANGE, COLISSIMO_FR_FR_RANGE, CHRONO_FR_BE_RANGE, CHRONO_EXPIRED],
      }));
      const res = await mod.smarty365Rates({
        receiverCountry: "FR",
        receiverZipCode: "75001",
        weightKg: 1,
      });
      expect(res.success).toBe(true);
      if (!res.success) return;
      // Colissimo (5.50) doit passer avant Chrono (8 × 1.2035 = 9.63)
      expect(res.carriers).toHaveLength(2);
      expect(res.carriers[0].transporter).toBe("COLISSIMO");
      expect(res.carriers[0].price).toBe(5.5);
      expect(res.carriers[1].transporter).toBe("CHRONOPOST");
      expect(res.carriers[1].price).toBe(9.63);
    });

    it("ne renvoie aucun tarif pour un pays non couvert", async () => {
      mockFetch.mockResolvedValueOnce(mockJson({ data: [CHRONO_FR_FR_RANGE, COLISSIMO_FR_FR_RANGE] }));
      const res = await mod.smarty365Rates({
        receiverCountry: "US",
        receiverZipCode: "10001",
        weightKg: 1,
      });
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.carriers).toHaveLength(0);
    });

    it("filtre les ranges EXPIRED", async () => {
      mockFetch.mockResolvedValueOnce(mockJson({ data: [CHRONO_EXPIRED] }));
      const res = await mod.smarty365Rates({
        receiverCountry: "FR",
        receiverZipCode: "75001",
        weightKg: 1,
      });
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.carriers).toHaveLength(0);
    });

    it("erreur si clé API manquante", async () => {
      cachedDataMock.getCachedSmarty365ApiKey.mockResolvedValueOnce(null);
      const res = await mod.smarty365Rates({
        receiverCountry: "FR",
        receiverZipCode: "75001",
        weightKg: 1,
      });
      expect(res.success).toBe(false);
    });

    it("masque toutes les routes point relais / bureau de poste", async () => {
      const relayPointRange = {
        ...CHRONO_FR_FR_RANGE,
        id: 10,
        pricingUnit: {
          ...CHRONO_FR_FR_RANGE.pricingUnit,
          route: { id: 900, transporter: "COLISSIMO", code: "COLISSIMO_RELAY_POINT_SML", name: "Colissimo Point Relais" },
        },
      };
      const postOfficeRange = {
        ...CHRONO_FR_FR_RANGE,
        id: 11,
        pricingUnit: {
          ...CHRONO_FR_FR_RANGE.pricingUnit,
          route: { id: 901, transporter: "COLISSIMO", code: "COLISSIMO_POST_OFFICE_SML", name: "Colissimo Bureau de Poste" },
        },
      };
      const mondialRelayRange = {
        ...CHRONO_FR_FR_RANGE,
        id: 12,
        pricingUnit: {
          ...CHRONO_FR_FR_RANGE.pricingUnit,
          route: { id: 902, transporter: "MONDIAL_RELAY", code: "MONDIAL_RELAY_HOME_FR", name: "Mondial Relay Home" },
        },
      };
      const chrono2ShopRange = {
        ...CHRONO_FR_FR_RANGE,
        id: 13,
        pricingUnit: {
          ...CHRONO_FR_FR_RANGE.pricingUnit,
          route: { id: 903, transporter: "CHRONOPOST", code: "CHRONOPOST_2SP_DIR_SML", name: "Chronopost 2Shop" },
        },
      };
      mockFetch.mockResolvedValueOnce(mockJson({
        data: [CHRONO_FR_FR_RANGE, relayPointRange, postOfficeRange, mondialRelayRange, chrono2ShopRange],
      }));
      const res = await mod.smarty365Rates({
        receiverCountry: "FR",
        receiverZipCode: "75001",
        weightKg: 1,
      });
      expect(res.success).toBe(true);
      if (!res.success) return;
      // Seule la route domicile (CHRONO_FR) doit passer le filtre
      expect(res.carriers).toHaveLength(1);
      expect(res.carriers[0].routeCode).toBe("CHRONO_FR");
    });

    it("garde la meilleure offre par route quand plusieurs contrats se recouvrent", async () => {
      const cheaper = {
        ...CHRONO_FR_FR_RANGE,
        id: 99,
        pricingTable: [{ fee: 3, type: "common", minWeight: 0, maxWeight: 5, minQuantity: 1 }],
      };
      mockFetch.mockResolvedValueOnce(mockJson({ data: [CHRONO_FR_FR_RANGE, cheaper] }));
      const res = await mod.smarty365Rates({
        receiverCountry: "FR",
        receiverZipCode: "75001",
        weightKg: 1,
      });
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.carriers).toHaveLength(1);
      // 3 × 1.2035 = 3.6105 → 3.61
      expect(res.carriers[0].price).toBe(3.61);
    });
  });

  // ─── createSmarty365Parcel ─────────────────────────────────────────

  describe("createSmarty365Parcel", () => {
    // Helper : mock /api/address (resolveSenderAddressId) + parcel POST.
    function mockAddressAndParcel(parcelResponse: unknown) {
      mockFetch
        .mockResolvedValueOnce(mockJson({
          data: [
            { id: 1154314, type: "sender", company: "Beli & Jolie" },
            { id: 1154060, type: "billing" },
          ],
        }))
        .mockResolvedValueOnce(mockJson(parcelResponse));
    }

    it("succès : parse la réponse array de parcels et retourne le premier", async () => {
      mockAddressAndParcel([
        {
          id: 5114159,
          transporter: "CHRONOPOST",
          route: "CHRONO_FR",
          trackingNumber: "XX107768926JB",
          labelUrl: "https://s3.eu-west-1.amazonaws.com/production/label/10691/XX107768926JB.pdf",
        },
      ]);
      const res = await mod.createSmarty365Parcel({
        transporter: "CHRONOPOST",
        routeCode: "CHRONO_FR",
        orderNumber: "K7X9M2PH",
        weightKg: 0.8,
        toFirstName: "Marie",
        toLastName: "Dupont",
        toCompany: null,
        toEmail: "marie@example.com",
        toAddress1: "1 rue de la Paix",
        toAddress2: null,
        toZipCode: "75001",
        toCity: "Paris",
        toCountry: "France",
        toPhone: "0612345678",
      });
      expect(res.success).toBe(true);
      if (!res.success) return;
      expect(res.parcelId).toBe(5114159);
      expect(res.trackingId).toBe("XX107768926JB");
      expect(res.labelUrl).toContain(".pdf");
    });

    it("body : format parcels:[] + senderAddressId + receiverAddress inline", async () => {
      mockAddressAndParcel([{
        id: 1, transporter: "CHRONOPOST", route: "CHRONO_FR",
        trackingNumber: "T1", labelUrl: "https://x/p.pdf",
      }]);
      await mod.createSmarty365Parcel({
        transporter: "CHRONOPOST",
        routeCode: "CHRONO_FR",
        orderNumber: "K7X9M2PH",
        weightKg: 0.8,
        toFirstName: "Marie", toLastName: "Dupont", toCompany: "ACME",
        toEmail: "m@x.com", toAddress1: "1 rue X", toAddress2: null,
        toZipCode: "75001", toCity: "Paris", toCountry: "FR", toPhone: "01",
      });
      // Le 2ᵉ call fetch = POST /api/parcel
      const [, init] = mockFetch.mock.calls[1];
      const body = JSON.parse(init.body as string);
      expect(body.transporter).toBe("CHRONOPOST");
      expect(body.route).toBe("CHRONO_FR");
      expect(body.senderAddressId).toBe(1154314);
      expect(body.parcels).toHaveLength(1);
      expect(body.parcels[0].weight).toBe(0.8);
      expect(body.parcels[0].insuredValue).toBe(0);
      expect(body.receiverAddress.firstName).toBe("Marie");
      expect(body.receiverAddress.lastName).toBe("Dupont");
      expect(body.receiverAddress.company).toBe("ACME");
      expect(body.receiverAddress.postalCode).toBe("75001");
      expect(body.receiverAddress.countryCode).toBe("FR");
      // reference vit dans le sous-parcel (cf. doc officielle Smarty365)
      expect(body.parcels[0].reference).toBe("K7X9M2PH");
    });

    it("insuredValue arrondi à l'entier supérieur dans le sous-parcel", async () => {
      mockAddressAndParcel([{
        id: 1, transporter: "CHRONOPOST", route: "CHRONO_FR",
        trackingNumber: "T1", labelUrl: "https://x/p.pdf",
      }]);
      await mod.createSmarty365Parcel({
        transporter: "CHRONOPOST", routeCode: "CHRONO_FR",
        orderNumber: "X", weightKg: 1, insuredValueEur: 127.42,
        toFirstName: "M", toLastName: "D", toCompany: null,
        toEmail: "", toAddress1: "", toAddress2: null,
        toZipCode: "75001", toCity: "Paris", toCountry: "FR", toPhone: null,
      });
      const [, init] = mockFetch.mock.calls[1];
      const body = JSON.parse(init.body as string);
      expect(body.parcels[0].insuredValue).toBe(128);
    });

    it("insuredValue négatif ou zéro devient 0", async () => {
      mockAddressAndParcel([{
        id: 1, transporter: "CHRONOPOST", route: "CHRONO_FR",
        trackingNumber: "T1", labelUrl: "https://x/p.pdf",
      }]);
      await mod.createSmarty365Parcel({
        transporter: "X", routeCode: "Y", orderNumber: "Z",
        weightKg: 1, insuredValueEur: -5,
        toFirstName: "M", toLastName: "D", toCompany: null,
        toEmail: "", toAddress1: "", toAddress2: null,
        toZipCode: "", toCity: "", toCountry: "FR", toPhone: null,
      });
      const [, init] = mockFetch.mock.calls[1];
      const body = JSON.parse(init.body as string);
      expect(body.parcels[0].insuredValue).toBe(0);
    });

    it("passe les items douaniers dans le sous-parcel quand fournis", async () => {
      mockFetch
        .mockResolvedValueOnce(mockJson({ data: [{ id: 1, type: "sender" }] }))
        .mockResolvedValueOnce(mockJson([{ id: 5, trackingNumber: "XF1", labelUrl: "https://x/p.pdf" }]));
      await mod.createSmarty365Parcel({
        transporter: "CHRONOPOST", routeCode: "CHRONOPOST_EXPRESS_SML",
        orderNumber: "REU001", weightKg: 1, insuredValueEur: 100,
        customsItems: [{
          hscode: "71171900", originCountry: "CN",
          weight: "1", quantity: "1", value: "100",
          description: "Bijoux fantaisie",
        }],
        toFirstName: "Julie", toLastName: "Payet", toCompany: null,
        toEmail: "j@ex.re", toAddress1: "14 rue Leclerc", toAddress2: null,
        toZipCode: "97400", toCity: "Saint-Denis", toCountry: "RE", toPhone: "0692",
      });
      const [, init] = mockFetch.mock.calls[1];
      const body = JSON.parse(init.body as string);
      // Items DOIVENT être dans le sous-parcel[0], pas à la racine
      expect(body.parcels[0].items).toHaveLength(1);
      expect(body.parcels[0].items[0].hscode).toBe("71171900");
      expect(body.parcels[0].items[0].originCountry).toBe("CN");
      expect(body.parcels[0].items[0].value).toBe("100");
      // Pas de faux champs inventés — la doc officielle ne les mentionne pas
      expect(body.parcelType).toBeUndefined();
      expect(body.customClearance).toBeUndefined();
      expect(body.hasInvoice).toBeUndefined();
    });

    it("sans customsItems, pas de champ items dans le sous-parcel (FR métropole)", async () => {
      mockFetch
        .mockResolvedValueOnce(mockJson({ data: [{ id: 1, type: "sender" }] }))
        .mockResolvedValueOnce(mockJson([{ id: 6, trackingNumber: "T1", labelUrl: "https://x/p.pdf" }]));
      await mod.createSmarty365Parcel({
        transporter: "CHRONOPOST", routeCode: "CHRONOPOST_18_B2C_SML",
        orderNumber: "FR001", weightKg: 1,
        toFirstName: "Test", toLastName: "Test", toCompany: null,
        toEmail: "t@t.fr", toAddress1: "1 rue", toAddress2: null,
        toZipCode: "75001", toCity: "Paris", toCountry: "FR", toPhone: null,
      });
      const [, init] = mockFetch.mock.calls[1];
      const body = JSON.parse(init.body as string);
      expect(body.parcels[0].items).toBeUndefined();
    });

    it("erreur 'Need customs parameters' → message actionnable dev", async () => {
      mockFetch
        .mockResolvedValueOnce(mockJson({ data: [{ id: 1, type: "sender" }] }))
        .mockResolvedValueOnce({
          ok: false, status: 400,
          text: async () => JSON.stringify({
            statusCode: 400, message: "Need customs parameters", error: "Bad Request",
          }),
        });
      const res = await mod.createSmarty365Parcel({
        transporter: "COLISSIMO", routeCode: "COLISSIMO_OM_SML",
        orderNumber: "REU002", weightKg: 1,
        toFirstName: "X", toLastName: "Y", toCompany: null,
        toEmail: "", toAddress1: "", toAddress2: null,
        toZipCode: "97400", toCity: "Saint-Denis", toCountry: "RE", toPhone: null,
      });
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error).toContain("customsItems");
    });

    it("erreur si aucune adresse expéditeur configurée côté Smarty365", async () => {
      // /api/address renvoie sans adresse type=sender
      mockFetch.mockResolvedValueOnce(mockJson({
        data: [{ id: 1154060, type: "billing" }],
      }));
      const res = await mod.createSmarty365Parcel({
        transporter: "CHRONOPOST", routeCode: "CHRONO_FR",
        orderNumber: "X", weightKg: 1,
        toFirstName: "M", toLastName: "D", toCompany: null,
        toEmail: "", toAddress1: "", toAddress2: null,
        toZipCode: "", toCity: "", toCountry: "FR", toPhone: null,
      });
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error).toContain("Adresse expéditeur");
    });
  });

  // ─── isPickupPointRoute ────────────────────────────────────────────

  describe("isPickupPointRoute", () => {
    it("détecte les points relais Colissimo", () => {
      expect(mod.isPickupPointRoute("COLISSIMO_RELAY_POINT_SML", "COLISSIMO")).toBe(true);
      expect(mod.isPickupPointRoute("COLISSIMO_RELAY_POINT_INTER_SML", "COLISSIMO")).toBe(true);
      expect(mod.isPickupPointRoute("COLISSIMO_POST_OFFICE_SML", "COLISSIMO")).toBe(true);
    });

    it("détecte les points relais Chronopost", () => {
      expect(mod.isPickupPointRoute("CHRONOPOST_RELAY_13H_SML", "CHRONOPOST")).toBe(true);
      expect(mod.isPickupPointRoute("CHRONOPOST_2SP_DIR_SML", "CHRONOPOST")).toBe(true);
      expect(mod.isPickupPointRoute("CHRONOPOST_2SPEU_SML", "CHRONOPOST")).toBe(true);
    });

    it("Mondial Relay = 100% point relais (toutes routes exclues)", () => {
      expect(mod.isPickupPointRoute("MONDIAL_RELAY_HOME_FR", "MONDIAL_RELAY")).toBe(true);
      expect(mod.isPickupPointRoute("MONDIAL_RELAY_SML", "MONDIAL_RELAY")).toBe(true);
      expect(mod.isPickupPointRoute("MONDIAL_RELAY_C2C_SML", "MONDIAL_RELAY")).toBe(true);
    });

    it("laisse passer les routes domicile", () => {
      expect(mod.isPickupPointRoute("CHRONOPOST_SML_CLASSIC", "CHRONOPOST")).toBe(false);
      expect(mod.isPickupPointRoute("CHRONOPOST_18_B2C_SML", "CHRONOPOST")).toBe(false);
      expect(mod.isPickupPointRoute("COLISSIMO_SIGN_SML", "COLISSIMO")).toBe(false);
      expect(mod.isPickupPointRoute("COLISSIMO_EU_SML", "COLISSIMO")).toBe(false);
      expect(mod.isPickupPointRoute("GLS_SML", "GLS")).toBe(false);
    });

    it("erreur HTTP : renvoie le message API (array)", async () => {
      mockFetch
        .mockResolvedValueOnce(mockJson({ data: [{ id: 1, type: "sender" }] }))
        .mockResolvedValueOnce({
          ok: false, status: 400,
          text: async () => JSON.stringify({ statusCode: 400, message: ["route must be a string"], error: "Bad Request" }),
        });
      const res = await mod.createSmarty365Parcel({
        transporter: "", routeCode: "", orderNumber: "X", weightKg: 1,
        toFirstName: "M", toLastName: "D", toCompany: null,
        toEmail: "", toAddress1: "", toAddress2: null,
        toZipCode: "", toCity: "", toCountry: "FR", toPhone: null,
      });
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error).toContain("route must be a string");
    });

    it("erreur HTTP : renvoie le message API (string)", async () => {
      mockFetch
        .mockResolvedValueOnce(mockJson({ data: [{ id: 1, type: "sender" }] }))
        .mockResolvedValueOnce({
          ok: false, status: 500,
          text: async () => JSON.stringify({ statusCode: 500, message: "internal", error: "Server Error" }),
        });
      const res = await mod.createSmarty365Parcel({
        transporter: "X", routeCode: "Y", orderNumber: "Z", weightKg: 1,
        toFirstName: "M", toLastName: "D", toCompany: null,
        toEmail: "", toAddress1: "", toAddress2: null,
        toZipCode: "", toCity: "", toCountry: "FR", toPhone: null,
      });
      expect(res.success).toBe(false);
      if (res.success) return;
      expect(res.error).toContain("internal");
    });

    it("erreur si trackingNumber absent de la réponse", async () => {
      mockFetch
        .mockResolvedValueOnce(mockJson({ data: [{ id: 1, type: "sender" }] }))
        .mockResolvedValueOnce(mockJson([{ id: 1, labelUrl: "http://x" }]));
      const res = await mod.createSmarty365Parcel({
        transporter: "X", routeCode: "Y", orderNumber: "Z", weightKg: 1,
        toFirstName: "M", toLastName: "D", toCompany: null,
        toEmail: "", toAddress1: "", toAddress2: null,
        toZipCode: "", toCity: "", toCountry: "FR", toPhone: null,
      });
      expect(res.success).toBe(false);
    });

    it("erreur si clé API manquante", async () => {
      cachedDataMock.getCachedSmarty365ApiKey.mockResolvedValueOnce(null);
      const res = await mod.createSmarty365Parcel({
        transporter: "X", routeCode: "Y", orderNumber: "Z", weightKg: 1,
        toFirstName: "M", toLastName: "D", toCompany: null,
        toEmail: "", toAddress1: "", toAddress2: null,
        toZipCode: "", toCity: "", toCountry: "FR", toPhone: null,
      });
      expect(res.success).toBe(false);
    });
  });

  // ─── fetchSmarty365Label ───────────────────────────────────────────

  describe("fetchSmarty365Label", () => {
    it("télécharge en 1ʳᵉ tentative sans Bearer (URL S3 signée)", async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer; // "%PDF"
      mockFetch.mockResolvedValueOnce({
        ok: true, status: 200,
        arrayBuffer: async () => pdfBytes,
      });
      const buf = await mod.fetchSmarty365Label("https://s3.example.com/label.pdf?signed=abc");
      expect(buf).not.toBeNull();
      expect(buf!.length).toBe(4);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Premier appel : PAS de header Authorization
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts?.headers?.Authorization).toBeUndefined();
    });

    it("retente avec Bearer si la 1ʳᵉ tentative échoue", async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 403 })
        .mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => pdfBytes });
      const buf = await mod.fetchSmarty365Label("https://s3.example.com/label.pdf");
      expect(buf).not.toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, opts] = mockFetch.mock.calls[1];
      expect(opts?.headers?.Authorization).toBe("Bearer jwt-test-token");
    });

    it("retourne null si les 2 tentatives échouent", async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 403 })
        .mockResolvedValueOnce({ ok: false, status: 403 });
      const buf = await mod.fetchSmarty365Label("https://s3.example.com/label.pdf");
      expect(buf).toBeNull();
    });
  });

  // ─── testSmarty365ApiKey ───────────────────────────────────────────

  describe("testSmarty365ApiKey", () => {
    it("valid: clé acceptée par /api/user", async () => {
      mockFetch.mockResolvedValueOnce(mockJson([{ userId: 13234, tenantId: "63f5cb4" }]));
      const res = await mod.testSmarty365ApiKey("jwt-abc");
      expect(res.valid).toBe(true);
    });

    it("invalid: 401", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      const res = await mod.testSmarty365ApiKey("bad");
      expect(res.valid).toBe(false);
    });
  });
});
