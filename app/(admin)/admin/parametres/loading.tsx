export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Page header */}
      <div>
        <div className="h-8 w-44 bg-bg-primary rounded" />
        <div className="h-4 w-64 bg-bg-primary rounded mt-2" />
      </div>

      {/* Tab navigation */}
      <div className="flex gap-2 border-b border-border pb-px overflow-x-auto">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-9 rounded-t-lg bg-bg-primary"
            style={{ width: `${70 + i * 12}px` }}
          />
        ))}
      </div>

      {/* Settings form blocks */}
      <div className="space-y-6">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="bg-bg-primary border border-border rounded-2xl p-6 space-y-4"
          >
            <div className="h-5 w-48 bg-border rounded" />
            <div className="h-4 w-full max-w-md bg-border rounded" />
            <div className="h-10 w-full bg-border rounded-lg" />
            <div className="h-10 w-full bg-border rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
