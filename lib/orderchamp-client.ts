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
): Promise<T> {
  const headers = await getOrderchampHeaders();
  const body = JSON.stringify(variables ? { query, variables } : { query });
  const init: RequestInit = { method: "POST", headers, body };

  let lastNetworkError: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(ORDERCHAMP_BASE_URL, init);
      if (res.status !== 429 && res.status < 500) {
        return await parseGraphQLResponse<T>(res, opName);
      }
      if (attempt === MAX_ATTEMPTS - 1) {
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
      if (attempt === MAX_ATTEMPTS - 1) {
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

async function parseGraphQLResponse<T>(res: Response, opName?: string): Promise<T> {
  let payload: GraphQLResponse<T> | null = null;
  try {
    payload = (await res.json()) as GraphQLResponse<T>;
  } catch {
    if (!res.ok) {
      throw new OrderchampGraphQLError(
        `Orderchamp HTTP ${res.status} sans JSON`,
        [{ message: `HTTP ${res.status}` }],
        res.status,
      );
    }
    throw new OrderchampGraphQLError(
      "Orderchamp a renvoyé une réponse non-JSON",
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
      `Orderchamp HTTP ${res.status}`,
      [{ message: `HTTP ${res.status}` }],
      res.status,
    );
  }

  if (!payload?.data) {
    throw new OrderchampGraphQLError(
      "Réponse Orderchamp vide (pas de data)",
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
