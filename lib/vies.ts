import { logger } from "@/lib/logger";

/**
 * Vérification TVA intracommunautaire via VIES REST API.
 * Utilisé à l'inscription (fire-and-forget) et par l'admin (relancer).
 *
 * Endpoint VIES : https://ec.europa.eu/taxation_customs/vies/rest-api/ms/{CC}/vat/{NUMBER}
 */

const EU_MEMBER_STATES = new Set([
  "AT","BE","BG","CY","CZ","DE","DK","EE","ES","FI","FR",
  "GR","HR","HU","IE","IT","LT","LU","LV","MT","NL","PL",
  "PT","RO","SE","SI","SK","XI",
]);

const VIES_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 4;
// Backoff exponentiel : 2s → 4s → 8s → 16s (~30s cumulés)
// Nécessaire quand le pays interrogé (IT, ES, DE…) bride les requêtes simultanées.
const BASE_RETRY_DELAY_MS = 2_000;
const RETRYABLE_ERRORS = new Set(["MS_MAX_CONCURRENT_REQ", "SERVICE_UNAVAILABLE", "MS_UNAVAILABLE"]);

function nextRetryDelay(attempt: number): number {
  const exp = BASE_RETRY_DELAY_MS * 2 ** attempt;
  const jitter = 1 + (Math.random() * 0.5 - 0.25); // ±25 %
  return Math.round(exp * jitter);
}

// Traduction des codes techniques VIES en messages lisibles pour l'admin.
const USER_ERROR_MESSAGES: Record<string, string> = {
  MS_MAX_CONCURRENT_REQ: "Le service fiscal du pays du client est temporairement surchargé. Réessayez dans quelques secondes.",
  MS_UNAVAILABLE: "Le service fiscal du pays du client est momentanément indisponible.",
  SERVICE_UNAVAILABLE: "Le service VIES est momentanément indisponible.",
  TIMEOUT: "Le service fiscal du pays du client n'a pas répondu à temps.",
  INVALID_INPUT: "Numéro de TVA rejeté par VIES (format non conforme).",
  INVALID_REQUESTER_INFO: "Requête refusée par VIES (informations invalides).",
  GLOBAL_MAX_CONCURRENT_REQ: "VIES est saturé au niveau européen. Réessayez dans quelques secondes.",
  IP_BLOCKED: "IP bloquée par VIES.",
};

export interface ViesResult {
  valid: boolean;
  countryCode: string;
  vatNumber: string;
  name: string | null;
  address: string | null;
  requestDate: string | null;
  serviceError?: string;
}

/**
 * Parse un numéro de TVA brut → { countryCode, number } ou null si invalide.
 */
export function parseVatNumber(raw: string): { countryCode: string; number: string } | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length < 4 || cleaned.length > 15) return null;
  const countryCode = cleaned.slice(0, 2);
  const number = cleaned.slice(2);
  if (!EU_MEMBER_STATES.has(countryCode)) return null;
  return { countryCode, number };
}

/**
 * Interroge VIES avec retry automatique sur erreurs temporaires.
 * Retourne toujours un ViesResult (jamais de throw).
 */
export async function checkVies(rawVat: string): Promise<ViesResult> {
  const parsed = parseVatNumber(rawVat);
  if (!parsed) {
    return {
      valid: false,
      countryCode: rawVat.slice(0, 2).toUpperCase(),
      vatNumber: rawVat.slice(2),
      name: null,
      address: null,
      requestDate: null,
      serviceError: "Format TVA invalide ou pays non reconnu par VIES.",
    };
  }

  const { countryCode, number } = parsed;
  const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${number}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VIES_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeout);

      if (!res.ok) {
        logger.warn("[VIES] non-200 response", { countryCode, status: res.status });
        return {
          valid: false,
          countryCode,
          vatNumber: number,
          name: null,
          address: null,
          requestDate: null,
          serviceError: `VIES a répondu ${res.status}. Service peut-être temporairement indisponible.`,
        };
      }

      const data = await res.json().catch(() => null);
      if (!data || typeof data !== "object") {
        return {
          valid: false,
          countryCode,
          vatNumber: number,
          name: null,
          address: null,
          requestDate: null,
          serviceError: "Réponse VIES illisible.",
        };
      }

      const d = data as Record<string, unknown>;
      const userError = typeof d.userError === "string" ? d.userError : "";

      // Retry sur erreurs temporaires
      if (RETRYABLE_ERRORS.has(userError) && attempt < MAX_RETRIES) {
        const delay = nextRetryDelay(attempt);
        logger.info("[VIES] retryable error, retrying", { userError, attempt: attempt + 1, delayMs: delay, countryCode });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      const result: ViesResult = {
        valid: d.isValid === true || d.valid === true,
        countryCode,
        vatNumber: number,
        name: typeof d.name === "string" && d.name.trim() && d.name !== "---" ? d.name : null,
        address: typeof d.address === "string" && d.address.trim() && d.address !== "---" ? d.address : null,
        requestDate: typeof d.requestDate === "string" ? d.requestDate : null,
      };

      // "VALID" et "INVALID" sont de vrais résultats VIES, pas des erreurs de service.
      // Tout autre code (MS_UNAVAILABLE, SERVICE_UNAVAILABLE, TIMEOUT, INVALID_INPUT…)
      // signale un vrai problème → on le remonte en serviceError pour l'admin.
      const REAL_RESULTS = new Set(["VALID", "INVALID", ""]);
      if (userError && !REAL_RESULTS.has(userError)) {
        result.serviceError = USER_ERROR_MESSAGES[userError] ?? `Erreur VIES : ${userError}`;
      }

      return result;
    } catch (err) {
      clearTimeout(timeout);
      const isAbort = err instanceof Error && err.name === "AbortError";

      if (attempt < MAX_RETRIES) {
        const delay = nextRetryDelay(attempt);
        logger.info("[VIES] fetch error, retrying", { attempt: attempt + 1, delayMs: delay, isAbort, countryCode });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      logger.error("[VIES] fetch failed after retries", {
        countryCode,
        error: err,
      });
      return {
        valid: false,
        countryCode,
        vatNumber: number,
        name: null,
        address: null,
        requestDate: null,
        serviceError: isAbort
          ? "VIES n'a pas répondu après plusieurs tentatives."
          : "Impossible de joindre VIES.",
      };
    }
  }

  // Fallback
  return {
    valid: false,
    countryCode,
    vatNumber: number,
    name: null,
    address: null,
    requestDate: null,
    serviceError: "VIES : service temporairement surchargé, réessayez.",
  };
}
