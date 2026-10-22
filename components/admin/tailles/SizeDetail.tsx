"use client";

import { isProtectedSizeName } from "@/lib/protected-sizes";

export type SizeDetailData = {
  id: string;
  name: string;
  position: number;
  positionInSorted: number;
  totalSortedCount: number;
  variantCount: number;
  pfsSizeRef: string | null;
};

type Props = {
  size: SizeDetailData;
  pfsEnabled: boolean;
  showBackButton: boolean;
  onBack: () => void;
  onRename: () => void;
  onDelete: () => void;
  onEditPfsMapping: () => void;
};

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  if (trimmed.length <= 2) return trimmed.toUpperCase();
  const parts = trimmed.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

export default function SizeDetail({
  size,
  pfsEnabled,
  showBackButton,
  onBack,
  onRename,
  onDelete,
  onEditPfsMapping,
}: Props) {
  const isProtected = isProtectedSizeName(size.name);
  const isOrphan = pfsEnabled && size.pfsSizeRef == null;
  const deleteBlocked = size.variantCount > 0;

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
            className="shrink-0 w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-[#27272A] to-[#18181B] text-white flex items-center justify-center font-heading text-base md:text-lg font-bold"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            {initials(size.name)}
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-[18px] md:text-[20px] font-bold tracking-tight text-text-primary truncate">
              {size.name}
            </h2>
            <div className="flex items-center gap-2 text-[12px] text-text-secondary mt-0.5 flex-wrap">
              <span className="font-medium">{size.variantCount} variante{size.variantCount > 1 ? "s" : ""}</span>
              <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span>Position <b className="text-text-primary">{size.position + 1}</b></span>
              {pfsEnabled && (
                <>
                  <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-text-muted" />
                  {isOrphan ? (
                    <span className="badge badge-error text-[10px]">PFS requis</span>
                  ) : (
                    <span className="badge badge-success text-[10px]">Mappée PFS</span>
                  )}
                </>
              )}
              {isProtected && (
                <>
                  <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-text-muted" />
                  <span className="badge badge-neutral text-[10px]">Verrouillée</span>
                </>
              )}
            </div>
          </div>

          {!isProtected && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={onRename}
                aria-label="Renommer la taille"
                title="Renommer"
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
                aria-label="Supprimer la taille"
                title={deleteBlocked ? "Impossible — utilisée par des variantes" : "Supprimer"}
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-[#BE123C] hover:bg-[#FFF1F2] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9M4.772 5.79l1.068 13.883A2.25 2.25 0 008.084 21.75h7.832a2.25 2.25 0 002.244-2.077L19.228 5.79M5.79 5.79a48.11 48.11 0 013.478-.397m0 0v-.916c0-1.18.91-2.164 2.09-2.201a51.964 51.964 0 013.32 0c1.18.037 2.09 1.022 2.09 2.201v.916m-7.5 0a48.667 48.667 0 017.5 0" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* === CORPS === */}
      <div className="px-4 md:px-6 py-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
          {/* Bloc Ordre + Utilisation */}
          <section
            aria-label="Informations"
            className="rounded-2xl border border-border bg-bg-secondary/40 p-4 md:p-5 flex flex-col gap-5 min-w-0"
          >
            <header className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-bg-primary border border-border text-text-secondary">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
              </span>
              <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-primary">
                Informations
              </h3>
            </header>

            {!isProtected && (
              <div>
                <h4 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-2">
                  Ordre d'affichage
                </h4>
                <div className="rounded-xl bg-bg-primary border border-border px-4 py-3 flex items-center justify-between">
                  <span className="text-[13px] text-text-secondary">
                    Rang <b className="text-text-primary">{size.positionInSorted + 1}</b> sur {size.totalSortedCount}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    Glissez dans la liste pour réordonner
                  </span>
                </div>
              </div>
            )}

            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted mb-2">
                Utilisation catalogue
              </h4>
              <div className="rounded-xl bg-bg-primary border border-border px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-text-primary">
                    {size.variantCount === 0 ? "Inutilisée" : "En circulation"}
                  </div>
                  <div className="text-[11.5px] text-text-secondary mt-0.5">
                    {size.variantCount === 0
                      ? "Aucune variante ne l'utilise"
                      : `${size.variantCount} variante${size.variantCount > 1 ? "s" : ""} liée${size.variantCount > 1 ? "s" : ""}`}
                  </div>
                </div>
                <span
                  aria-hidden
                  className={`shrink-0 inline-block w-2 h-2 rounded-full ${
                    size.variantCount === 0 ? "bg-rose-400" : "bg-emerald-500"
                  }`}
                />
              </div>
              {deleteBlocked && !isProtected && (
                <p className="text-[11px] text-text-muted mt-2">
                  La suppression reste bloquée tant qu'au moins une variante utilise cette taille.
                </p>
              )}
            </div>
          </section>

          {/* Bloc PFS */}
          {pfsEnabled && (
            <section
              aria-label="Mapping Paris Fashion Shop"
              className="rounded-2xl border border-border bg-bg-secondary/40 p-4 md:p-5 flex flex-col gap-3 min-w-0"
            >
              <header className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-bg-primary border border-border text-text-secondary">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                  </svg>
                </span>
                <h3 className="text-[12px] font-bold uppercase tracking-[0.12em] text-text-primary">
                  Paris Fashion Shop
                </h3>
              </header>

              <button
                type="button"
                onClick={onEditPfsMapping}
                disabled={isProtected}
                className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-bg-primary hover:border-border-dark hover:bg-bg-tertiary transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span
                  aria-hidden
                  className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-[#4f46e5] to-[#6366f1] grid place-items-center text-white text-[12px] font-bold"
                >
                  P
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-text-primary">PFS</span>
                    <span
                      aria-hidden
                      className={`inline-block w-1.5 h-1.5 rounded-full ${isOrphan ? "bg-amber-400" : "bg-emerald-500"}`}
                      title={isOrphan ? "Non mappée" : "Mappée"}
                    />
                  </div>
                  <div className={`text-[12px] truncate ${isOrphan ? "text-text-muted italic" : "text-text-secondary"}`}>
                    {isOrphan ? "Non mappée — obligatoire pour publier sur PFS" : size.pfsSizeRef}
                  </div>
                </div>
                <span className="shrink-0 text-[12px] text-text-muted group-hover:text-text-primary font-medium inline-flex items-center gap-1">
                  <span className="hidden sm:inline">{isOrphan ? "Choisir" : "Modifier"}</span>
                  <span aria-hidden>→</span>
                </span>
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
