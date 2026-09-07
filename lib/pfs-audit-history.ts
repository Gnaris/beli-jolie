/**
 * PFS Audit History — Journal des runs d'audit automatique.
 *
 * Snapshot avant / après par produit, diff des champs demandés par la cliente
 * (nom, description, prix, stock, variantes ±, composition, activation),
 * persistance dans les tables PfsAuditRun / PfsAuditRunChange.
 *
 * Utilisé par le runner d'audit auto (lib/pfs-audit-runner.ts branche auto)
 * + les server actions de lecture / purge côté drawer.
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ─── Types publics ─────────────────────────────────────────────────────────

/** Un changement individuel dans un produit — 1 ligne du tableau avant/après. */
export interface PfsAuditRunChangeItem {
  /** "product" : champ fiche · "variant" : champ d'une couleur/variante. */
  scope: "product" | "variant";
  /** Identifiant machine (name, description, price, stock, composition, disabled, addedVariant, removedVariant…). */
  field: string;
  /** Libellé lisible : « Nom », « Prix », « Stock », etc. */
  label: string;
  /** Couleur concernée si scope=variant. */
  colorName?: string;
  /** Type de vente si scope=variant. */
  variantType?: "UNIT" | "PACK";
  /** Valeur avant (rendue en texte). */
  before: string | null;
  /** Valeur après (rendue en texte). */
  after: string | null;
}

export interface PfsAuditHistoryRunSummary {
  id: string;
  autoTriggered: boolean;
  startedAt: string; // ISO
  finishedAt: string | null;
  status: "RUNNING" | "DONE" | "ERROR";
  totalProducts: number;
  changedProducts: number;
  errorMessage: string | null;
}

export interface PfsAuditHistoryProductDetail {
  productId: string;
  reference: string;
  name: string;
  firstImage: string | null;
  changes: PfsAuditRunChangeItem[];
}

// ─── Snapshot ──────────────────────────────────────────────────────────────

export interface PfsAuditProductSnapshot {
  productId: string;
  reference: string;
  name: string;
  description: string;
  status: string;
  compositions: { compositionName: string; percentage: number }[];
  variants: {
    colorId: string | null;
    colorName: string;
    saleType: "UNIT" | "PACK";
    unitPrice: number;
    stock: number;
    weight: number;
    disabled: boolean;
    packQuantity: number | null;
  }[];
}

/**
 * Prend un snapshot complet du produit — champs fiche + variantes + compos.
 * Utilisé avant ET après l'application des corrections PFS pour calculer le
 * diff destiné au journal historique.
 */
export async function captureProductSnapshot(
  productId: string,
): Promise<PfsAuditProductSnapshot | null> {
  const p = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      status: true,
      compositions: {
        select: {
          percentage: true,
          composition: { select: { name: true } },
        },
      },
      colors: {
        select: {
          colorId: true,
          color: { select: { name: true } },
          saleType: true,
          unitPrice: true,
          stock: true,
          weight: true,
          disabled: true,
          packQuantity: true,
        },
      },
    },
  });
  if (!p) return null;
  return {
    productId: p.id,
    reference: p.reference,
    name: p.name,
    description: p.description ?? "",
    status: p.status,
    compositions: p.compositions
      .map((c) => ({
        compositionName: c.composition?.name ?? "?",
        percentage: Number(c.percentage),
      }))
      .sort((a, b) => a.compositionName.localeCompare(b.compositionName)),
    variants: p.colors
      .map((v) => ({
        colorId: v.colorId,
        colorName: v.color?.name ?? "(sans couleur)",
        saleType: (v.saleType as "UNIT" | "PACK") ?? "UNIT",
        unitPrice: Number(v.unitPrice),
        stock: v.stock ?? 0,
        weight: v.weight ?? 0,
        disabled: v.disabled ?? false,
        packQuantity: v.packQuantity ?? null,
      }))
      .sort(
        (a, b) =>
          a.colorName.localeCompare(b.colorName) || a.saleType.localeCompare(b.saleType),
      ),
  };
}

// ─── Diff ──────────────────────────────────────────────────────────────────

function variantKey(v: { colorId: string | null; saleType: "UNIT" | "PACK" }): string {
  return `${v.colorId ?? "null"}::${v.saleType}`;
}

function fmtPrice(n: number): string {
  return `${n.toFixed(2)} €`;
}

