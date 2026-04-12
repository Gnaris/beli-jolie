export default function ProductEditLoading() {
  return (
    <div className="max-w-[1600px] mx-auto space-y-8 animate-pulse">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-bg-secondary/95 backdrop-blur-sm border-b border-border -mx-6 px-6 pt-3 pb-4">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-[13px] mb-3">
          <div className="h-3.5 w-16 bg-bg-tertiary rounded" />
          <div className="h-3.5 w-3.5 bg-bg-tertiary rounded" />
          <div className="h-3.5 w-32 bg-bg-tertiary rounded" />
          <div className="h-3.5 w-3.5 bg-bg-tertiary rounded" />
          <div className="h-3.5 w-16 bg-bg-tertiary rounded" />
        </nav>
        {/* Title + actions row */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-7 w-48 bg-bg-tertiary rounded-lg" />
            <div className="h-4 w-24 bg-bg-tertiary rounded" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-10 w-32 bg-bg-tertiary rounded-xl" />
            <div className="h-10 w-40 bg-bg-tertiary rounded-xl" />
          </div>
        </div>
        {/* Section title + badges */}
        <div className="flex items-center gap-3 flex-wrap mt-4 pt-4 border-t border-border">
          <div className="h-5 w-48 bg-bg-tertiary rounded" />
          <div className="h-7 w-20 bg-bg-tertiary rounded-full" />
        </div>
      </div>

      {/* Form sections */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-8">
        {/* Main column */}
        <div className="space-y-6">
          {/* Basic info block */}
          <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm space-y-4">
            <div className="h-5 w-32 bg-bg-tertiary rounded" />
            <div className="h-10 w-full bg-bg-tertiary rounded-lg" />
            <div className="h-10 w-full bg-bg-tertiary rounded-lg" />
            <div className="h-24 w-full bg-bg-tertiary rounded-lg" />
          </div>

          {/* Variants block */}
          <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm space-y-4">
            <div className="h-5 w-24 bg-bg-tertiary rounded" />
            <div className="h-20 w-full bg-bg-tertiary rounded-lg" />
            <div className="h-20 w-full bg-bg-tertiary rounded-lg" />
          </div>

          {/* Images block */}
          <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm space-y-4">
            <div className="h-5 w-20 bg-bg-tertiary rounded" />
            <div className="flex gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="w-24 h-24 bg-bg-tertiary rounded-xl" />
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-sm space-y-4">
            <div className="h-5 w-24 bg-bg-tertiary rounded" />
            <div className="h-10 w-full bg-bg-tertiary rounded-lg" />
            <div className="h-10 w-full bg-bg-tertiary rounded-lg" />
            <div className="h-10 w-full bg-bg-tertiary rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
