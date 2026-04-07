export default function CouleursLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-36 bg-bg-tertiary rounded-lg" />
        <div className="h-10 w-36 bg-bg-tertiary rounded-xl" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="card p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-bg-tertiary" />
            <div className="h-4 w-20 bg-bg-tertiary rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
