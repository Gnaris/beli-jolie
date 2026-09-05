/**
 * Orderchamp GraphQL Client
 *
 * Un seul endpoint `POST https://api.orderchamp.com/v1/graphql` — toutes les
 * queries et mutations passent par ici. Retry 429 / 5xx / erreurs réseau,
 * détection des erreurs GraphQL (`errors[]` top-level) et des userErrors
 * (retournés par les mutations).
 *
 * Convention : les callers passent la query GraphQL brute (constante depuis
 * `lib/orderchamp-queries.ts`) et un objet `variables`. On retourne la partie
 * `data` désérialisée ou on throw un `OrderchampGraphQLError` structuré.
 */

import { ORDERCHAMP_BASE_URL, getOrderchampHeaders } from "@/lib/orderchamp-auth";
import { logger } from "@/lib/logger";

const MAX_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 300_000;

export interface OrderchampUserError {
  field?: string[] | string | null;
  message: string;
  code?: string | null;
}

export interface OrderchampGraphQLErrorPayload {
  message: string;
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
}

/**
 * Erreur GraphQL top-level (query invalide, unauthorized, throttle, etc.).
 * Distinct des `userErrors` renvoyés par les mutations pour les validations
 * métier — ceux-là sont laissés aux callers dans la réponse `data`.
 */
export class OrderchampGraphQLError extends Error {
  public readonly errors: OrderchampGraphQLErrorPayload[];
  public readonly status: number;
  constructor(message: string, errors: OrderchampGraphQLErrorPayload[], status: number) {
    super(message);
    this.name = "OrderchampGraphQLError";
    this.errors = errors;
    this.status = status;
  }
}

/**
 * Calcule le délai avant le prochain essai. 429 = attente longue (respect
 * `Retry-After` si présent, sinon backoff 30s → 120s). 5xx / erreur réseau =
 * backoff exponentiel court 500ms → 8s.
 */
export function computeOrderchampRetryDelayMs(response: Response, attempt: number): number {
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
      }
      const dateMs = Date.parse(retryAfter);
      if (!Number.isNaN(dateMs)) {
        return Math.max(0, Math.min(dateMs - Date.now(), MAX_RETRY_DELAY_MS));
      }
    }
    return Math.min((attempt + 1) * 30_000, 120_000);
  }
  return 500 * Math.pow(2, attempt);
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: OrderchampGraphQLErrorPayload[];
}

/**
 * Exécute une opération GraphQL (query ou mutation) et retourne la partie
 * `data`. Throw `OrderchampGraphQLError` si `errors[]` est présent ou si le
 * transport échoue durablement.
 *
 * Les mutations qui renvoient `userErrors` retournent ces erreurs dans `data`
 * — c'est au caller de les inspecter (message métier à remonter à l'UI).
 */
export async function orderchampGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  opName?: string,
  options?: { disableRetry?: boolean },
): Promise<T> {
  const headers = await getOrderchampHeaders();
  const body = JSON.stringify(variables ? { query, variables } : { query });
  const init: RequestInit = { method: "POST", headers, body };

  // disableRetry : pour les mutations non-idempotentes (productCreate,
  // customCategoryCreate, etc.). Un retry après un 5xx ou une erreur réseau
  // peut créer un doublon si la mutation a bien été traitée côté OC mais que
  // la réponse a été perdue en route. Cf. incident du 2026-08-20 (produits
  // triplés sur OC).
  //
  // ⚠️ Un 429 (rate-limit) reste TOUJOURS retriable même avec disableRetry :
  // OC a explicitement rejeté la requête sans la traiter — pas de risque de
  // doublon, et sans retry la cliente se prend un « HTTP 429 sans JSON » en
  // pleine figure alors qu'il suffit d'attendre 30-60s (cf. bug 2026-09-05
  // sur productCreate Orderchamp après un batch de publish PFS/eFashion).
  const disableRetry = options?.disableRetry ?? false;
  const maxAttempts = MAX_ATTEMPTS;

  let lastNetworkError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(ORDERCHAMP_BASE_URL, init);
      // 401/403 = clé invalide/révoquée : re-tenter ne va pas la débloquer.
      // On sort du retry immédiatement et on laisse parseGraphQLResponse throw
      // un OrderchampGraphQLError propre que le caller peut détecter.
      if (res.status === 401 || res.status === 403) {
        return await parseGraphQLResponse<T>(res, opName);
      }
      // 5xx : dangereux à retenter pour une mutation non-idempotente
      // (réponse potentiellement perdue en route → doublon).
      if (res.status >= 500 && disableRetry) {
        return await parseGraphQLResponse<T>(res, opName);
      }
      if (res.status !== 429 && res.status < 500) {
        return await parseGraphQLResponse<T>(res, opName);
      }
      if (attempt === maxAttempts - 1) {
        return await parseGraphQLResponse<T>(res, opName);
      }
      const wait = computeOrderchampRetryDelayMs(res, attempt);
      logger.warn("[Orderchamp] retry", { opName, status: res.status, attempt, wait });
      await new Promise((r) => setTimeout(r, wait));
    } catch (err) {
      lastNetworkError = err;
      const causeObj = (err as { cause?: unknown }).cause;
      const causeCode = causeObj instanceof Error
        ? (causeObj as Error & { code?: string }).code ?? causeObj.name
        : undefined;
      // Erreur réseau : dangereuse à retenter pour une mutation non-idempotente
      // (la requête a peut-être atteint OC malgré la coupure côté réponse).
      if (disableRetry) {
        logger.error("[Orderchamp] fetch network error (disableRetry actif)", {
          opName,
          attempt,
          message: err instanceof Error ? err.message : String(err),
          cause: causeCode,
        });
        if (err instanceof Error && causeCode) {
          err.message = `${err.message} (${causeCode})`;
        }
        throw err;
      }
      if (attempt === maxAttempts - 1) {
        logger.error("[Orderchamp] fetch network error (retries épuisés)", {
          opName,
          attempt,
          message: err instanceof Error ? err.message : String(err),
          cause: causeCode,
        });
        if (err instanceof Error && causeCode) {
          err.message = `${err.message} (${causeCode})`;
        }
        throw err;
      }
      const wait = 500 * Math.pow(2, attempt);
      logger.warn("[Orderchamp] retry (network)", { opName, attempt, cause: causeCode, wait });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (lastNetworkError !== null) throw lastNetworkError;
  const finalRes = await fetch(ORDERCHAMP_BASE_URL, init);
  return await parseGraphQLResponse<T>(finalRes, opName);
}