function fmtCompos(rows: { compositionName: string; percentage: number }[]): string {
  if (rows.length === 0) return "(aucune)";
  return rows.map((c) => `${c.compositionName} ${c.percentage}%`).join(" + ");
}

/**
 * Compare deux snapshots et produit la liste des changements demandés par la
 * cliente : nom, description, prix, stock, variantes (ajouts/suppressions),
 * composition, variante activée/désactivée.
 *
 * Retourne un tableau vide si les 2 snapshots sont équivalents.
 */
export function diffProductSnapshots(
  before: PfsAuditProductSnapshot,
  after: PfsAuditProductSnapshot,
): PfsAuditRunChangeItem[] {
  const out: PfsAuditRunChangeItem[] = [];

  if (before.name !== after.name) {
    out.push({
      scope: "product",
      field: "name",
      label: "Nom",
      before: before.name,
      after: after.name,
    });
  }
  if ((before.description ?? "") !== (after.description ?? "")) {
    out.push({
      scope: "product",
      field: "description",
      label: "Description",
      before: before.description || "(vide)",
      after: after.description || "(vide)",
    });
  }
  if (before.status !== after.status) {
    out.push({
      scope: "product",
      field: "status",
      label: "Statut fiche",
      before: before.status,
      after: after.status,
    });
  }
  const beforeCompoStr = fmtCompos(before.compositions);
  const afterCompoStr = fmtCompos(after.compositions);
  if (beforeCompoStr !== afterCompoStr) {
    out.push({
      scope: "product",
      field: "composition",
      label: "Composition",
      before: beforeCompoStr,
      after: afterCompoStr,
    });
  }

  // Variantes : index par (colorId, saleType) pour détecter ajouts/suppressions
  // + comparer les valeurs champ par champ des variantes communes.
  const beforeMap = new Map(before.variants.map((v) => [variantKey(v), v]));
  const afterMap = new Map(after.variants.map((v) => [variantKey(v), v]));

  // Ajouts
  for (const [k, v] of afterMap) {
    if (beforeMap.has(k)) continue;
    const label = v.saleType === "PACK" && v.packQuantity ? `${v.colorName} (pack de ${v.packQuantity})` : v.colorName;
    out.push({
      scope: "variant",
      field: "addedVariant",
      label: "Variante ajoutée",
      colorName: v.colorName,
      variantType: v.saleType,
      before: null,
      after: label,
    });
  }
  // Suppressions
  for (const [k, v] of beforeMap) {
    if (afterMap.has(k)) continue;
    const label = v.saleType === "PACK" && v.packQuantity ? `${v.colorName} (pack de ${v.packQuantity})` : v.colorName;
    out.push({
      scope: "variant",
      field: "removedVariant",
      label: "Variante supprimée",
      colorName: v.colorName,
      variantType: v.saleType,
      before: label,
      after: null,
    });
  }
  // Communes → diff des champs demandés
  for (const [k, va] of afterMap) {
    const vb = beforeMap.get(k);
    if (!vb) continue;
    if (vb.unitPrice !== va.unitPrice) {
      out.push({
        scope: "variant",
        field: "price",
        label: "Prix",
        colorName: va.colorName,
        variantType: va.saleType,
        before: fmtPrice(vb.unitPrice),
        after: fmtPrice(va.unitPrice),
      });
    }
    if (vb.stock !== va.stock) {
      out.push({
        scope: "variant",
        field: "stock",
        label: "Stock",
        colorName: va.colorName,
        variantType: va.saleType,
        before: String(vb.stock),
        after: String(va.stock),
      });
    }
    if (vb.disabled !== va.disabled) {
      out.push({
        scope: "variant",
        field: "disabled",
        label: vb.disabled ? "Variante réactivée" : "Variante désactivée",
        colorName: va.colorName,
        variantType: va.saleType,
        before: vb.disabled ? "désactivée" : "activée",
        after: va.disabled ? "désactivée" : "activée",
      });
    }
  }

  return out;
}

// ─── Persistance ───────────────────────────────────────────────────────────

/** Crée un run vide (status RUNNING) — renvoie l'id. */
export async function createPfsAuditRun(
  tenantId: string,
  autoTriggered: boolean,
): Promise<string> {
  const row = await prisma.pfsAuditRun.create({
    data: {
      tenantId,
      autoTriggered,
      status: "RUNNING",
      totalProducts: 0,
      changedProducts: 0,
    },
    select: { id: true },
  });
  return row.id;
}

