export default function ReclamationsLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-44 bg-bg-tertiary rounded-lg" />
      <div className="card overflow-hidden">
        <div className="table-header h-12" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="table-row h-16 flex items-center gap-4 px-4">
            <div className="h-4 w-32 bg-bg-tertiary rounded" />
            <div className="h-4 w-48 bg-bg-tertiary rounded" />
            <div className="flex-1" />
            <div className="h-5 w-20 bg-bg-tertiary rounded-full" />
            <div className="h-4 w-20 bg-bg-tertiary rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
