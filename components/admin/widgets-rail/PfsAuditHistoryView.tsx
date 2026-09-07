"use client";

/**
 * Onglet « Historique » du drawer Audit PFS.
 *
 * Liste des derniers runs auto (30 par défaut, 90 jours de rétention). Chaque
 * run est une carte pliable avec un bouton « Voir le détail » qui charge et
 * affiche produit par produit un tableau compact avant / après (nom,
 * description, prix, stock, variantes ±, composition, activation).
 *
 * Reste étroit — le drawer fait ~400px, donc les colonnes avant/après sont
 * empilées verticalement pour rester lisibles.
 */

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  getPfsAuditHistoryAction,
  getPfsAuditRunDetailsAction,
  deletePfsAuditRunAction,
  deleteAllPfsAuditRunsAction,
} from "@/app/actions/admin/pfs-audit-auto";
import type {
  PfsAuditHistoryRunSummary,
  PfsAuditHistoryProductDetail,
  PfsAuditRunChangeItem,
} from "@/lib/pfs-audit-history";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startIso: string, endIso: string | null): string | null {
  if (!endIso) return null;
  const diffMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (diffMs < 1000) return "< 1 s";
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m} min ${rem} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

function statusBadge(status: "RUNNING" | "DONE" | "ERROR", errorMessage: string | null) {
  if (status === "DONE") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-semibold">
        ✓ Terminé
      </span>
    );
  }
  if (status === "ERROR") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[11px] font-semibold"
        title={errorMessage ?? undefined}
      >
        ✗ Interrompu
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 text-[11px] font-semibold">
      ⟳ En cours
    </span>
  );
}

