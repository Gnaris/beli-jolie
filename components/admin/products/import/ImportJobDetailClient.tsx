"use client";

/**
 * Page détail d'un import (succès + erreurs)
 *
 * - Filtres : Tous / Succès / Erreurs (3 chips)
 * - Recherche : par référence ou nom de fichier
 * - Affiche les images réussies (avec ref + couleur + position)
 * - Affiche les erreurs (avec raison + actions de correction inline)
 *
 * Pour les images en erreur avec « couleur introuvable », propose la liste
 * des couleurs disponibles en chips cliquables → PATCH /draft/[id] avec
 * colorId pour réimporter l'image.
 */

import { useMemo, useState, useTransition, useCallback } from "react";
import Link from "next/link";
import Image from "@/components/ui/SmartImage";
import ColorSwatch from "@/components/ui/ColorSwatch";
import { useToast } from "@/components/ui/Toast";

export interface ImportJobDetailData {
  id: string;
  type: "PRODUCTS" | "IMAGES";
  status: string;
  filename: string | null;
  totalItems: number;
  processedItems: number;
  successItems: number;
  errorItems: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  resultDetails: {
    type?: "IMAGES" | "PRODUCTS";
    images?: {
      filename: string;
      reference: string;
      color: string;
      position: number;
      imagePath?: string;
      productId?: string;
    }[];
    products?: {
      reference: string;
      name: string;
      category?: string;
      variants?: { color: string; saleType: string; unitPrice: number; stock: number; packQuantity?: number | null }[];
    }[];
  } | null;
  draft: {
    id: string;
    status: string;
    errorRows: number;
    rows: Record<string, unknown>[];
  } | null;
}

interface AvailableColorEntry {
  id: string;
  name: string;
  hex?: string | null;
  patternImage?: string | null;
}

type Filter = "all" | "success" | "errors";

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusLabel(status: string): { label: string; classes: string } {
  switch (status) {
    case "COMPLETED": return { label: "Terminé", classes: "bg-emerald-100 text-emerald-800 border-emerald-200" };
    case "PROCESSING": return { label: "En cours", classes: "bg-sky-100 text-sky-800 border-sky-200" };
    case "PENDING": return { label: "En attente", classes: "bg-slate-100 text-slate-700 border-slate-200" };
    case "FAILED": return { label: "Échec", classes: "bg-rose-100 text-rose-800 border-rose-200" };
    case "CANCELLED": return { label: "Annulé", classes: "bg-slate-100 text-slate-600 border-slate-200" };
    default: return { label: status, classes: "bg-slate-100 text-slate-700 border-slate-200" };
  }
}