/** Marque un run comme DONE + persiste totaux.
 *  updateMany (non updateUnique) : robuste si la cliente a supprimé le run
 *  depuis le drawer pendant que l'audit tournait — pas de crash, juste no-op. */
export async function finalizePfsAuditRunSuccess(
  runId: string,
  totalProducts: number,
  changedProducts: number,
): Promise<void> {
  await prisma.pfsAuditRun.updateMany({
    where: { id: runId },
    data: {
      status: "DONE",
      finishedAt: new Date(),
      totalProducts,
      changedProducts,
    },
  });
}

/** Marque un run comme ERROR + persiste le message. updateMany pour la même
 *  raison que finalizePfsAuditRunSuccess. */
export async function finalizePfsAuditRunError(
  runId: string,
  errorMessage: string,
): Promise<void> {
  await prisma.pfsAuditRun.updateMany({
    where: { id: runId },
    data: {
      status: "ERROR",
      finishedAt: new Date(),
      errorMessage,
    },
  });
}

/** Ajoute la ligne d'un produit modifié dans un run. Silencieux si le run
 *  parent a été supprimé entre-temps (P2003 FK) — évite un crash du runner
 *  auto quand la cliente vide l'historique pendant qu'un audit tourne. */
export async function persistProductChange(
  runId: string,
  tenantId: string,
  snapshot: {
    productId: string;
    reference: string;
    name: string;
    firstImage: string | null;
  },
  changes: PfsAuditRunChangeItem[],
): Promise<void> {
  if (changes.length === 0) return;
  try {
    await prisma.pfsAuditRunChange.create({
      data: {
        runId,
        tenantId,
        productId: snapshot.productId,
        reference: snapshot.reference,
        name: snapshot.name,
        firstImage: snapshot.firstImage,
        changes: changes as unknown as import("@prisma/client").Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    logger.warn("[PFS Audit History] Persist change ignoré (run supprimé ?)", {
      runId,
      productId: snapshot.productId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Lecture (server actions & UI) ─────────────────────────────────────────

/** Renvoie les N derniers runs pour l'onglet Historique du drawer. */
export async function listPfsAuditHistoryRuns(
  tenantId: string,
  limit = 30,
): Promise<PfsAuditHistoryRunSummary[]> {
  const rows = await prisma.pfsAuditRun.findMany({
    where: { tenantId },
    orderBy: { startedAt: "desc" },
    take: Math.max(1, Math.min(limit, 100)),
    select: {
      id: true,
      autoTriggered: true,
      startedAt: true,
      finishedAt: true,
      status: true,
      totalProducts: true,
      changedProducts: true,
      errorMessage: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    autoTriggered: r.autoTriggered,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    status: (r.status as "RUNNING" | "DONE" | "ERROR") ?? "DONE",
    totalProducts: r.totalProducts,
    changedProducts: r.changedProducts,
    errorMessage: r.errorMessage,
  }));
}

/** Renvoie le détail (produits modifiés + changes) d'un run donné. */
export async function getPfsAuditRunDetails(
  tenantId: string,
  runId: string,
): Promise<PfsAuditHistoryProductDetail[]> {
  const rows = await prisma.pfsAuditRunChange.findMany({
    where: { tenantId, runId },
    orderBy: { createdAt: "asc" },
    select: {
      productId: true,
      reference: true,
      name: true,
      firstImage: true,
      changes: true,
    },
  });
  return rows.map((r) => ({
    productId: r.productId,
    reference: r.reference,
    name: r.name,
    firstImage: r.firstImage,
    changes: (r.changes as unknown as PfsAuditRunChangeItem[]) ?? [],
  }));
}

// ─── Purge (cron 24h) ──────────────────────────────────────────────────────

const RETENTION_DAYS = 90;

/** Supprime les runs finalisés depuis plus de 90 jours (cascade sur changes). */
export async function purgeOldPfsAuditRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000);
  try {
    const res = await prisma.pfsAuditRun.deleteMany({
      where: { finishedAt: { lt: cutoff, not: null } },
    });
    if (res.count > 0) {
      logger.info("[PFS Audit History] Purge terminée", {
        deleted: res.count,
        cutoff: cutoff.toISOString(),
      });
    }
    return res.count;
  } catch (err) {
    logger.error("[PFS Audit History] Purge échouée", { error: err as Error });
    return 0;
  }
}
