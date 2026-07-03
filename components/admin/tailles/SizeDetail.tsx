"use client";

import { isProtectedSizeName } from "@/lib/protected-sizes";

export type SizeDetailData = {
  id: string;
  name: string;
  position: number;
  positionInSorted: number; // rang parmi les tailles triées (0-based)
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
    <div className="flex flex-col gap-4 p-5 md:p-7 bg-bg-primary overflow-y-auto md:h-full">
      {/* ─── Header ─── */}
      <div className="flex items-start justify-between gap-3 pb-5 border-b border-border">
        <div className="flex items-start gap-4 min-w-0">
          {showBackButton && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Retour à la liste"
              className="md:hidden inline-flex items-center justify-center w-8 h-8 rounded-md border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-ink mt-0.5"
            >
              ←
            </button>
          )}
          <div
            aria-hidden
            className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#27272A] to-[#18181B] text-white flex items-center justify-center font-heading text-lg font-bold flex-shrink-0"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            {initials(size.name)}
          </div>
          <div className="min-w-0">
            <h2 className="font-heading text-[22px] font-bold tracking-tight text-text-primary truncate">
              {size.name}
            </h2>
            <div className="flex items-center gap-2.5 text-[12px] text-text-secondary mt-1.5 flex-wrap">
              <span>{size.variantCount} variante{size.variantCount > 1 ? "s" : ""}</span>
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
        </div>
        {!isProtected && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onRename}
              className="inline-flex items-center gap-2 h-[38px] px-3.5 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-ink shadow-[var(--shadow-sm)] text-[13px] font-semibold transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              Renommer
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleteBlocked}
              title={deleteBlocked ? "Impossible : cette taille est utilisée par des variantes." : undefined}
              className="inline-flex items-center gap-2 h-[38px] px-3.5 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C] hover:bg-[#FEE2E2] hover:border-[#FCA5A5] shadow-[var(--shadow-sm)] text-[13px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#FFF1F2] disabled:hover:border-[#FECDD3]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Supprimer
            </button>
          </div>
        )}
      </div>

      {/* ─── Grid cartes ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ordre d'affichage — infos uniquement, glisser-déposer dans la liste à gauche */}
        {!isProtected && (
          <section className="relative overflow-hidden rounded-2xl border border-border p-5 bg-bg-primary" style={{ boxShadow: "var(--shadow-sm)" }}>
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-slate-400 to-slate-600" />
            <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-3xl bg-slate-200/50 pointer-events-none" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1 h-4 rounded-full bg-slate-500" />
                <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-600 font-heading">
                  Ordre d'affichage
                </h3>
              </div>
              <p className="text-[12.5px] text-text-secondary mb-4 font-body">
                Glissez la ligne dans la liste à gauche pour changer l'ordre.
              </p>

              <div className="h-10 rounded-xl bg-bg-secondary border border-border flex items-center justify-center font-heading font-bold text-text-primary text-[13px]">
                Rang {size.positionInSorted + 1} sur {size.totalSortedCount}
              </div>
            </div>
          </section>
        )}

        {/* Paris Fashion Shop */}
        {pfsEnabled && (
          <section className={`relative overflow-hidden rounded-2xl border p-5 bg-bg-primary ${isOrphan ? "border-rose-200" : "border-border"} ${isProtected ? "lg:col-span-2" : ""}`} style={{ boxShadow: "var(--shadow-sm)" }}>
            <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${isOrphan ? "from-rose-400 to-rose-600" : "from-emerald-400 to-emerald-600"}`} />
            <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full blur-3xl pointer-events-none ${isOrphan ? "bg-rose-200/50" : "bg-emerald-200/50"}`} />
            <div className="relative">
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-1 h-4 rounded-full ${isOrphan ? "bg-rose-500" : "bg-emerald-500"}`} />
                <h3 className={`text-[10.5px] font-semibold uppercase tracking-[0.18em] font-heading ${isOrphan ? "text-rose-700" : "text-emerald-700"}`}>
                  Paris Fashion Shop
                </h3>
              </div>
              <p className="text-[12.5px] text-text-secondary mb-4 font-body">
                Référence taille utilisée lors de la publication PFS.
              </p>

              {isOrphan ? (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-rose-50 border border-rose-200">
                  <div className="w-9 h-9 rounded-lg bg-white ring-1 ring-rose-200 flex items-center justify-center">
                    <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-700">Pas de correspondance</div>
                    <div className="text-[12.5px] text-text-secondary">Obligatoire pour publier sur PFS.</div>
                  </div>
                  <button
                    type="button"
                    onClick={onEditPfsMapping}
                    disabled={isProtected}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-ink text-text-inverse text-[12px] font-semibold shadow-[var(--shadow-sm)] hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Choisir…
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                  <div className="w-9 h-9 rounded-lg bg-white ring-1 ring-emerald-200 flex items-center justify-center">
                    <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Référence PFS</div>
                    <div className="font-heading font-bold text-text-primary truncate">{size.pfsSizeRef}</div>
                  </div>
                  {!isProtected && (
                    <button
                      type="button"
                      onClick={onEditPfsMapping}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-ink text-[12px] font-semibold shadow-[var(--shadow-sm)]"
                    >
                      Modifier
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Utilisation catalogue */}
        <section className="relative overflow-hidden rounded-2xl border border-border p-5 bg-bg-primary lg:col-span-2" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-400 to-sky-600" />
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-3xl bg-sky-200/50 pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-1 h-4 rounded-full bg-sky-500" />
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-sky-700 font-heading">
                Utilisation catalogue
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl p-4 bg-gradient-to-br from-sky-50 to-bg-primary border border-sky-100">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-700">Variantes</div>
                <div className="mt-1 font-heading text-2xl font-bold text-sky-800">{size.variantCount}</div>
                <div className="text-[11px] text-text-secondary mt-0.5">déclinaisons produit</div>
              </div>
              <div className="rounded-xl p-4 bg-gradient-to-br from-bg-secondary to-bg-primary border border-border">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">Statut</div>
                <div className="mt-1 font-heading text-lg font-bold text-text-primary">
                  {size.variantCount === 0 ? "Inutilisée" : "En circulation"}
                </div>
                <div className="text-[11px] text-text-secondary mt-0.5">
                  {size.variantCount === 0 ? "Aucun produit ne l'utilise" : "Suppression bloquée"}
                </div>
              </div>
            </div>

            {deleteBlocked && !isProtected && (
              <div className="mt-4 flex items-center gap-2 text-[12px] text-text-secondary p-3 rounded-xl bg-bg-secondary border border-border">
                <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>La suppression restera bloquée tant qu'au moins un produit utilise cette taille.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
