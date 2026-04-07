export default function DocumentsLegauxLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-bg-tertiary rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-5 space-y-3">
            <div className="h-5 w-2/3 bg-bg-tertiary rounded" />
            <div className="h-4 w-full bg-bg-tertiary rounded" />
            <div className="h-4 w-3/4 bg-bg-tertiary rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
