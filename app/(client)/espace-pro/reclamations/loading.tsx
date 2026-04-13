export default function ReclamationsLoading() {
  return (
    <div className="p-6 md:p-10 space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-44 bg-gray-200 rounded" />
        <div className="h-10 w-36 bg-gray-200 rounded-xl" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4 flex items-center gap-4">
            <div className="h-4 w-28 bg-gray-200 rounded" />
            <div className="h-4 w-32 bg-gray-200 rounded" />
            <div className="flex-1" />
            <div className="h-5 w-20 bg-gray-200 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
