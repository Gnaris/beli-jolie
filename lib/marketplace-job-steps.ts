/**
 * lib/marketplace-job-steps.ts
 *
 * Progression étape par étape d'un MarketplaceRefreshJob. Le worker pousse
 * une entrée à chaque phase clé (validation, auth, création produit, création
 * variantes, upload images, publication, sauvegarde IDs). Le widget marketplaces
 * lit ces entrées pour afficher la timeline détaillée style « modale de liaison ».
 *
 * Persisté dans MarketplaceRefreshJob.steps (Json?). Format = array de StepEntry,
 * ajouté au fur et à mesure. La colonne peut rester null pour les jobs anciens
 * ou pour les branches qui n'ont pas été instrumentées — le client tombe alors
 * en fallback « pas de détail » et affiche juste le statut global.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Kinds d'étapes possibles. Ajouter uniquement en fin de liste (le client
 * connaît les libellés FR via STEP_LABELS ci-dessous).
 */
export type StepKind =
  | "VALIDATE" // validation des données produit (prix, poids, compo…)
  | "AUTH" // authentification chez la marketplace
  | "DIFF" // calcul du diff snapshot (mode update)
  | "FETCH_REMOTE" // lecture de l'état marketplace actuel
  | "CREATE_PRODUCT" // POST /products
  | "UPDATE_PRODUCT" // PATCH /products/{id}
  | "CREATE_VARIANTS" // création couleurs / tailles / SKUs
  | "UPDATE_VARIANTS" // modification variantes existantes
  | "DELETE_VARIANTS" // suppression variantes orphelines
  | "UPLOAD_IMAGES" // upload photos vers marketplace
  | "SYNC_ATTRIBUTES" // composition, pays, catégorie…
  | "ARCHIVE_OLD" // archivage ancien produit (refresh)
  | "RENAME" // renommage de la référence temporaire (refresh)
  | "PUBLISH" // bascule ONLINE côté marketplace
  | "SAVE_IDS" // sauvegarde des IDs marketplaces en base
  | "IMPORT_VARIANT" // import d'une variante orpheline depuis le marketplace (liaison)
  | "LINK_IDS" // pose des IDs marketplace côté BJ (liaison)
  | "POST_SYNC"; // sync complète post-liaison (forceFullSync)

export type StepStatus = "pending" | "in_progress" | "done" | "error" | "skipped";

/**
 * Une étape unique. `total`/`current` renseignés seulement quand pertinent
 * (upload d'images 3/12, création de variantes 2/5).
 */
export interface StepEntry {
  kind: StepKind;
  /** Libellé affiché côté client — si absent, le client dérive via STEP_LABELS. */
  label?: string;
  status: StepStatus;
  /** ISO date de début (posé au premier passage in_progress). */
  startedAt?: string;
  /** ISO date de fin (posé quand done/error/skipped). */
  completedAt?: string;
  /** Message court (succès : ID retourné · erreur : cause FR). */
  message?: string;
  /** Barre de progression : X sur Y. Rempli pour uploads/variantes. */
  current?: number;
  total?: number;
  /** Détails structurés optionnels (ex : IDs marketplace retournés, log court). */
  data?: Record<string, unknown>;
}

/**
 * Libellés FR par défaut, utilisés côté client si aucun label explicite n'est
 * poussé par le worker.
 */
export const STEP_LABELS: Record<StepKind, string> = {
  VALIDATE: "Validation des données produit",
  AUTH: "Authentification marketplace",
  DIFF: "Calcul du diff",
  FETCH_REMOTE: "Lecture de l'état marketplace",
  CREATE_PRODUCT: "Création du produit",
  UPDATE_PRODUCT: "Mise à jour du produit",
  CREATE_VARIANTS: "Création des variantes couleurs",
  UPDATE_VARIANTS: "Mise à jour des variantes",
  DELETE_VARIANTS: "Suppression des variantes orphelines",
  UPLOAD_IMAGES: "Upload des images",
  SYNC_ATTRIBUTES: "Sync composition et attributs",
  ARCHIVE_OLD: "Archivage de l'ancienne fiche",
  RENAME: "Renommage de la référence",
  PUBLISH: "Publication finale",
  SAVE_IDS: "Sauvegarde des identifiants",
  IMPORT_VARIANT: "Import de la variante depuis le marketplace",
  LINK_IDS: "Liaison des identifiants",
  POST_SYNC: "Synchronisation complète post-liaison",
};

/**
 * Coerce un JSON serialisé en `StepEntry[]`. Résilient : retourne `[]` si le
 * JSON est absent, vide, invalide, ou d'une forme inattendue.
 */
