export default function CompositionsLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-44 bg-bg-tertiary rounded-lg" />
        <div className="h-10 w-36 bg-bg-tertiary rounded-xl" />
      </div>
      <div className="card overflow-hidden">
        <div className="table-header h-12" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="table-row h-14 flex items-center gap-4 px-4">
            <div className="h-4 w-40 bg-bg-tertiary rounded" />
            <div className="flex-1" />
            <div className="h-4 w-16 bg-bg-tertiary rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
