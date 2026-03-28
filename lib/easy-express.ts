/**
 * lib/easy-express.ts
 *
 * Client API Easy-Express v3
 * Flux en 2 étapes :
 *   1. POST /api/v3/shipments/rates  → transactionId + liste carriers
 *   2. POST /api/v3/shipments/checkout → trackingId + label
 *
 * Configuration via les paramètres admin :
 *   - Clé API : SiteConfig "easy_express_api_key" (paramètres admin uniquement)
 *   - Adresse expéditeur : CompanyInfo (informations société)
 */

import { getCachedCompanyInfo, getCachedEasyExpressApiKey } from "@/lib/cached-data";

const BASE_URL = "https://easy-express.fr";

/** Convertit un nom de pays ("France") ou code ISO en code 2 lettres pour Easy-Express */
function countryToCode(country?: string | null): string {
  if (!country) return "FR";
  const trimmed = country.trim();
  // Déjà un code ISO 2 lettres
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  // Mapping des noms courants
  const map: Record<string, string> = {
    france: "FR", belgique: "BE", suisse: "CH", luxembourg: "LU",
    allemagne: "DE", espagne: "ES", italie: "IT", "pays-bas": "NL",
    portugal: "PT", "royaume-uni": "GB",
  };
  return map[trimmed.toLowerCase()] ?? "FR";
}

/** Récupère la clé API depuis la DB (paramètres admin uniquement) */
async function getApiKey(): Promise<string | null> {
  return await getCachedEasyExpressApiKey();
}

function bearerHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };
}

// ─────────────────────────────────────────────
// Étape 1 — Cotation (utilisé par /api/carriers)
// ─────────────────────────────────────────────

export interface RatesInput {
  receiverCountry: string;
  receiverZipCode: string;
  weightKg: number;
}

export interface RatesCarrier {
  carrierId: string;   // base64 opaque ID retourné par Easy-Express
  name:      string;
  price:     number;   // en euros (déjà converti depuis centimes)
  delay:     string;
  logo:      string;
}

export interface RatesResult {
  success:       true;
  transactionId: string;
  carriers:      RatesCarrier[];
}

export interface RatesError {
  success: false;
  error:   string;
}

