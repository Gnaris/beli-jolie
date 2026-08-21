/**
 * lib/smarty365.ts
 *
 * Client API Smarty365 — alternative à Easy-Express.
 *
 * Différence de modèle vs Easy-Express :
 *   Easy-Express = agrégateur white-label, utilise ses contrats à lui.
 *   Smarty365   = plateforme qui exécute VOS contrats négociés en direct
 *                 (Colissimo/Chrono/Mondial Relay/GLS/GPX). Les tarifs sont
 *                 lus depuis /api/pricingRange (grille précalculée par tranche
 *                 de poids et zone géographique) plutôt qu'un appel de cotation.
 *
 * Flux :
 *   1. `smarty365Rates(input)` — filtre localement la grille (cache 1h) pour
 *      renvoyer les routes applicables au pays + poids → format harmonisé
 *      avec fetchEasyExpressRates() pour /api/carriers.
 *   2. `createSmarty365Parcel(input)` — POST /api/parcel → PDF S3 direct.
 *
 * Convention `carrierId` renvoyé côté client :
 *   `smarty:{TRANSPORTER}:{ROUTE_CODE}` — permet à generateShipmentLabel de
 *   détecter le provider depuis l'Order.carrierId, sans dépendre du réglage
 *   global (une commande gardera son provider même si l'admin bascule).
 */

import { getCachedCompanyInfo, getCachedSmarty365ApiKey } from "@/lib/cached-data";
import { logger } from "@/lib/logger";
import { getCurrentTenantIdSync } from "@/lib/tenant-als";

const BASE_URL = "https://www.smarty365.com";
const CARRIER_ID_PREFIX = "smarty:";

// ─────────────────────────────────────────────
// Types du payload Smarty365
// ─────────────────────────────────────────────

interface SmartyPricingRow {
  fee: number;          // prix HT en euros pour la tranche
  type: string;         // "common" | "special" ... (on ignore les special pour l'instant)
  maxWeight: number;
  minWeight: number;
  minQuantity: number;
}

interface SmartyRoute {
  id: number;
  transporter: string;  // "CHRONOPOST" | "COLISSIMO" | ...
  code: string;         // "CHRONOPOST_SML_CLASSIC"
  name: string;         // "Chronopost SML Classic"
  billingType?: string;
  weightType?: string;
  coefficient?: number;
}

interface SmartyPricingUnit {
  id: number;
  senderCountryCodes: string[];
  receiverCountryCodes: string[];
  limitation?: string | null;   // "2 - 5 jours"
  routeId: number;
  route: SmartyRoute;
}

interface SmartyValidPeriod {
  startAt: string;   // "2026-05-14"
  endAt: string;     // "2026-12-31"
}

interface SmartyPricingRange {
  id: number;
  pricingTable: SmartyPricingRow[];
  applyFuelTax: boolean;
  validPeriod: SmartyValidPeriod[];
  expiredDate?: string | null;
  state: "PUBLISHED" | "EXPIRED" | string;
  pricingUnit: SmartyPricingUnit;
}

interface SmartyList<T> {
  data: T[];
  count: number;
  total: number;
  page: number;
  pageCount: number;
}

interface SmartyParcelResponse {
  id: number;
  transporter: string;
  route: string;
  trackingNumber: string;
  shippingNumber?: string;
  labelUrl: string;
  et: number;    // HT
  it: number;    // TTC
  vat: number;
  shippingFee: number;
  fuelTaxFee: number;
  senderCountryCode: string;
  receiverCountryCode: string;
  [k: string]: unknown;
}

// ─────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────

function bearer(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };
}

/** Convertit un nom de pays FR ou un code ISO en code 2 lettres (uppercase). */
function countryToCode(country?: string | null): string {
  if (!country) return "FR";
  const t = country.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  const map: Record<string, string> = {
    france: "FR", belgique: "BE", suisse: "CH", luxembourg: "LU",
    allemagne: "DE", espagne: "ES", italie: "IT", "pays-bas": "NL",
    portugal: "PT", "royaume-uni": "GB", angleterre: "GB",
  };
  return map[t.toLowerCase()] ?? "FR";
}

