/**
 * lib/marketplace-queue-serializer.ts
 *
 * Pont entre la représentation BDD (enums majuscules, status à 5 valeurs
 * SUCCEEDED/FAILED/...) et la forme attendue par le widget côté client
 * (MarketplaceRefreshItem du context, status à 4 valeurs avec 'done' englobant
 * SUCCEEDED + FAILED). Centralisé ici pour éviter la divergence si on touche
 * au modèle.
 */
import type { Prisma } from "@prisma/client";

export type ClientStatus = "queued" | "in_progress" | "awaiting_callback" | "done";
export type ClientMode = "publish" | "refresh" | "resync";
export type ClientMarketplace = "pfs" | "ankorstore" | "efashion" | "faire";

/**
 * Actions ciblées produites par la vérification PFS et poussées dans un job
 * de la file marketplace pour affichage widget + badge en cours. Le worker
 * détecte leur présence dans `payload.verifyActions` et dispatch vers
 * `applyPfsVerifyActionsCore` au lieu de la sync standard REFRESH/RESYNC.
 */
export interface QueueVerifyAction {
  key: string;
  direction: "push" | "pull";
}

export interface ClientEnqueueInput {
  productId: string;
  reference: string;
  productName: string;
  firstImage?: string | null;
  options: {
    local?: boolean;
    pfs?: boolean;
    ankorstore?: boolean;
    efashion?: boolean;
    faire?: boolean;
  };
  mode?: ClientMode;
  marketplace?: ClientMarketplace;
  /**
   * Optionnel : liste d'écarts à appliquer via `applyPfsVerifyActionsCore`
   * (envoi granulaire depuis le tooltip PFS Verify). Le worker prend ce chemin
   * quand la clé est présente ; sinon il exécute la sync marketplace complète.
   */
  verifyActions?: QueueVerifyAction[];
}

/**
 * Intention métier du job — routage vers l'onglet correspondant du widget
 * marketplaces (voir MarketplacesDrawer). Optionnel : les vieux jobs pré-2026-08
 * n'ont pas d'intent, le client tombe alors en fallback "update".
 */
export type ClientJobIntent = "create" | "update" | "refresh" | "scheduled" | "link";

export interface SerializedJob {
  id: string;
  productId: string;
  reference: string;
  productName: string;
  firstImage: string | null;
  options: ClientEnqueueInput["options"];
  mode: ClientMode;
  marketplace: ClientMarketplace;
  status: ClientStatus;
  intent?: ClientJobIntent;
  /** Progression étape par étape (voir lib/marketplace-job-steps.ts). */
  steps?: unknown[];
  localOutcome?: unknown;
  pfsOutcome?: unknown;
  ankorsOutcome?: unknown;
  efashionOutcome?: unknown;
  faireOutcome?: unknown;
  ankorsOperationId?: string;
  createdAt: string;
  /** ISO string. Absent = démarrage immédiat. Présent = heure prévue de départ. */
  scheduledFor?: string;
  startedAt?: string;
  completedAt?: string;
}

type JobRow = Prisma.MarketplaceRefreshJobGetPayload<Record<string, never>>;

export function mapMarketplaceToDb(value: ClientMarketplace): "PFS" | "ANKORSTORE" | "EFASHION" | "FAIRE" {
  if (value === "ankorstore") return "ANKORSTORE";
  if (value === "efashion") return "EFASHION";
  if (value === "faire") return "FAIRE";
  return "PFS";
}

export function mapModeToDb(value: ClientMode): "PUBLISH" | "REFRESH" | "RESYNC" {
  if (value === "publish") return "PUBLISH";
  if (value === "resync") return "RESYNC";
  return "REFRESH";
}

export function mapIntentToDb(
  value: ClientJobIntent,
): "CREATE" | "UPDATE" | "REFRESH" | "SCHEDULED" | "LINK" {
  if (value === "create") return "CREATE";
  if (value === "refresh") return "REFRESH";
  if (value === "scheduled") return "SCHEDULED";
  if (value === "link") return "LINK";
  return "UPDATE";
}

function mapIntentToClient(value: JobRow["intent"] | null | undefined): ClientJobIntent | undefined {
  if (!value) return undefined;
  if (value === "CREATE") return "create";
  if (value === "UPDATE") return "update";
  if (value === "REFRESH") return "refresh";
  if (value === "SCHEDULED") return "scheduled";
  if (value === "LINK") return "link";
  return undefined;
}

function mapMarketplaceToClient(value: JobRow["marketplace"]): ClientMarketplace {
  if (value === "ANKORSTORE") return "ankorstore";
  if (value === "EFASHION") return "efashion";
  if (value === "FAIRE") return "faire";
  return "pfs";
}

