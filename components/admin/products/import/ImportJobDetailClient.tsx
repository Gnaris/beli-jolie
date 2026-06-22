"use client";

/**
 * Page détail d'un import (succès uniquement)
 *
 * - Recherche : par référence ou nom de fichier
 * - Affiche les images / produits réussis
 *
 * La section « À corriger » a été retirée : les erreurs ne sont plus
 * rejouables depuis cette page. Le compteur d'erreurs reste affiché
 * dans le bandeau d'en-tête à titre informatif uniquement.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "@/components/ui/SmartImage";

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
}

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
  const [query, setQuery] = useState("");

  const status = statusLabel(data.status);
  const isImages = data.type === "IMAGES";
  const successList = isImages ? (data.resultDetails?.images ?? []) : (data.resultDetails?.products ?? []);

  // ── Filtrage par texte ─────────────────────────────────────────
  const q = query.trim().toLowerCase();

  const filteredSuccess = useMemo(() => {
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
  }, [q, successList, isImages]);

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
              <KpiTile label="Erreurs" value={data.errorItems} accent={data.errorItems > 0 ? "rose" : "slate"} />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Barre d'outils : recherche ──────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
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

function SectionCard({
  accent,
  title,
  count,
  empty,
  children,
}: {
  accent: "emerald";
  title: string;
  count: number;
  empty: string | null;
  children: React.ReactNode;
}) {
  const styles = {
    emerald: { border: "border-emerald-200", bar: "from-emerald-400 to-emerald-600", chip: "bg-emerald-100/80 border-emerald-200 text-emerald-800", chipDot: "bg-emerald-500", halo: "bg-emerald-300/30" },
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