export async function fetchEasyExpressRates(
  input: RatesInput
): Promise<RatesResult | RatesError> {
  const apiKey = await getApiKey();
  if (!apiKey) return { success: false, error: "Clé API Easy-Express manquante." };

  const company = await getCachedCompanyInfo();

  const body = {
    senderAddress: {
      countryCode: countryToCode(company?.country),
      postalCode:  company?.postalCode ?? "",
    },
    receiverAddress: {
      countryCode: input.receiverCountry,
      postalCode:  input.receiverZipCode,
    },
    parcels: [{ weight: Math.max(1, input.weightKg) }],
  };

  try {
    const res = await fetch(`${BASE_URL}/api/v3/shipments/rates`, {
      method: "POST",
      headers: bearerHeaders(apiKey),
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const rawText = await res.text();

    if (!res.ok) {
      return { success: false, error: `Easy-Express rates (${res.status}): ${rawText.slice(0, 200)}` };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { success: false, error: "Easy-Express rates: réponse non-JSON" };
    }

    // Format réel : { Response: { Status, Code, Message: { transactionId, carriers[] } } }
    const response = data.Response as Record<string, unknown> | undefined;
    if (!response || response.Code !== 200) {
      const msg = (response?.Message as string) ?? "Erreur inconnue";
      return { success: false, error: `Easy-Express rates: ${msg}` };
    }

    const message     = response.Message as Record<string, unknown>;
    const transactionId = (message.transactionId ?? "") as string;
    const rawCarriers   = (message.carriers ?? []) as Record<string, unknown>[];

    const carriers: RatesCarrier[] = rawCarriers.map((c) => {
      const infos = (c.infos ?? {}) as Record<string, unknown>;
      return {
        carrierId: (c.id ?? "") as string,
        name:      (c.name ?? "") as string,
        // prix en centimes → euros
        price:     Math.round(((c.priceIncTax ?? c.price ?? 0) as number) / 100 * 100) / 100,
        delay:     (infos.estimatedArrival ?? "3-5 jours") as string,
        logo:      (c.logo ?? "") as string,
      };
    });

    return { success: true, transactionId, carriers };
  } catch (err) {
    console.error("[easy-express/rates] Exception:", err);
    return { success: false, error: "Impossible de contacter Easy-Express." };
  }
}

// ─────────────────────────────────────────────
// Étape 2 — Création expédition (checkout)
// ─────────────────────────────────────────────

export interface EasyExpressShipmentInput {
  transactionId: string;  // retourné par /rates
  carrierId:     string;  // base64 retourné par /rates

  orderNumber:  string;
  weightKg:     number;

  // Destinataire
  toFirstName:  string;
  toLastName:   string;
  toCompany:    string | null;
  toEmail:      string;
  toAddress1:   string;
  toAddress2:   string | null;
  toZipCode:    string;
  toCity:       string;
  toCountry:    string;
  toPhone:      string | null;
}

export interface EasyExpressShipmentResult {
  success:     true;
  trackingId:  string;
  labelUrl:    string;
}

export interface EasyExpressShipmentError {
  success: false;
  error:   string;
}

export type EasyExpressResult = EasyExpressShipmentResult | EasyExpressShipmentError;

export async function createEasyExpressShipment(
  input: EasyExpressShipmentInput
): Promise<EasyExpressResult> {
  const apiKey = await getApiKey();
  if (!apiKey) return { success: false, error: "Clé API Easy-Express manquante." };

  const company = await getCachedCompanyInfo();
  const shopName = company?.shopName || "Ma Boutique";

  const body = {
    transactionId: input.transactionId,
    carrierId:     input.carrierId,
    shipmentRequest: {
      parcels: [{ weight: Math.max(1, input.weightKg) }],
      senderAddress: {
        company:       company?.name ?? shopName,
        shopName:      shopName,
        email:         company?.email ?? "",
        phoneNumber:   company?.phone ?? "",
        mobileNumber:  company?.phone ?? "",
        street:        company?.address ?? "",
        complement:    "",
        city:          company?.city ?? "",
        postalCode:    company?.postalCode ?? "",
        countryCode:   countryToCode(company?.country),
        siret:         company?.siret ?? "",
      },
      receiverAddress: {
        firstName:          input.toFirstName,
        lastName:           input.toLastName,
        company:            input.toCompany   ?? "",
        shopName:           "",
        email:              input.toEmail,
        phoneNumber:        input.toPhone     ?? "",
        mobileNumber:       input.toPhone     ?? "",
        street:             input.toAddress1,
        complement:         input.toAddress2  ?? "",
        city:               input.toCity,
        stateProvinceCode:  "",
        postalCode:         input.toZipCode,
        countryCode:        input.toCountry,
        instructions:       "",
      },
    },
  };

  try {
    const res = await fetch(`${BASE_URL}/api/v3/shipments/checkout`, {
      method: "POST",
      headers: bearerHeaders(apiKey),
      body: JSON.stringify(body),
    });

    const rawText = await res.text();

    if (!res.ok) {
      return { success: false, error: `Easy-Express checkout (${res.status}): ${rawText.slice(0, 200)}` };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawText);
    } catch {
      return { success: false, error: "Easy-Express checkout: réponse non-JSON" };
    }

    // Format réel : { Response: { Code, Message: { labels, parcels: [{ tracking, ticket }] } } }
    const response = data.Response as Record<string, unknown> | undefined;
    if (!response || response.Code !== 200) {
      const msg = (response?.Message as string) ?? "Erreur inconnue";
      return { success: false, error: `Easy-Express checkout: ${msg}` };
    }

    const message  = response.Message as Record<string, unknown>;
    const parcels  = (message.parcels ?? []) as Record<string, unknown>[];
    const first    = parcels[0] ?? {};
    const trackingId = (first.tracking ?? "") as string;
    // "labels" = PDF combiné de tous les bordereaux, "ticket" = label individuel
    const labelUrl   = (message.labels ?? first.ticket ?? "") as string;

    if (!trackingId) {
      return { success: false, error: "Easy-Express: numéro de suivi absent de la réponse." };
    }

    return { success: true, trackingId, labelUrl };
  } catch (err) {
    console.error("[easy-express/checkout] Exception:", err);
    return { success: false, error: "Impossible de contacter Easy-Express." };
  }
}

// ─────────────────────────────────────────────
// Téléchargement du bordereau PDF
// ─────────────────────────────────────────────

export async function fetchEasyExpressLabel(labelUrl: string): Promise<Buffer | null> {
  try {
    const apiKey = await getApiKey() ?? "";
    const res = await fetch(labelUrl, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
