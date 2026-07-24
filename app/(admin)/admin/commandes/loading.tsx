/**
 * Skeleton de la page /admin/commandes. Reprend la structure réelle : header,
 * onglets Boutique/Marketplaces, période, rangée des marketplaces, KPI tiles,
 * et tableau. Sert pour les 2 onglets — quelques blocs (période, marketplaces)
 * ne concernent que l'onglet Marketplaces mais restent visuellement neutres.
 */
export default function AdminOrdersLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header : eyebrow + titre + description */}
      <header className="space-y-2">
        <div className="h-3 w-16 bg-bg-tertiary rounded" />
        <div className="h-8 w-48 bg-bg-tertiary rounded-lg" />
        <div className="h-3 w-80 bg-bg-tertiary rounded max-w-full" />
      </header>

      {/* Onglets Boutique / Marketplaces */}
      <div className="flex gap-1 border-b border-border">
        <div className="px-4 py-3 flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-bg-tertiary" />
          <div className="h-3 w-20 bg-bg-tertiary rounded" />
        </div>
        <div className="px-4 py-3 flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-bg-tertiary" />
          <div className="h-3 w-24 bg-bg-tertiary rounded" />
        </div>
      </div>

      {/* Barre période */}
      <div className="rounded-2xl bg-bg-primary border border-border shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-3 w-14 bg-bg-tertiary rounded mr-2" />
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-7 w-16 bg-bg-tertiary rounded-full" />
          ))}
        </div>
      </div>

      {/* Rangée des 5 marketplaces */}
      <div className="rounded-2xl bg-bg-primary border border-border shadow-sm p-3 md:p-4">
        <div className="flex flex-wrap md:flex-nowrap items-stretch gap-2 md:gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-xl border border-border bg-bg-secondary/50 p-3 min-w-0 flex-1 md:min-w-[220px]"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-bg-tertiary" />
                <div className="h-3 w-24 bg-bg-tertiary rounded" />
              </div>
              <div className="space-y-1.5">
                <div className="h-2.5 w-32 bg-bg-tertiary rounded" />
                <div className="h-2.5 w-20 bg-bg-tertiary rounded" />
              </div>
              <div className="flex items-center gap-1.5 mt-auto">
                <div className="h-7 flex-1 bg-bg-tertiary rounded-lg" />
                <div className="h-7 flex-1 bg-bg-tertiary rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* KPI tiles (5 colonnes lg) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl bg-bg-primary border border-border shadow-sm p-4 space-y-3"
          >
            <div className="h-3 w-24 bg-bg-tertiary rounded" />
            <div className="h-8 w-20 bg-bg-tertiary rounded" />
            <div className="h-2.5 w-32 bg-bg-tertiary rounded" />
          </div>
        ))}
      </div>

      {/* Top clients / Top produits */}
      <div className="grid lg:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl bg-bg-primary border border-border shadow-sm p-4 space-y-3"
          >
            <div className="h-3 w-32 bg-bg-tertiary rounded" />
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-bg-tertiary" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-40 bg-bg-tertiary rounded max-w-full" />
                  <div className="h-2.5 w-24 bg-bg-tertiary rounded" />
                </div>
                <div className="h-4 w-16 bg-bg-tertiary rounded" />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Tableau des commandes */}
      <div className="rounded-2xl bg-bg-primary border border-border shadow-sm overflow-hidden">
        {/* Header + filtres */}
        <div className="p-4 border-b border-border space-y-3">
          <div className="h-3 w-40 bg-bg-tertiary rounded" />
          <div className="flex items-center gap-2 flex-wrap">
            <div className="h-8 flex-1 min-w-[200px] bg-bg-tertiary rounded-lg" />
            <div className="h-8 w-[190px] bg-bg-tertiary rounded-lg" />
            <div className="h-8 w-[170px] bg-bg-tertiary rounded-lg" />
            <div className="h-8 w-[170px] bg-bg-tertiary rounded-lg" />
          </div>
        </div>

        {/* En-tête tableau */}
        <div className="bg-bg-secondary px-4 py-3 flex items-center gap-4">
          <div className="w-4 h-4 bg-bg-tertiary rounded" />
          <div className="w-6 h-3 bg-bg-tertiary rounded" />
          <div className="w-6 h-6 bg-bg-tertiary rounded-md" />
          <div className="h-3 w-24 bg-bg-tertiary rounded" />
          <div className="h-3 w-20 bg-bg-tertiary rounded" />
          <div className="h-3 w-24 bg-bg-tertiary rounded flex-1" />
          <div className="h-3 w-20 bg-bg-tertiary rounded" />
          <div className="h-3 w-16 bg-bg-tertiary rounded" />
          <div className="h-3 w-16 bg-bg-tertiary rounded" />
        </div>

        {/* Lignes */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="px-4 py-3.5 border-b border-border flex items-center gap-4"
          >
            <div className="w-4 h-4 bg-bg-tertiary rounded" />
            <div className="w-6 h-3 bg-bg-tertiary rounded" />
            <div className="w-6 h-6 bg-bg-tertiary rounded-md" />
            <div className="h-3.5 w-28 bg-bg-tertiary rounded" />
            <div className="h-3 w-24 bg-bg-tertiary rounded" />
            <div className="flex-1 space-y-1.5 min-w-0">
              <div className="h-3.5 w-40 bg-bg-tertiary rounded max-w-full" />
              <div className="h-2.5 w-32 bg-bg-tertiary rounded" />
            </div>
            <div className="h-3.5 w-16 bg-bg-tertiary rounded" />
            <div className="h-5 w-20 bg-bg-tertiary rounded-full" />
            <div className="h-5 w-20 bg-bg-tertiary rounded-full" />
          </div>
        ))}

        {/* Pagination */}
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="h-3 w-52 bg-bg-tertiary rounded" />
          <div className="flex items-center gap-2">
            <div className="h-7 w-20 bg-bg-tertiary rounded" />
            <div className="h-7 w-12 bg-bg-tertiary rounded" />
            <div className="h-7 w-20 bg-bg-tertiary rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