export function coerceStepArray(raw: unknown): StepEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: StepEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.kind !== "string") continue;
    if (typeof rec.status !== "string") continue;
    const status = rec.status as StepStatus;
    if (!["pending", "in_progress", "done", "error", "skipped"].includes(status)) continue;
    out.push({
      kind: rec.kind as StepKind,
      status,
      label: typeof rec.label === "string" ? rec.label : undefined,
      startedAt: typeof rec.startedAt === "string" ? rec.startedAt : undefined,
      completedAt: typeof rec.completedAt === "string" ? rec.completedAt : undefined,
      message: typeof rec.message === "string" ? rec.message : undefined,
      current: typeof rec.current === "number" ? rec.current : undefined,
      total: typeof rec.total === "number" ? rec.total : undefined,
      data:
        rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)
          ? (rec.data as Record<string, unknown>)
          : undefined,
    });
  }
  return out;
}

/**
 * Merge une entrée dans un tableau existant :
 *  - si une entrée avec le même `kind` existe : on la met à jour (patch)
 *  - sinon : on l'ajoute en fin
 *
 * Idempotent — appeler markStepInternal plusieurs fois avec le même kind ne
 * duplique pas l'entrée. Utile pour passer PENDING → IN_PROGRESS → DONE sans
 * gérer manuellement l'index côté worker.
 */
export function mergeStep(existing: StepEntry[], patch: Partial<StepEntry> & { kind: StepKind }): StepEntry[] {
  const idx = existing.findIndex((s) => s.kind === patch.kind);
  const now = new Date().toISOString();
  if (idx === -1) {
    const entry: StepEntry = {
      kind: patch.kind,
      status: patch.status ?? "pending",
      label: patch.label,
      startedAt: patch.status === "in_progress" || patch.status === "done" ? now : patch.startedAt,
      completedAt:
        patch.status === "done" || patch.status === "error" || patch.status === "skipped"
          ? now
          : patch.completedAt,
      message: patch.message,
      current: patch.current,
      total: patch.total,
      data: patch.data,
    };
    return [...existing, entry];
  }
  const current = existing[idx];
  const merged: StepEntry = {
    ...current,
    ...patch,
    startedAt:
      current.startedAt ??
      (patch.status === "in_progress" || patch.status === "done" ? now : undefined),
    completedAt:
      patch.status === "done" || patch.status === "error" || patch.status === "skipped"
        ? current.completedAt ?? now
        : current.completedAt,
    message: patch.message ?? current.message,
    data: patch.data ? { ...(current.data ?? {}), ...patch.data } : current.data,
  };
  const next = existing.slice();
  next[idx] = merged;
  return next;
}

/**
 * Pousse (ou met à jour) une étape sur un job marketplace. Best-effort :
 * une erreur d'écriture n'interrompt jamais le worker (l'étape est une info
 * d'affichage, pas un état métier).
 *
 * Concurrence : lit puis réécrit. Deux appels rapides sur des kinds différents
 * peuvent s'écraser. Dans notre worker, chaque job est traité par un seul
 * thread donc pas de risque pratique. Si un jour on passe à du parallélisme
 * intra-job, wrapper dans une transaction avec SELECT ... FOR UPDATE.
 */
export async function markStep(
  jobId: string,
  patch: Partial<StepEntry> & { kind: StepKind },
): Promise<void> {
  try {
    const job = await prisma.marketplaceRefreshJob.findUnique({
      where: { id: jobId },
      select: { steps: true },
    });
    if (!job) return;
    const current = coerceStepArray(job.steps);
    const next = mergeStep(current, patch);
    await prisma.marketplaceRefreshJob.update({
      where: { id: jobId },
      data: { steps: next as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    // Non bloquant : la progression est un affichage, pas un état métier.
    logger.warn("[Marketplace Steps] markStep failed", {
      jobId,
      kind: patch.kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Raccourci pour marquer une étape "démarrée" et retourner un finaliseur
 * qui la marque "done" ou "error" selon le résultat. Réduit la verbosité
 * dans le worker : `const done = await stepScope(jobId, "AUTH"); ...; await done("ok")`.
 */
export async function stepScope(
  jobId: string,
  kind: StepKind,
  init?: { label?: string; total?: number },
): Promise<(result: { ok: true; message?: string; data?: Record<string, unknown> } | { ok: false; message: string }) => Promise<void>> {
  await markStep(jobId, {
    kind,
    status: "in_progress",
    label: init?.label,
    total: init?.total,
  });
  return async (result) => {
    if (result.ok) {
      await markStep(jobId, {
        kind,
        status: "done",
        message: result.message,
        data: result.data,
      });
    } else {
      await markStep(jobId, {
        kind,
        status: "error",
        message: result.message,
      });
    }
  };
}
