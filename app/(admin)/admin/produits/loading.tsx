export default function AdminProductsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-32 bg-bg-tertiary rounded-lg" />
          <div className="h-4 w-48 bg-bg-tertiary rounded mt-2" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-10 w-28 bg-bg-tertiary rounded-xl" />
          <div className="h-10 w-40 bg-bg-tertiary rounded-xl" />
        </div>
      </div>

      {/* Filtres */}
      <div className="card px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-10 flex-1 min-w-[200px] bg-bg-tertiary rounded-lg" />
          <div className="h-10 w-36 bg-bg-tertiary rounded-lg" />
          <div className="h-10 w-28 bg-bg-tertiary rounded-lg" />
          <div className="h-10 w-20 bg-bg-tertiary rounded-lg" />
        </div>
      </div>

      {/* Tableau */}
      <div className="card overflow-hidden">
        {/* Header du tableau */}
        <div className="flex items-center gap-4 px-4 h-11 border-b border-border bg-bg-secondary">
          <div className="w-5 h-5 bg-bg-tertiary rounded shrink-0" />
          <div className="w-10 shrink-0" />
          <div className="h-3 w-10 bg-bg-tertiary rounded shrink-0" />
          <div className="h-3 w-16 bg-bg-tertiary rounded flex-[3]" />
          <div className="h-3 w-16 bg-bg-tertiary rounded flex-[2]" />
          <div className="h-3 w-16 bg-bg-tertiary rounded flex-1" />
          <div className="h-3 w-12 bg-bg-tertiary rounded shrink-0" />
          <div className="w-8 shrink-0" />
        </div>

        {/* Lignes */}
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 h-[72px] border-b border-border last:border-b-0"
          >
            {/* Checkbox */}
            <div className="w-5 h-5 bg-bg-tertiary rounded shrink-0" />
            {/* Image */}
            <div className="w-10 h-10 bg-bg-tertiary rounded-lg shrink-0" />
            {/* Ref */}
            <div
              className="h-3.5 bg-bg-tertiary rounded shrink-0"
              style={{ width: `${60 + (i % 3) * 15}px` }}
            />
            {/* Nom */}
            <div
              className="h-3.5 bg-bg-tertiary rounded flex-[3]"
              style={{ maxWidth: `${140 + (i % 4) * 30}px` }}
            />
            {/* Catégorie */}
            <div
              className="h-3.5 bg-bg-tertiary rounded flex-[2]"
              style={{ maxWidth: `${80 + (i % 3) * 20}px` }}
            />
            {/* Couleurs */}
            <div className="flex items-center gap-1 flex-1">
              {Array.from({ length: 1 + (i % 3) }).map((_, j) => (
                <div key={j} className="w-5 h-5 bg-bg-tertiary rounded-full shrink-0" />
              ))}
            </div>
            {/* Statut */}
            <div className="h-5 w-16 bg-bg-tertiary rounded-full shrink-0" />
            {/* Actions */}
            <div className="w-8 h-8 bg-bg-tertiary rounded-lg shrink-0" />
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-1">
        <div className="h-3.5 w-28 bg-bg-tertiary rounded" />
        <div className="flex items-center gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="w-9 h-9 bg-bg-tertiary rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
