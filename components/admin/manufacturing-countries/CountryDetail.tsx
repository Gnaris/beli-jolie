"use client";

export type CountryDetailData = {
  id: string;
  name: string;
  isoCode: string | null;
  pfsCountryRef: string | null;
  efashionProvenanceId: number | null | undefined;
  efashionProvenanceLabel: string | null | undefined;
  faireCountryCode: string | null | undefined;
  productCount: number;
  translations: Record<string, string>;
};

type Props = {
  item: CountryDetailData;
  showBackButton: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function isoToFlag(iso: string | null | undefined): string {
  if (!iso || !/^[A-Za-z]{2}$/.test(iso)) return "🏳️";
  const A = 0x1f1e6;
  const up = iso.toUpperCase();
  return String.fromCodePoint(A + up.charCodeAt(0) - 65, A + up.charCodeAt(1) - 65);
}

function MappingRow({
  label,
  mapped,
  value,
}: {
  label: string;
  mapped: boolean;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-bg-secondary border border-border">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted w-32 flex-shrink-0">
        {label}
      </div>
      {mapped ? (
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span
            aria-hidden
            className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0"
            style={{ boxShadow: "0 0 0 3px rgba(16,185,129,0.14)" }}
          />
          <span className="text-[13px] font-semibold text-text-primary truncate">
            {value}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-text-muted flex-shrink-0" />
          <span className="text-[12.5px] text-text-muted italic">Non mappé</span>
        </div>
      )}
    </div>
  );
}

export default function CountryDetail({
  item,
  showBackButton,
  onBack,
  onEdit,
  onDelete,
}: Props) {
  const isUnused = item.productCount === 0;
  const deleteBlocked = item.productCount > 0;
  const hasTranslations = Object.keys(item.translations).length > 0;
  const missingIso = !item.isoCode;

  const efashionValue =
    item.efashionProvenanceLabel ??
    (item.efashionProvenanceId != null ? `id ${item.efashionProvenanceId}` : "");

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
            className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#27272A] to-[#18181B] text-white flex items-center justify-center text-[28px] leading-none flex-shrink-0"
            style={{ boxShadow: "var(--shadow-pop)" }}
          >
            {isoToFlag(item.isoCode)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {item.isoCode ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold font-mono bg-bg-tertiary text-text-secondary uppercase tracking-wider">
                  {item.isoCode}
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 uppercase tracking-wider">
                  ISO manquant
                </span>
              )}
              <span className="font-mono text-[10.5px] font-semibold tracking-wider text-text-muted uppercase">Pays de fabrication</span>
            </div>
            <h2 className="font-heading text-[22px] font-bold tracking-tight text-text-primary truncate">
              {item.name}
            </h2>
            <div className="flex items-center gap-2.5 text-[12px] text-text-secondary mt-2 flex-wrap">
              <span>
                <b className="text-text-primary tabular-nums">{item.productCount}</b>{" "}
                produit{item.productCount > 1 ? "s" : ""}
              </span>
              <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span className="inline-flex items-center gap-1">
                <span
                  aria-hidden
                  className={`w-1.5 h-1.5 rounded-full ${
                    isUnused ? "bg-rose-400" : "bg-sky-500"
                  }`}
                />
                {isUnused ? "Inutilisé" : "En circulation"}
              </span>
              <span aria-hidden className="w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span className="inline-flex items-center gap-1">
                <span
                  aria-hidden
                  className={`w-1.5 h-1.5 rounded-full ${
                    hasTranslations ? "bg-emerald-500" : "bg-amber-400"
                  }`}
                />
                {hasTranslations ? "Traduit" : "Sans traduction"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-2 h-[38px] px-3.5 rounded-lg border border-border bg-bg-primary text-text-secondary hover:text-text-primary hover:border-ink shadow-[var(--shadow-sm)] text-[13px] font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
            Modifier
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleteBlocked}
            title={deleteBlocked ? "Impossible : ce pays est attribué à des produits." : undefined}
            className="inline-flex items-center gap-2 h-[38px] px-3.5 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] text-[#BE123C] hover:bg-[#FEE2E2] hover:border-[#FCA5A5] shadow-[var(--shadow-sm)] text-[13px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#FFF1F2] disabled:hover:border-[#FECDD3]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            Supprimer
          </button>
        </div>
      </div>

      {/* ─── Grid cartes ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Détails (slate) */}
        <section className="relative overflow-hidden rounded-2xl border border-border p-5 bg-bg-primary" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-slate-400 to-slate-600" />
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-3xl bg-slate-200/50 pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1 h-4 rounded-full bg-slate-500" />
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-600 font-heading">
                Détails du pays
              </h3>
            </div>
            <p className="text-[12.5px] text-text-secondary mb-4 font-body">
              Nom du pays, code ISO et traductions affichées sur le site.
            </p>
            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Nom (Français)</div>
                <div className="text-[13.5px] font-semibold text-text-primary">{item.name}</div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Nom (Anglais)</div>
                {item.translations["en"] ? (
                  <div className="text-[13.5px] text-text-primary">{item.translations["en"]}</div>
                ) : (
                  <div className="text-[12.5px] text-text-muted italic">Non renseigné</div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Code ISO 3166-1 alpha-2</div>
                {item.isoCode ? (
                  <div className="font-mono font-bold text-text-primary text-[15px] tracking-tight">{item.isoCode}</div>
                ) : (
                  <div className="text-[12.5px] text-amber-700 italic">À compléter pour l&apos;export</div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Utilisation catalogue (sky) */}
        <section className="relative overflow-hidden rounded-2xl border border-border p-5 bg-bg-primary" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-400 to-sky-600" />
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-3xl bg-sky-200/50 pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-1 h-4 rounded-full bg-sky-500" />
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-sky-700 font-heading">
                Utilisation catalogue
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-4 bg-gradient-to-br from-sky-50 to-bg-primary border border-sky-100">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-700">Produits</div>
                <div className="mt-1 font-heading text-2xl font-bold text-sky-800 tabular-nums">
                  {item.productCount}
                </div>
                <div className="text-[11px] text-text-secondary mt-0.5">actuellement liés</div>
              </div>
              <div className="rounded-xl p-4 bg-gradient-to-br from-bg-secondary to-bg-primary border border-border">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">Statut</div>
                <div className="mt-1 font-heading text-lg font-bold text-text-primary">
                  {isUnused ? "Inutilisé" : "En circulation"}
                </div>
                <div className="text-[11px] text-text-secondary mt-0.5">
                  {isUnused ? "Aucun produit ne l'utilise" : "Suppression bloquée"}
                </div>
              </div>
            </div>
            {deleteBlocked && (
              <div className="mt-4 flex items-center gap-2 text-[12px] text-text-secondary p-3 rounded-xl bg-bg-secondary border border-border">
                <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>La suppression restera bloquée tant qu&apos;au moins un produit utilise ce pays.</span>
              </div>
            )}
          </div>
        </section>

        {/* Marketplaces (slate) - full width */}
        <section className="relative overflow-hidden rounded-2xl border border-border p-5 bg-bg-primary lg:col-span-2" style={{ boxShadow: "var(--shadow-sm)" }}>
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-slate-400 to-slate-600" />
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full blur-3xl bg-slate-200/50 pointer-events-none" />
          <div className="relative">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <span className="w-1 h-4 rounded-full bg-slate-500" />
                <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-600 font-heading">
                  Marketplaces
                </h3>
              </div>
              <button
                type="button"
                onClick={onEdit}
                className="text-[11px] font-semibold text-text-muted hover:text-text-primary transition-colors"
              >
                Modifier →
              </button>
            </div>
            <p className="text-[12.5px] text-text-secondary mb-4 font-body">
              Correspondances utilisées pour publier vers PFS, eFashion et Faire.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <MappingRow
                label="Paris Fashion Shop"
                mapped={!!item.pfsCountryRef}
                value={item.pfsCountryRef ?? ""}
              />
              <MappingRow
                label="eFashion"
                mapped={item.efashionProvenanceId != null}
                value={efashionValue}
              />
              <MappingRow
                label="Faire"
                mapped={!!item.faireCountryCode}
                value={item.faireCountryCode ?? ""}
              />
            </div>
            {missingIso && (
              <div className="mt-4 flex items-center gap-2 text-[12px] text-amber-700 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>Ajoutez le code ISO 3166-1 pour permettre les envois marketplaces.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