/**
 * Traduit un statut HTTP brut Orderchamp en message lisible pour la cliente.
 * Le message est celui affiché dans la modale save / toast d'erreur — évite
 * les libellés techniques comme « HTTP 429 sans JSON » qui n'aident pas.
 */
function friendlyHttpMessage(status: number): string {
  if (status === 429) {
    return "Orderchamp est saturé (trop de requêtes récentes). Réessayez dans 2 à 3 minutes.";
  }
  if (status === 401 || status === 403) {
    return "Clé API Orderchamp invalide ou révoquée. Vérifiez le token dans Paramètres → Marketplaces → Orderchamp.";
  }
  if (status >= 500) {
    return `Orderchamp est momentanément indisponible (HTTP ${status}). Réessayez dans quelques instants.`;
  }
  if (status === 404) {
    return "Ressource Orderchamp introuvable (HTTP 404). Le produit ou la variante n'existe peut-être plus côté OC.";
  }
  if (status >= 400) {
    return `Orderchamp a refusé la requête (HTTP ${status}).`;
  }
  return `Orderchamp a répondu HTTP ${status}.`;
}

async function parseGraphQLResponse<T>(res: Response, opName?: string): Promise<T> {
  let payload: GraphQLResponse<T> | null = null;
  try {
    payload = (await res.json()) as GraphQLResponse<T>;
  } catch {
    if (!res.ok) {
      throw new OrderchampGraphQLError(
        friendlyHttpMessage(res.status),
        [{ message: `HTTP ${res.status}` }],
        res.status,
      );
    }
    throw new OrderchampGraphQLError(
      "Orderchamp a renvoyé une réponse illisible (corps non-JSON).",
      [{ message: "invalid-json" }],
      res.status,
    );
  }

  if (payload?.errors && payload.errors.length > 0) {
    const firstMsg = payload.errors[0]?.message ?? "Erreur GraphQL inconnue";
    logger.error("[Orderchamp] GraphQL errors", {
      opName,
      status: res.status,
      errors: payload.errors,
    });
    throw new OrderchampGraphQLError(firstMsg, payload.errors, res.status);
  }

  if (!res.ok) {
    throw new OrderchampGraphQLError(
      friendlyHttpMessage(res.status),
      [{ message: `HTTP ${res.status}` }],
      res.status,
    );
  }

  if (!payload?.data) {
    throw new OrderchampGraphQLError(
      "Orderchamp a répondu sans données. Réessayez la publication.",
      [{ message: "empty-data" }],
      res.status,
    );
  }

  return payload.data;
}

/**
 * Helper : à partir d'une mutation qui retourne `{ userErrors: [{ field, message }] }`,
 * renvoie un array unifié pour affichage. Utile pour éviter la répétition
 * dans chaque fichier de publish/update.
 */
export function extractUserErrors(payload: unknown): OrderchampUserError[] {
  if (!payload || typeof payload !== "object") return [];
  const anyPayload = payload as Record<string, unknown>;
  const errs = anyPayload.userErrors ?? anyPayload.user_errors;
  if (!Array.isArray(errs)) return [];
  return errs
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      field: e.field as string[] | string | null | undefined,
      message: (e.message as string | undefined) ?? "Erreur Orderchamp inconnue",
      code: (e.code as string | null | undefined) ?? null,
    }));
}

/**
 * Formatte un array de userErrors en une seule string lisible pour l'UI/logs.
 * Retourne null si aucun error.
 */
export function formatUserErrors(errors: OrderchampUserError[]): string | null {
  if (errors.length === 0) return null;
  return errors
    .map((e) => {
      const field = Array.isArray(e.field) ? e.field.join(".") : e.field ?? "";
      return field ? `${field}: ${e.message}` : e.message;
    })
    .join(" · ");
}
