export default function PfsResumeDetailLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-56 bg-bg-tertiary rounded-lg" />
      <div className="card p-6 space-y-4">
        <div className="h-5 w-40 bg-bg-tertiary rounded" />
        <div className="h-4 w-full bg-bg-tertiary rounded" />
        <div className="h-4 w-3/4 bg-bg-tertiary rounded" />
      </div>
      <div className="card overflow-hidden">
        <div className="table-header h-12" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="table-row h-14 flex items-center gap-4 px-4">
            <div className="h-4 w-28 bg-bg-tertiary rounded" />
            <div className="h-4 w-24 bg-bg-tertiary rounded" />
            <div className="flex-1" />
            <div className="h-5 w-16 bg-bg-tertiary rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