function ChangeRow({ change }: { change: PfsAuditRunChangeItem }) {
  const isAdd = change.field === "addedVariant";
  const isRemove = change.field === "removedVariant";
  const bg = isAdd
    ? "bg-emerald-50/60 border-emerald-200"
    : isRemove
      ? "bg-rose-50/60 border-rose-200"
      : "bg-slate-50 border-slate-200";
  return (
    <div className={`rounded-lg border ${bg} p-2 text-[11.5px]`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="font-semibold text-slate-800">{change.label}</span>
        {change.colorName && (
          <span className="text-slate-500">— {change.colorName}</span>
        )}
        {change.variantType === "PACK" && (
          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-medium">
            Pack
          </span>
        )}
      </div>
      {!isAdd && !isRemove && (
        <div className="grid gap-1.5">
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-semibold uppercase tracking-wide">
              Avant
            </span>
            <span className="text-slate-700 break-words">{change.before ?? "—"}</span>
          </div>
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-semibold uppercase tracking-wide">
              Après
            </span>
            <span className="text-slate-700 break-words">{change.after ?? "—"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductRow({
  product,
}: {
  product: PfsAuditHistoryProductDetail;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 p-2.5 hover:bg-slate-50 transition text-left"
      >
        {product.firstImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.firstImage}
            alt=""
            className="w-9 h-9 rounded-lg object-cover shrink-0 bg-slate-100"
          />
        ) : (
          <div className="w-9 h-9 rounded-lg bg-slate-100 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-slate-800 truncate">
            {product.name}
          </div>
          <div className="text-[10.5px] text-slate-500">
            Réf. {product.reference} — {product.changes.length} modification
            {product.changes.length > 1 ? "s" : ""}
          </div>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-slate-400 transition-transform shrink-0 ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-1.5 border-t border-slate-100 pt-2">
          {product.changes.map((c, i) => (
            <ChangeRow key={i} change={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function RunCard({
  run,
  onDeleted,
}: {
  run: PfsAuditHistoryRunSummary;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<PfsAuditHistoryProductDetail[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleOpen = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && !details) {
      setLoading(true);
      const r = await getPfsAuditRunDetailsAction(run.id);
      setLoading(false);
      if (r.success) setDetails(r.products);
      else toast.error("Chargement impossible", r.error);
    }
  }, [open, details, run.id, toast]);

  const handleDelete = useCallback(
    async (ev: React.MouseEvent) => {
      ev.stopPropagation();
      const ok = await confirm({
        type: "warning",
        title: "Supprimer ce run ?",
        message: `Le run du ${new Date(run.startedAt).toLocaleString("fr-FR")} et toutes ses modifications enregistrées seront supprimés définitivement.`,
        confirmLabel: "Supprimer",
        cancelLabel: "Annuler",
      });
      if (!ok) return;
      setDeleting(true);
      const r = await deletePfsAuditRunAction(run.id);
      setDeleting(false);
      if (r.success) {
        onDeleted(run.id);
      } else {
        toast.error("Suppression impossible", r.error);
      }
    },
    [confirm, run.id, run.startedAt, onDeleted, toast],
  );

  const duration = formatDuration(run.startedAt, run.finishedAt);
  const showDetails = run.changedProducts > 0 && run.status === "DONE";

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[12px] font-semibold text-slate-800">
              {formatDate(run.startedAt)}
            </div>
            <div className="text-[10.5px] text-slate-500 flex items-center gap-1 mt-0.5">
              {run.autoTriggered ? "Automatique" : "Manuel"}
              {duration && <> · {duration}</>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {statusBadge(run.status, run.errorMessage)}
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              title="Supprimer ce run"
              className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition disabled:opacity-40"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
              </svg>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-600">
          <span>
            <span className="font-semibold text-slate-800">{run.changedProducts}</span>{" "}
            produit{run.changedProducts > 1 ? "s" : ""} modifié
            {run.changedProducts > 1 ? "s" : ""}
          </span>
          <span className="text-slate-400">sur {run.totalProducts} en écart</span>
        </div>
        {run.status === "ERROR" && run.errorMessage && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
            {run.errorMessage}
          </div>
        )}
        {showDetails && (
          <button
            type="button"
            onClick={handleOpen}
            className="w-full mt-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-[11.5px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition"
          >
            {open ? "Masquer le détail" : "Voir le détail"}
            <svg
              className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <div className="border-t border-slate-100 p-2.5 bg-slate-50/50 space-y-2">
          {loading && (
            <div className="text-[11px] text-slate-500 text-center py-3">
              Chargement du détail…
            </div>
          )}
          {!loading && details && details.length === 0 && (
            <div className="text-[11px] text-slate-500 text-center py-3">
              Aucun changement enregistré pour ce run.
            </div>
          )}
          {!loading &&
            details &&
            details.map((p) => <ProductRow key={p.productId} product={p} />)}
        </div>
      )}
    </div>
  );
}

export function PfsAuditHistoryView({ visible }: { visible: boolean }) {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<PfsAuditHistoryRunSummary[] | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getPfsAuditHistoryAction(30);
    setLoading(false);
    if (r.success) setRuns(r.runs);
    else toast.error("Chargement de l'historique impossible", r.error);
  }, [toast]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const handleDeleteOne = useCallback((id: string) => {
    setRuns((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
  }, []);

  const handleDeleteAll = useCallback(async () => {
    if (!runs || runs.length === 0) return;
    const ok = await confirm({
      type: "warning",
      title: "Vider tout l'historique ?",
      message: `Les ${runs.length} run${runs.length > 1 ? "s" : ""} de l'historique et toutes leurs modifications seront supprimés définitivement.`,
      confirmLabel: "Tout supprimer",
      cancelLabel: "Annuler",
    });
    if (!ok) return;
    setDeletingAll(true);
    const r = await deleteAllPfsAuditRunsAction();
    setDeletingAll(false);
    if (r.success) {
      setRuns([]);
      toast.success("Historique vidé", `${r.deleted} run${r.deleted > 1 ? "s" : ""} supprimé${r.deleted > 1 ? "s" : ""}.`);
    } else {
      toast.error("Suppression impossible", r.error);
    }
  }, [runs, confirm, toast]);

  if (loading && !runs) {
    return (
      <div className="p-6 text-center text-[12px] text-slate-500">
        Chargement de l'historique…
      </div>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <div className="p-6 text-center text-[12px] text-slate-500 max-w-sm mx-auto">
        <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
          <svg
            className="w-6 h-6 text-slate-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3M12 21a9 9 0 100-18 9 9 0 000 18z" />
          </svg>
        </div>
        <p className="font-semibold text-slate-700 mb-1">Aucun audit automatique enregistré</p>
        <p>
          Activez l'audit automatique dans <em>Paramètres → Marketplaces → PFS</em>. Les 90 derniers jours seront conservés ici.
        </p>
      </div>
    );
  }

  return (
    <div className="p-2.5 space-y-2 overflow-y-auto">
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <span className="text-[10.5px] text-slate-500 uppercase tracking-wide font-semibold">
          {runs.length} run{runs.length > 1 ? "s" : ""}
        </span>
        <button
          type="button"
          onClick={handleDeleteAll}
          disabled={deletingAll || runs.length === 0}
          className="inline-flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-700 hover:underline transition disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
          </svg>
          {deletingAll ? "Suppression…" : "Tout supprimer"}
        </button>
      </div>
      {runs.map((r) => (
        <RunCard key={r.id} run={r} onDeleted={handleDeleteOne} />
      ))}
      <div className="text-center pt-2 pb-4">
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 transition"
        >
          ⟳ Actualiser
        </button>
      </div>
    </div>
  );
}