/** Une pricingRange est-elle utilisable aujourd'hui ? (état PUBLISHED + période courante) */
function isRangeActive(range: SmartyPricingRange, now = new Date()): boolean {
  if (range.state !== "PUBLISHED") return false;
  const periods = range.validPeriod ?? [];
  if (periods.length === 0) return true;
  const nowMs = now.getTime();
  return periods.some((p) => {
    const start = new Date(p.startAt).getTime();
    const end = new Date(p.endAt + "T23:59:59").getTime();
    return nowMs >= start && nowMs <= end;
  });
}

/** Le pricingRange couvre-t-il un couple sender→receiver ? */
function matchesRoute(range: SmartyPricingRange, senderCC: string, receiverCC: string): boolean {
  const senders = range.pricingUnit?.senderCountryCodes ?? [];
  const receivers = range.pricingUnit?.receiverCountryCodes ?? [];
  return senders.includes(senderCC) && receivers.includes(receiverCC);
}

/**
 * Reconnaît les routes qui nécessitent la sélection d'un point relais / bureau
 * de poste par le client. Notre tunnel de checkout ne propose pas encore ce
 * widget → on masque ces routes pour éviter les bordereaux non-générables.
 *
 * Reconnaissance :
 *   - Codes contenant RELAY_POINT / POST_OFFICE / RELAY_13H
 *   - Codes commençant par MONDIAL_RELAY_ (Mondial Relay = 100% point relais,
 *     même les routes "Home" nécessitent un point de dépôt côté expéditeur)
 *   - Codes contenant _2SP_ / _2SPEU_ (Chronopost 2Shop, dépôt en boutique)
 */
export function isPickupPointRoute(routeCode: string, transporter: string): boolean {
  const code = routeCode.toUpperCase();
  const t = transporter.toUpperCase();
  if (t === "MONDIAL_RELAY") return true;
  if (code.includes("RELAY_POINT")) return true;
  if (code.includes("POST_OFFICE")) return true;
  if (code.includes("RELAY_13H")) return true;
  if (code.includes("_2SP_") || code.includes("_2SPEU_")) return true;
  return false;
}

/**
 * Trouve la tranche de poids applicable et renvoie le prix HT correspondant.
 * Retourne `null` si aucune tranche ne couvre le poids demandé (colis hors barème).
 */
export function pickPricingRow(rows: SmartyPricingRow[], weightKg: number): SmartyPricingRow | null {
  // Tranches ouvertes en bas, fermées en haut : "de X kg (exclu) à Y kg (inclus)".
  // Cas limite : poids 1kg avec une tranche 0-1 → applicable ; poids 15.001 → tombe dans 15-20.
  const eligible = rows
    .filter((r) => r.type === "common" || !r.type) // on ignore "special_areas" pour l'instant
    .filter((r) => weightKg > r.minWeight - 0.0001 && weightKg <= r.maxWeight + 0.0001)
    .sort((a, b) => a.fee - b.fee); // au moindre prix si plusieurs tranches recouvrent
  return eligible[0] ?? null;
}

/**
 * Prix HT total pour un colis (tranche + fuel tax si applicable).
 * Le taux de carburant est appliqué au prix de la tranche selon `applyFuelTax`.
 * Le taux fuel varie chaque mois côté transporteur — on utilise 20.35% par défaut
 * (valeur observée dans la grille de production), configurable via la constante ci-dessous.
 */
const DEFAULT_FUEL_TAX_RATE_PCT = 20.35;
// Taux d'assurance Claisy public observé sur le compte de test — sert de défaut
// quand SiteConfig `smarty365_insurance_rate_pct` n'est pas positionnée.
const DEFAULT_INSURANCE_RATE_PCT = 0.6;

export function computeSmartyRangePrice(
  range: SmartyPricingRange,
  weightKg: number,
  fuelTaxRatePct = DEFAULT_FUEL_TAX_RATE_PCT,
): number | null {
  const row = pickPricingRow(range.pricingTable, weightKg);
  if (!row) return null;
  let price = row.fee;
  if (range.applyFuelTax) {
    price = price * (1 + fuelTaxRatePct / 100);
  }
  // Arrondi centimes
  return Math.round(price * 100) / 100;
}

// ─────────────────────────────────────────────
// Récupération des pricing ranges (cache tenant-scopé)
// ─────────────────────────────────────────────

interface CachedRangesEntry {
  ranges: SmartyPricingRange[];
  fetchedAt: number;
}