function mapModeToClient(value: JobRow["mode"]): ClientMode {
  if (value === "PUBLISH") return "publish";
  if (value === "RESYNC") return "resync";
  return "refresh";
}

function mapStatusToClient(value: JobRow["status"]): ClientStatus {
  switch (value) {
    case "QUEUED":
      return "queued";
    case "IN_PROGRESS":
      return "in_progress";
    case "AWAITING_CALLBACK":
      return "awaiting_callback";
    case "SUCCEEDED":
    case "FAILED":
      return "done";
    case "CANCELLED":
    default:
      return "done"; // ne devrait pas remonter via GET mais on bouchonne
  }
}

export function serializeJob(job: JobRow): SerializedJob {
  const payload = (job.payload as unknown as {
    reference?: string;
    productName?: string;
    firstImage?: string | null;
    options?: ClientEnqueueInput["options"];
  }) ?? {};

  return {
    id: job.id,
    productId: job.productId,
    reference: payload.reference ?? "?",
    productName: payload.productName ?? "Produit introuvable",
    firstImage: payload.firstImage ?? null,
    options: payload.options ?? {},
    mode: mapModeToClient(job.mode),
    marketplace: mapMarketplaceToClient(job.marketplace),
    status: mapStatusToClient(job.status),
    intent: mapIntentToClient(job.intent),
    steps: Array.isArray(job.steps) ? (job.steps as unknown[]) : undefined,
    localOutcome: (job.localOutcome as unknown) ?? undefined,
    pfsOutcome: (job.pfsOutcome as unknown) ?? undefined,
    ankorsOutcome: (job.ankorsOutcome as unknown) ?? undefined,
    efashionOutcome: (job.efashionOutcome as unknown) ?? undefined,
    faireOutcome: (job.faireOutcome as unknown) ?? undefined,
    ankorsOperationId: job.ankorsOperationId ?? undefined,
    createdAt: job.createdAt.toISOString(),
    scheduledFor: job.scheduledFor ? job.scheduledFor.toISOString() : undefined,
    startedAt: job.startedAt ? job.startedAt.toISOString() : undefined,
    completedAt: job.completedAt ? job.completedAt.toISOString() : undefined,
  };
}

// ─── Validation simple côté serveur ─────────────────────────────────
export function validateEnqueueInput(
  items: unknown,
): { ok: true; items: ClientEnqueueInput[] } | { ok: false; error: string } {
  if (!Array.isArray(items)) return { ok: false, error: "items doit être un tableau." };
  if (items.length === 0) return { ok: false, error: "items vide." };
  if (items.length > 500) return { ok: false, error: "Trop d'items (max 500)." };

  const out: ClientEnqueueInput[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "Chaque item doit être un objet." };
    }
    const it = raw as Record<string, unknown>;
    if (typeof it.productId !== "string" || it.productId.length === 0) {
      return { ok: false, error: "productId requis sur chaque item." };
    }
    if (typeof it.reference !== "string") {
      return { ok: false, error: "reference requise sur chaque item." };
    }
    if (typeof it.productName !== "string") {
      return { ok: false, error: "productName requis sur chaque item." };
    }
    const options = (it.options as Record<string, unknown>) ?? {};
    const mode =
      it.mode === "publish" || it.mode === "refresh" || it.mode === "resync"
        ? (it.mode as ClientMode)
        : undefined;
    const marketplace =
      it.marketplace === "pfs" ||
      it.marketplace === "ankorstore" ||
      it.marketplace === "efashion" ||
      it.marketplace === "faire"
        ? (it.marketplace as ClientMarketplace)
        : undefined;
    // verifyActions optionnel — valide chaque entrée (key string non vide + direction ∈ {push,pull})
    let verifyActions: QueueVerifyAction[] | undefined;
    if (Array.isArray(it.verifyActions)) {
      const parsed: QueueVerifyAction[] = [];
      for (const raw of it.verifyActions) {
        if (!raw || typeof raw !== "object") continue;
        const va = raw as Record<string, unknown>;
        if (typeof va.key !== "string" || va.key.length === 0) continue;
        if (va.direction !== "push" && va.direction !== "pull") continue;
        parsed.push({ key: va.key, direction: va.direction });
      }
      if (parsed.length > 0) verifyActions = parsed;
    }
    out.push({
      productId: it.productId,
      reference: it.reference as string,
      productName: it.productName as string,
      firstImage: typeof it.firstImage === "string" ? (it.firstImage as string) : null,
      options: {
        local: options.local === true,
        pfs: options.pfs === true,
        ankorstore: options.ankorstore === true,
        efashion: options.efashion === true,
        faire: options.faire === true,
      },
      mode,
      marketplace,
      verifyActions,
    });
  }
  return { ok: true, items: out };
}