export default function ImportJobDetailClient({ data }: { data: ImportJobDetailData }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [draftRows, setDraftRows] = useState(data.draft?.rows ?? []);
  const [draftId, setDraftId] = useState(data.draft?.id ?? null);
  const [removingIdx, setRemovingIdx] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  const status = statusLabel(data.status);
  const isImages = data.type === "IMAGES";
  const successList = isImages ? (data.resultDetails?.images ?? []) : (data.resultDetails?.products ?? []);

  // ── Filtrage par texte + onglet ─────────────────────────────────
  const q = query.trim().toLowerCase();

  const filteredSuccess = useMemo(() => {
    if (filter === "errors") return [];
    if (!q) return successList;
    if (isImages) {
      const list = successList as { filename: string; reference: string; color: string }[];
      return list.filter((s) =>
        s.filename.toLowerCase().includes(q) ||
        s.reference.toLowerCase().includes(q) ||
        s.color.toLowerCase().includes(q),
      );
    }
    const list = successList as { reference: string; name: string }[];
    return list.filter((p) =>
      p.reference.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    );
  }, [filter, q, successList, isImages]);

  const filteredErrors = useMemo(() => {
    if (filter === "success") return [];
    if (!q) return draftRows;
    return draftRows.filter((r) => {
      const ref = String(r.reference ?? "").toLowerCase();
      const fn = String(r.filename ?? r.name ?? "").toLowerCase();
      const col = String(r.color ?? "").toLowerCase();
      return ref.includes(q) || fn.includes(q) || col.includes(q);
    });
  }, [filter, q, draftRows]);

  // ── Action : assigner une couleur à une ligne en erreur ─────────
  const assignColor = useCallback((rowIndex: number, colorId: string) => {
    if (!draftId) return;
    setRemovingIdx(rowIndex);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/products/import/draft/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowIndex, colorId }),
        });
        const result = await res.json();
        if (result.ok) {
          setDraftRows((prev) => prev.filter((_, i) => i !== rowIndex));
          toast({ type: "success", title: "Image réimportée." });
        } else {
          toast({ type: "error", title: result.errors?.[0] ?? "Erreur lors de la réassignation." });
        }
      } catch {
        toast({ type: "error", title: "Erreur réseau." });
      } finally {
        setRemovingIdx(null);
      }
    });
  }, [draftId, toast]);

  // ── Action : retirer une ligne du brouillon ─────────────────────
  const dismissRow = useCallback((rowIndex: number) => {
    if (!draftId) return;
    setRemovingIdx(rowIndex);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/products/import/draft/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowIndex, dismiss: true }),
        });
        const result = await res.json();
        if (result.ok) {
          setDraftRows((prev) => prev.filter((_, i) => i !== rowIndex));
          toast({ type: "success", title: "Ligne retirée." });
        } else {
          toast({ type: "error", title: "Erreur lors du retrait." });
        }
      } catch {
        toast({ type: "error", title: "Erreur réseau." });
      } finally {
        setRemovingIdx(null);
      }
    });
  }, [draftId, toast]);

  // Si le brouillon est vide après corrections, on peut le supprimer côté serveur
  const cleanupDraft = useCallback(async () => {
    if (!draftId || draftRows.length > 0) return;
    try {
      await fetch(`/api/admin/products/import/draft/${draftId}`, { method: "DELETE" });
      setDraftId(null);
    } catch {
      /* silent */
    }
  }, [draftId, draftRows.length]);

  // Auto-cleanup quand toutes les erreurs sont résolues
  useMemo(() => {
    if (draftId && draftRows.length === 0) {
      cleanupDraft();
    }
  }, [draftRows.length, draftId, cleanupDraft]);

  return (
    <div className="space-y-5">
      {/* ─── Hero ───────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl border border-border shadow-sm">
        <div className={`absolute inset-0 ${
          data.errorItems === 0
            ? "bg-gradient-to-br from-emerald-50 via-bg-primary to-bg-primary"
            : "bg-gradient-to-br from-amber-50 via-bg-primary to-bg-primary"
        }`} />
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl bg-emerald-300/20 pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-48 h-48 rounded-full blur-3xl bg-amber-300/20 pointer-events-none" />

        <div className="relative p-5 sm:p-6 md:p-7">
          <Link
            href="/admin/produits/importer/historique"
            className="inline-flex items-center gap-1.5 text-[11px] font-body font-medium text-text-secondary hover:text-text-primary transition-colors mb-3"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
            Retour à l&apos;historique
          </Link>

          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-body font-semibold uppercase tracking-[0.18em] ${status.classes}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {status.label}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg-primary border border-border text-[10px] font-body font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  {isImages ? "Images" : "Produits"}
                </span>
              </div>
              <h1 className="font-heading text-xl sm:text-2xl font-bold text-text-primary tracking-tight mt-2.5">
                {data.filename || (isImages ? "Import d'images" : "Import de produits")}
              </h1>
              <p className="font-body text-xs sm:text-[13px] text-text-muted mt-1">
                Démarré le {formatDate(data.createdAt)} · ID <span className="font-mono">{data.id.slice(0, 8)}</span>
              </p>
              {data.errorMessage && (
                <p className="mt-3 text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 font-body max-w-xl">
                  {data.errorMessage}
                </p>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3 shrink-0 w-full md:w-auto">
              <KpiTile label="Au total" value={data.totalItems} accent="slate" />
              <KpiTile label="Succès" value={data.successItems} accent="emerald" />
              <KpiTile label="Erreurs" value={draftRows.length || data.errorItems} accent={draftRows.length > 0 || data.errorItems > 0 ? "rose" : "slate"} />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Barre d'outils : onglets + search ──────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip current={filter} value="all" onClick={setFilter} count={successList.length + draftRows.length}>Tous</FilterChip>
          <FilterChip current={filter} value="success" onClick={setFilter} count={successList.length} variant="emerald">Succès</FilterChip>
          <FilterChip current={filter} value="errors" onClick={setFilter} count={draftRows.length} variant="rose">À corriger</FilterChip>
        </div>
        <div className="flex items-center gap-2 bg-bg-primary border border-border px-3 py-2 rounded-xl sm:w-[320px]">
          <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isImages ? "Référence, nom de fichier, couleur…" : "Référence ou nom de produit…"}
            className="flex-1 bg-transparent text-[12px] font-body text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="text-text-muted hover:text-text-primary">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ─── Section : Succès ───────────────────────────────────── */}
      {filter !== "errors" && (
        <SectionCard
          accent="emerald"
          title={isImages ? "Images importées" : "Produits créés"}
          count={filteredSuccess.length}
          empty={filteredSuccess.length === 0 ? (q ? "Aucun succès ne correspond à la recherche." : "Aucun élément n'a été importé.") : null}
        >
          {isImages ? (
            <ImageSuccessList
              items={filteredSuccess as NonNullable<NonNullable<ImportJobDetailData["resultDetails"]>["images"]>}
            />
          ) : (
            <ProductSuccessList
              items={filteredSuccess as NonNullable<NonNullable<ImportJobDetailData["resultDetails"]>["products"]>}
            />
          )}
        </SectionCard>
      )}

      {/* ─── Section : Erreurs ──────────────────────────────────── */}
      {filter !== "success" && (
        <SectionCard
          accent="rose"
          title="À corriger"
          count={filteredErrors.length}
          empty={filteredErrors.length === 0 ? (q ? "Aucune erreur ne correspond à la recherche." : "Aucune erreur à corriger.") : null}
        >
          <ul className="divide-y divide-rose-50">
            {filteredErrors.map((row, idxInFiltered) => {
              // Trouve l'index réel dans draftRows pour les actions PATCH
              const rowIndex = draftRows.indexOf(row);
              return (
                <ErrorRow
                  key={`${row.filename ?? row.reference ?? "x"}-${rowIndex}`}
                  row={row}
                  rowIndex={rowIndex}
                  isImages={isImages}
                  busy={removingIdx === rowIndex}
                  onAssignColor={assignColor}
                  onDismiss={dismissRow}
                />
              );
            })}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

// ─── Sous-composants ─────────────────────────────────────────────

function KpiTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "slate" | "emerald" | "rose";
}) {
  const styles = {
    slate: { bg: "bg-bg-primary", border: "border-border", text: "text-text-primary" },
    emerald: { bg: "bg-gradient-to-br from-emerald-50 via-bg-primary to-bg-primary", border: "border-emerald-200", text: "text-emerald-700" },
    rose: { bg: "bg-gradient-to-br from-rose-50 via-bg-primary to-bg-primary", border: "border-rose-200", text: "text-rose-700" },
  }[accent];
  return (
    <div className={`relative overflow-hidden rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 border ${styles.border} ${styles.bg} shadow-sm`}>
      <p className="text-[10px] font-body uppercase tracking-wider text-text-muted font-semibold">{label}</p>
      <p className={`font-heading text-lg sm:text-xl font-bold tabular-nums leading-none mt-1 ${styles.text}`}>{value}</p>
    </div>
  );
}

function FilterChip({
  current,
  value,
  onClick,
  count,
  children,
  variant,
}: {
  current: Filter;
  value: Filter;
  onClick: (v: Filter) => void;
  count: number;
  children: React.ReactNode;
  variant?: "emerald" | "rose";
}) {
  const isActive = current === value;
  const baseInactive = "bg-bg-primary text-text-secondary border-border hover:border-text-secondary";
  const activeVariant =
    variant === "emerald" ? "bg-emerald-700 text-white border-emerald-700 shadow-sm" :
    variant === "rose" ? "bg-rose-700 text-white border-rose-700 shadow-sm" :
    "bg-bg-dark text-text-inverse border-bg-dark shadow-sm";

  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] font-body font-medium transition-all ${
        isActive ? activeVariant : baseInactive
      }`}
    >
      {children}
      <span className={`text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full ${
        isActive ? "bg-white/20" : "bg-bg-secondary"
      }`}>
        {count}
      </span>
    </button>
  );
}

function SectionCard({
  accent,
  title,
  count,
  empty,
  children,
}: {
  accent: "emerald" | "rose";
  title: string;
  count: number;
  empty: string | null;
  children: React.ReactNode;
}) {
  const styles = {
    emerald: { border: "border-emerald-200", bar: "from-emerald-400 to-emerald-600", chip: "bg-emerald-100/80 border-emerald-200 text-emerald-800", chipDot: "bg-emerald-500", halo: "bg-emerald-300/30" },
    rose: { border: "border-rose-200", bar: "from-rose-400 to-rose-600", chip: "bg-rose-100/80 border-rose-200 text-rose-800", chipDot: "bg-rose-500", halo: "bg-rose-300/30" },
  }[accent];

  return (
    <div className={`relative bg-bg-primary border ${styles.border} rounded-2xl overflow-hidden shadow-sm`}>
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${styles.bar} pointer-events-none`} />
      <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl ${styles.halo} pointer-events-none`} />
      <div className="relative px-5 pt-5 pb-3 border-b border-border-light">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-body font-semibold uppercase tracking-[0.18em] ${styles.chip}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${styles.chipDot}`} />
            {title}
          </span>
          <span className="ml-auto font-heading text-lg font-bold tabular-nums text-text-primary">{count}</span>
        </div>
      </div>
      {empty ? (
        <div className="px-5 py-10 text-center">
          <p className="text-[12px] text-text-muted font-body">{empty}</p>
        </div>
      ) : (
        <div className="max-h-[640px] overflow-y-auto">{children}</div>
      )}
    </div>
  );
}

