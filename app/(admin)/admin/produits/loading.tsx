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

      {/* Stats rapides */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-bg-primary border border-border rounded-xl px-4 py-3">
            <div className="h-3 w-16 bg-bg-tertiary rounded mb-2" />
            <div className="h-6 w-10 bg-bg-tertiary rounded" />
          </div>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-bg-tertiary rounded-xl" style={{ width: `${80 + (i % 2) * 20}px` }} />
        ))}
      </div>

      {/* Filtres */}
      <div className="bg-bg-primary border border-border rounded-2xl px-6 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-10 flex-1 min-w-[200px] bg-bg-tertiary rounded-lg" />
          <div className="h-10 w-28 bg-bg-tertiary rounded-lg" />
          <div className="h-10 w-36 bg-bg-tertiary rounded-lg" />
          <div className="h-10 w-20 bg-bg-tertiary rounded-lg" />
        </div>
      </div>

      {/* Tableau */}
      <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden">
        {/* Header du tableau */}
        <div className="flex items-center gap-4 px-4 h-12 border-b border-border bg-bg-secondary">
          <div className="w-5 h-5 bg-bg-tertiary rounded shrink-0" />
          <div className="w-12 shrink-0" />
          <div className="h-2.5 w-10 bg-bg-tertiary rounded shrink-0" />
          <div className="h-2.5 w-16 bg-bg-tertiary rounded flex-[3]" />
          <div className="h-2.5 w-16 bg-bg-tertiary rounded flex-[2]" />
          <div className="h-2.5 w-16 bg-bg-tertiary rounded flex-1" />
          <div className="h-2.5 w-12 bg-bg-tertiary rounded shrink-0" />
          <div className="w-8 shrink-0" />
        </div>

        {/* Lignes */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 h-[76px] border-b border-border-light last:border-b-0"
          >
            {/* Checkbox */}
            <div className="w-5 h-5 bg-bg-tertiary rounded shrink-0" />
            {/* Image */}
            <div className="w-12 h-12 bg-bg-tertiary rounded-xl shrink-0" />
            {/* Ref */}
            <div
              className="h-6 bg-bg-tertiary rounded-md shrink-0"
              style={{ width: `${60 + (i % 3) * 15}px` }}
            />
            {/* Nom */}
            <div className="flex-[3] space-y-1.5">
              <div
                className="h-3.5 bg-bg-tertiary rounded"
                style={{ maxWidth: `${140 + (i % 4) * 30}px` }}
              />
              <div
                className="h-2.5 bg-bg-tertiary rounded"
                style={{ maxWidth: `${60 + (i % 3) * 15}px` }}
              />
            </div>
            {/* Catégorie */}
            <div
              className="h-3.5 bg-bg-tertiary rounded flex-[2]"
              style={{ maxWidth: `${80 + (i % 3) * 20}px` }}
            />
            {/* Couleurs */}
            <div className="flex items-center gap-1 flex-1">
              {Array.from({ length: 2 + (i % 3) }).map((_, j) => (
                <div key={j} className="w-5 h-5 bg-bg-tertiary rounded-full shrink-0" />
              ))}
            </div>
            {/* Statut */}
            <div className="h-6 w-20 bg-bg-tertiary rounded-md shrink-0" />
            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              <div className="w-8 h-8 bg-bg-tertiary rounded-lg" />
              <div className="w-8 h-8 bg-bg-tertiary rounded-lg" />
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-2">
        <div className="h-3.5 w-36 bg-bg-tertiary rounded" />
        <div className="flex items-center gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-8 h-8 bg-bg-tertiary rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
