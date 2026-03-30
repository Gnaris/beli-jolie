export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Page header */}
      <div>
        <div className="h-8 w-48 bg-bg-primary rounded" />
        <div className="h-4 w-72 bg-bg-primary rounded mt-2" />
      </div>

      {/* Filters / search bar */}
      <div className="flex flex-wrap gap-3">
        <div className="h-10 w-64 bg-bg-primary rounded-lg" />
        <div className="h-10 w-36 bg-bg-primary rounded-lg" />
        <div className="h-10 w-36 bg-bg-primary rounded-lg" />
      </div>

      {/* Table rows */}
      <div className="bg-bg-primary border border-border rounded-2xl overflow-hidden">
        {/* Table header */}
        <div className="h-12 bg-bg-primary border-b border-border" />
        {/* Table rows */}
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="h-16 border-b border-border last:border-b-0 flex items-center px-4 gap-4"
          >
            <div className="h-8 w-8 bg-border rounded-full shrink-0" />
            <div className="h-4 w-40 bg-border rounded" />
            <div className="h-4 w-32 bg-border rounded" />
            <div className="h-6 w-20 bg-border rounded-full ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
