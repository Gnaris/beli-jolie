export default function BrouillonDetailLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-52 bg-bg-tertiary rounded-lg" />
        <div className="h-10 w-28 bg-bg-tertiary rounded-xl" />
      </div>
      <div className="card p-6 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-4 w-full bg-bg-tertiary rounded" />
        ))}
      </div>
    </div>
  );
}
