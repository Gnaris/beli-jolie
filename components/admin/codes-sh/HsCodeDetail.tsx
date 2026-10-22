"use client";

import { formatDate } from "@/lib/format-date";

export type HsCodeDetailData = {
  id: string;
  code: string;
  label: string;
  productCount: number;
  createdAt: Date;
};

type Props = {
  item: HsCodeDetailData;
  showBackButton: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function prefix(code: string): string {
  return code.slice(0, 4);
}

function formatCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += 2) groups.push(code.slice(i, i + 2));
  return groups.join(" ");
}

export default function HsCodeDetail({
  item,
  showBackButton,
  onBack,
  onEdit,
  onDelete,
}: Props) {
  const isUnused = item.productCount === 0;
  const deleteBlocked = item.productCount > 0;

  const statusLabel = isUnused
    ? "Inutilisé"
    : item.productCount >= 100
      ? "Fortement utilisé"
      : "En circulation";
  const statusDotClass = isUnused
    ? "bg-rose-400"
    : item.productCount >= 100
      ? "bg-emerald-500"
      : "bg-sky-500";

  return (
    <div className="flex flex-col bg-bg-primary border border-border rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
      {/* === HEADER === */}
      <header className="bg-bg-primary border-b border-border px-4 md:px-6 py-4">
        <div className="flex items-start gap-3 md:gap-4">
          {showBackButton && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Retour à la liste"
              className="md:hidden shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-bg-secondary text-text-secondary hover:text-text-primary mt-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          <span
            aria-hidden
            className="shrink-0 w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-[#27272A] to-[#18181B] text-white flex items-center justify-center font-mono text-[12px] md:text-[13px] font-bold tracking-tight"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            {prefix(item.code)}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[10.5px] font-semibold tracking-wider text-text-muted uppercase">
                Numéro
              </span>
              <span className="font-mono text-[14px] font-bold text-text-primary tracking-tight">
                {formatCode(item.code)}
              </span>
            </div>
            <h2 className="font-heading text-[18px] md:text-[20px] font-bold tracking-tight text-text-primary truncate">
              {item.label}
            </h2>
            <div className="flex items-center gap-2 text-[12px] text-text-secondary mt-0.5 flex-wrap">
              <span>
                <b className="text-text-primary tabular-nums">{item.productCount}</b> produit{item.productCount > 1 ? "s" : ""}
              </span>
              <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span className="inline-flex items-center gap-1">
                <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${statusDotClass}`} />
                {statusLabel}
              </span>
              <span aria-hidden className="hidden sm:inline w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span className="hidden sm:inline">ajouté le {formatDate(item.createdAt)}</span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onEdit}
              aria-label="Modifier le code SH"
              title="Modifier"
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleteBlocked}
              aria-label="Supprimer le code SH"
              title={deleteBlocked ? "Impossible — attribué à des produits" : "Supprimer"}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-[#BE123C] hover:bg-[#FFF1F2] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9M4.772 5.79l1.068 13.883A2.25 2.25 0 008.084 21.75h7.832a2.25 2.25 0 002.244-2.077L19.228 5.79M5.79 5.79a48.11 48.11 0 013.478-.397m0 0v-.916c0-1.18.91-2.164 2.09-2.201a51.964 51.964 0 013.32 0c1.18.037 2.09 1.022 2.09 2.201v.916m-7.5 0a48.667 48.667 0 017.5 0" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* === CORPS === */}
      <div className="px-4 md:px-6 py-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
          {/* Bloc Détails */}
          <section
            aria-label="Détails du code"
            className="rounded-2xl border border-border bg-bg-secondary/40 p-4 md:p-5 flex flex-col gap-4 min-w-0"
          >
            <header className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-bg-primary border border-border text-text-secondary">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
              </span>
              <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-primary">
                Détails du code
              </h3>
            </header>

            <p className="text-[12px] text-text-muted">
              Ces informations apparaissent dans les documents douaniers et les exports marketplaces.
            </p>

            <div className="rounded-xl border border-border bg-bg-primary p-4 space-y-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                  Numéro
                </div>
                <div className="font-mono font-bold text-text-primary text-[15px] tracking-tight">
                  {formatCode(item.code)}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                  Libellé
                </div>
                <div className="text-[13.5px] text-text-primary">{item.label}</div>
              </div>
            </div>
          </section>

          {/* Bloc Utilisation */}
          <section
            aria-label="Utilisation catalogue"
            className="rounded-2xl border border-border bg-bg-secondary/40 p-4 md:p-5 flex flex-col gap-4 min-w-0"
          >
            <header className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-bg-primary border border-border text-text-secondary">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </span>
              <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-primary">
                Utilisation catalogue
              </h3>
            </header>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-4 bg-bg-primary border border-border">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Produits
                </div>
                <div className="mt-1 font-heading text-2xl font-bold text-text-primary tabular-nums">
                  {item.productCount}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">actuellement liés</div>
              </div>
              <div className="rounded-xl p-4 bg-bg-primary border border-border">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Statut
                </div>
                <div className="mt-1 font-heading text-lg font-bold text-text-primary">
                  {isUnused ? "Inutilisé" : "En circulation"}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {isUnused ? "Aucun produit ne l'utilise" : "Suppression bloquée"}
                </div>
              </div>
            </div>

            {deleteBlocked && (
              <p className="text-[11px] text-text-muted">
                La suppression restera bloquée tant qu'au moins un produit utilise ce code.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
