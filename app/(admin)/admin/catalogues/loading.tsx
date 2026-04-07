export default function CataloguesLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-40 bg-bg-tertiary rounded-lg" />
        <div className="h-10 w-32 bg-bg-tertiary rounded-xl" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card p-5 space-y-3">
            <div className="h-5 w-3/4 bg-bg-tertiary rounded" />
            <div className="h-4 w-1/2 bg-bg-tertiary rounded" />
            <div className="h-4 w-1/3 bg-bg-tertiary rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