// Cache mémoire local par tenant (TTL 1h). On évite unstable_cache ici car
// le payload est volumineux (~1 Mo) et unstable_cache le sérialise à chaque hit.
const rangesMemoryCache = new Map<string, CachedRangesEntry>();
const RANGES_TTL_MS = 60 * 60 * 1000; // 1h

async function fetchAllPricingRanges(apiKey: string): Promise<SmartyPricingRange[]> {
  // Smarty365 accepte limit=500 (observé sur le compte de test : 227 lignes en une page).
  // Si un compte a > 500 tarifs, itérer sur les pages via ?page=N.
  const res = await fetch(`${BASE_URL}/api/pricingRange?limit=500`, {
    headers: bearer(apiKey),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Smarty365 pricingRange HTTP ${res.status}`);
  }
  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Smarty365 pricingRange: réponse non-JSON");
  }
  // L'endpoint retourne parfois un tableau brut, parfois { data: [...] }.
  const list: SmartyPricingRange[] = Array.isArray(parsed)
    ? (parsed as SmartyPricingRange[])
    : ((parsed as SmartyList<SmartyPricingRange>).data ?? []);
  return list;
}

async function getPricingRangesForCurrentTenant(apiKey: string): Promise<SmartyPricingRange[]> {
  const tid = getCurrentTenantIdSync() ?? "global";
  const cached = rangesMemoryCache.get(tid);
  if (cached && Date.now() - cached.fetchedAt < RANGES_TTL_MS) {
    return cached.ranges;
  }
  const ranges = await fetchAllPricingRanges(apiKey);
  rangesMemoryCache.set(tid, { ranges, fetchedAt: Date.now() });
  return ranges;
}

/** Vide le cache mémoire (utile après changement de clé API). */
export function clearSmarty365RangesCache(): void {
  rangesMemoryCache.clear();
  senderAddressIdCache.clear();
}

// ─────────────────────────────────────────────
// Résolution de l'ID adresse expéditeur (Smarty365 exige un ID persistant,
// pas une adresse inline). L'adresse "type=sender" est configurée une seule
// fois dans le back-office Smarty365 par la cliente — on la retrouve via
// /api/address?type=sender. Cache mémoire par tenant, TTL 1h.
// ─────────────────────────────────────────────

interface SmartyAddress {
  id: number;
  type: "sender" | "receiver" | "billing" | string;
  company?: string | null;
  street?: string | null;
  postalCode?: string | null;
}

const senderAddressIdCache = new Map<string, { id: number | null; fetchedAt: number }>();
const SENDER_TTL_MS = 60 * 60 * 1000;

async function resolveSenderAddressId(apiKey: string): Promise<number | null> {
  const tid = getCurrentTenantIdSync() ?? "global";
  const cached = senderAddressIdCache.get(tid);
  if (cached && Date.now() - cached.fetchedAt < SENDER_TTL_MS) {
    return cached.id;
  }
  try {
    const res = await fetch(`${BASE_URL}/api/address?limit=50`, {
      headers: bearer(apiKey),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const raw = await res.json() as SmartyList<SmartyAddress> | SmartyAddress[];
    const list: SmartyAddress[] = Array.isArray(raw) ? raw : (raw.data ?? []);
    const sender = list.find((a) => a.type === "sender");
    const id = sender?.id ?? null;
    senderAddressIdCache.set(tid, { id, fetchedAt: Date.now() });
    return id;
  } catch (err) {
    logger.warn("[smarty365/sender-address] fetch failed", { error: err });
    return null;
  }
}

// ─────────────────────────────────────────────
// Étape 1 — Cotation locale (format harmonisé avec Easy-Express)
// ─────────────────────────────────────────────

export interface Smarty365RatesInput {
  receiverCountry: string;
  receiverZipCode: string;
  weightKg: number;
}

export interface Smarty365RatesCarrier {
  carrierId: string;    // "smarty:{TRANSPORTER}:{ROUTE_CODE}"
  name: string;         // ex "Chronopost SML Classic"
  price: number;        // HT en euros
  delay: string;        // ex "2 - 5 jours" ou "Rapide"
  logo: string;         // vide (Smarty365 n'expose pas de logo standard)
  transporter: string;  // "CHRONOPOST" | "COLISSIMO" | ...
  routeCode: string;    // "CHRONOPOST_SML_CLASSIC"
}

export interface Smarty365RatesResult {
  success: true;
  transactionId: string; // vide — Smarty365 ne délivre pas de token de cotation
  carriers: Smarty365RatesCarrier[];
}

export interface Smarty365RatesError {
  success: false;
  error: string;
}

export function buildSmarty365CarrierId(transporter: string, routeCode: string): string {
  return `${CARRIER_ID_PREFIX}${transporter}:${routeCode}`;
}

export function isSmarty365CarrierId(carrierId: string | null | undefined): boolean {
  return !!carrierId && carrierId.startsWith(CARRIER_ID_PREFIX);
}

export function parseSmarty365CarrierId(carrierId: string): { transporter: string; routeCode: string } | null {
  if (!isSmarty365CarrierId(carrierId)) return null;
  const rest = carrierId.slice(CARRIER_ID_PREFIX.length);
  const idx = rest.indexOf(":");
  if (idx < 0) return null;
  return {
    transporter: rest.slice(0, idx),
    routeCode: rest.slice(idx + 1),
  };
}

/**
 * Filtre les pricingRanges applicables au pays destinataire, calcule le prix
 * pour chaque route unique, et déduplique pour ne garder que la meilleure
 * offre par route (le compte peut avoir plusieurs contrats sur la même route
 * — on prend le moins cher).
 */
export async function smarty365Rates(input: Smarty365RatesInput): Promise<Smarty365RatesResult | Smarty365RatesError> {
  const apiKey = await getCachedSmarty365ApiKey();
  if (!apiKey) return { success: false, error: "Clé API Smarty365 manquante." };

  const company = await getCachedCompanyInfo();
  const senderCC = countryToCode(company?.country);
  const receiverCC = countryToCode(input.receiverCountry);

  let ranges: SmartyPricingRange[];
  try {
    ranges = await getPricingRangesForCurrentTenant(apiKey);
  } catch (err) {
    logger.error("[smarty365/rates] fetch pricingRange failed", { error: err });
    return { success: false, error: "Impossible de récupérer les tarifs Smarty365." };
  }

  const now = new Date();
  const applicable = ranges
    .filter((r) => isRangeActive(r, now))
    .filter((r) => matchesRoute(r, senderCC, receiverCC))
    // On masque les routes point relais tant que le tunnel de checkout ne propose
    // pas la sélection d'un point de retrait. Les routes concernées échoueraient
    // à la création du parcel (relayPointId manquant côté Smarty365).
    .filter((r) => !isPickupPointRoute(r.pricingUnit.route.code, r.pricingUnit.route.transporter));

  // Une même route peut avoir plusieurs pricingRange (contrats différents,
  // périodes qui se recouvrent, etc.). On garde la moins chère par route.
  const bestByRoute = new Map<string, { range: SmartyPricingRange; price: number }>();
  for (const range of applicable) {
    const price = computeSmartyRangePrice(range, input.weightKg);
    if (price == null) continue;
    const key = range.pricingUnit.route.code;
    const current = bestByRoute.get(key);
    if (!current || price < current.price) {
      bestByRoute.set(key, { range, price });
    }
  }

  const carriers: Smarty365RatesCarrier[] = Array.from(bestByRoute.values())
    .sort((a, b) => a.price - b.price)
    .map(({ range, price }) => {
      const route = range.pricingUnit.route;
      return {
        carrierId: buildSmarty365CarrierId(route.transporter, route.code),
        name: route.name,
        price,
        delay: range.pricingUnit.limitation?.trim() || "Délai standard",
        logo: "",
        transporter: route.transporter,
        routeCode: route.code,
      };
    });

  return { success: true, transactionId: "", carriers };
}

// ─────────────────────────────────────────────
// Étape 2 — Création du bordereau (parcel)
// ─────────────────────────────────────────────

/**
 * Un item douanier — obligatoire pour les envois DOM-TOM et hors UE.
 * Format tiré directement de la doc officielle Smarty365 (`/api-spec.js`) :
 * `hscode` en minuscule, `originCountry` (pas countryOfOrigin), `value`
 * (pas unitPrice/totalPrice), champs numériques en string.
 */
export interface Smarty365CustomsItem {
  hscode: string;        // ex "71171900" (SH 8 chiffres)
  originCountry: string; // ISO 2 lettres, ex "CN"
  weight: string;        // kg en string, ex "1"
  quantity: string;      // qty en string, ex "1"
  value: string;         // valeur unitaire € HT en string, ex "100"
  description: string;   // ex "Bijoux fantaisie"
}

export interface Smarty365ParcelInput {
  transporter: string;     // ex "CHRONOPOST"
  routeCode: string;       // ex "CHRONOPOST_SML_CLASSIC"

  orderNumber: string;
  weightKg: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;

  /**
   * Valeur à assurer en euros HT (typiquement le sous-total HT de la commande).
   * Passée obligatoirement pour que le colis soit assuré chez Smarty365 —
   * coût de l'assurance à la charge de la boutique (n'apparaît pas au client).
   */
  insuredValueEur?: number;

  /**
   * Items douaniers — obligatoires pour DOM-TOM (RE, GP, MQ, GF, YT, NC, PF…)
   * et international hors UE. Ignorés pour FR métropolitain et UE.
   */
  customsItems?: Smarty365CustomsItem[];

  // Destinataire
  toFirstName: string;
  toLastName: string;
  toCompany: string | null;
  toEmail: string;
  toAddress1: string;
  toAddress2: string | null;
  toZipCode: string;
  toCity: string;
  toCountry: string;
  toPhone: string | null;
}

export interface Smarty365ParcelResult {
  success: true;
  parcelId: number;
  trackingId: string;
  labelUrl: string;
  transporter: string;
  routeCode: string;
}

export interface Smarty365ParcelError {
  success: false;
  error: string;
}

const DEFAULT_DIMENSIONS = { length: 30, width: 20, height: 10 };

export async function createSmarty365Parcel(
  input: Smarty365ParcelInput,
): Promise<Smarty365ParcelResult | Smarty365ParcelError> {
  const apiKey = await getCachedSmarty365ApiKey();
  if (!apiKey) return { success: false, error: "Clé API Smarty365 manquante." };

  // Résolution de l'adresse expéditeur (ID persistant côté Smarty365).
  // L'adresse "type=sender" est configurée une seule fois dans le back-office
  // par la cliente — on la retrouve via /api/address?type=sender.
  const senderAddressId = await resolveSenderAddressId(apiKey);
  if (!senderAddressId) {
    return {
      success: false,
      error:
        "Adresse expéditeur introuvable côté Smarty365. " +
        "Configurez votre adresse d'expédition dans le back-office Smarty365 (menu Adresses → type Expéditeur).",
    };
  }

  const insuredValue = input.insuredValueEur && input.insuredValueEur > 0
    ? Math.ceil(input.insuredValueEur)
    : 0;

  // Format officiel Smarty365 (cf. `docs/smarty365-api.md` + `/api-spec.js`).
  // Le sous-parcel porte `weight`, `length`, `width`, `height`, `insuredValue`,
  // `reference` et `items[]` (douane). Ajouter `items` déclenche automatiquement
  // le mode "customs parcel" côté Smarty365 — pas de flag `customClearance` à
  // envoyer (n'existe pas dans la doc, contrairement à mes premières tentatives).
  const parcelObj: Record<string, unknown> = {
    weight: Math.max(0.1, input.weightKg),
    length: input.lengthCm ?? DEFAULT_DIMENSIONS.length,
    width: input.widthCm ?? DEFAULT_DIMENSIONS.width,
    height: input.heightCm ?? DEFAULT_DIMENSIONS.height,
    insuredValue,
    reference: input.orderNumber,
  };
  if (input.customsItems && input.customsItems.length > 0) {
    parcelObj.items = input.customsItems;
  }

  const body: Record<string, unknown> = {
    transporter: input.transporter,
    route: input.routeCode,
    parcels: [parcelObj],
    senderAddressId,
    receiverAddress: {
      firstName: input.toFirstName,
      lastName: input.toLastName,
      company: input.toCompany ?? "",
      email: input.toEmail,
      phoneNumber: input.toPhone ?? "",
      mobileNumber: input.toPhone ?? "",
      street: input.toAddress1,
      complement: input.toAddress2 ?? "",
      city: input.toCity,
      postalCode: input.toZipCode,
      countryCode: countryToCode(input.toCountry),
    },
    labelFormat: "pdf",
  };

  try {
    const res = await fetch(`${BASE_URL}/api/parcel`, {
      method: "POST",
      headers: bearer(apiKey),
      body: JSON.stringify(body),
    });
    const rawText = await res.text();

    if (!res.ok) {
      // L'API renvoie souvent { statusCode, message: string | string[], error } sur erreur.
      let msg = rawText.slice(0, 500);
      try {
        const parsed = JSON.parse(rawText);
        const m = parsed?.message;
        msg = Array.isArray(m) ? m.join(" · ") : (typeof m === "string" ? m : msg);
      } catch { /* garder rawText */ }
      // Log détaillé pour diagnostiquer (body + réponse) — utile côté serveur
      // pour comprendre pourquoi Smarty365 refuse un parcel donné.
      logger.warn("[smarty365/parcel] HTTP error", {
        status: res.status,
        msg,
        bodySent: body,
        rawResponse: rawText.slice(0, 500),
      });

      // Message "Need customs parameters" = items[] douaniers manquants
      // pour un envoi DOM-TOM ou hors UE. On remonte un message actionnable
      // à l'admin plutôt que le texte technique brut.
      if (msg.includes("Need customs")) {
        return {
          success: false,
          error:
            "Envoi DOM-TOM ou hors UE : les informations douanières sont manquantes " +
            "(description, code SH, pays d'origine, valeur). Contactez le développeur — " +
            "l'appelant doit fournir `customsItems`.",
        };
      }

      return { success: false, error: `Smarty365 (${res.status}) : ${msg}` };
    }

    // La réponse est un ARRAY de parcels créés (multi-colis possible), on
    // prend le premier car nos commandes sont mono-colis.
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return { success: false, error: "Smarty365 : réponse non-JSON à la création du parcel." };
    }

    const parcels: SmartyParcelResponse[] = Array.isArray(parsed)
      ? (parsed as SmartyParcelResponse[])
      : [parsed as SmartyParcelResponse];
    const data = parcels[0];

    if (!data?.trackingNumber) {
      logger.warn("[smarty365/parcel] réponse OK mais sans trackingNumber", { data });
      return { success: false, error: "Smarty365 : numéro de suivi absent de la réponse." };
    }

    return {
      success: true,
      parcelId: data.id,
      trackingId: data.trackingNumber,
      labelUrl: data.labelUrl,
      transporter: data.transporter,
      routeCode: data.route,
    };
  } catch (err) {
    logger.error("[smarty365/parcel] Exception", { error: err });
    return { success: false, error: "Impossible de contacter Smarty365." };
  }
}

// ─────────────────────────────────────────────
// Téléchargement du bordereau PDF
// ─────────────────────────────────────────────

/**
 * Télécharge le PDF du bordereau. Les URLs Smarty365 pointent vers S3 avec
 * signature déjà incluse dans l'URL — pas besoin de header Authorization.
 * On fait quand même une tentative en incluant le token pour couvrir les
 * futures évolutions de l'API.
 */
export async function fetchSmarty365Label(labelUrl: string): Promise<Buffer | null> {
  try {
    // Première tentative : URL S3 sans header (le cas actuel).
    let res = await fetch(labelUrl);
    if (!res.ok) {
      // Fallback : ré-essayer avec le Bearer, au cas où Smarty365 servirait
      // les futurs labels derrière une auth token (comme Easy-Express).
      const apiKey = await getCachedSmarty365ApiKey();
      if (apiKey) {
        res = await fetch(labelUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
      }
      if (!res.ok) return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    logger.error("[smarty365/label] Exception", { error: err });
    return null;
  }
}

// ─────────────────────────────────────────────
// Validation clé API (utilisé par le bouton "Vérifier" côté admin)
// ─────────────────────────────────────────────

export async function testSmarty365ApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/user`, {
      headers: bearer(apiKey),
    });
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "Jeton refusé (401/403)." };
    }
    if (!res.ok) return { valid: false, error: `Erreur ${res.status}` };
    const data = await res.json();
    // /api/user renvoie un tableau [{userId, tenantId, ...}] ou un objet.
    const first = Array.isArray(data) ? data[0] : data;
    if (!first) return { valid: false, error: "Réponse vide." };
    return { valid: true };
  } catch {
    return { valid: false, error: "Impossible de contacter Smarty365." };
  }
}

// ─────────────────────────────────────────────
// Re-exports pratiques
// ─────────────────────────────────────────────

// Placeholder pour éviter les imports morts côté consommateurs.
export const SMARTY365_PROVIDER_ID = "smarty365" as const;
