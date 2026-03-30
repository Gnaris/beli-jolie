export default function Loading() {
  return (
    <div className="p-6 md:p-10 space-y-8 animate-pulse">
      {/* Page title */}
      <div className="space-y-2">
        <div className="h-8 w-56 bg-gray-200 rounded" />
        <div className="h-4 w-80 bg-gray-200 rounded" />
      </div>

      {/* Stat cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="h-28 bg-gray-200 rounded-xl"
          />
        ))}
      </div>

      {/* Recent orders section */}
      <div className="space-y-4">
        <div className="h-6 w-40 bg-gray-200 rounded" />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-20 bg-gray-200 rounded-xl"
            />
          ))}
        </div>
      </div>

      {/* Account info block */}
      <div className="h-48 bg-gray-200 rounded-xl" />
    </div>
  );
}