function ImageSuccessList({
  items,
}: {
  items: NonNullable<NonNullable<ImportJobDetailData["resultDetails"]>["images"]>;
}) {
  if (!items) return null;
  return (
    <ul className="divide-y divide-emerald-50">
      {items.map((img, idx) => (
        <li key={`${img.filename}-${idx}`} className="px-5 py-3 flex items-center gap-3">
          {img.imagePath ? (
            <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-emerald-100 bg-bg-secondary shrink-0">
              <Image src={`/${img.imagePath}`} alt={img.filename} fill className="object-cover" unoptimized />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-lg border border-emerald-100 bg-bg-secondary shrink-0 flex items-center justify-center">
              <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-text-primary font-body font-medium truncate">{img.filename}</p>
            <p className="text-[11px] text-text-muted font-body mt-0.5">
              <span className="font-mono font-semibold">{img.reference}</span> · {img.color} · position {img.position}
            </p>
          </div>
          {img.productId && (
            <Link
              href={`/admin/produits/${img.productId}`}
              className="text-[11px] font-body font-medium text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 shrink-0"
            >
              Ouvrir
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProductSuccessList({
  items,
}: {
  items?: NonNullable<ImportJobDetailData["resultDetails"]>["products"];
}) {
  if (!items) return null;
  return (
    <ul className="divide-y divide-emerald-50">
      {items.map((p, idx) => (
        <li key={`${p.reference}-${idx}`} className="px-5 py-3 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 font-mono font-semibold text-[10px] flex items-center justify-center shrink-0">
            {p.reference.slice(0, 3)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] text-text-primary font-body font-medium">
              <span className="font-mono font-semibold">{p.reference}</span> · {p.name}
            </p>
            {p.variants && p.variants.length > 0 && (
              <p className="text-[11px] text-text-muted font-body mt-0.5">
                {p.variants.length} variante{p.variants.length > 1 ? "s" : ""} · {p.variants.map((v) => v.color).slice(0, 3).join(", ")}
                {p.variants.length > 3 && ` +${p.variants.length - 3}`}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ErrorRow({
  row,
  rowIndex,
  isImages,
  busy,
  onAssignColor,
  onDismiss,
}: {
  row: Record<string, unknown>;
  rowIndex: number;
  isImages: boolean;
  busy: boolean;
  onAssignColor: (rowIndex: number, colorId: string) => void;
  onDismiss: (rowIndex: number) => void;
}) {
  const filename = String(row.filename ?? row.name ?? "—");
  const reference = String(row.reference ?? "—");
  const color = String(row.color ?? "—");
  const position = row.position != null ? Number(row.position) : null;
  const errors = Array.isArray(row.errors) ? (row.errors as string[]) : [];
  const tempPath = row.tempPath ? String(row.tempPath) : null;
  const availableColors = Array.isArray(row.availableColors)
    ? (row.availableColors as AvailableColorEntry[])
    : [];

  return (
    <li className="px-5 py-3 space-y-2">
      <div className="flex items-start gap-3">
        {tempPath ? (
          <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-rose-100 bg-bg-secondary shrink-0">
            <Image src={`/${tempPath}`} alt={filename} fill className="object-cover" unoptimized />
          </div>
        ) : (
          <div className="w-12 h-12 rounded-lg border border-rose-100 bg-rose-50 shrink-0 flex items-center justify-center">
            <svg className="w-5 h-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[12px] text-text-primary font-body font-medium truncate">{filename}</p>
          <p className="text-[11px] text-text-muted font-body mt-0.5">
            <span className="font-mono">{reference}</span>
            {isImages && color !== "—" && <> · {color}</>}
            {position != null && <> · position {position}</>}
          </p>
          {errors.map((err, i) => (
            <p key={i} className="text-[11px] text-rose-700 font-body mt-1 leading-snug">{err}</p>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(rowIndex)}
          disabled={busy}
          className="text-[10px] text-text-muted hover:text-rose-600 font-body shrink-0 disabled:opacity-50"
        >
          Retirer
        </button>
      </div>
      {availableColors.length > 0 && isImages && (
        <div className="pl-[60px]">
          <p className="text-[10px] text-text-muted font-body uppercase tracking-wider font-semibold mb-1.5">
            Couleurs disponibles sur le produit
          </p>
          <div className="flex flex-wrap gap-1.5">
            {availableColors.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onAssignColor(rowIndex, c.id)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-primary border border-rose-200 hover:border-rose-500 hover:shadow-sm transition-all text-[11px] font-body disabled:opacity-50"
              >
                <ColorSwatch hex={c.hex ?? "#9CA3AF"} patternImage={c.patternImage ?? null} size={14} rounded="full" />
                <span className="text-text-primary">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}
