export default function PaysLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-28 bg-bg-tertiary rounded-lg" />
        <div className="h-10 w-32 bg-bg-tertiary rounded-xl" />
      </div>
      <div className="card overflow-hidden">
        <div className="table-header h-12" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="table-row h-14 flex items-center gap-4 px-4">
            <div className="h-4 w-8 bg-bg-tertiary rounded" />
            <div className="h-4 w-32 bg-bg-tertiary rounded" />
            <div className="flex-1" />
            <div className="h-4 w-12 bg-bg-tertiary rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
