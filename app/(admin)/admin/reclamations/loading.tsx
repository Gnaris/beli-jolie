export default function ReclamationsLoading() {
  return (
    <div className="space-y-5 md:space-y-6 animate-pulse">
      <div className="rounded-3xl border border-border bg-bg-secondary/40 h-40 md:h-48" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-bg-secondary/40 h-28" />
        ))}
      </div>
      <div className="rounded-2xl border border-border bg-bg-secondary/40 h-20" />
      <div className="rounded-2xl border border-border bg-bg-primary overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-b border-border h-20 px-6 flex items-center gap-4">
            <div className="h-4 w-32 bg-bg-secondary rounded" />
            <div className="h-4 w-48 bg-bg-secondary rounded" />
            <div className="flex-1" />
            <div className="h-5 w-20 bg-bg-secondary rounded-full" />
            <div className="h-4 w-20 bg-bg-secondary rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
