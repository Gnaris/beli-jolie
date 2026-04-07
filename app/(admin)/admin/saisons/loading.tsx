export default function SaisonsLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 bg-bg-tertiary rounded-lg" />
        <div className="h-10 w-32 bg-bg-tertiary rounded-xl" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-2">
            <div className="h-5 w-2/3 bg-bg-tertiary rounded" />
            <div className="h-4 w-1/3 bg-bg-tertiary rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
